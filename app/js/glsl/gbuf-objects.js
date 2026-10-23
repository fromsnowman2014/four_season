// =====================================================================================
//  GLSL: GBUF_OBJECTS chunk (G-buffer bake only). Chalet list, the conifer grid and forest density, the tree and
//  chalet SDFs. Queried only through sceneQ (gbuf-main.js); forestDensity is also read once by the materials.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.GBUF_OBJECTS = `
// ------------------------------------------------------------ conifers (SDF on a jittered grid)
// chalets: x, z, rotation. A cluster around the path junction, spread across the meadow
const int NCH = 13;
const vec3 CH[13] = vec3[13](vec3(74.0, 450.0, 0.4), vec3(-7.0, 520.0, -0.3), vec3(-10.0, 595.0, 0.9), vec3(-92.0, 645.0, 0.2),
                             vec3(-56.0, 740.0, -0.5), vec3(-128.0, 765.0, 1.1), vec3(-65.0, 835.0, 0.3), vec3(-105.0, 925.0, -0.8),
                             vec3(80.0, 610.0, 0.6), vec3(0.0, 745.0, -0.2), vec3(-190.0, 690.0, 0.8), vec3(-280.0, 640.0, 0.3), vec3(175.0, 520.0, -0.6));
const float TC = 11.0;
// pixel-footprint range over which SDF trees thin out and the forest-albedo term takes over
const float TREE_FP0 = 1.1, TREE_FP1 = 2.4;
float forestDensity(vec2 c, float h) {
  float x = c.x, z = c.y;
  float n = vn(c * 0.0019 + vec2(5.2, 1.3)) * 0.6 + vn(c * 0.0061 + 3.3) * 0.3 + vn(c * 0.019) * 0.1;
  float across = dot(c - WP, WN);
  // the dark forest band across the middle distance, sweeping in from the left and ending mid-frame
  float bz = 980.0 + 0.3 * x - 130.0 * sin(x * 0.0021 + 1.0);
  float band = exp(-sq((z - bz) / (150.0 + 70.0 * vn(c * 0.003 + 1.0)))) * smoothstep(520.0, 150.0, x);
  // the wooded hillside on the left, reaching the lower-left corner as a tongue
  float left = smoothstep(-150.0, -480.0, x + 0.25 * z + 70.0 * vn(c * 0.0035)) * smoothstep(100.0, 360.0, z);
  // groves on the near knoll at the lower right
  // (dense, and reaching down to the near edge of the frame like the reference's lower-right forest)
  float right = smoothstep(60.0, 360.0, x - 0.45 * (z - 450.0) + 60.0 * vn(c * 0.004 + 2.0)) * smoothstep(140.0, 330.0, z) * smoothstep(1300.0, 950.0, z);
  // sparse random stands, kept off the open pasture under the wall and thinning toward the right
  float patchy = smoothstep(0.45, 0.62, n) * 0.25 * smoothstep(-900.0, -1600.0, across) * smoothstep(900.0, 200.0, x);
  // the wooded flanks of the glacial valley (far left; only ever drawn as the unresolved-forest albedo)
  float vside = smoothstep(2000.0, 3600.0, z) * smoothstep(300.0, -700.0, x + 0.15 * z) * smoothstep(-0.6, 0.0, n);
  float d = patchy + 0.95 * band * smoothstep(-0.45, -0.05, n) + 0.9 * left * smoothstep(-0.5, -0.1, n) + 0.85 * right * smoothstep(-0.3, 0.2, n) + 0.8 * vside;
  d = max(d, 0.003 + 0.045 * smoothstep(-0.05, 0.3, n) * smoothstep(0.35, 0.6, vn(c * 0.011 + 2.0) * 0.5 + 0.5));  // scattered groups
  d *= smoothstep(5.0, 14.0, pathDist(c));                         // keep the paths clear
  d *= smoothstep(330.0, 110.0, h + 60.0 * vn(c * 0.002 + 7.0));   // ragged treeline
  float dc = 1e5;
  for (int i = 0; i < NCH; i++) dc = min(dc, length(c - CH[i].xy));
  d *= smoothstep(16.0, 42.0, dc);                                 // clearings around the chalets
  return clamp(d, 0.0, 0.93);
}
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }

// returns tree distance; hf = height fraction inside the tree, tid = per-tree random.
// fp thins the stand out between TREE_FP0 and TREE_FP1 (the forest-albedo term fades in over the same range)
float treesSDF(vec3 p, float hb, float fp, out float hfr, out float tid) {
  vec2 g = p.xz / TC;
  vec2 cell = floor(g);
  vec2 o = step(0.5, g - cell) - 1.0;           // 2x2 neighbourhood toward p's quadrant
  float best = 1e5; hfr = 0.0; tid = 0.0;
  float fade = smoothstep(TREE_FP1, TREE_FP0, fp);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 c = cell + o + vec2(float(i), float(j));
    float r0 = hash2(c * 1.0 + 0.5), r1 = hash2(c + 71.3), r2 = hash2(c + 13.9), r3 = hash2(c - 41.7);
    float dens = forestDensity((c + 0.5) * TC, hb) * fade;
    if (r0 > dens) continue;
    vec2 tp = (c + 0.5 + (vec2(r1, r2) - 0.5) * 0.42) * TC;
    // heights: mostly 9-24 m, a few emergent old trees; denser stands grow taller
    float H = (mix(9.0, 24.0, r3) + 9.0 * step(0.92, fract(r1 * 9.1))) * mix(0.82, 1.12, dens);
    float R = H * (0.22 + 0.1 * fract(r3 * 13.7));
    vec3 q = vec3(p.x - tp.x, p.y - hb, p.z - tp.y);
    float y = q.y / H;
    // crown skew: the axis leans up to ~15% of H, so no two silhouettes are the same cone
    q.xz -= (vec2(fract(r0 * 5.3), fract(r2 * 3.7)) - 0.5) * 0.3 * H * clamp(y, 0.0, 1.0);
    float rr = length(q.xz);
    // whorled branch tiers (5-11 per tree): smooth sawtooth -> each tier widest at its base (snow shelves on top)
    float tiers = 5.0 + 6.0 * r1;
    float ty = fract(y * tiers + r2);
    float saw = min(ty * 6.0, 1.0) * (1.0 - ty);
    float ang = atan(q.z, q.x);
    float br = 0.09 * sin(ang * 7.0 + r0 * 40.0 + y * 11.0) + 0.05 * sin(ang * 13.0 - y * 23.0);
    float rad = R * (1.0 - y) * (0.55 + 0.45 * saw + br);
    float d = (rr - max(rad, 0.0)) * 0.62;
    d = max(d, 0.15 * H - q.y);
    d = max(d, q.y - H);
    float trunk = max(rr - 0.06 * H * (1.0 - y), max(q.y - 0.3 * H, -q.y - 2.0));
    d = min(d, trunk);
    if (d < best) { best = d; hfr = clamp(y, 0.0, 1.0); tid = r3; }
  }
  return best;
}
float chaletsSDF(vec3 p, float hb, out float m) {
  float best = 1e5; m = 3.0;
  for (int i = 0; i < NCH; i++) {
    vec3 c = CH[i];
    vec2 dxz = p.xz - c.xy;
    if (dot(dxz, dxz) > 1600.0) continue;
    float cs = cos(c.z), sn = sin(c.z);
    vec3 q = vec3(cs * dxz.x - sn * dxz.y, p.y - hb, sn * dxz.x + cs * dxz.y);
    float sc = 1.1 + 0.6 * hash2(vec2(float(i) * 3.7, 1.0));          // per-chalet scale 1.1-1.7
    q /= sc;
    // pitched roof: thin slab following |z|*tan(28deg), overhanging 0.7 m; the walls are clipped by the
    // roof plane so the gable ends are triangles under it instead of a box poking through the slab
    float ry = 4.7 - abs(q.z) * 0.53;
    float walls = max(sdBox(q - vec3(0.0, 1.0, 0.0), vec3(4.6, 3.8, 3.1)), q.y - ry + 0.12);
    float roof = max(abs(q.y - ry) * 0.88 - 0.22, max(abs(q.x) - 5.3, abs(q.z) - 3.8));
    float d = min(walls, roof) * sc;
    if (d < best) { best = d; m = roof < walls ? 4.0 : 3.0; }
  }
  return best;
}
float nearChalets(vec2 p) {
  return (p.y > 400.0 && p.y < 980.0 && p.x > -330.0 && p.x < 230.0) ? 1.0 : 0.0;
}
`;
})(window.SNOW);
