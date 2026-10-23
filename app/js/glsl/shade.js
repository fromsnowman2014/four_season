// =====================================================================================
//  GLSL: the scene shading pass (frozen glue). It owns only the tree-sway remap of the G-buffer lookup, the cloud
//  pass fetch and the order of the calls into the lane chunks:
//    sky pixel:     skyPixel (ATMOS, lane C) -> applyVeil (VEIL, lane E)
//    surface pixel: shadeSurface (SURFACE, lane D) -> applyAtmos (ATMOS, lane C) -> applyVeil (VEIL, lane E)
//    ?view=:        surfaceDebug (SURFACE)
//  Output: rgb = scene radiance, a = snow fraction x sun visibility (0 on the sky), read by the composite sparkle and
//  the flake colour-over-snow. Program 'shade' = COMMON + ENV + ATMOS + GBUF + SURFACE + VEIL + FS_SHADE.
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
float treeH(vec4 g) { return floor(g.y + 0.001) == 2.0 ? fract(g.y + 0.001) / 0.9 : 0.0; }
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
    o = vec4(applyVeil(skyPixel(rd, cl), t, gl_FragCoord.xy), 0.0);
    return;
  }
  float snowMask;
  vec3 col = shadeSurface(uv, g0, rd, t, snowMask);
  col = applyAtmos(col, t, rd, cl, cT);
  o = vec4(applyVeil(col, t, gl_FragCoord.xy), snowMask);
}
`;
  S.glsl.progs.shade = { vs: ['VS_FULL'], fs: ['COMMON', 'ENV', 'ATMOS', 'GBUF', 'SURFACE', 'VEIL', 'FS_SHADE'] };
})(window.SNOW);
