// =====================================================================================
//  GLSL: rain (stage-1 owner: lane E). Instanced, stateless raindrops in camera-aligned depth slices, drawn with the
//  same per-layer contract as the flakes and the shared PRECIP_VS core (flake.js): base point, wind integrals, the
//  40 fall bins (uFallQ over uFallLH, wrapped from S.anim.rainI), the slice-box wrap and the drag wake.
//  Each drop has a fixed diameter (1.6-4.4 mm, mostly small) and the matching terminal speed (5.7-8.9 m/s); the
//  streak is the drop's path during the rain shutter uExpoRain, so its length follows speed and depth. A drop is a
//  tiny lens: it shows the wide environment (mostly the bright sky) refracted, so it reads as a bright line over
//  dark forest and almost vanishes against the sky; sunlit drops add a forward glow and glints along the streak.
//  Near drops (0.3-1.5 m) are defocused by the same one-sided circle of confusion as the flakes.
//  Program 'rain' = COMMON + ENV + ATMOS + PRECIP_VS + VS_RAIN | PRECISION_FI + ENV + GBUF + FS_RAIN.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.VS_RAIN = `
uniform float uRainV;     // rain fall factor (= d rainI / dt)
uniform float uExpoRain;  // rain shutter (s): the streak is the drop's path while it is open
uniform float uPushK;     // the layer's drag-wake weight
uniform vec2 uRainGust;   // scroll of the gust bands (integrated wind, wrapped by the 256 noise period on the CPU)
out vec2 vP;              // quad position in px: x along the streak, y across
flat out vec4 vPar;       // half width px (incl. defocus), streak length px, bead frequency, bead phase
flat out vec3 vSun;       // sun glint colour along the streak (premultiplied by the drop's alpha later)
flat out float vDef;      // defocus share of the half width (0 sharp .. 1 a soft out-of-focus blur)
out vec4 vCol;
out float vDist;

void main() {
  vec2 corner = CORNERS[gl_VertexID];
  uint id = uint(gl_InstanceID);
  vec4 r0, r1, r2;
  precipRand(r0, r1, r2);
  vec3 bw = sliceBase(r0);
  float t = uFlakeT;

  // drop diameter (mm), skewed to small drops; terminal speed from the Atlas fit v = 9.65 - 10.3 exp(-0.6 D).
  // The distribution is fixed: heavier rain means more drops, never faster ones (speed only via the integral)
  float D = mix(1.6, 4.4, r0.w * r0.w);
  int fbin = fallBin((9.65 - 10.3 * exp(-0.6 * D) - uFallLH.x) / (uFallLH.y - uFallLH.x));
  float fall = binSpeed(fbin) * uRainV;
  // dense drops answer the wind sluggishly (an affine mix of the two integrals: the lattice wrap stays exact)
  float resp = 0.12 + 0.25 * r1.y;
  vec3 wdisp = mix(uDispA, uDispB, resp);
  vec3 wvel = mix(uWindA, uWindB, resp);
  // a little horizontal turbulence (the snow eddies at a tenth of their amplitude; rates on the W0 grid)
  float ta = 0.03 + 0.12 * uGale;
  vec3 ph = bw * vec3(0.37, 0.29, 0.33);
  float a1 = ph.x + ph.y * 0.7 + 16.0 * W0 * t, a2 = ph.z - ph.x * 0.6 + 25.0 * W0 * t + 2.0;
  vec3 turb = ta * vec3(sin(a1), 0.0, sin(a2));
  vec3 turbV = ta * W0 * vec3(16.0 * cos(a1), 0.0, 25.0 * cos(a2));

  vec3 cs = sliceWrap(bw + wdisp + uFallQ[fbin] + turb);
  vec2 ndc, sv;
  project(cs, wvel + vec3(0.0, -fall, 0.0) + turbV, ndc, sv);
  float zc = cs.z;
  precipWake(ndc, sv, zc, uPushK);
  if (offScreen(zc, ndc)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float a = sliceFade(zc) * clamp(uCount - float(id), 0.0, 1.0);
  // gusts sweep the rain in bands: a screen-space density noise drifting with the integrated wind (far layers)
  if (uGale > 0.0 && uLayer >= 7) {
    vec2 gq = vec2(ndc.x * uAspect, ndc.y) * 1.6 + uRainGust;
    float gs = tnoise(gq) * 0.65 + tnoise(gq * 2.3 + 5.0) * 0.35;
    a *= mix(1.0, 0.25 + 1.5 * smoothstep(0.3, 0.72, gs), 0.85 * uGale);
  }
  if (a < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float rTrue = 0.5 * D * 0.001 / max(zc, 0.05) * uFocalPx;
  float speed = length(sv);
  vec2 dir = speed > 1e-3 ? sv / speed : vec2(0.0, -1.0);
  // streak length: the path while the shutter is open (a drop crossing the lens is capped: longer is invisible)
  float blur = min(speed * uExpoRain, (uLayer == 5 ? 170.0 : 320.0) * uRes.y / 1080.0);
  float coc = min(uCocK * max(0.0, 1.0 / max(zc, 0.05) - 1.0 / uFocus), 40.0 * uRes.y / 1080.0);
  float rD = max(rTrue + coc, 0.6);
  // visibility: the true optical cover of a sub-pixel drop is ~0.5% (invisible), so it is boosted, but kept linear
  // in the drop size (a line's width cover, not a disc's area) and divided over the streak (the time share)
  float kVis = uLayer == 5 ? 3.5 : (uLayer == 6 ? 7.0 : (uLayer == 7 ? 8.0 : 9.0));
  a *= kVis * min(1.0, rTrue / rD) * (2.0 * rD + 1.0) / (blur + 2.0 * rD + 1.0);
  // per drop: most are faint, a few catch the light (brightness and visibility spread, so no even 'scratched film')
  float bri = mix(0.45, 1.25, r1.w * r1.w);
  a *= mix(0.55, 1.15, r2.x);
  a = min(a, 0.42);

  vec3 pW = uCamPos + uCamR * cs.x + uCamU * cs.y + uCamF * cs.z;
  float dist = length(cs);
  vec3 V = (pW - uCamPos) / dist;
  // the refracted environment: mostly sky (horizon-weighted), a little of the lit ground; slightly below the sky's
  // own radiance, so a drop is a faint grey line against the sky and a bright one against forest
  vec3 env = mix(uSkyHor, uSkyZen, 0.3) * 0.86 + uSkyAmb * 0.1;
  // sunlit drops (broken cloud): a forward-scattering glow toward the sun and glints along the streak
  float sunVis = (1.0 - uOvercast) * mix(1.0, cloudShadow(pW), 0.85);
  float mu = dot(V, uSunDir);
  float hg = (1.0 - 0.64) / pow(1.64 - 1.6 * mu, 1.5);         // Henyey-Greenstein, g = 0.8
  vec3 col = (env + uSunCol * sunVis * (0.03 + 0.02 * hg)) * bri;
  vec4 fg = fogAt(dist, V);
  col = col * fg.a + fg.rgb;

  float hl = rD + 0.5 * blur + 0.8, hw = rD + 0.8;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 offPx = dir * corner.x * hl + perp * corner.y * hw;
  gl_Position = vec4(ndc + offPx / (0.5 * uRes), 0.0, 1.0);
  vP = vec2(corner.x * hl, corner.y * hw);
  // the oscillating drop flashes the refracted sun a few times along its path (bead spacing ~ the drop's
  // oscillation period x its screen speed; at most ~1 bead per 6 px)
  vPar = vec4(rD, blur, 6.2831853 / max(speed * mix(0.008, 0.014, r2.y), 6.0), r2.z * 6.2831853);
  vDef = sat(coc / rD);
  vSun = uSunCol * sunVis * fg.a * bri * (0.35 + 0.25 * hg) * step(0.55, r1.z) * (1.0 - vDef);
  vCol = vec4(col, a);
  vDist = dist;
}
`;
  C.FS_RAIN = `
uniform vec2 uRes;
in vec2 vP;
flat in vec4 vPar;
flat in vec3 vSun;
flat in float vDef;
in vec4 vCol;
in float vDist;
out vec4 o;

void main() {
  float rD = vPar.x, hx = 0.5 * vPar.y;
  // capsule: a soft Gaussian line across (a defocused drop: a flatter, wider blur, like the near snow discs), the
  // exposure window along (the drop enters and leaves it: soft ends)
  float ax = max(abs(vP.x) - hx, 0.0);
  float d = length(vec2(ax, vP.y)) / rD;
  float cov = mix(exp(-d * d * 2.0), 0.75 * (1.0 - smoothstep(0.35, 1.0, d)), vDef);
  cov *= 1.0 - 0.55 * smoothstep(0.55, 1.0, abs(vP.x) / (hx + rD));
  // soft occlusion against the scene (G-buffer ray distance)
  vec2 suv = gl_FragCoord.xy / uRes;
  float occ = clamp((G0(suv).x - vDist) / max(0.4, 0.05 * vDist), 0.0, 1.0);
  float a = clamp(cov * vCol.a * occ, 0.0, 1.0);
  if (a < 0.0015) discard;
  float bead = pow(0.5 + 0.5 * sin(vP.x * vPar.z + vPar.w), 6.0);
  vec3 col = vCol.rgb + vSun * bead;
  // premultiplied; water transmits most of what is behind it, so the background is dimmed less than the
  // refracted light is added
  o = vec4(col * a, a * 0.8);
}
`;
  S.glsl.progs.rain = { vs: ['COMMON', 'ENV', 'ATMOS', 'PRECIP_VS', 'VS_RAIN'], fs: ['PRECISION_FI', 'ENV', 'GBUF', 'FS_RAIN'] };
})(window.SNOW);
