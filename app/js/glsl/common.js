// =====================================================================================
//  GLSL: shared chunks (frozen during the stage-1 lanes)
//   COMMON        precision, the camera / sun / clock / lighting / cloud uniforms every scene pass shares (from S.F),
//                 camera ray, integer hashes, texture value noise (uNoise, 256-periodic), octahedral normal coding
//   ENV           the per-frame environment state (weather, ground, season, precipitation) shared across the lanes,
//                 plus the ?view= selector. Every per-frame program includes it right after its precision header
//                 (COMMON or PRECISION_*); the G-buffer bake does not, so environment state can never reach the bake
//   VS_FULL       full-screen triangle (gl_VertexID only, no vertex buffers)
//   GBUF          G-buffer reads for the per-frame passes (shown buffer, the one being baked, and their mix):
//                 G0..G3(uv), layout in ARCHITECTURE.md
//   PRECISION_*   precision headers of the passes that do not include COMMON (they must precede ENV and GBUF)
//  The atmosphere functions that Phase 1 kept inside COMMON (skyColor, stratus, the cloud weather map and
//  shadows, fog) live in the ATMOS chunk (atmos.js); every program that used them includes COMMON + ENV + ATMOS.
//  A uniform must be declared exactly once per program stage: never redeclare a COMMON or ENV uniform in a chunk.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.COMMON = `
precision highp float; precision highp int; precision highp sampler2D;
uniform vec2 uRes;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uTanH;
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uSunCol, uSkyAmb, uSkyZen, uSkyHor, uFogCol;
uniform vec4 uFogP;      // x haze density, y haze scale height, z storm extinction, w valley-mist density
uniform vec2 uCloudOff;
uniform float uCloudCov;
uniform sampler2D uNoise;

vec3 camRay(vec2 frag) {
  vec2 ndc = frag / uRes * 2.0 - 1.0;
  return normalize(uCamF + uCamR * (ndc.x * uTanH * uRes.x / uRes.y) + uCamU * (ndc.y * uTanH));
}
uint hu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hf(uint x) { return float(hu(x)) * (1.0 / 4294967296.0); }
float hash2(vec2 p) { ivec2 i = ivec2(floor(p)); return hf(uint(i.x) * 0x27d4eb2du ^ hu(uint(i.y) + 0x165667b1u)); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float sq(float x) { return x * x; }

// Texture value noise (cheap, per-frame use). Texel (x,y): G = A(x,y), R = A(x+37,y+17),
// which turns one bilinear fetch into a 3D noise lookup (iq's trick).
float tnoise(vec2 x) { vec2 p = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return textureLod(uNoise, (p + f + 0.5) / 256.0, 0.0).g; }
float tnoise3(vec3 x) {
  vec3 p = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  vec2 uv = p.xy + vec2(37.0, 17.0) * p.z + f.xy;
  vec2 rg = textureLod(uNoise, (uv + 0.5) / 256.0, 0.0).gr;
  return mix(rg.x, rg.y, f.z);
}

vec2 octEnc(vec3 n) {
  vec3 v = n / (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 e = v.xz;
  if (v.y < 0.0) e = (1.0 - abs(e.yx)) * vec2(e.x >= 0.0 ? 1.0 : -1.0, e.y >= 0.0 ? 1.0 : -1.0);
  return e;
}
vec3 octDec(vec2 e) {
  vec3 v = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  float t = max(-v.y, 0.0);
  v.x += v.x >= 0.0 ? -t : t; v.z += v.z >= 0.0 ? -t : t;
  return normalize(v);
}
`;
  // The per-frame environment (values and neutral defaults in S.F, see core.js / ARCHITECTURE.md). The Phase-1
  // uniforms uStorm (snow curtain) and uStormSky (overcast front) are renamed uSnowCurtain and uOvercast.
  C.ENV = `
uniform float uSnowCurtain;  // 0..1 the snow curtain (Phase 1 sim.storm): flake turbulence / streaks / thinning, shutter
uniform float uOvercast;     // 0..1 the overcast / gale front that leads and outlasts the curtain (Phase 1 sim.sky)
uniform float uCover;        // snow cover level, compared against the baked snowT (per pixel: effectiveCover() in SURFACE)
uniform vec4 uSeasonW;       // season weights (spring, summer, autumn, winter), sum 1
uniform float uTemp;         // meadow air temperature (deg C)
uniform vec2 uSnowline;      // x: snowline altitude (m), y: half-width of its transition (m)
uniform float uWet;          // 0..1 ground wetness
uniform float uCumulus;      // 0..1 near cumulus (drifting cloud shadows over the meadow)
uniform float uFogDay;       // 0..1 fog weather (valley fog sea)
uniform vec4 uMistP;         // valley mist: x reference depth (level -x m), y scale height (m), z bank floor, w bank gain
uniform float uPrecipSnow;   // 0..1 snowfall rate (1 = the Phase-1 constant snowfall)
uniform float uPrecipRain;   // 0..1 rainfall rate
uniform float uSnowFrac;     // 0..1 snow share of the precipitation
uniform float uGale;         // 0..1 gale strength
uniform float uHeavy;        // 0..1 heavy snowfall / blizzard intensity
uniform float uCirrus;       // cirrus amount (1 = the Phase-1 veil)
uniform float uShadowAmp;    // cloud-shadow strength (Phase 1: 0.65)
uniform int uView;           // ?view= debug channel (0 = off; S.VIEWS)
`;
  C.VS_FULL = `void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

  // G-buffer reads for the per-frame passes (layout: G0 = t, mat + frac, sun shadow, AO; G1 = summer albedo, snowT;
  // G2 = oct detail normal, oct smooth normal; G3 = rock, soil / path, larch, moisture, all 0..1). While a resize rebakes, two buffers exist: uG* (the current one, baked
  // for the previous canvas) and uN* (the next, striped in from the bottom row up). The vertical FOV is fixed, so a
  // pixel of the old buffer still holds the right ray once u is rescaled by the aspect ratio change (uGb.x; columns
  // beyond the old frame clamp to its edge); rows already baked read the new buffer, so the new frame wipes up over
  // the old one and the final swap changes nothing. On the first load (uGb.z = 2) there is no old buffer: unbaked rows
  // read as sky and the composite hides them behind the reveal edge.
  //   uGb: x = new/old aspect, y = baked fraction of the next buffer (from the bottom), z = 0 one buffer, 1 both, 2 next only
  // The no-bake case (almost every frame) is one textureLod behind a uniform branch: explicit LOD, so no implicit
  // derivatives force the compiler to flatten the bake-only branches into extra fetches
  C.GBUF = `
uniform sampler2D uG0, uG1, uG2, uG3, uN0, uN1, uN2, uN3;
uniform vec3 uGb;
vec4 gbMix(vec4 nxt, vec4 cur, vec4 none, vec2 uv) { return uv.y < uGb.y ? nxt : (uGb.z > 1.5 ? none : cur); }
vec2 gbUV(vec2 uv) { return vec2(0.5 + (uv.x - 0.5) * uGb.x, uv.y); }
vec4 G0(vec2 uv) { if (uGb.z < 0.5) return textureLod(uG0, uv, 0.0); return gbMix(textureLod(uN0, uv, 0.0), textureLod(uG0, gbUV(uv), 0.0), vec4(65000.0, 0.0, 1.0, 1.0), uv); }
vec4 G1(vec2 uv) { if (uGb.z < 0.5) return textureLod(uG1, uv, 0.0); return gbMix(textureLod(uN1, uv, 0.0), textureLod(uG1, gbUV(uv), 0.0), vec4(0.0), uv); }
vec4 G2(vec2 uv) { if (uGb.z < 0.5) return textureLod(uG2, uv, 0.0); return gbMix(textureLod(uN2, uv, 0.0), textureLod(uG2, gbUV(uv), 0.0), vec4(0.0), uv); }
vec4 G3(vec2 uv) { if (uGb.z < 0.5) return textureLod(uG3, uv, 0.0); return gbMix(textureLod(uN3, uv, 0.0), textureLod(uG3, gbUV(uv), 0.0), vec4(0.0), uv); }
`;
  C.PRECISION_F = 'precision highp float;';
  C.PRECISION_FI = 'precision highp float; precision highp int;';
})(window.SNOW);
