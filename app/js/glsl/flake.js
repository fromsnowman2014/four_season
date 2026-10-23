// =====================================================================================
//  GLSL: snowflakes (stage-1 owner: lane E). Instanced, stateless particles in camera-aligned depth slices:
//  the vertex shader places, wraps, streaks and lights each flake; the fragment shader draws the crystal shapes
//  and capsules with soft occlusion against the G-buffer and a cool tint over snow (read from the scene alpha).
//  PRECIP_VS is the stateless core both precipitation vertex shaders share (VS_FLAKE here, VS_RAIN in rain.js): the
//  per-layer uniforms, the per-instance hashes, the slice-box wrap, the projection and the drag wake.
//  Constants NB = 40 bins and TW = 120 must match precip.js (wrapLayer) and derive/precip.js (the % 120 clocks);
//  the fall-speed range comes per layer as uFallLH (the descriptor's vlo / vhi).
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.PRECIP_VS = `
uniform float uAspect, uFocalPx, uCocK, uFocus;
uniform vec3 uDispA, uDispB, uWindA, uWindB;
// Time never reaches these shaders as a raw, growing number: every term is either a CPU-integrated displacement
// that the CPU lattice-wraps exactly (wind, fall) or a phase whose rate is a multiple of 2*pi/TW, so the CPU
// can wrap its clock by TW with no discontinuity. Particles therefore never jump, however long the page runs.
uniform vec3 uFallQ[40];  // per fall-speed bin: (0,-k*F,0) reduced by the slice-box lattice (F = the layer's fall integral)
uniform vec2 uFallLH;     // fall-speed range of the layer's 40 bins (m/s at fall factor 1)
uniform float uFlakeT;    // oscillation clock, wrapped by TW on the CPU
uniform int uLayer;
uniform vec3 uSlice;      // z0, z1, fade length
uniform vec2 uHalfXY;
uniform float uCount;
uniform uint uSeed;
uniform vec4 uMs[32];     // drag-wake segments: ndc position, ndc displacement
uniform float uMa[32];    // segment ages (s)
uniform int uMn;

// envelope of one wake segment over its age: fast attack, ~2.5 s release (the curl stays readable after a sweep)
float pushProf(float a) { return (1.0 - exp(-a * 9.0)) * exp(-a * 0.4) * smoothstep(3.6, 2.6, a); }

uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
const vec2 CORNERS[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
const float TW = 120.0;                    // wrap period of the oscillation clocks
const float W0 = 6.2831853 / TW;           // the rate quantum: every oscillation rate is an integer multiple of it

// fixed per-instance randoms (stateless, reproducible); every layer id is its own stream, so the snow and rain
// layers use distinct ids or their populations would correlate
void precipRand(out vec4 r0, out vec4 r1, out vec4 r2) {
  uvec4 hA = pcg4d(uvec4(uint(gl_InstanceID), uint(uLayer) * 7919u + 17u, uSeed, 0x51ed27u));
  uvec4 hB = pcg4d(hA ^ uvec4(0x9e3779b9u));
  uvec4 hC = pcg4d(hB + uvec4(0x632be5abu));
  r0 = vec4(hA >> 8u) * (1.0 / 16777216.0);
  r1 = vec4(hB >> 8u) * (1.0 / 16777216.0);
  r2 = vec4(hC >> 8u) * (1.0 / 16777216.0);
}
vec3 sliceHalf() { return vec3(uHalfXY, 0.5 * (uSlice.y - uSlice.x)); }
// the instance's base point in the slice box (world-space offset)
vec3 sliceBase(vec4 r0) { vec3 bc = (r0.xyz * 2.0 - 1.0) * sliceHalf(); return uCamR * bc.x + uCamU * bc.y + uCamF * bc.z; }
// a fall bin's centre speed (m/s at fall factor 1) from a 0..1 key over the layer's range: the CPU integrates and
// lattice-wraps each of the 40 bins exactly (uFallQ), so a particle's bin never changes
int fallBin(float key) { return int(clamp(key * 40.0, 0.0, 39.0)); }
float binSpeed(int b) { return mix(uFallLH.x, uFallLH.y, (float(b) + 0.5) / 40.0); }
// wrap a world displacement inside the camera-aligned slice box -> camera-space position (constant density, no CPU work)
vec3 sliceWrap(vec3 pw) {
  vec3 halfB = sliceHalf();
  vec3 qc = vec3(dot(pw, uCamR), dot(pw, uCamU), dot(pw, uCamF));
  qc = mod(qc + halfB, 2.0 * halfB) - halfB;
  return qc + vec3(0.0, 0.0, 0.5 * (uSlice.x + uSlice.y));
}
// camera-space position + world velocity -> ndc and the analytic screen velocity (px / s)
void project(vec3 cs, vec3 vel, out vec2 ndc, out vec2 sv) {
  vec3 vc = vec3(dot(vel, uCamR), dot(vel, uCamU), dot(vel, uCamF));
  float zc = cs.z;
  ndc = vec2(cs.x / (zc * uTanH * uAspect), cs.y / (zc * uTanH));
  sv = vec2((vc.x * zc - cs.x * vc.z) / (zc * zc * uTanH * uAspect), (vc.y * zc - cs.y * vc.z) / (zc * zc * uTanH)) * 0.5 * uRes;
}
// depth fade at the slice ends
float sliceFade(float zc) { return smoothstep(uSlice.x, uSlice.x + uSlice.z, zc) * (1.0 - smoothstep(uSlice.y - uSlice.z, uSlice.y, zc)); }
// position cull: behind the near plane or outside the (padded) frustum
bool offScreen(float zc, vec2 ndc) { return zc < 0.08 || abs(ndc.x) > 1.12 || abs(ndc.y) > 1.12; }

// local push / swirl around the drag (screen space): each recent wake segment drags nearby particles along its
// motion and adds a counter-rotating vortex pair (a wake), easing out over ~3 s. The time derivative of the same
// field (d/dt of each segment's envelope) is added to the screen velocity, so a sweep streaks the particles it moves
// (motion blur along the wake) instead of only displacing them. k weights the response (1 = snow).
void precipWake(inout vec2 ndc, inout vec2 sv, float zc, float k) {
  if (uMn <= 0) return;
  vec2 asp = vec2(uAspect, 1.0);
  vec2 push = vec2(0.0), pushV = vec2(0.0);
  for (int i = 0; i < 32; i++) {
    if (i >= uMn) break;
    vec4 m = uMs[i];
    float age = uMa[i];
    vec2 d = (ndc - m.xy) * asp;
    float fo = exp(-dot(d, d) * 12.0);
    vec2 mv = m.zw * asp;
    float side = sign(d.x * mv.y - d.y * mv.x);
    vec2 f = (mv * 1.25 + vec2(-d.y, d.x) * side * length(mv) * 3.6) * fo;
    push += f * pushProf(age);
    pushV += f * (pushProf(age) - pushProf(max(age - 0.04, 0.0))) * 25.0;   // ndc / s
  }
  float pwgt = mix(1.0, 0.3, smoothstep(3.0, 60.0, zc)) * k;
  ndc += push / asp * pwgt;
  // streak: the envelope's rate (x5, a hand-sweep gust streaks more than the bare displacement rate)
  // plus the wake itself read as a local wind, so particles inside it stay streaked while it fades
  sv += (pushV * 5.0 + push * 14.0) / asp * pwgt * 0.5 * uRes;
}
`;
  C.VS_FLAKE = `
uniform float uExpo;
uniform float uFallV;     // current snow fall factor (= d fallI / dt: the curtain and wet snow fall faster)
uniform float uTumT;      // tumble clock: integral of the tumble rate, wrapped by TW
uniform float uWetSnow;   // 0..1 wet snow near 0 deg C: big heavy aggregates, less flutter / tumble / glint, greyer
out vec2 vP;
flat out vec4 vSeed;
flat out vec4 vPar;       // drawn radius px (incl. defocus), blur px, type, aa
flat out vec4 vRot;       // cos, sin (shape vs streak frame), squash, true radius px
out vec4 vCol;
out float vDist;

void main() {
  vec2 corner = CORNERS[gl_VertexID];
  uint id = uint(gl_InstanceID);
  vec4 r0, r1, r2;
  precipRand(r0, r1, r2);
  vec3 bw = sliceBase(r0);
  float wet = uWetSnow;

  float light = r0.w;                 // 0 = heavy clumped aggregate ... 1 = light crystal
  float t = uFlakeT;
  // fall speed: heavy clumps 1.35 m/s ... light crystals 0.55, x0.85-1.15 per flake, quantised to 40 bins (2.7%
  // steps) so the CPU can integrate and lattice-wrap each bin's fall exactly; the storm / wet factor is in the integral
  int fbin = fallBin((mix(1.35, 0.55, light) * mix(0.85, 1.15, r1.x) - uFallLH.x) / (uFallLH.y - uFallLH.x));
  float fall = binSpeed(fbin) * uFallV;
  // per-flake inertia: blend of a sluggish and a quick wind response (light flakes respond more)
  float resp = clamp(light * 0.8 + 0.2 * r1.y, 0.0, 1.0);
  // NB: only affine mixes of the two integrals are allowed (weights sum to 1), otherwise the
  // CPU-side lattice wrap of uDispA/uDispB would make flakes jump.
  vec3 wdisp = mix(uDispA, uDispB, resp);
  vec3 wvel = mix(uWindA, uWindB, resp);
  // turbulence: travelling sine eddies over (base position, time) -> coherent yet never lockstep
  // (rates 16, 25, 11 x W0 = 0.84, 1.31, 0.58 rad/s; the 2.08 / 1.6875 harmonics keep integer multiples);
  // heavy wet clumps follow the eddies less
  float ta = mix(0.16, 1.7, uSnowCurtain) * (1.0 - 0.35 * wet);
  vec3 ph = bw * vec3(0.37, 0.29, 0.33);
  float a1 = ph.x + ph.y * 0.7 + 16.0 * W0 * t, a2 = ph.z - ph.x * 0.6 + 25.0 * W0 * t + 2.0, a3 = ph.y + ph.z * 0.5 + 11.0 * W0 * t + 4.0;
  float tv = mix(0.6, 1.3, uSnowCurtain);   // updrafts / downdrafts in gusts
  vec3 turb = ta * vec3(sin(a1) + 0.5 * sin(2.08 * a2), tv * sin(a3), sin(a2) + 0.5 * sin(1.6875 * a1 + 1.0));
  vec3 turbV = ta * W0 * vec3(16.0 * cos(a1) + 26.0 * cos(2.08 * a2), tv * 11.0 * cos(a3), 25.0 * cos(a2) + 13.5 * cos(1.6875 * a1 + 1.0));
  // flutter: per-flake helical wobble 0.5-2 Hz (60..240 cycles per TW); wet clumps barely flutter
  float fw = floor(mix(60.0, 240.0, r1.z) + 0.5) * W0;
  float fr = mix(0.012, 0.1, light) * (1.0 + 0.8 * uSnowCurtain) * (1.0 - 0.7 * wet);
  float fph = fw * t + r1.w * 6.2831853;
  vec3 flut = fr * vec3(cos(fph), 0.4 * sin(2.0 * fph), sin(fph));
  vec3 flutV = fr * fw * vec3(-sin(fph), 0.8 * cos(2.0 * fph), cos(fph));

  vec3 cs = sliceWrap(bw + wdisp + uFallQ[fbin] + turb + flut);
  vec2 ndc, sv;
  project(cs, wvel + vec3(0.0, -fall, 0.0) + turbV + flutV, ndc, sv);
  float zc = cs.z;
  float wz = sliceFade(zc);
  precipWake(ndc, sv, zc, 1.0);
  // cull before any texture fetch or lighting (about half of the slice box lies outside the frustum)
  if (offScreen(zc, ndc)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // size / type per layer
  float type, size, baseA;
  if (uLayer == 0) { size = mix(0.006, 0.014, r2.x); type = 0.0; baseA = 0.9; }
  else if (uLayer == 1 || uLayer == 4) {
    // 1 dendrite, 2 plate, 3 aggregate. Most big real flakes are clumps: ~40% single crystals, 60% aggregates.
    // Near 0 deg C the crystals stick together: one flake at a time (its own threshold) turns into a clump
    type = light > 0.6 && fract(r2.y * 7.31) >= wet ? (r2.y > 0.38 ? 1.0 : 2.0) : 3.0;
    size = type == 3.0 ? mix(0.032, 0.078, r2.x * r2.x) : mix(0.03, 0.068, r2.x);   // crystals: 15-35 px over 2.3-4.5 m
    // hero tier (0.9-2.4 m, inside the depth of field): 10-50 px radius, sharp
    if (uLayer == 4) size = type == 3.0 ? mix(0.04, 0.075, r2.x) : mix(0.035, 0.07, r2.x);
    // wet snow (함박눈): the clumps grow into big soft aggregates of several centimetres
    if (type == 3.0) size *= 1.0 + 0.35 * wet;
    baseA = 0.92;
  } else if (uLayer == 2) { size = mix(0.014, 0.036, r2.x) * (1.0 + 0.3 * wet); type = 4.0; baseA = 0.85; }
  else { size = mix(0.012, 0.028, r2.x) * (1.0 + 0.25 * wet); type = 5.0; baseA = 0.85; }
  float rTrue = 0.5 * size / max(zc, 0.05) * uFocalPx;
  float speed = length(sv);
  float blur = speed * uExpo;
  vec2 dir = speed > 1e-3 ? sv / speed : vec2(0.0, -1.0);
  float coc = uCocK * max(0.0, 1.0 / max(zc, 0.05) - 1.0 / uFocus);
  float rD, aa, a = baseA;
  float blurMix = 0.0;
  if (uLayer == 0) {
    // near bokeh tier: soft discs (capped so the nearest never become lens dirt), faint but readable;
    // the streak is capped too: a near smear longer than this is invisible and only costs fill rate
    coc = min(coc, 60.0 * uRes.y / 1080.0);
    blur = min(blur, 100.0 * uRes.y / 1080.0);
    rD = max(rTrue, coc) + 0.5; aa = 0.45; blurMix = 1.0;
    a *= clamp(sq(rTrue / rD) * 5.0, 0.25, 0.45);    // the few near discs read as bright flakes, not smudges
  } else if (uLayer == 1 || uLayer == 4) {
    // defocus: the crystal keeps its true radius and its edge ramp widens by the circle of confusion
    // (energy is spread, not removed); the quad grows by coc to hold the blurred outline
    rD = rTrue + coc;
    aa = (0.9 + 0.6 * coc) / max(rTrue, 0.5);
    blurMix = sat(coc / max(rTrue, 0.5));
    a *= mix(1.0, 0.45, smoothstep(0.0, 0.8, blurMix));     // out-of-focus ice reads ghostly
  }
  else { rD = max(rTrue, 1.2); aa = 0.0; a *= min(1.0, sq(rTrue / rD) * 1.6); }   // 1.2 px floor: no 1-px film scratches
  if (uLayer != 1 && uLayer != 4) a *= max((2.0 * rD) / (2.0 * rD + blur), uLayer == 0 ? 0.25 : 0.0);
  if (uLayer == 3) a *= 1.0 - 0.6 * uSnowCurtain;
  if (uLayer == 2) a *= 1.0 - 0.35 * uSnowCurtain;
  // blizzard: thin the uniform fine streaks over the sky (upper third) so it is not a flat scratched field
  if (uLayer == 2 || uLayer == 3) a *= 1.0 - 0.45 * uSnowCurtain * smoothstep(0.1, 0.6, ndc.y);
  if (uLayer == 4 || uLayer == 0) a *= 1.0 - 0.3 * uSnowCurtain;       // keep a few big flakes whipping past the lens
  a *= wz * clamp(uCount - float(id), 0.0, 1.0);
  a *= 1.0 - 0.08 * wet;                                                // wet snow is a little more translucent
  if (a < 0.0015) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // blizzard gust sheets: a slow screen-space noise modulates the density of the streak tiers, so the curtain has
  // banks and gaps drifting with the gale instead of a uniform hatch. The scroll rate is 256/TW units/s, one full
  // noise period per clock wrap, so the sheet never jumps (the 2nd octave scrolls at an integer multiple)
  if (uLayer != 0 && uLayer != 4 && uSnowCurtain > 0.0) {
    vec2 gq = vec2(ndc.x * uAspect, ndc.y) * 2.2 + vec2(2.1333333, 0.0) * t;
    float gs = tnoise(gq) * 0.6 + tnoise(gq * 2.0 + 7.0) * 0.4;
    a *= mix(1.0, 0.3 + 1.4 * smoothstep(0.3, 0.7, gs), uSnowCurtain);
  }

  // rotation, tumble (squash) and sparkle: rates snapped to the W0 grid (steps of 0.05 rad/s); the tumble
  // speeds up in a storm (and slows for wet clumps), so it runs on the integrated clock uTumT
  float ang = r2.z * 6.2831853 + floor((r1.y - 0.5) * 2.2 * (0.3 + light) / W0 + 0.5) * W0 * t;
  float tum = r2.w * 6.2831853 + floor(mix(0.5, 2.6, r1.z) / W0 + 0.5) * W0 * uTumT;
  // tumble as a rocking wobble: crystals swing from face-on down to 0.3 (a perfect face-on star is a moment,
  // not the norm); clumps stay roundish (wet clumps more so); defocus rounds everything back to a disc
  float squash = mix(1.0 - (type == 3.0 ? 0.35 * (1.0 - 0.6 * wet) : 0.7) * sq(0.5 - 0.5 * cos(tum)), 1.0, blurMix);
  float rel = atan(dir.y, dir.x) - ang;

  vec3 pW = uCamPos + uCamR * cs.x + uCamU * cs.y + uCamF * cs.z;
  float dist = length(cs);
  vec3 V = (pW - uCamPos) / dist;
  float mu = dot(V, uSunDir);
  float g = 0.62;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;       // forward scattering
  float facing = abs(cos(tum));
  // sunlit ice: bright white front-lit body (cloud shadow only partly dims it: flakes are lit by the
  // whole sky), plus tumble glints when a facet swings through the mirror direction
  // (in a whiteout a flake is lit from the whole sphere, the ground only from above: streaks sit above the snow)
  vec3 col = uSunCol * (0.36 + 0.28 * facing + hg) * mix(1.0, cloudShadow(pW), 0.6) + uSkyAmb * mix(1.0, 2.5, uSnowCurtain);
  float glints = (1.0 - uSnowCurtain * 0.85) * (1.0 - wet);              // wet clumps have no clean facets
  if (uLayer == 1 || uLayer == 4) {
    float glint = pow(max(cos(tum * 2.0 + r0.x * 6.2831853), 0.0), 160.0) * step(0.5, r2.y);
    col += uSunCol * glint * (type == 3.0 ? 0.9 : (uLayer == 4 ? 1.2 : 1.6)) * glints;
  } else if (uLayer == 2) {
    // mid-distance twinkles: a quarter of the tier flashes briefly as it tumbles through the sun -> a field of
    // small sparkles rather than one clipped flare
    float tw = pow(max(cos(tum * 2.0 + r0.x * 6.2831853), 0.0), 90.0) * step(0.75, r2.y);
    col += uSunCol * tw * 2.2 * glints;
  }
  // per-flake brightness: real flakes are not all the same white. The crystal tiers spread 0.55-1.1, skewed
  // dim (and thin light crystals are the most translucent), so a bright one stands out as a hero; the far end
  // of the mid tier is dimmer than its near end, a depth cue the fog alone is too weak to give at 2-9 m
  float bri = (uLayer == 1 || uLayer == 4) ? mix(0.55, 1.1, r1.w * r1.w) * mix(1.0, 0.8, light) : mix(0.7, 1.1, r1.w);
  if (uLayer == 1) bri *= mix(1.0, 0.72, smoothstep(2.5, 9.0, zc));
  bri = mix(bri, 0.5 + 0.5 * bri, uSnowCurtain);      // a dim streak is lost in the whiteout: narrower spread in a blizzard
  col *= bri;
  // wet snow: half-melted, water-logged ice is a little greyer (slightly blue-grey: it transmits the sky)
  col *= mix(vec3(1.0), vec3(0.88, 0.9, 0.94), wet);
  vec4 fg = fogAt(dist, V);
  col = col * fg.a + fg.rgb;

  float hl = rD + 0.5 * blur + 1.2, hw = rD + 1.2;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 offPx = dir * corner.x * hl + perp * corner.y * hw;
  gl_Position = vec4(ndc + offPx / (0.5 * uRes), 0.0, 1.0);
  vP = vec2(corner.x * hl, corner.y * hw);
  vSeed = r1.wzyx * 0.7 + r2.yxwz * 0.3;
  vPar = vec4(rD, blur, type, aa);
  vRot = vec4(cos(rel), sin(rel), squash, rTrue);
  vCol = vec4(col, a);
  vDist = dist;
}
`;
  C.FS_FLAKE = `
uniform vec2 uRes;
uniform int uLayer;
uniform sampler2D uScene;   // the shaded scene: a = snow fraction x sun visibility (FS_SHADE)
uniform float uWetSnow;     // 0..1 wet snow (the aggregates' shape)
in vec2 vP;
flat in vec4 vSeed;
flat in vec4 vPar;
flat in vec4 vRot;
in vec4 vCol;
in float vDist;
out vec4 o;

float sq(float x) { return x * x; }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// fold the plane into one 30-degree wedge: 6-fold rotational + mirror symmetry of ice crystals
vec2 foldD6(vec2 q) {
  float r = length(q);
  float a = atan(q.y, q.x);
  a = abs(mod(a + 0.5235988, 1.0471976) - 0.5235988);
  return r * vec2(cos(a), sin(a));
}
// stellar dendrite: tapered main arm with side branches at 60 degrees, hexagonal core with an inner
// ring. Two seed-driven variants: A keeps its branches inside the wedge (neighbouring arms never
// touch) and adds one branchlet per branch on big sharp flakes; B is fern-like with five tapered
// branches whose mirrored copies meet between the arms (the textbook 'Christmas star').
float dendrite(vec2 q, vec4 s, float aa) {
  if (dot(q, q) > sq(1.06 + aa)) return 0.0;
  vec2 p = foldD6(q);
  bool fern = s.z > 0.5 && aa < 0.06;                        // fern only when its branches resolve (r > ~15 px)
  float w = max(mix(0.04, 0.075, s.x), 0.9 * aa);          // never thinner than ~1 px (no aliasing)
  float d = sdSeg(p, vec2(0.0), vec2(0.92, 0.0)) - w * (1.0 - 0.45 * p.x);
  bool fine = !fern && aa < 0.045;                           // branchlets only on big, sharp flakes (r > ~20 px)
  vec2 bd = vec2(0.5, 0.8660254);
  float sz = fract(s.z * 2.0);
  float b0 = mix(0.2, 0.32, s.y), bs = fern ? mix(0.13, 0.21, sz) : mix(0.13, 0.17, sz);
  bs = max(bs, 3.5 * aa);                                    // side branches need ~3.5 px of spacing to read
  float bl = mix(0.4, 0.7, fract(s.w * 5.3));
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    float x = b0 + fk * bs;
    if (x > (fern ? 0.9 : 0.86) || (!fern && k == 4)) break;
    float L = fern ? (0.97 - x) * bl : min((0.97 - x) * mix(0.55, 0.95, fract(s.w * 3.7 + fk * 0.31)), x * 0.9);
    vec2 a0 = vec2(x, 0.0), a1 = a0 + bd * L;
    float tt = clamp(dot(p - a0, bd) / max(L, 1e-3), 0.0, 1.0);                       // taper along the branch
    d = min(d, sdSeg(p, a0, a1) - max(w * (fern ? 0.72 * (1.0 - 0.55 * tt) : 0.62), 0.8 * aa));
    if (fine) {   // one branchlet parallel to the main arm, sprouting from the branch midpoint
      vec2 m = a0 + bd * (L * 0.5);
      d = min(d, sdSeg(p, m, m + vec2(L * 0.3, 0.0)) - max(w * 0.5, 0.8 * aa));
    }
  }
  float hexd = dot(p, vec2(0.8660254, 0.5));
  float core = mix(0.09, 0.2, s.w);
  d = min(d, hexd - core);
  float c = 1.0 - smoothstep(-aa, aa, d);
  float rim = smoothstep(-min(w * 0.9, 0.035) - aa, 0.0, d);               // edges catch the light (a thin line on wide arms)
  float ridge = 1.0 - smoothstep(0.0, 0.025 + aa, p.y);
  float ring = 1.0 - smoothstep(0.0, 0.02 + aa, abs(hexd - core * 0.6));
  // translucent body (0.42) under bright rims / ridges / ring, so the interior structure survives tone mapping
  return c * (0.42 + 0.5 * rim + 0.3 * ridge + 0.2 * ring);
}
// hexagonal / stellar plate with ridges, an inner hexagon line and bright rims
float plate(vec2 q, vec4 s, float aa) {
  if (dot(q, q) > sq(1.06 + aa)) return 0.0;
  vec2 p = foldD6(q);
  float R = mix(0.62, 0.92, s.x);
  float hexd = dot(p, vec2(0.8660254, 0.5));
  float d;
  if (s.y > 0.45) {   // stellar plate: broad arms widening toward the tip
    float wArm = 0.07 + 0.2 * smoothstep(0.3, 0.95, p.x / R);
    d = min(max(p.y - wArm * R, p.x - R), hexd - 0.3 * R);
  } else d = hexd - R * 0.8660254;
  float c = 1.0 - smoothstep(-aa, aa, d);
  float ridge = 1.0 - smoothstep(0.0, 0.025 + aa, p.y);
  float inner = 1.0 - smoothstep(0.0, 0.025 + aa, abs(hexd - 0.4 * R));
  float rim = smoothstep(-0.07 - aa, 0.0, d);
  return c * (0.38 + 0.28 * ridge + 0.22 * inner + 0.5 * rim);      // translucent body, bright rim and ridges
}
// one small six-armed crystal used inside aggregates
float miniStar(vec2 q, float aa) {
  vec2 p = foldD6(q);
  float d = sdSeg(p, vec2(0.0), vec2(0.92, 0.0)) - 0.1 * (1.0 - 0.4 * p.x);
  d = min(d, sdSeg(p, vec2(0.5, 0.0), vec2(0.5, 0.0) + vec2(0.5, 0.866) * 0.36) - 0.07);
  d = min(d, dot(p, vec2(0.866, 0.5)) - 0.2);
  return 1.0 - smoothstep(-aa, aa, d);
}
// clumped aggregate (most large real flakes): a soft translucent lumpy core with a few
// tumbled crystals fused into it, their arms poking out of the outline. Wet snow near 0 deg C (uWetSnow): the
// crystals have melted into the clump, which grows into a bigger, lobed, denser cotton-like ball
float aggregate(vec2 q, vec4 s, float aa) {
  if (dot(q, q) > sq(1.06 + aa)) return 0.0;
  uint h = floatBitsToUint(s.x * 9.71 + s.y) ^ 0x9e3779b9u;
  float rr = length(q);
  float ang0 = atan(q.y, q.x);
  float wet = uWetSnow;
  float lump = 0.5 + 0.09 * sin(3.0 * ang0 + s.z * 6.0) + 0.06 * sin(5.0 * ang0 + s.w * 6.0) + 0.04 * (1.0 - wet) * sin(8.0 * ang0 + s.x * 6.0);
  lump += wet * (0.16 + 0.05 * sin(2.0 * ang0 + s.y * 6.0) + 0.03 * sin(4.0 * ang0 + s.z * 9.0));   // a lopsided round tuft
  float core = 1.0 - smoothstep(lump - 0.3 - 0.12 * wet - aa, lump + aa, rr);
  float tex = 0.75 + 0.25 * sin(q.x * 9.0 + s.z * 6.0) * sin(q.y * 8.0 + s.w * 6.0);
  float c = core * mix(core, 1.0, 0.35 * wet) * (0.42 + 0.3 * wet) * tex;   // translucent, denser centre (wet: a dense ball)
  float arms = 1.0 - 0.85 * wet;
  for (int k = 0; k < 3; k++) {
    h = h * 747796405u + 2891336453u;
    uint h2 = (h >> 5u) * 2654435761u;
    vec4 r = vec4(float(h >> 8u), float(h2 >> 8u), float((h2 * 1103515245u) >> 8u), float((h * 22695477u) >> 8u)) / 16777216.0;
    vec2 off = (r.xy - 0.5) * 0.45;
    float sc = mix(0.45, 0.62, r.z);
    float an = r.w * 6.2831853;
    vec2 qq = q - off;
    qq = vec2(cos(an) * qq.x - sin(an) * qq.y, sin(an) * qq.x + cos(an) * qq.y) / sc;
    qq.y /= mix(0.5, 1.0, fract(r.w * 7.3));                                 // tilted crystal
    if (dot(qq, qq) < 1.1) c = max(c, miniStar(qq, aa / sc) * mix(0.8, 1.0, r.z) * arms);
  }
  return c;
}
float shapeAt(vec2 sp) {
  // shape in units of the true radius; defocus widens the edge ramp (aa) and the quad (vPar.x) instead
  vec2 q = vec2(vRot.x * sp.x - vRot.y * sp.y, vRot.y * sp.x + vRot.x * sp.y) / vRot.w;
  q.y /= vRot.z;
  // the tumble squash shrinks the pixel footprint along y: widen the edge ramp by the geometric mean of the
  // two axes' scales, so an edge-on crystal softens instead of aliasing (and its fine detail switches off)
  float aa = vPar.w * inversesqrt(max(vRot.z, 0.2));
  if (vPar.z < 1.5) return dendrite(q, vSeed, aa);
  if (vPar.z < 2.5) return plate(q, vSeed, aa);
  return aggregate(q, vSeed, aa);
}
void main() {
  float rPx = vPar.x, blur = vPar.y;
  float cov;
  if ((uLayer == 1 || uLayer == 4) && blur < min(3.5 * rPx, 28.0)) {
    // true motion blur of the crystal shape: a box of taps along the streak at <= 1 px spacing (up to 29),
    // so a short calm blur keeps the crystal crisp with no tap structure (coarser stratified taps with
    // per-pixel jitter left a diagonal hatch across the big sharp flakes). A wet clump has only soft edges:
    // up to 2.5 px between taps is enough there
    int taps = int(ceil(blur / (vPar.z > 2.5 ? 1.0 + 1.5 * uWetSnow : 1.0))) + 1;
    float acc = 0.0;
    for (int k = 0; k < 29; k++) {
      if (k >= taps) break;
      float off = ((float(k) + 0.5) / float(taps) - 0.5) * blur;
      acc += shapeAt(vP - vec2(off, 0.0));
    }
    cov = acc / float(taps);
  } else if (uLayer == 1 || uLayer == 4) {
    // long streak: the crystal detail is smeared out anyway -> analytic soft capsule,
    // energy-normalised against the streak length, slightly brighter core.
    // Per-flake character so the blizzard is not a parallel hatch: width x0.6-1.4, brightness x0.6-1.2,
    // and a ~12% subset of thin, bright, crisp streaks (small dense flakes whipping past)
    float wv = mix(0.6, 1.4, vSeed.z), bv = mix(0.6, 1.2, vSeed.w);
    if (fract(vSeed.y * 5.3) > 0.88) { wv *= 0.4; bv *= 1.6; }
    vec2 q = vec2(max(abs(vP.x) - 0.5 * blur, 0.0), vP.y);
    float d = length(q) / (rPx * 0.55 * wv);
    float along = 1.0 - smoothstep(0.3, 0.5, abs(vP.x) / (blur + 2.0 * rPx));       // soft streak ends
    // a flake sweeping 'blur' px covers each pixel for ~2r/blur of the exposure
    cov = exp(-d * d * 2.0) * (0.55 + 0.45 * along) * min(1.0, 2.0 * rPx / (blur + 2.0 * rPx)) * 1.5 * bv;
    cov *= 0.65 + 0.35 * sin(vP.x / max(rPx, 1.0) * 1.3 + vSeed.x * 40.0);        // tumbling flicker along the streak
  } else {
    // capsule = analytically motion-blurred disc
    vec2 q = vec2(max(abs(vP.x) - 0.5 * blur, 0.0), vP.y);
    float d = length(q) / rPx;
    // near tier: a soft flat disc (no bright rim: a rimmed disc reads as a soap bubble / lens dirt)
    if (uLayer == 0) cov = (1.0 - smoothstep(1.0 - vPar.w, 1.0, d)) * 0.85;
    else cov = exp(-d * d * 2.3);
  }
  // soft occlusion against the scene (G-buffer ray distance)
  vec2 suv = gl_FragCoord.xy / uRes;
  float st = G0(suv).x;
  float occ = clamp((st - vDist) / max(0.4, 0.05 * vDist), 0.0, 1.0);
  float a = clamp(cov * vCol.a * occ, 0.0, 1.0);
  if (a < 0.0015) discard;
  // over snow-covered ground a thin ice crystal reads as a faint, slightly bluer translucent shadow (it transmits
  // the sky, the sunlit snow behind it does not), otherwise white on white vanishes. Scaled by the flake's own
  // alpha so faint flakes stay translucent rather than turning into grey stickers; in a blizzard the whiteout is
  // grey, so only a weak cool shadow side is kept on the streaks
  vec3 col = vCol.rgb;
  if (st < 60000.0) {
    float snowBG = textureLod(uScene, suv, 0.0).a;
    col *= mix(vec3(1.0), vec3(0.5, 0.56, 0.68), snowBG * mix(0.55, 0.3, uSnowCurtain) * clamp(a * 2.0, 0.0, 1.0));   // over half the tint is kept in a blizzard: the streaks stay legible over snow
  }
  o = vec4(col * a, a);    // premultiplied alpha
}
`;
  S.glsl.progs.flake = { vs: ['COMMON', 'ENV', 'ATMOS', 'PRECIP_VS', 'VS_FLAKE'], fs: ['PRECISION_FI', 'ENV', 'GBUF', 'FS_FLAKE'] };
})(window.SNOW);
