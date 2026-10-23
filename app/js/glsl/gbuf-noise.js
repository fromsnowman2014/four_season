// =====================================================================================
//  GLSL: GBUF_NOISE chunk (G-buffer bake only). ALU value noise with analytic derivatives, 3D value noise, the
//  rock bump, fractional-octave fbm, iq's eroded fbm, ridged multifractal, softplus. Too expensive per frame:
//  only the one-time bake uses them.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.GBUF_NOISE = `
const mat2 M2 = mat2(0.8, 0.6, -0.6, 0.8);

// value noise in [-1,1] (quintic) and with analytic derivatives
float vn(vec2 x) {
  vec2 i = floor(x), f = x - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash2(i), b = hash2(i + vec2(1, 0)), c = hash2(i + vec2(0, 1)), d = hash2(i + vec2(1, 1));
  return -1.0 + 2.0 * (a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y);
}
vec3 vnd(vec2 x) {
  vec2 i = floor(x), f = x - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash2(i), b = hash2(i + vec2(1, 0)), c = hash2(i + vec2(0, 1)), d = hash2(i + vec2(1, 1));
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(-1.0 + 2.0 * (a + k1 * u.x + k2 * u.y + k4 * u.x * u.y), 2.0 * du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
// 3D value noise (for rock detail on steep faces, where heightfield noise would be stretched)
float hash3(vec3 p) { ivec3 i = ivec3(floor(p)); return hf(uint(i.x) * 0x27d4eb2du ^ hu(uint(i.y) * 0x165667b1u ^ hu(uint(i.z) + 0x9e3779b9u))); }
float vn3(vec3 x) {
  vec3 i = floor(x), f = x - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z) * 2.0 - 1.0;
}
float fbm3(vec3 p, float oct) {
  float a = 0.0, b = 0.5;
  for (int i = 0; i < 7; i++) {
    float fi = float(i); if (fi >= oct) break;
    a += b * vn3(p) * clamp(oct - fi, 0.0, 1.0);
    b *= 0.5; p = p * 2.03 + vec3(1.7, -3.1, 2.3);
  }
  return a;
}
// 3D bump: perturb the normal by the surface-projected gradient of a 3D fbm (ridged-ish rock)
vec3 rockBump(vec3 p, vec3 n, float fp, float amp) {
  float sc = 70.0;
  float oct = clamp(log2(sc / max(1.5 * fp, 0.2)), 0.0, 7.0);
  float e = max(fp * 0.7, 0.3);
  vec3 q = p / sc;
  float c = abs(fbm3(q, oct));
  vec3 g = vec3(abs(fbm3(q + vec3(e / sc, 0, 0), oct)) - c, abs(fbm3(q + vec3(0, e / sc, 0), oct)) - c, abs(fbm3(q + vec3(0, 0, e / sc), oct)) - c) / e;
  g -= dot(g, n) * n;
  return normalize(n - amp * sc * g);
}

// fbm with a fractional octave count (smooth LOD by pixel footprint -> no seams)
float fbmF(vec2 p, float oct) {
  float a = 0.0, b = 0.5;
  for (int i = 0; i < 12; i++) {
    float fi = float(i); if (fi >= oct) break;
    a += b * vn(p) * clamp(oct - fi, 0.0, 1.0);
    b *= 0.5; p = M2 * p * 2.03 + 1.7;
  }
  return a;
}
// iq "erosion" fbm: each octave is damped by the accumulated slope, n/(1+|grad|^2),
// so detail collects in gullies and ridges stay sharp -> eroded mountain look.
float erodedFbm(vec2 p, float oct) {
  float a = 0.0, b = 0.5; vec2 d = vec2(0.0);
  for (int i = 0; i < 12; i++) {
    float fi = float(i); if (fi >= oct) break;
    float w = clamp(oct - fi, 0.0, 1.0);
    vec3 n = vnd(p);
    d += n.yz * w;
    a += b * w * n.x / (1.0 + dot(d, d));
    b *= 0.5; p = M2 * p * 2.0;
  }
  return a;
}
// ridged multifractal (sharp crests), weights feed back between octaves
float ridgedFbm(vec2 p, float oct) {
  float a = 0.0, b = 0.5, w = 1.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i); if (fi >= oct) break;
    float f = clamp(oct - fi, 0.0, 1.0);
    float n = 1.0 - abs(vn(p)); n *= n;
    a += b * n * w * f;
    w = clamp(n * 1.7, 0.0, 1.0);
    b *= 0.5; p = M2 * p * 2.07 + 11.7;
  }
  return a;
}
float softplus(float x, float k) { return k * log(1.0 + exp(clamp(x / k, -40.0, 40.0))); }
`;
})(window.SNOW);
