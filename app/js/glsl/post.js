// =====================================================================================
//  GLSL: post (stage-1 owner: lane C). FXAA on the scene (before the flakes), the bloom down / up chain, and the
//  composite: snow sparkle at canvas resolution (gated by the scene alpha: snow fraction x sun visibility, by the deck
//  and by the drifting cloud shadow), exposure, white balance, ACES, grade (S-curve, desaturation: derive/atmos.js),
//  vignette, grain and the first-load reveal. With ?view= the composite shows the debug channel ungraded.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.FS_FXAA = `precision highp float;
uniform sampler2D uTex; uniform vec2 uInv;
out vec4 o;
float L(vec3 c) { c = c / (1.0 + c); return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 uv = gl_FragCoord.xy * uInv;
  vec3 m = texture(uTex, uv).rgb;
  float lNW = L(texture(uTex, uv + vec2(-1.0, -1.0) * uInv).rgb), lNE = L(texture(uTex, uv + vec2(1.0, -1.0) * uInv).rgb);
  float lSW = L(texture(uTex, uv + vec2(-1.0, 1.0) * uInv).rgb), lSE = L(texture(uTex, uv + vec2(1.0, 1.0) * uInv).rgb);
  float lM = L(m);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.03, lMax * 0.1)) { o = vec4(m, 1.0); return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -6.0, 6.0) * uInv;
  vec3 A = 0.5 * (texture(uTex, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uTex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 B = A * 0.5 + 0.25 * (texture(uTex, uv - dir * 0.5).rgb + texture(uTex, uv + dir * 0.5).rgb);
  float lB = L(B);
  o = vec4((lB < lMin || lB > lMax) ? A : B, 1.0);
}`;
  C.FS_DOWN = `precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcInv; uniform vec2 uDstRes; uniform float uThresh;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstRes;
  vec3 c = texture(uSrc, uv + uSrcInv * vec2(-1.0, -1.0)).rgb + texture(uSrc, uv + uSrcInv * vec2(1.0, -1.0)).rgb
         + texture(uSrc, uv + uSrcInv * vec2(-1.0, 1.0)).rgb + texture(uSrc, uv + uSrcInv * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  if (uThresh > 0.0) { float l = max(c.r, max(c.g, c.b)); c *= max(l - uThresh, 0.0) / max(l, 1e-4); c = min(c, vec3(30.0)); }
  o = vec4(c, 1.0);
}`;
  C.FS_UP = `precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcInv; uniform vec2 uDstRes;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstRes;
  vec3 c = texture(uSrc, uv).rgb * 4.0;
  c += (texture(uSrc, uv + vec2(uSrcInv.x, 0.0)).rgb + texture(uSrc, uv - vec2(uSrcInv.x, 0.0)).rgb + texture(uSrc, uv + vec2(0.0, uSrcInv.y)).rgb + texture(uSrc, uv - vec2(0.0, uSrcInv.y)).rgb) * 2.0;
  c += texture(uSrc, uv + uSrcInv).rgb + texture(uSrc, uv - uSrcInv).rgb + texture(uSrc, uv + vec2(uSrcInv.x, -uSrcInv.y)).rgb + texture(uSrc, uv + vec2(-uSrcInv.x, uSrcInv.y)).rgb;
  o = vec4(c / 16.0, 1.0);
}`;
  C.FS_COMP = `uniform sampler2D uHdr, uBloom, uScene;
uniform float uExposure, uBloomStr, uFrame, uTwinkleT;
uniform vec3 uGrade;         // white balance (season; rain cools it)
uniform vec3 uGradeP;        // x desaturation, y S-curve strength, z sparkle gate (direct sun: overcast, fog; > 1: denser, brighter glints)
out vec4 o;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uView > 0) { o = vec4(texture(uHdr, uv).rgb, 1.0); return; }      // ?view=: the debug channel, ungraded
  vec3 c = texture(uHdr, uv).rgb + texture(uBloom, uv).rgb * uBloomStr;
  // snow sparkle: 1 px sun glints flickering at per-pixel rates, added here at canvas resolution after the
  // scene FXAA (which smeared them to faint grain), on sunlit snow and not through a whiteout. The density follows
  // the scene alpha (snow fraction x sun visibility from the shading pass), squared; the direct sun is gated by the
  // deck / fog (uGradeP.z) and, per glint, by the drifting cloud shadow at the glint's ground point
  vec4 g0 = G0(uv);
  if (g0.x < 60000.0 && uGradeP.z > 0.001) {
    float sv = textureLod(uScene, uv, 0.0).a;
    float sp = h12(floor(gl_FragCoord.xy) + 0.5);
    float tw = 0.5 + 0.5 * sin(uTwinkleT * (2.0 + 5.0 * fract(sp * 13.1)) + sp * 40.0);
    float spark = step(1.0 - 0.016 * sv * sv * max(uGradeP.z, 1.0), fract(sp * 7.77)) * tw * smoothstep(2500.0, 150.0, g0.x) * uGradeP.z;
    if (spark > 0.0) {
      float cs = cloudShadow(uCamPos + camRay(gl_FragCoord.xy) * g0.x);
      c += uSunCol * spark * 2.6 * cs * cs;
    }
  }
  c *= uExposure;
  c *= uGrade;                                       // white balance
  c = aces(c);
  c = mix(c, c * c * (3.0 - 2.0 * c), uGradeP.y);                              // gentle S-curve: sunlit vs shade
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.0 - uGradeP.x);
  c = mix(c, c * vec3(0.96, 0.99, 1.05) + vec3(0.0, 0.004, 0.012), 0.5 * (1.0 - l));  // cool lift in the shadows
  vec2 vq = uv - 0.5;
  c *= 1.0 - 0.16 * smoothstep(0.25, 0.95, length(vq * vec2(1.25, 1.0)));     // vignette
  c = pow(c, vec3(1.0 / 2.2));
  c += (h12(gl_FragCoord.xy + fract(uFrame * 0.618) * 913.0) - 0.5) * 0.022; // film grain / dither
  // first load: the scene is revealed row by row behind the bake's progress edge (soft over 8% of the height).
  // Rebake after a widening resize: columns the old frame never saw stay letterboxed until the new rows reach them
  float fade = 1.0;
  if (uGb.z > 1.5) fade = smoothstep(uGb.y, uGb.y - 0.08, uv.y);
  else if (uGb.z > 0.5 && uv.y >= uGb.y && abs(gbUV(uv).x - 0.5) > 0.5) fade = 0.0;
  c = mix(vec3(0.80, 0.85, 0.90), c, fade);
  o = vec4(c, 1.0);
}`;
  S.glsl.progs.fxaa = { vs: ['VS_FULL'], fs: ['FS_FXAA'] };
  S.glsl.progs.down = { vs: ['VS_FULL'], fs: ['FS_DOWN'] };
  S.glsl.progs.up = { vs: ['VS_FULL'], fs: ['FS_UP'] };
  // the composite includes COMMON + ATMOS for the sparkle's cloud shadow (camRay, cloudShadow); uRes and uSunCol
  // come from COMMON
  S.glsl.progs.comp = { vs: ['VS_FULL'], fs: ['COMMON', 'ENV', 'ATMOS', 'GBUF', 'FS_COMP'] };
})(window.SNOW);
