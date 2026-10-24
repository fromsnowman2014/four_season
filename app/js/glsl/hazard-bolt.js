// =====================================================================================
//  GLSL: the lightning bolt (Phase-3 owner: lane Z). Program 'bolt': the strike's branching channel in world space
//  (derive/events.js builds it per strike: strands of points in uBolt[], precip.js uploads them), one instanced quad
//  per segment (gl_VertexID corners, gl_InstanceID segment; no buffers). Drawn by S.drawHazards (precip.js) after the
//  precipitation into R.hdr, additively (alpha 0), so its glow feeds the bloom.
//   VS_BOLT  projects a segment's two points, widens it into a screen-space quad (the core and its glow: a hot, narrow
//            core of ~1-3 px and a soft violet-blue glow of ~3-40 px, both from the distance), carries the segment's
//            distance (for the depth test), its aerial transmittance (fogAt: far strikes are hazy) and fades the part
//            inside the cloud deck (above the base, uBoltC.w)
//   FS_BOLT  capsule distance to the segment; core + glow; the caps count half (two caps meet at every joint, so a
//            joint is not a bead); depth-tested softly against the G-buffer (a ridge, the wall, the house, a palm in
//            front hides it) and against the cloud pass (a cloud nearer than the channel veils it)
//  Point format: xyz world, w = level x 4 + start x 2 + intensity (0..0.999): level 0 the main channel, 1-2 branches;
//  start: the first point of a strand (the segment ending there is skipped).
//  Pass-local uniforms (precip.js): uBolt[160], uBoltN, uBoltI (x main radiance, y branch radiance, z core width, w glow
//  width: metres at the channel, so it narrows with distance), uBoltC (rgb the core tint: warmer as it cools, w the
//  cloud base m), uAspect, uFocalPx, uBoltSky / uBoltSkyD (the cloud pass, units 5 / 6).
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.VS_BOLT = `
uniform vec4 uBolt[160];         // (160: with the shared uniforms well under the 256 vertex vectors WebGL2 guarantees)
uniform int uBoltN;
uniform vec4 uBoltI;
uniform vec4 uBoltC;
uniform float uAspect, uFocalPx;
out vec2 vP;               // px: x along the segment from its first point, y across
flat out vec4 vSeg;        // segment length px, core sigma px, glow sigma px, cap: 1 if the segment ends a strand
out vec3 vCore;            // core radiance (tint x intensity x transmittance x in-cloud fade)
out vec3 vGlow;            // glow radiance
out float vDist;

void cullV() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
vec3 toCam(vec3 p) { vec3 d = p - uCamPos; return vec3(dot(d, uCamR), dot(d, uCamU), dot(d, uCamF)); }
vec2 toPx(vec3 c) { return vec2(c.x / (c.z * uTanH * uAspect), c.y / (c.z * uTanH)) * 0.5 * uRes; }

void main() {
  int i = gl_InstanceID;
  if (i + 1 >= uBoltN) { cullV(); return; }
  vec4 A = uBolt[i], B = uBolt[i + 1];
  float stB = floor(mod(B.w, 4.0) / 2.0);
  if (stB > 0.5) { cullV(); return; }
  float lev = floor(A.w / 4.0);
  float inten = 0.5 * (fract(A.w) + fract(B.w));
  vec3 ca = toCam(A.xyz), cb = toCam(B.xyz);
  if (ca.z < 2.0 || cb.z < 2.0) { cullV(); return; }
  vec2 pa = toPx(ca), pb = toPx(cb);
  vec2 d = pb - pa;
  float L = length(d);
  vec2 dir = L > 1e-3 ? d / L : vec2(0.0, 1.0), perp = vec2(-dir.y, dir.x);
  float da = length(A.xyz - uCamPos), db = length(B.xyz - uCamPos), dm = 0.5 * (da + db);
  float rs = uRes.y / 1080.0;
  // core: the hot channel blooms to ~1-3 px; glow: the lit air and rain around it, ~uBoltI.w m (narrower far away)
  float sc = clamp(uBoltI.z * uFocalPx / dm, 0.65 * rs, 2.4 * rs);
  float sg = clamp(uBoltI.w * uFocalPx / dm, 3.0 * rs, 26.0 * rs) * (lev > 0.5 ? 0.75 : 1.0);
  float W = 3.0 * sg + 2.0;
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  bool atB = corner.x > 0.0;
  vec2 px = (atB ? pb + dir * W : pa - dir * W) + perp * corner.y * W;
  gl_Position = vec4(px / (0.5 * uRes), 0.0, 1.0);
  vP = vec2(atB ? L + W : -W, corner.y * W);
  vSeg = vec4(L, sc, sg, 0.0);
  vDist = atB ? db : da;
  vec3 P = atB ? B.xyz : A.xyz;
  // aerial transmittance (rain haze, storm extinction) and the fade into the deck above its base
  vec4 fg = fogAt(vDist, normalize(P - uCamPos));
  float inCloud = 1.0 - smoothstep(uBoltC.w - 30.0, uBoltC.w + 220.0, P.y);
  float I = (lev > 0.5 ? uBoltI.y * (lev > 1.5 ? 0.55 : 1.0) : uBoltI.x) * inten;
  float k = fg.a * inCloud * I;
  vCore = uBoltC.rgb * vec3(0.92, 0.95, 1.0) * k * 45.0;
  // (stage 2b: a stronger violet-blue glow, the lit rain and air around the channel: not a flat white line)
  vGlow = vec3(0.5, 0.55, 1.0) * k * 1.3;
}
`;
  C.FS_BOLT = `
uniform vec2 uRes;
uniform sampler2D uBoltSky, uBoltSkyD;    // the cloud pass: premultiplied radiance + transmittance, cloud distance (km x opacity)
in vec2 vP;
flat in vec4 vSeg;
in vec3 vCore;
in vec3 vGlow;
in float vDist;
out vec4 o;

void main() {
  float L = vSeg.x;
  float da = vP.x < 0.0 ? -vP.x : max(vP.x - L, 0.0);
  float d2 = da * da + vP.y * vP.y;
  float cap = (vP.x < 0.0 || vP.x > L) ? 0.5 : 1.0;     // two caps meet at each joint
  float core = exp(-d2 / (2.0 * vSeg.y * vSeg.y));
  float sg = vSeg.z;
  float glow = 0.6 * exp(-d2 / (2.0 * sg * sg)) + 0.4 * exp(-sqrt(d2) / (2.5 * sg));
  vec3 c = (vCore * core + vGlow * glow) * cap;
  if (max(c.r, max(c.g, c.b)) < 1e-4) discard;
  vec2 suv = gl_FragCoord.xy / uRes;
  // depth: hidden where the scene is nearer (soft over ~3% of the distance)
  float st = G0(suv).x;
  float occ = clamp((st - vDist) / max(25.0, 0.03 * vDist), 0.0, 1.0);
  // a cloud nearer than the channel veils it (its transmittance)
  vec4 cl = texture(uBoltSky, suv);
  float op = 1.0 - cl.a;
  float cT = op > 0.003 ? texture(uBoltSkyD, suv).x / op * 1000.0 : 1e9;
  float vis = mix(1.0, cl.a, smoothstep(vDist * 0.97, vDist * 0.8, cT));
  o = vec4(c * occ * vis, 0.0);           // additive (premultiplied, alpha 0)
}
`;
  // (lazy: built on first use or by the background prewarm, not with the scene's set at boot / on a switch: gl.js)
  S.glsl.progs.bolt = { vs: ['COMMON', 'ENV', 'ATMOS', 'VS_BOLT'], fs: ['PRECISION_FI', 'ENV', 'GBUF', 'FS_BOLT'], lazy: true };
})(window.SNOW);
