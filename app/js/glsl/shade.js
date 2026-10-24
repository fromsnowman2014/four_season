// =====================================================================================
//  GLSL: the scene shading pass (frozen glue). It owns only the tree-sway remap of the G-buffer lookup, the cloud
//  pass fetch and the order of the calls into the lane chunks:
//    sky pixel:     skyPixel (ATMOS; or the scene's sceneSky: SCENE_SKY) -> hazardLight (HAZARD) -> applyVeil (VEIL)
//    surface pixel: shadeSurface (the scene's surface chunk: SURFACE / SURFACE_HOUSE) -> hazardSurface -> hazardLight
//                   (HAZARD) -> applyAtmos (ATMOS) -> applyVeil (VEIL)
//    ?view=:        surfaceDebug (the scene's surface chunk)
//  Output: rgb = scene radiance, a = snow fraction x sun visibility (0 on the sky), read by the composite sparkle and
//  the flake colour-over-snow. Program 'shade' (valley) = COMMON + ENV + ATMOS + GBUF + SURFACE + VEIL + HAZARD +
//  FS_SHADE; 'shade@house' swaps SURFACE for SURFACE_HOUSE (which also brings its own treeH: SCENE_SWAY).
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.FS_SHADE = `
uniform sampler2D uSky, uSkyD;
uniform vec3 uSway;          // x: lateral wind (m/s), y: integrated sway phase (rad, CPU), z: focal length in px
out vec4 o;

// tree sway: treetops lean/oscillate with the wind. The G-buffer is static, so we invert the
// displacement field with a 2-step fixed-point lookup (starting mid-tree so silhouettes move too).
// treeH(g0): the sway weight of a G-buffer pixel (0 = rigid). A scene whose surface chunk defines SCENE_SWAY brings its
// own (its material ids differ: SURFACE_HOUSE); the valley's is material 2 (tree) with its height fraction
#ifndef SCENE_SWAY
float treeH(vec4 g) { return floor(g.y + 0.001) == 2.0 ? fract(g.y + 0.001) / 0.9 : 0.0; }
#endif
// a sky pixel's radiance: ATMOS's skyPixel, or the scene's own sky (stage 2b): a scene whose surface chunk defines
// SCENE_SKY brings sceneSky(rd, cl) (the house: its golden-hour gradient over skyPixel)
#ifndef SCENE_SKY
vec3 sceneSky(vec3 rd, vec4 cl) { return skyPixel(rd, cl); }
#endif
vec2 swayOff(float h, float t, vec2 frag) {
  float w = uSway.x;
  float osc = sin(uSway.y + frag.x * 0.013 + frag.y * 0.007) * (0.25 + 0.05 * abs(w));
  float disp = (0.012 * w + osc * 0.12) * h * h * 18.0;          // metres at the top of an ~18 m spruce
  return vec2(disp / max(t, 1.0) * uSway.z, 0.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 g0 = G0(uv);
  {
    vec2 oMax = swayOff(1.0, g0.x, gl_FragCoord.xy);
    if (abs(oMax.x) > 0.15 && g0.x < 6000.0) {
      vec2 x = gl_FragCoord.xy - 0.5 * oMax;
      for (int i = 0; i < 2; i++) { vec4 gi = G0(x / uRes); x = gl_FragCoord.xy - swayOff(treeH(gi), gi.x, gl_FragCoord.xy); }
      vec4 gs = G0(x / uRes);
      if (treeH(gs) > 0.0 || treeH(g0) > 0.0) { uv = x / uRes; g0 = gs; }
    }
  }
  vec3 rd = camRay(uv * uRes);
  float t = g0.x;
  vec4 cl = texture(uSky, uv);            // clouds: premultiplied radiance + transmittance
  float cOp = 1.0 - cl.a;
  float cT = cOp > 0.003 ? texture(uSkyD, uv).x / cOp : 0.0;   // opacity-weighted mean cloud distance (0 = none)
  if (uView > 0) { o = vec4(t > 60000.0 ? vec3(0.04, 0.06, 0.1) : surfaceDebug(uView, uv, g0, rd, t), 0.0); return; }
  if (t > 60000.0) {
    o = vec4(applyVeil(hazardLight(sceneSky(rd, cl), uv, g0, rd, t, cl), t, gl_FragCoord.xy), 0.0);
    return;
  }
  float snowMask;
  vec3 col = shadeSurface(uv, g0, rd, t, snowMask);
  col = hazardSurface(col, uv, g0, rd, t);      // crack decals (HAZARD; neutral in stage 0)
  col = hazardLight(col, uv, g0, rd, t, cl);    // lightning on the scene
  col = applyAtmos(col, t, rd, cl, cT);
  o = vec4(applyVeil(col, t, gl_FragCoord.xy), snowMask);
}
`;
  // the valley's shade program (scenes/valley.js progs.shade); the house's is 'shade@house' (glsl/house/surface-house.js)
  S.glsl.progs.shade = { vs: ['VS_FULL'], fs: ['COMMON', 'ENV', 'ATMOS', 'GBUF', 'SURFACE', 'VEIL', 'HAZARD', 'FS_SHADE'] };

  // HAZARD_IDLE (polish): the five hazard hooks the glue calls (FS_SKY / FS_SKY_SOFT: hazardSky; FS_SHADE: hazardLight,
  // hazardSurface; FS_COMP / FS_COMP_SCENE: hazardShake, hazardComp) as exactly what each returns while its hazard is
  // off, with HAZARD's signatures. gl.js builds a hook-free twin of every program whose recipe includes HAZARD ('<recipe>~idle':
  // HAZARD replaced by this chunk) and render.js draws the twin while no hazard is on: the same image (each hook is the
  // identity then), the Phase-2 code (the inlined hooks changed the Metal codegen of the sky expression: 1 LSB on a
  // pixel or two of some rain frames) and less of it (the valley ~2% faster in steady state). tests/check.mjs pins
  // the signatures and the hooks' early-outs that render.js's predicate mirrors.
  C.HAZARD_IDLE = `
vec3 hazardSky(vec3 acc, float T, vec3 rd, float tHit) { return acc; }
vec3 hazardLight(vec3 col, vec2 uv, vec4 g0, vec3 rd, float t, vec4 cl) { return col; }
vec3 hazardSurface(vec3 col, vec2 uv, vec4 g0, vec3 rd, float t) { return col; }
vec2 hazardShake(vec2 uv) { return uv; }
vec3 hazardComp(sampler2D hdr, sampler2D bloom, float bloomStr, vec2 uv) { return texture(hdr, uv).rgb + texture(bloom, uv).rgb * bloomStr; }
`;
})(window.SNOW);
