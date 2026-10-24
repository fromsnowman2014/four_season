// =====================================================================================
//  GLSL: the hazard particles (Phase-3 owner: lane Z).
//   ash    (wildfire) program 'ash' = the stateless precipitation core (PRECIP_VS: slice-box wrap of the lattice-
//          wrapped wind / fall integrals, 40 fall bins, the drag wake) + VS_ASH / FS_ASH: grey, irregular, slowly
//          tumbling flakes of burnt leaf and paper (pale grey to charred), drifting lazily with the wind, falling at
//          0.2-0.9 m/s (S.anim.ashI); lit by the smoky light, fogged like the snow. Premultiplied alpha.
//   ember  (wildfire) program 'ember' = PRECIP_VS + VS_EMBER / FS_EMBER: sparse glowing sparks carried by the wind,
//          rising and sinking in the turbulence (S.anim.emberI, speeds -0.7..+0.3 m/s), flickering as they cool;
//          additive (alpha 0) HDR, so the bloom halos them.
//   dust   (earthquake) program 'dust' = VS_DUST / FS_DUST, drawn by S.drawHazards (precip.js), NOT a slice-box layer:
//          plumes anchored on the scene itself. Each plume picks a screen point (seeded per quake), reads the G-buffer
//          there (distance, material, normal, G3) and keeps it only on the right ground: the valley's cliffs (rock,
//          steep: rockfall dust streaming down the face, and dust rolling off the foot of the wall), the house's street,
//          driveway and walkway edges (a material edge) and the fence (puffs). Its puffs are spawned over a few seconds
//          after the main shock (some plumes on the aftershocks), slide / rise, swell, drift with the wind and settle
//          over ~10-25 s. Soft noisy billboards, lit by the sun and the sky, fogged, depth-tested against the G-buffer.
//          Its colour and strength follow the ground (derive/events.js): wet ground raises little, a snowy street none,
//          snowy cliffs shed white powder plumes.
//  The rates come from derive/events.js (F.uAshRate, F.uEmberRate through the layer descriptors in precip.js; the dust
//  from derive/events.js draw.dust).
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  // ---------------------------------------------------------------------------------------------- ash
  C.VS_ASH = `
out vec2 vP;
flat out vec4 vSeed;
flat out vec4 vPar;       // drawn radius px, blur px, true radius px, aa
flat out vec4 vRot;       // cos, sin, squash, curl
out vec4 vCol;
out float vDist;
void main() {
  vec2 corner = CORNERS[gl_VertexID];
  uint id = uint(gl_InstanceID);
  vec4 r0, r1, r2;
  precipRand(r0, r1, r2);
  vec3 bw = sliceBase(r0);
  float t = uFlakeT;
  // fall: light ash drifts down slowly (0.2-0.9 m/s); the fall integral is S.anim.ashI (factor 1)
  int fbin = fallBin(r1.x);
  float fall = binSpeed(fbin);
  float resp = 0.65 + 0.35 * r1.y;                       // ash follows the wind closely (affine mix: the wrap stays exact)
  vec3 wdisp = mix(uDispA, uDispB, resp), wvel = mix(uWindA, uWindB, resp);
  // lazy eddies, larger than the snow's (rates on the W0 grid)
  float ta = 0.55 + 0.6 * uGale;
  vec3 ph = bw * vec3(0.31, 0.27, 0.35);
  float a1 = ph.x + ph.y * 0.7 + 13.0 * W0 * t, a2 = ph.z - ph.x * 0.6 + 21.0 * W0 * t + 2.0, a3 = ph.y + ph.z * 0.5 + 9.0 * W0 * t + 4.0;
  vec3 turb = ta * vec3(sin(a1) + 0.5 * sin(2.0 * a2), 0.8 * sin(a3), sin(a2) + 0.5 * sin(2.0 * a1 + 1.0));
  vec3 turbV = ta * W0 * vec3(13.0 * cos(a1) + 21.0 * cos(2.0 * a2), 0.8 * 9.0 * cos(a3), 21.0 * cos(a2) + 13.0 * cos(2.0 * a1 + 1.0));
  // flutter: a slow side-to-side rocking as a flat flake falls
  float fw = floor(mix(40.0, 120.0, r1.z) + 0.5) * W0, fph = fw * t + r1.w * 6.2831853;
  vec3 flut = 0.08 * vec3(cos(fph), 0.3 * sin(2.0 * fph), sin(fph));
  vec3 flutV = 0.08 * fw * vec3(-sin(fph), 0.6 * cos(2.0 * fph), cos(fph));
  vec3 cs = sliceWrap(bw + wdisp + uFallQ[fbin] + turb + flut);
  vec2 ndc, sv;
  project(cs, wvel + vec3(0.0, -fall, 0.0) + turbV + flutV, ndc, sv);
  float zc = cs.z;
  precipWake(ndc, sv, zc, 0.9);
  if (offScreen(zc, ndc)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // size per layer: near big flakes (5-16 mm), mid, far fine specks
  float size = uLayer == 13 ? mix(0.006, 0.02, r2.x * r2.x) : uLayer == 12 ? mix(0.005, 0.014, r2.x) : mix(0.004, 0.01, r2.x);
  float rTrue = 0.5 * size / max(zc, 0.05) * uFocalPx;
  float coc = uCocK * max(0.0, 1.0 / max(zc, 0.05) - 1.0 / uFocus);
  float rD = max(rTrue + coc, 0.9);
  float speed = length(sv), blur = speed / 200.0;       // a fast shutter: the slow flakes stay crisp
  vec2 dir = speed > 1e-3 ? sv / speed : vec2(0.0, -1.0);
  float a = sliceFade(zc) * clamp(uCount - float(id), 0.0, 1.0);
  a *= min(1.0, sq(rTrue / rD) * 1.5 + 0.4) * (2.0 * rD) / (2.0 * rD + blur);
  a *= uLayer == 9 ? 0.75 : 0.92;
  if (a < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // tumble: a flat flake rocks edge-on and back
  float tum = r2.w * 6.2831853 + floor(mix(0.4, 1.6, r1.z) / W0 + 0.5) * W0 * t;
  float squash = mix(1.0 - 0.75 * sq(0.5 - 0.5 * cos(tum)), 1.0, sat(coc / max(rTrue, 0.5)));
  float ang = r2.z * 6.2831853 + floor((r1.y - 0.5) * 1.6 / W0 + 0.5) * W0 * t;
  vec3 pW = uCamPos + uCamR * cs.x + uCamU * cs.y + uCamF * cs.z;
  float dist = length(cs);
  vec3 V = (pW - uCamPos) / dist;
  // pale grey flakes to charred black bits, a little warm; lit by the (smoky) sun and sky
  float alb = mix(0.07, 0.62, r2.y * r2.y);
  vec3 tint = mix(vec3(1.0, 0.95, 0.88), vec3(1.0), r0.w);
  float facing = abs(cos(tum));
  vec3 col = alb * tint * (uSunCol * (0.25 + 0.35 * facing) * mix(1.0, cloudShadow(pW), 0.6) + uSkyAmb * 1.1);
  vec4 fg = fogAt(dist, V);
  col = col * fg.a + fg.rgb * 0.6;
  float hl = rD + 0.5 * blur + 1.2, hw = rD + 1.2;
  vec2 perp = vec2(-dir.y, dir.x);
  gl_Position = vec4(ndc + (dir * corner.x * hl + perp * corner.y * hw) / (0.5 * uRes), 0.0, 1.0);
  vP = vec2(corner.x * hl, corner.y * hw);
  vSeed = r1.wzyx * 0.7 + r2.yxwz * 0.3;
  float rel = atan(dir.y, dir.x) - ang;
  vPar = vec4(rD, blur, max(rTrue, 0.6), (0.9 + coc) / max(rTrue, 0.6));
  vRot = vec4(cos(rel), sin(rel), squash, r0.x);
  vCol = vec4(col, a);
  vDist = dist;
}
`;
  C.FS_ASH = `
uniform vec2 uRes;
in vec2 vP;
flat in vec4 vSeed;
flat in vec4 vPar;
flat in vec4 vRot;
in vec4 vCol;
in float vDist;
out vec4 o;
float sq(float x) { return x * x; }
// an irregular torn flake: a lobed outline (a few harmonics from the seed), a notch, a darker curled rim
float ashShape(vec2 q, float aa) {
  float r = length(q);
  if (r > 1.25 + aa) return 0.0;
  float an = atan(q.y, q.x);
  vec4 s = vSeed * 6.2831853;
  float R = 0.78 + 0.16 * sin(3.0 * an + s.x) + 0.1 * sin(5.0 * an + s.y) + 0.07 * sin(8.0 * an + s.z) + 0.05 * sin(13.0 * an + s.w);
  R -= 0.3 * exp(-sq(mod(an - s.z + 3.14159, 6.2831853) - 3.14159) * 8.0) * step(0.5, vSeed.x);   // a torn notch
  float c = 1.0 - smoothstep(R - aa, R + aa, r);
  float rim = smoothstep(R - 0.3 - aa, R, r);
  return c * (0.85 + 0.15 * sin(q.x * 7.0 + s.x) * sin(q.y * 6.0 + s.y)) * (1.0 - 0.35 * rim);
}
void main() {
  float rD = vPar.x, blur = vPar.y;
  float cov;
  vec2 sp = vP;
  if (vPar.z < 2.0) {
    // a speck (under ~2 px): a soft disc (its energy is kept by the alpha factor in VS_ASH), streaked if it moves
    vec2 q = vec2(max(abs(vP.x) - 0.5 * blur, 0.0), vP.y);
    float d = length(q) / rD;
    cov = exp(-d * d * 2.3);
  } else if (blur < 1.5 * rD) {
    vec2 q = vec2(vRot.x * sp.x - vRot.y * sp.y, vRot.y * sp.x + vRot.x * sp.y) / vPar.z;
    q.y /= max(vRot.z, 0.2);
    cov = ashShape(q, vPar.w * inversesqrt(max(vRot.z, 0.2)));
  } else {
    vec2 q = vec2(max(abs(vP.x) - 0.5 * blur, 0.0), vP.y);
    float d = length(q) / rD;
    cov = exp(-d * d * 2.0) * min(1.0, 2.0 * rD / (blur + 2.0 * rD)) * 1.4;
  }
  vec2 suv = gl_FragCoord.xy / uRes;
  float occ = clamp((G0(suv).x - vDist) / max(0.4, 0.05 * vDist), 0.0, 1.0);
  float a = clamp(cov * vCol.a * occ, 0.0, 1.0);
  if (a < 0.0015) discard;
  o = vec4(vCol.rgb * a, a);
}
`;
  // ---------------------------------------------------------------------------------------------- embers
  C.VS_EMBER = `
out vec2 vP;
flat out vec4 vPar;       // radius px, blur px, glow px, 0
out vec3 vCol;
out float vDist;
void main() {
  vec2 corner = CORNERS[gl_VertexID];
  uint id = uint(gl_InstanceID);
  vec4 r0, r1, r2;
  precipRand(r0, r1, r2);
  vec3 bw = sliceBase(r0);
  float t = uFlakeT;
  int fbin = fallBin(r1.x);
  float fall = binSpeed(fbin);                            // negative: rising
  float resp = 0.85 + 0.15 * r1.y;
  vec3 wdisp = mix(uDispA, uDispB, resp), wvel = mix(uWindA, uWindB, resp);
  // embers swirl: strong eddies, updrafts
  float ta = 0.9 + 0.8 * uGale;
  vec3 ph = bw * vec3(0.23, 0.29, 0.21);
  float a1 = ph.x + ph.y * 0.7 + 17.0 * W0 * t, a2 = ph.z - ph.x * 0.6 + 26.0 * W0 * t + 2.0, a3 = ph.y + ph.z * 0.5 + 11.0 * W0 * t + 4.0;
  vec3 turb = ta * vec3(sin(a1) + 0.5 * sin(2.0 * a2), 1.1 * sin(a3), sin(a2) + 0.5 * sin(2.0 * a1 + 1.0));
  vec3 turbV = ta * W0 * vec3(17.0 * cos(a1) + 26.0 * cos(2.0 * a2), 1.1 * 11.0 * cos(a3), 26.0 * cos(a2) + 17.0 * cos(2.0 * a1 + 1.0));
  vec3 cs = sliceWrap(bw + wdisp + uFallQ[fbin] + turb);
  vec2 ndc, sv;
  project(cs, wvel + vec3(0.0, -fall, 0.0) + turbV, ndc, sv);
  float zc = cs.z;
  precipWake(ndc, sv, zc, 1.0);
  if (offScreen(zc, ndc)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // an ember is 1-4 mm: sub-pixel beyond a few metres; a hot point with a short streak (a 1/40 s exposure) and a glow
  float size = mix(0.0012, 0.004, r2.x * r2.x);
  float rTrue = 0.5 * size / max(zc, 0.05) * uFocalPx;
  float coc = min(uCocK * max(0.0, 1.0 / max(zc, 0.05) - 1.0 / uFocus), 12.0 * uRes.y / 1080.0);
  float rD = max(rTrue + coc, 0.75 * uRes.y / 1080.0);
  float speed = length(sv), blur = min(speed / 90.0, 40.0 * uRes.y / 1080.0);
  vec2 dir = speed > 1e-3 ? sv / speed : vec2(0.0, 1.0);
  float a = sliceFade(zc) * clamp(uCount - float(id), 0.0, 1.0);
  // flicker as it tumbles and cools: per-ember rates on the W0 grid
  float fl = 0.55 + 0.45 * sin(floor(mix(60.0, 200.0, r1.z) + 0.5) * W0 * t + r1.w * 6.2831853);
  fl *= 0.7 + 0.3 * sin(floor(mix(150.0, 420.0, r2.y) + 0.5) * W0 * t + r2.z * 6.2831853);
  float heat = r0.w;
  vec3 col = mix(vec3(1.0, 0.2, 0.025), vec3(1.0, 0.45, 0.1), heat) * mix(3.5, 9.0, heat * heat) * fl * a;
  // the energy of a sub-pixel ember spread over its drawn disc and streak
  col *= min(1.0, sq(rTrue / rD) * 4.0 + 0.45) * (2.0 * rD + 1.0) / (2.0 * rD + blur + 1.0);
  vec3 pW = uCamPos + uCamR * cs.x + uCamU * cs.y + uCamF * cs.z;
  float dist = length(cs);
  col *= fogAt(dist, (pW - uCamPos) / dist).a;
  if (max(col.r, col.g) < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float gw = rD * 2.5 + 1.5;
  float hl = rD + 0.5 * blur + gw, hw = rD + gw;
  vec2 perp = vec2(-dir.y, dir.x);
  gl_Position = vec4(ndc + (dir * corner.x * hl + perp * corner.y * hw) / (0.5 * uRes), 0.0, 1.0);
  vP = vec2(corner.x * hl, corner.y * hw);
  vPar = vec4(rD, blur, gw, 0.0);
  vCol = col;
  vDist = dist;
}
`;
  C.FS_EMBER = `
uniform vec2 uRes;
in vec2 vP;
flat in vec4 vPar;
in vec3 vCol;
in float vDist;
out vec4 o;
void main() {
  float rD = vPar.x, blur = vPar.y, gw = vPar.z;
  vec2 q = vec2(max(abs(vP.x) - 0.5 * blur, 0.0), vP.y);
  float d = length(q);
  float core = exp(-d * d / (rD * rD) * 1.6);
  float glow = exp(-d / gw * 2.0) * 0.3;
  vec2 suv = gl_FragCoord.xy / uRes;
  float occ = clamp((G0(suv).x - vDist) / max(0.4, 0.05 * vDist), 0.0, 1.0);
  vec3 c = vCol * (core + glow) * occ;
  if (max(c.r, c.g) < 0.002) discard;
  o = vec4(c, 0.0);          // additive
}
`;
  // ---------------------------------------------------------------------------------------------- quake dust
  C.VS_DUST = `
uniform vec4 uDust;        // x time since the main shock (s), y seed, z scene (0 valley, 1 house), w strength
uniform vec4 uDustC;       // rgb the dust's albedo (rock flour, street dust; powder snow off snowy cliffs)
uniform float uAspect, uFocalPx;
uniform vec3 uWindA, uWindB;   // the wind (m/s; derive/precip.js): the dust drifts with it
out vec2 vP;               // -1..1 across the puff
flat out vec4 vPar;        // radius px, seed, density, 0
out vec3 vCol;
out float vDist;
float hh(float a, float b) { return hf(uint(a) * 0x27d4eb2du ^ hu(uint(b) + 0x165667b1u)); }
void cullD() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
float matAt(vec2 uv) { return floor(G0(uv).y + 0.001); }
void main() {
  int NK = 36;
  int pl = gl_InstanceID / NK, k = gl_InstanceID - pl * NK;
  float fp = float(pl), fk = float(k), sd = uDust.y;
  bool house = uDust.z > 0.5;
  // (stage 2b) the house: fewer, distinct plumes (26 of the 40) instead of a continuous band along the curb
  if (house && pl >= 26) { cullD(); return; }
  // the plume's anchor: seeded screen points (up to 4 tries), kept only on the right ground
  //  valley: 2 of 3 plumes on the cliff faces (rock, steep: rockfall), the rest at the wall's foot (rock giving way to
  //          turf); house: hard ground at a material edge (the curbs, the driveway / walkway / sidewalk edges), the fence
  vec2 uvA = vec2(0.0); vec4 g0 = vec4(0.0); vec3 n = vec3(0.0, 1.0, 0.0);
  bool ok = false, foot = hh(fp + 300.0, sd) > 0.66;
  vec2 along = vec2(1.0, 0.0);
  for (int j = 0; j < 4; j++) {
    float fj = float(j) * 977.0;
    uvA = house ? vec2(mix(0.02, 0.98, hh(fp + fj, sd)), mix(0.08, 0.62, hh(fp + 50.0 + fj, sd)))
                : (foot ? vec2(mix(0.3, 0.99, hh(fp + fj, sd)), mix(0.42, 0.8, hh(fp + 50.0 + fj, sd)))
                        : vec2(mix(0.2, 0.99, hh(fp + fj, sd)), mix(0.55, 0.97, hh(fp + 50.0 + fj, sd))));
    g0 = G0(uvA);
    if (g0.x > 60000.0) continue;
    float mat = floor(g0.y + 0.001);
    n = octDec(G2(uvA).zw);
    if (house) {
      vec2 e = vec2(0.005, 0.009);
      bool hx = matAt(uvA + vec2(e.x, 0.0)) != mat || matAt(uvA - vec2(e.x, 0.0)) != mat;
      bool hy = matAt(uvA + vec2(0.0, e.y)) != mat || matAt(uvA - vec2(0.0, e.y)) != mat;
      // (stage 2b: and the roof's edges: dust and grit shaken off the eaves and the ridge fall as a veil)
      bool hyR = mat == 6.0 && (matAt(uvA + vec2(0.0, 0.035)) != mat || matAt(uvA - vec2(0.0, 0.035)) != mat);
      ok = (mat >= 11.0 && mat <= 14.0 && (hx || hy)) || mat == 15.0 || hyR;
      along = hx && !hy ? vec2(0.0, 1.0) : vec2(1.0, 0.0);      // spread along the edge (a curb across the view: x)
    } else {
      float rock = G3(uvA).r;
      ok = mat == 1.0 && g0.x > 700.0 && (foot ? rock > 0.15 && rock < 0.7 : rock > 0.45 && n.y < 0.85);
    }
    if (ok) break;
  }
  if (!ok) { cullD(); return; }
  vec3 A = uCamPos + camRay(uvA * uRes) * g0.x;
  bool roof = house && floor(g0.y + 0.001) == 6.0;
  // timing: most plumes go with the main shock (a few seconds' spread), the rest with the aftershocks
  float r1 = hh(fp + 100.0, sd), r2 = hh(fp + 150.0, sd), r3 = hh(fp + 200.0, sd);
  float t0 = r1 < 0.7 ? 3.0 * r2 * r2 : (r1 < 0.87 ? 8.1 : 10.5) + 0.8 * r2;
  float emit = house ? mix(0.8, 2.2, r3) : mix(3.0, 6.0, r3);
  float ts = t0 + emit * (fk + hh(fk, fp + sd)) / float(NK);
  float age = uDust.x - ts;
  float life = house ? 3.0 + 4.0 * hh(fk + 30.0, fp) : 12.0 + 12.0 * hh(fk + 30.0, fp);
  if (age < 0.0 || age > life) { cullD(); return; }
  float rk1 = hh(fk + 60.0, fp), rk2 = hh(fk + 90.0, fp), rk3 = hh(fk + 120.0, fp);
  vec3 P;
  float rad;
  if (house) {
    // a puff shaken off the edge: a little column around the spot, thrown up 0.3-1.3 m, billowing out, settling
    // (stage 2b: tighter around its spot and taller, so each plume reads as one puff of dust); off the roof: grit
    // falling from the eaves in a thin veil that spreads as it drops
    vec3 ax = along.x > 0.5 ? uCamR : normalize(vec3(uCamF.x, 0.0, uCamF.z));
    float sl = 1.0 - exp(-age / 0.8);
    if (roof) {
      P = A + ax * (rk1 - 0.5) * 1.6 + vec3(rk3 - 0.5, 0.0, rk2 - 0.5) * 0.5 * sl - vec3(0.0, min(4.0 * age * age, A.y + 0.2) * (0.6 + 0.4 * rk2), 0.0);
      rad = (0.1 + 0.32 * (1.0 - exp(-age / 1.0))) * mix(0.7, 1.3, rk3);
    } else {
      P = A + ax * (rk1 - 0.5) * 1.1 + vec3(rk3 - 0.5, 0.0, rk2 - 0.5) * 0.9 * sl + vec3(0.0, (0.3 + 1.0 * rk2 * rk2) * sl - 0.04 * age, 0.0);
      rad = (0.14 + 0.55 * (1.0 - exp(-age / 1.6))) * mix(0.7, 1.3, rk3);
    }
  } else {
    // rockfall: the debris runs down the face (its front at s(t)), leaving dust behind it that billows out from the
    // face, rises and swells; at the wall's foot it rolls out across the slope
    vec3 g = vec3(0.0, -1.0, 0.0);
    vec3 down = normalize(g - n * dot(g, n) + vec3(0.0, -1e-3, 0.0));
    vec3 side = normalize(cross(n, down) + 1e-4);
    float U = foot ? 70.0 : 110.0;
    float te = ts - t0;                                       // when the front passed: the puff starts there
    float front = U * (foot ? 2.0 : 4.5) * (1.0 - exp(-te / 2.2)) * mix(0.7, 1.2, r2);
    float bil = 1.0 - exp(-age / 2.5);
    P = A + down * front + side * (rk1 - 0.5) * U * 0.7 + n * U * (0.15 + 0.5 * rk2) * bil + vec3(0.0, U * 0.05 * age * (0.4 + 0.6 * rk3), 0.0);
    rad = U * (0.35 + 0.9 * bil) * mix(0.6, 1.3, rk3);
  }
  P += mix(uWindA, uWindB, 0.5) * age * 0.5;
  vec3 c = vec3(dot(P - uCamPos, uCamR), dot(P - uCamPos, uCamU), dot(P - uCamPos, uCamF));
  if (c.z < 0.5) { cullD(); return; }
  vec2 ndc = vec2(c.x / (c.z * uTanH * uAspect), c.y / (c.z * uTanH));
  float rPx = rad / c.z * uFocalPx;
  if (abs(ndc.x) > 1.3 || abs(ndc.y) > 1.3 || rPx < 0.5) { cullD(); return; }
  float dens = smoothstep(0.0, house ? 0.15 : 0.6, age) * sq(1.0 - age / life) * uDust.w * (house ? (roof ? 0.3 : 0.42) : 0.32) * mix(0.6, 1.0, rk1);
  if (house) dens *= mix(0.45, 1.0, smoothstep(6.0, 14.0, c.z)) * (0.55 + 0.9 * hh(fp + 400.0, sd));   // (the near ones thinner; plumes differ)
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  gl_Position = vec4(ndc + corner * rPx / (0.5 * uRes), 0.0, 1.0);
  vP = corner;
  vPar = vec4(rPx, fk * 0.37 + fp * 0.11, dens, 0.0);
  float dist = length(P - uCamPos);
  vec3 V = (P - uCamPos) / dist;
  // dry dust: grey-beige rock flour in the valley, a light tan street dust at the house; lit from the sun side and
  // the sky (dust is translucent: no hard terminator), fogged
  vec3 alb = uDustC.rgb;
  float sunF = 0.5 + 0.3 * max(dot(normalize(vec3(rk1 - 0.5, 0.6, rk3 - 0.5)), uSunDir), 0.0);
  vec3 col = alb * (uSunCol * sunF * cloudShadow(P) + uSkyAmb * 0.85);
  vec4 fg = fogAt(dist, V);
  vCol = col * fg.a + fg.rgb;
  vDist = dist;
}
`;
  C.FS_DUST = `
in vec2 vP;
flat in vec4 vPar;
in vec3 vCol;
in float vDist;
out vec4 o;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  // a soft billow: a radial falloff broken up by two octaves of noise
  vec2 q = vP * 2.2 + vPar.y * 13.0;
  float n = tnoise(q) * 0.6 + tnoise(q * 2.3 + 7.0) * 0.4;
  float d = (1.0 - smoothstep(0.1, 1.0, r + 0.45 * (n - 0.5))) * vPar.z * (0.5 + 1.0 * n);
  vec2 suv = gl_FragCoord.xy / uRes;
  float st = G0(suv).x;
  float occ = clamp((st - vDist) / max(0.3, 0.04 * vDist), 0.0, 1.0);
  float a = clamp(d * occ, 0.0, 1.0);
  if (a < 0.002) discard;
  o = vec4(vCol * a, a);
}
`;
  // (lazy: built on first use or by the background prewarm, not with the scene's set at boot / on a switch: gl.js)
  S.glsl.progs.ash = { vs: ['COMMON', 'ENV', 'ATMOS', 'PRECIP_VS', 'VS_ASH'], fs: ['PRECISION_FI', 'ENV', 'GBUF', 'FS_ASH'], lazy: true };
  S.glsl.progs.ember = { vs: ['COMMON', 'ENV', 'ATMOS', 'PRECIP_VS', 'VS_EMBER'], fs: ['PRECISION_FI', 'ENV', 'GBUF', 'FS_EMBER'], lazy: true };
  S.glsl.progs.dust = { vs: ['COMMON', 'ENV', 'ATMOS', 'GBUF', 'VS_DUST'], fs: ['COMMON', 'ENV', 'GBUF', 'FS_DUST'], lazy: true };
})(window.SNOW);
