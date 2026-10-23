// =====================================================================================
//  GLSL: GBUF_TERRAIN chunk (G-buffer bake only). Scene layout (paths, the wall frame, the valley axis), the
//  macro weights layoutW shared by height and material, and the heightfield terrainH. terrainH is inlined once,
//  through sceneQ (gbuf-main.js): never call it from anywhere else (ANGLE/Metal compile time).
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.GBUF_TERRAIN = `
// ---- scene layout (metres; camera at the origin looking +z, +x is screen-right). Staged after the
// reference photo: a high vantage over a chalet meadow, the great wall on the right seen at a grazing
// angle (its foot nearest at the right edge, receding to the far centre), the glacial valley far-left.
// Two dirt paths: path 1 winds away from the viewer up through the chalets, path 2 branches off at
// the junction (z = PJ) toward the lower right.
float path1X(float z) { return 20.0 + 70.0 * sin(z * 0.0044 + 0.8) + 26.0 * sin(z * 0.0127 + 2.0) - 0.05 * z; }
float path1dX(float z) { return 0.308 * cos(z * 0.0044 + 0.8) + 0.330 * cos(z * 0.0127 + 2.0) - 0.05; }
const float PJ = 700.0;
float path2Z(float x) { float u = x - path1X(PJ); return PJ - 0.5 * u + 55.0 * sin(u * 0.011 + 0.3) * smoothstep(0.0, 60.0, u); }
float path2dZ(float x) { float u = x - path1X(PJ); return -0.5 + 0.605 * cos(u * 0.011 + 0.3) * smoothstep(0.0, 60.0, u); }
// distance to the nearest path (grows past their ends so the masks fade out)
float pathDist(vec2 p) {
  float d1 = abs(p.x - path1X(p.y)) / sqrt(1.0 + sq(path1dX(p.y))) + 40.0 * smoothstep(2300.0, 2700.0, p.y);
  float u = p.x - path1X(PJ);
  float d2 = abs(p.y - path2Z(p.x)) / sqrt(1.0 + sq(path2dZ(p.x))) + 40.0 * smoothstep(0.0, -30.0, u);
  return min(d1, d2);
}
const vec2 WP = vec2(1600.0, 2400.0);     // nearest point of the wall's foot (just off the right edge)
const vec2 WD = vec2(-0.414, 0.910);      // unit direction along the foot, receding to the far centre
const vec2 WN = vec2(0.910, 0.414);       // unit direction into the wall (perpendicular to the foot)
float valleyAxis(float z) { return -1500.0 - 0.2 * z + 260.0 * sin(z * 0.00041 + 0.4); }

// macro weights used by both height and material. across/along: wall-frame coordinates (m);
// footD: signed distance from the (wavy) foot of the rock face, positive up the face
void layoutW(vec2 w, out float mtnW, out float valW, out float wallW, out float across, out float along, out float footD) {
  float x = w.x, z = w.y;
  vec2 r = w - WP;
  along = dot(r, WD); across = dot(r, WN);
  // the foot line waves at two scales so the face is ribbed with buttresses all the way down, not a flat ramp
  float ac = across + 260.0 * vn(vec2(along * 0.0009, 0.5)) + 110.0 * vn(vec2(along * 0.0031, across * 0.0006) + 3.0);
  footD = ac + 150.0;
  wallW = smoothstep(-150.0, 1250.0, ac) * smoothstep(-3800.0, -2200.0, along) * smoothstep(14500.0, 11000.0, along);
  vec2 lp = (w - vec2(-6000.0, 16500.0)) / vec2(3600.0, 2800.0);  // left snowy massif
  float left = exp(-dot(lp, lp) * 1.2);
  float back = smoothstep(14000.0, 20000.0, z) * 0.75;             // distant range closing the valley
  mtnW = clamp(max(wallW, max(left, back)), 0.0, 1.0);
  float dv = (x - valleyAxis(z)) / 1450.0;
  valW = exp(-dv * dv) * smoothstep(400.0, 2600.0, z - 0.3 * (x + 1700.0)) * (1.0 - mtnW * 0.85);
}
float gauss2(vec2 d) { return exp(-dot(d, d)); }

float terrainH(vec2 p, float fp) {
  // gentle domain warp keeps the macro shapes organic
  vec2 w = p + 180.0 * vec2(vn(p * 0.00033 + vec2(4.1, 0.3)), vn(p * 0.00033 + vec2(-2.3, 6.1)));
  float x = w.x, z = w.y;
  float mtnW, valW, wallW, across, along, footD; layoutW(w, mtnW, valW, wallW, across, along, footD);

  // --- meadow: the hillside under the viewpoint drops into the chalet basin; a few knolls
  float h = 40.0 - 140.0 * smoothstep(-150.0, 700.0, z);
  h += 70.0 * gauss2((w - vec2(380.0, 1300.0)) / 420.0) + 50.0 * gauss2((w - vec2(-80.0, 1950.0)) / 520.0) + 35.0 * gauss2((w - vec2(430.0, 520.0)) / 260.0);
  // --- the pasture flank climbing to the wall's foot on the near (right) part of the wall ...
  float nearW = smoothstep(4200.0, 1200.0, along);
  h += 0.21 * softplus(across + 1500.0, 450.0) * nearW * (1.0 - valW);
  // ... while further along, the ground falls away into the valley so the far wall rises from low down
  h -= 550.0 * smoothstep(1200.0, 4200.0, along) * smoothstep(-2200.0, -300.0, across);
  // terraces (benches) and ribs/gullies running down the flank's fall line
  float flankM = smoothstep(-1700.0, -500.0, across) * (1.0 - smoothstep(-250.0, 150.0, across)) * nearW;
  float tz = across / 150.0 + 0.7 * vn(vec2(along * 0.004, 1.0)); float tf = fract(tz);
  h += 18.0 * (smoothstep(0.35, 0.65, tf) - tf) * flankM * (0.6 + 0.4 * vn(w * 0.0015 + 2.0));
  float og = clamp(log2(400.0 / max(2.2 * fp, 0.5)), 0.0, 6.0);
  h += 80.0 * erodedFbm(vec2(along / 230.0, across / 700.0) + vec2(8.3, 2.1), og) * flankM;
  // --- valley trough on the left
  h -= 1000.0 * valW;
  // --- mountains
  if (mtnW > 0.002) {
    float oct = clamp(log2(2800.0 / max(2.2 * fp, 0.5)), 1.0, 11.0);
    vec2 q = w / 2800.0;
    float e = erodedFbm(q + vec2(3.1, 1.7), oct);
    float r = ridgedFbm(q * 1.25 + vec2(-4.2, 9.1), oct - 1.0);
    // the wall lowers as it recedes; the left massif is a little taller than the wall's near end
    vec2 lp = (w - vec2(-6000.0, 16500.0)) / vec2(3600.0, 2800.0);
    float left = exp(-dot(lp, lp) * 1.2), back = smoothstep(14000.0, 20000.0, z) * 0.75;
    float ws = mix(1.0, 0.55, smoothstep(0.0, 7000.0, along));
    float hs = (wallW * ws + left * 1.05 + back * 0.65) / max(wallW + left + back, 1e-3);
    float m = (1700.0 + 1300.0 * e + 1100.0 * r) * hs;
    vec2 lp2 = (w - vec2(-6300.0, 16800.0)) / vec2(2400.0, 2000.0);
    m += 700.0 * exp(-dot(lp2, lp2));                               // the left massif towers higher
    // couloirs & buttresses: ridged noise stretched along the fall line (z), narrow across (x)
    float oc = clamp(log2(260.0 / max(2.2 * fp, 0.5)), 0.0, 6.0);
    float cg = ridgedFbm(vec2(w.x / 210.0, w.y / 520.0) + vec2(1.3, 7.1), oc);
    m += (cg - 0.35) * 300.0 * smoothstep(700.0, 1800.0, m);
    // mid-scale eroded rock: ribs, ledges and buttress faces
    float oe = clamp(log2(420.0 / max(2.2 * fp, 0.5)), 0.0, 6.0);
    m += 140.0 * erodedFbm(w / 420.0 + vec2(5.5, 3.3), oe) * smoothstep(700.0, 1600.0, m);
    // irregular limestone ledges: tilted, folded, in patches, and faded out where they would be
    // sub-pixel (on the far peaks they otherwise collect snow into ruler-straight lines)
    float tz2 = (m + 0.12 * w.x + 0.06 * w.y + 420.0 * vn(w * 0.0004 + 1.0) + 130.0 * vn(w * 0.0007)) / 95.0; float tf2 = fract(tz2);
    float ledgeMask = smoothstep(-0.1, 0.5, vn(w * 0.0011 + 4.4)) * smoothstep(1000.0, 1600.0, m) * smoothstep(9.0, 3.0, fp);
    m += (smoothstep(0.3, 0.7, tf2) - tf2) * 95.0 * 0.32 * ledgeMask;
    h = mix(h, h + m, mtnW);
    // buttresses and gullies on the wall face itself (in the wall frame, so they run down the fall line
    // and reach the foot instead of fading with the ramp weight)
    float faceM = smoothstep(0.02, 0.25, wallW);
    float ob = clamp(log2(300.0 / max(2.2 * fp, 0.5)), 0.0, 6.0);
    // ~130 m rib spacing, 200 m relief: real buttresses with gullies between (the material pass re-evaluates
    // this ridged value for cavity shading, since the frontal sun casts no shadow into the gullies)
    h += 200.0 * (ridgedFbm(vec2(along / 260.0, across / 900.0) + vec2(5.0, 2.0), ob) - 0.4) * faceM;
  }
  // --- rolling meadow detail (fades out on mountains), down to ~1 m bumps near the camera
  float octM = clamp(log2(800.0 / max(2.0 * fp, 0.03)), 0.0, 11.0);
  h += 38.0 * fbmF(w / 800.0 + 2.3, octM) * (1.0 - 0.7 * mtnW);
  float octK = clamp(log2(170.0 / max(2.0 * fp, 0.03)), 0.0, 7.0);
  h += 9.0 * fbmF(w / 170.0 + 5.1, octK) * (1.0 - mtnW);
  float octB = clamp(log2(18.0 / max(2.0 * fp, 0.03)), 0.0, 5.0);
  h += 1.6 * fbmF(p / 18.0 + 7.7, octB) * (1.0 - mtnW);
  float octU = clamp(log2(75.0 / max(2.0 * fp, 0.03)), 0.0, 3.0);
  h += 5.0 * fbmF(p / 75.0 + 3.1, octU) * (1.0 - mtnW);
  // paths are slightly sunken into the turf
  h -= 0.35 * (1.0 - smoothstep(1.2, 2.6, pathDist(p)));
  return h;
}
`;
})(window.SNOW);
