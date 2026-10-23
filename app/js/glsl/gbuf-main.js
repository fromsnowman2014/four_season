// =====================================================================================
//  GLSL: the G-buffer bake program (frozen during the stage-1 lanes).
//   GBUF_HEAD   bake uniforms, the MRT outputs, march limits
//   GBUF_MAIN   sceneQ, the single scene-query call site, and the phase state machine in main()
//  Program 'gbuf' = COMMON + GBUF_HEAD + GBUF_NOISE + GBUF_TERRAIN + GBUF_OBJECTS + GBUF_MATERIALS + GBUF_MAIN.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.GBUF_HEAD = `
uniform float uPixAng;
uniform int uIter;                  // state-machine iteration cap (a uniform bound: the driver cannot unroll the loop)
layout(location = 0) out vec4 o0;   // t, material(+grass frac), sun shadow, AO
layout(location = 1) out vec4 o1;   // albedo, snow threshold
layout(location = 2) out vec4 o2;   // oct(detail normal), oct(smooth normal)
layout(location = 3) out vec4 o3;   // season-neutral material params, 0..1: rock, soil / path, larch, moisture (RGBA8)

const float TMAX = 42000.0;
const float HMAX = 4400.0;
`;
  C.GBUF_MAIN = `
// Every terrain / scene distance query of main() goes through this ONE call site (a phase state machine
// drives it, matte-style), so the big height function and the tree / chalet SDFs are inlined exactly once:
// the shader stays small and compiles quickly on ANGLE/Metal (Safari) instead of inlining terrainH ~25x.
//   mode 0: heightfield only (returns p.y - h)
//   mode 1: full scene for the march / SDF normals: trees (with a bounding slab above them) + chalets
//   mode 2: sun-shadow ray: trees only where the ray is near the ground, no slab, no chalets
// mat: 1 terrain, 2 tree, 3 wall, 4 roof. fpO is the footprint used for the objects (the shadow ray keeps
// the surface's footprint for the trees while the terrain LOD coarsens along the ray).
float sceneQ(vec3 p, float fp, float fpO, int mode, out float mat, out float hb, out float dTree, out float hfr, out float tid) {
  hb = terrainH(p.xz, fp);
  float dy = p.y - hb;
  mat = 1.0; dTree = 1e5; hfr = 0.0; tid = 0.0;
  if (mode == 0) return dy;
  bool near = fpO < TREE_FP1 && dy < 36.0;
  if (near) dTree = treesSDF(p, hb, fpO, hfr, tid);
  if (mode == 2) return min(dy, dTree);
  float d = dy * 0.42;
  if (fpO < TREE_FP1 && !near) d = min(d, dy - 35.5);
  if (dTree < d) { d = dTree; mat = 2.0; }
  if (nearChalets(p.xz) > 0.5 && dy < 14.0) { float cm; float dc = chaletsSDF(p, hb, cm); if (dc < d) { d = dc; mat = cm; } }
  return d;
}

void main() {
  vec3 rd = camRay(gl_FragCoord.xy);
  vec3 ro = uCamPos;
  float t = 2.0, tPrev = t, mat = 0.0;
  float bA = 0.0, bB = 0.0;                                   // bisection bracket
  vec3 pos = vec3(0.0), nD = vec3(0.0, 1.0, 0.0), nS = nD, so = vec3(0.0);
  float fp = 0.0, hT = 0.0, hfr = 0.0, tid = 0.0, sh = 1.0, ts = 0.0, ao = 1.0, canopy = 0.0;
  float hN[8]; vec4 tet = vec4(0.0);
  float occ = 0.0, wsum = 0.0, curvS = 0.0, curvLS = 0.0;
  bool hit = false;
  int phase = 0, j = 0, mi = 0;
  const vec2 k2 = vec2(1.0, -1.0);
  // phases: 0 march -> 1 bisection refine (heightfield, steep cliffs) -> 2 height at the hit -> 3 normal probes
  //         -> 4 soft sun shadow -> 5 AO horizon probes along the normal -> 6 canopy proximity -> 7 curvature -> 8 done
  for (int it = 0; it < uIter; it++) {
    vec3 q; float qf, qfo; int mode;
    if (phase == 0) { q = ro + rd * t; qf = t * uPixAng; qfo = qf; mode = 1; }
    else if (phase == 1) { float mt = 0.5 * (bA + bB); q = ro + rd * mt; qf = mt * uPixAng; qfo = qf; mode = 0; }
    else if (phase == 2) { q = pos; qf = fp; qfo = fp; mode = 0; }
    else if (phase == 3) {
      if (mat == 1.0) {
        // central differences at two scales: j<4 detail normal (fine footprint), j<8 smooth normal
        float e = j < 4 ? max(0.05, fp * 0.6) : max(1.5, fp * 5.0);
        int jj = j & 3;
        vec2 o = jj == 0 ? vec2(e, 0.0) : jj == 1 ? vec2(-e, 0.0) : jj == 2 ? vec2(0.0, e) : vec2(0.0, -e);
        q = vec3(pos.x + o.x, pos.y, pos.z + o.y); qf = j < 4 ? fp * 0.45 : fp * 5.0; qfo = qf; mode = 0;
      } else {
        // tetrahedral gradient of the scene SDF
        float e = max(0.03, fp * 0.5);
        vec3 kk = j == 0 ? k2.xyy : j == 1 ? k2.yyx : j == 2 ? k2.yxy : k2.xxx;
        q = pos + kk * e; qf = fp; qfo = fp; mode = 1;
      }
    }
    else if (phase == 4) { q = so + uSunDir * ts; qf = max(fp, ts * 0.004); qfo = fp; mode = (fp < TREE_FP1 && ts < 450.0) ? 2 : 0; }
    else if (phase == 5) { float hh = max(1.5, fp * 2.0) * pow(3.0, float(j)); q = pos + nS * hh; qf = max(fp, hh * 0.2); qfo = qf; mode = 0; }
    else if (phase == 6) { q = pos + vec3(0.0, 1.5, 0.0); qf = fp; qfo = fp; mode = 1; }
    else if (phase == 7) {
      // height vs. the mean of 4 neighbours at two scales (hummocks / ribs), consumed by the grass albedo
      float e = j < 4 ? max(10.0, fp * 6.0) : max(45.0, fp * 14.0);
      int jj = j & 3;
      vec2 o = jj == 0 ? vec2(e, 0.0) : jj == 1 ? vec2(-e, 0.0) : jj == 2 ? vec2(0.0, e) : vec2(0.0, -e);
      q = vec3(pos.x + o.x, pos.y, pos.z + o.y); qf = fp; qfo = fp; mode = 0;
    }
    else break;
    float m_, hb_, dT_, hfr_, tid_;
    float d = sceneQ(q, qf, qfo, mode, m_, hb_, dT_, hfr_, tid_);
    if (phase == 0) {
      if (d < max(0.35 * qf, 0.004)) {
        hit = true; mat = m_; hfr = hfr_; tid = tid_;
        if (mat == 1.0) { bA = tPrev; bB = t; phase = 1; j = 0; }
        else { pos = ro + rd * t; fp = qf; phase = 2; }
      }
      else if ((q.y > HMAX && rd.y > 0.0) || t > TMAX || ++mi >= 900) break;
      else { tPrev = t; t += max(d, 0.25 * qf); }
    } else if (phase == 1) {
      float mt = 0.5 * (bA + bB); if (d < 0.0) bB = mt; else bA = mt;
      if (++j >= 6) { t = bB; pos = ro + rd * t; fp = t * uPixAng; phase = 2; }
    } else if (phase == 2) { hT = hb_; phase = 3; j = 0; }
    else if (phase == 3) {
      bool done;
      if (mat == 1.0) {
        hN[j] = hb_; done = ++j >= 8;
        if (done) { nD = normalize(vec3(hN[1] - hN[0], 2.0 * max(0.05, fp * 0.6), hN[3] - hN[2])); nS = normalize(vec3(hN[5] - hN[4], 2.0 * max(1.5, fp * 5.0), hN[7] - hN[6])); }
      } else {
        tet[j] = d; done = ++j >= 4;
        if (done) { nD = normalize(k2.xyy * tet.x + k2.yyx * tet.y + k2.yxy * tet.z + k2.xxx * tet.w); nS = nD; }
      }
      if (done) {
        if (dot(nD, uSunDir) > -0.2) { so = pos + nD * max(0.15, fp * 2.0); ts = 0.4; phase = 4; j = 0; }
        else { sh = 0.0; phase = 5; j = 0; }
      }
    } else if (phase == 4) {
      sh = min(sh, 10.0 * d / ts);
      ts += clamp(d * 0.55, 0.25 + ts * 0.012, 60.0 + ts * 0.06);
      if (sh < 0.002 || ++j >= 110 || ts > 22000.0 || so.y + uSunDir.y * ts > HMAX) { phase = 5; j = 0; }
    } else if (phase == 5) {
      float hh = max(1.5, fp * 2.0) * pow(3.0, float(j));
      occ += clamp((hh - d) / hh, 0.0, 1.0) * (1.0 / float(j + 1)); wsum += 1.0 / float(j + 1);
      if (++j >= 5) { ao = clamp(1.0 - 1.5 * occ / wsum, 0.0, 1.0); phase = mat == 1.0 ? (fp < TREE_FP1 ? 6 : 7) : 8; j = 0; }
    } else if (phase == 6) {
      // ground darkening under / near trees (needle litter + occlusion); the same proximity is the canopy
      // interception term below (the ground beneath a spruce stays bare longest)
      canopy = 1.0 - smoothstep(-0.5, 4.5, dT_); ao *= mix(1.0, 0.45, canopy); phase = 7; j = 0;
    }
    else { if (j < 4) curvS += hb_; else curvLS += hb_; if (++j >= 8) phase = 8; }
  }
  if (!hit) { o0 = vec4(65000.0, 0.0, 1.0, 1.0); o1 = vec4(0.0); o2 = vec4(0.0); o3 = vec4(0.0); return; }
  sh = smoothstep(0.0, 1.0, clamp(sh, 0.0, 1.0));
  // ---- materials
  gbMaterials(t, mat, pos, nD, nS, fp, hT, hfr, tid, sh, ao, canopy, curvS, curvLS);
}
`;
  S.glsl.progs.gbuf = { vs: ['VS_FULL'], fs: ['COMMON', 'GBUF_HEAD', 'GBUF_NOISE', 'GBUF_TERRAIN', 'GBUF_OBJECTS', 'GBUF_MATERIALS', 'GBUF_MAIN'] };
})(window.SNOW);
