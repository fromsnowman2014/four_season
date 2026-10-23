// =====================================================================================
//  GLSL: GBUF_MATERIALS chunk (G-buffer bake only; stage-1 owner: lane D). Terrain (grass, rock, scree, far
//  forest, paths, snow threshold), tree and chalet materials, the season-neutral material parameters (G3) and the
//  G-buffer pack, as one function called once from main(). Must not call terrainH / sceneQ / forestDensity again
//  (compile-time constraint, see gbuf-main.js). Everything here is season-neutral: seasons are per-frame shading.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.GBUF_MATERIALS = `
// Materials: albedo (the summer reference), snow threshold, and the material-modified detail normal and AO, packed
// into the G-buffer. Called exactly once, from main() once the state machine is done; it makes no scene query (the
// only one is sceneQ). In: the hit (t, mat, pos), the detail / smooth normals, the footprint fp, the terrain height
// hT at the hit, the tree height fraction hfr and per-tree random tid, the soft sun shadow sh, the AO, the canopy
// proximity and the phase-7 curvature sums. Out: o0..o3.
// G3 (o3, RGBA8 0..1; all-RGBA16F fallback, so every channel is saturated here):
//   r rock: bare rock + scree fraction        g soil: trodden path / bare soil fraction (puddle potential)
//   b larch: 1 on a resolved larch crown; on the unresolved far forest its canopy cover x the stand's larch share
//   a moist: moisture order from the baked curvature, slope and pasture mottle (0 dry rib / sunny steep, 1 moist hollow)
// The larch summer reference (resolved crowns; SURFACE recolours by the ratio larchSeason / LARCH_REF, keep in sync)
const vec3 LARCH_REF = vec3(0.075, 0.10, 0.034);
// larch share of the conifer stands at xz (ground altitude alt): ~400 m stands with a ~100 m fringe, commoner toward
// the treeline and on the far valley flanks: 0.04 .. ~0.8, mean ~0.25 (mixed stands: spruce always stays
// among the larches). The same field picks the resolved larch crowns and tints the unresolved far canopy, so a golden
// stand stays one stand across the tree-SDF / forest-albedo hand-over
float larchShare(vec2 xz, float alt) {
  float n = 0.5 + 0.5 * (0.8 * vn(xz * 0.0024 + vec2(2.7, 8.1)) + 0.2 * vn(xz * 0.009 + vec2(5.3, 1.9)));
  return sat(0.5 * smoothstep(0.45, 0.75, n) + 0.18 * smoothstep(60.0, 300.0, alt) + 0.22 * smoothstep(2500.0, 4500.0, length(xz)) + 0.04);
}
void gbMaterials(float t, float mat, vec3 pos, vec3 nD, vec3 nS, float fp, float hT, float hfr, float tid,
                 float sh, float ao, float canopy, float curvS, float curvLS) {
  vec3 alb; float snowT; float grass = 0.0;
  vec4 mp = vec4(0.0);
  vec2 xz = pos.xz;
  if (mat == 1.0) {
    vec2 w = xz + 180.0 * vec2(vn(xz * 0.00033 + vec2(4.1, 0.3)), vn(xz * 0.00033 + vec2(-2.3, 6.1)));
    float mtnW, valW, wallW, across, along, footD; layoutW(w, mtnW, valW, wallW, across, along, footD);
    float steep = 1.0 - smoothstep(0.42, 0.86, nS.y);
    float alt = pos.y;
    float lodD = clamp(log2(5.5 / max(fp, 0.01)), 0.0, 6.0);   // n3's 11 m base octave at Nyquist: no shimmer on the far slopes
    float wAlong = smoothstep(-3800.0, -2200.0, along) * smoothstep(14500.0, 11000.0, along);   // the wall's extent along its foot
    float faceM = smoothstep(0.02, 0.25, wallW);
    // the same ridged buttress field the height uses (terrainH): crests ~1, gullies ~0
    float butt = ridgedFbm(vec2(along / 260.0, across / 900.0) + vec2(5.0, 2.0), clamp(log2(300.0 / max(2.2 * fp, 0.5)), 0.0, 6.0));
    // local curvature (height vs. the mean of 4 neighbours) at two scales: hummocks near the camera,
    // ribs/gullies on the far slopes. + on crests, - in hollows
    float ce = max(10.0, fp * 6.0), cl = max(45.0, fp * 14.0);
    float curv = (hT - 0.25 * curvS) / ce;      // neighbour sums from phase 7
    float curvL = (hT - 0.25 * curvLS) / cl;
    // grass: yellow-olive alpine pasture; pale/dry on ribs and sunny slopes, lush in hollows, scrub patches
    float n1 = vn(xz * 0.0027 + 1.7), n3 = fbmF(xz * 0.09, lodD);
    vec3 gA = vec3(0.125, 0.140, 0.042), gB = vec3(0.185, 0.175, 0.062), gC = vec3(0.075, 0.098, 0.032);
    vec3 grassC = mix(gA, gB, smoothstep(-0.3, 0.7, n1));
    grassC = mix(grassC, gC, 0.9 * max(smoothstep(0.03, 0.14, -curv), smoothstep(0.02, 0.1, -curvL)));
    grassC = mix(grassC, gB * vec3(1.05, 1.0, 0.9), 0.8 * max(smoothstep(0.03, 0.14, curv), smoothstep(0.02, 0.1, curvL)));
    float scrub = smoothstep(0.38, 0.65, vn(xz * 0.03 + 9.1) * 0.6 + vn(xz * 0.09 + 2.2) * 0.4);   // dwarf pine / alder patches
    grassC = mix(grassC, vec3(0.05, 0.075, 0.03), 0.6 * scrub * (1.0 - steep));
    grassC = mix(grassC, vec3(0.24, 0.21, 0.08), 0.3 * smoothstep(0.5, 0.9, vn(xz * 0.012 + 5.5)) * smoothstep(0.1, 0.5, steep + 0.3 * n1));  // straw
    // 40-80 m lush / bleached patches (grazing, drainage): the macro mottle of a real pasture, +-25%
    float pch = vn(xz * 0.015 + 6.3) * 0.7 + vn(xz * 0.045 + 1.9) * 0.3;
    grassC *= 1.0 + 0.25 * pch;
    grassC = mix(grassC, grassC * vec3(0.88, 1.0, 0.75), 0.5 * smoothstep(0.1, 0.6, pch));          // bleached = yellower
    grassC = mix(grassC, grassC * vec3(0.9, 1.0, 1.1), 0.5 * smoothstep(-0.1, -0.6, pch));          // lush = deeper green
    grassC *= 0.85 + 0.3 * n3;
    grassC = mix(grassC, grassC * vec3(1.0, 0.96, 0.85), smoothstep(0.1, 0.45, steep));   // drier on slopes (never brighter than flat turf)
    grassC = mix(grassC, grassC * vec3(0.72, 0.74, 0.7), 0.7 * mtnW);                    // muted alpine turf
    // rock: grey-blue limestone, strata bands (altitude-keyed, so they stay horizontal on the faces),
    // mottling from 3D noise (2D xz noise would smear vertically on a cliff), darker water streaks
    // bedding dips ~20 deg along the strike (alt + 0.36 * along), as on the reference's wall
    float strat = vn(vec2(alt * 0.011 + along * 0.004 + 0.5 * vn(xz * 0.0015), along * 0.0013)) * 0.6 + vn3(pos * 0.006) * 0.4;
    float stk = vn3(pos * 0.012 + 3.0);
    vec3 rockC = vec3(0.155, 0.16, 0.172) * max(0.68 + 0.5 * strat, 0.12) * (0.8 + 0.3 * stk);
    rockC = mix(rockC, vec3(0.16, 0.14, 0.11), 0.3 * smoothstep(0.2, 0.8, vn3(pos * 0.004)));
    // water-stain streaks run down the fall line: noise elongated 8:1 along altitude, in the wall frame
    vec2 sq2 = vec2(along * 0.05, alt * 0.006);
    float streaks = vn(sq2) * 0.6 + vn(sq2 * vec2(2.1, 1.9) + 5.0) * 0.4 * smoothstep(8.0, 2.0, fp);
    rockC *= 0.85 + 0.3 * smoothstep(-0.5, 0.6, streaks);
    // gully cavity: the sun azimuth is only ~11 deg off the near face's normal, so the real shadow test
    // leaves its gullies as bright as the ribs. Fake the cavity shading from the baked concavity (curvL,
    // phase 7: gullies, couloirs, ledge undersides) plus the broad (2-octave) buttress field, and give each
    // rib a lit and a shaded flank from that field's along-gradient (the sun has a small +along component)
    vec2 bq = vec2(along / 260.0, across / 900.0) + vec2(5.0, 2.0);
    float bA = ridgedFbm(bq + vec2(0.17, 0.0), 2.0), bB = ridgedFbm(bq - vec2(0.17, 0.0), 2.0);
    float cav = sat(smoothstep(0.03, 0.45, -curvL) + 0.8 * (1.0 - smoothstep(0.12, 0.5, 0.5 * (bA + bB))) * faceM);
    float ribLit = clamp((bB - bA) * 3.0, -1.0, 1.0);
    rockC *= mix(1.0, 0.45, cav * mix(0.6, 1.0, faceM)) * (1.0 + 0.25 * ribLit * faceM) * (1.0 + 0.18 * smoothstep(0.03, 0.4, curvL));
    rockC = mix(rockC, rockC * vec3(0.9, 1.0, 0.85), 0.35 * smoothstep(0.0, 0.6, vn3(pos * 0.013)));  // lichen tint
    // rock/turf boundary: a noisy threshold on steepness so outcrops break through the grass instead of a smooth smear
    float rn = vn(w * 0.012 + 3.0) * 0.6 + vn(w * 0.04) * 0.4;
    float rockW = smoothstep(0.3, 0.66, steep * 1.15 + 0.22 * rn);
    rockW = max(rockW, smoothstep(1150.0, 1900.0, alt + 350.0 * vn(xz * 0.0021)) * mix(0.6, 1.0, steep));
    rockW *= smoothstep(0.0, 0.25, mtnW + valW * 0.8 + steep * 0.5);
    // the wall's foot: broken rock and turf within ~120 m below the face instead of a sunlit grass lip
    rockW = max(rockW, 0.8 * smoothstep(-130.0, 20.0, footD + 60.0 * rn) * wAlong * smoothstep(0.2, 0.7, 0.5 + 0.5 * vn(w * 0.02 + 7.0) + 0.4 * steep));
    // rock albedo from 3D noise as well (no vertical stretching on cliffs)
    float r3 = fbm3(pos / 45.0, clamp(log2(45.0 / max(1.5 * fp, 0.2)), 0.0, 6.0));
    rockC *= 0.78 + 0.5 * r3;
    alb = mix(grassC, rockC, rockW);
    // scree fans spilling from the gullies at the wall's foot: each fan is a tongue that is narrow at
    // its apex (the gully mouth) and spreads downslope, so the foot is broken up rather than banded
    float fanN = vn(vec2(along * 0.0055, 0.3)) * 0.7 + vn(vec2(along * 0.016, 0.7)) * 0.3;    // which gullies shed scree
    float fanW = smoothstep(0.0, 0.55, fanN) * (0.45 + 0.55 * smoothstep(0.0, -300.0, footD));   // widens downslope
    float scree = fanW * smoothstep(-520.0, -180.0, footD + 80.0 * vn(w * 0.01)) * smoothstep(190.0, 70.0, footD) * (1.0 - 0.6 * steep)
                * smoothstep(-3800.0, -2200.0, along) * smoothstep(5000.0, 1500.0, along) * (1.0 - rockW);
    scree *= smoothstep(0.15, 0.55, scree + 0.3 * vn(w * 0.03 + 1.0));                           // ragged edges
    alb = mix(alb, vec3(0.21, 0.19, 0.16) * (0.7 + 0.6 * r3) * (0.85 + 0.3 * n3), scree * 0.5);
    nD = normalize(mix(nD, rockBump(pos, nD, fp, 0.7), rockW * smoothstep(0.1, 0.5, steep)));
    // distant forest (beyond the tree-SDF range): dark mottled canopy with stand-scale hue variation
    float fcov = 0.0, fthr = 0.0, lsh = 0.0;
    if (fp >= TREE_FP0) {
      float fd = forestDensity(xz, alt) * (1.0 - rockW);
      float fn = 0.5 + 0.5 * vn(xz * 0.08);
      float fn2 = 0.5 + 0.5 * vn(xz * 0.35);                                    // individual crowns as speckle
      float fn3 = vn(xz * 0.02 + 4.0);
      float cov = smoothstep(0.25, 0.7, fd + 0.3 * (fn - 0.5)) * smoothstep(TREE_FP0, TREE_FP1, fp);
      // darker than the resolved trees' albedo: a canopy seen from above is mostly its own shadow. The stand's larch
      // share is in its summer colour (LARCH_REF x the same canopy factor), recoloured per frame through G3.b
      lsh = larchShare(xz, alt);
      vec3 fc = mix(mix(vec3(0.028, 0.05, 0.026), vec3(0.05, 0.066, 0.028), smoothstep(-0.3, 0.5, fn3)), LARCH_REF * 0.75, lsh) * 0.7 * (0.3 + 1.4 * fn2);
      alb = mix(alb, fc, cov * 0.9);
      ao *= 1.0 - 0.4 * cov;
      fcov = cov;
      // unresolved far canopy: stands whiten together in ~250 m drifts (low-frequency stand noise) with a small
      // per-crown jitter, lagging the meadow; a per-crown threshold alone read as salt-and-pepper
      fthr = 0.5 + 0.35 * (0.5 + 0.5 * vn(xz * 0.004 + 1.0)) + 0.1 * fn2;
    }
    // paths
    float pd = pathDist(xz);
    float pm = (1.0 - smoothstep(1.5, 2.6 + fp * 0.4, pd)) * (1.0 - mtnW);
    alb = mix(alb, vec3(0.33, 0.29, 0.22) * (0.85 + 0.2 * n3), pm);
    grass = (1.0 - rockW) * (1.0 - pm) * (1.0 - fcov) * (1.0 - 0.8 * scree);
    // ---- snow threshold: flat, high, lee-side areas get snow first; steep cliffs stay rocky
    float altF = smoothstep(1150.0, 2300.0, alt + 280.0 * vn(xz * 0.0031));
    float drift = vn(vec2(xz.x * 0.0022 + xz.y * 0.0011, xz.y * 0.0065));   // wind-elongated drifts
    float patchN = vn(xz * 0.006 + 8.1) * 0.6 + vn(xz * 0.025) * 0.4;
    float tuft = fbmF(xz * 0.7, clamp(log2(1.4 / max(fp, 0.01)), 0.0, 4.0)) * 0.6 + vn(xz * 0.09 + 3.3) * 0.4;  // grass tufts poke through (4 octaves near the camera: ~9 cm)
    // far peaks (fp > ~3 m/px): the per-pixel patch / tuft / drift thresholds would split the summit snow into
    // salt noise, so they collapse to their means and the ledge test uses the smooth normal -> continuous fields
    float farM = smoothstep(2.5, 5.0, fp);
    float ledge = smoothstep(0.55, 0.92, mix(nD.y, nS.y, farM));
    float gentle = 1.0 - smoothstep(0.78, 0.99, nS.y);
    float patchT = mix(smoothstep(-0.6, 0.6, patchN), 0.5, farM), driftT = mix(drift, 0.0, farM), tuftT = mix(tuft, 0.0, farM);
    // flat meadow thresholds are spread over ~0.12..0.95 so cover grows patch by patch for minutes.
    // Per-material order (matte's table): high/flat first, trodden path +0.16 later, bare rock +0.12 later,
    // lee faces of the prevailing (+x) wind drift in first while windward faces are scoured (-0.10 n.x),
    // and the ground under a canopy stays bare longest (+0.1..0.4 interception, varied per stand so the sheltered
    // ground becomes islands rather than one hole at the forest edge). The tuft term (0.25) is what breaks a
    // patch margin into tuft-scale fringes instead of a smooth ramp
    snowT = 0.05 + 0.62 * patchT + 0.10 * (0.5 + 0.5 * driftT) + 0.25 * (0.5 + 0.5 * tuftT) * grass
          + 0.10 * gentle + 0.16 * pm + 0.12 * rockW + steep * (0.45 + 1.0 * rockW) - 0.55 * ledge * steep * rockW
          - mix(0.95, 1.2, smoothstep(2000.0, 2600.0, alt)) * altF * (1.0 - 0.55 * steep);
    snowT -= 0.10 * nS.x * (1.0 - 0.5 * rockW);
    snowT += canopy * (0.25 + 0.15 * vn(xz * 0.01 + 5.0));
    snowT = mix(snowT, fthr, fcov);
    snowT -= 0.75 * smoothstep(2500.0, 3500.0, alt + 200.0 * driftT) * (1.0 - 0.7 * steep);   // steep far faces keep their rock
    snowT -= 0.9 * smoothstep(1500.0, 2200.0, alt) * ledge * rockW;          // old snow lying on high ledges
    // old snow in the wall's upper couloirs (concave + low buttress value), as in the reference's upper right;
    // scaled with steep so it cancels the cliff penalty, gated per gully so only some of them hold snow
    float coul = sat(smoothstep(0.03, 0.35, -curvL) + 0.7 * (1.0 - smoothstep(0.06, 0.35, butt))) * smoothstep(-0.25, 0.3, vn(vec2(along * 0.0025, alt * 0.002) + 3.0));
    snowT -= (0.6 + 1.3 * steep) * smoothstep(1100.0, 1700.0, alt) * coul * rockW * faceM;
    snowT = max(snowT, mix(0.09, -1.0, altF));
    snowT = min(snowT, mix(0.95, 3.0, rockW));     // every turf band whitens by full cover; only rock can stay bare
    // ---- G3 material parameters (the same curvature / slope / mottle terms the grass albedo uses above)
    float hollowW = max(smoothstep(0.03, 0.14, -curv), smoothstep(0.02, 0.1, -curvL));
    float ribW = max(smoothstep(0.03, 0.14, curv), smoothstep(0.02, 0.1, curvL));
    float moist = 0.5 + 0.45 * hollowW - 0.45 * ribW - 0.3 * smoothstep(0.1, 0.45, steep) - 0.2 * pch;
    mp = vec4(sat(rockW + scree), sat(pm), sat(fcov * lsh), sat(moist));
  } else if (mat == 2.0) {
    // conifer needles: dark green, per-tree hue variation (some bluish firs, larch stands), lighter toward the sunlit
    // top, darker inside / at the bottom. A crown is a larch when its random tv falls under the stand's larch share,
    // read at the crown's axis (the hit minus the outward normal x the crown radius here; the tree height follows tid
    // as in treesSDF) so a crown practically never straddles the share threshold
    float H = mix(9.0, 24.0, tid);
    vec2 ax = pos.xz - normalize(nD.xz + 1e-4) * 0.22 * H * (1.0 - hfr);
    float larch = step(1.0 - larchShare(ax, hT), fract(tid * 7.3));
    vec3 tc = mix(vec3(0.018, 0.040, 0.020), vec3(0.060, 0.080, 0.030), tid * tid);
    tc = mix(tc, vec3(0.025, 0.045, 0.042), step(0.84, fract(tid * 13.7)));
    // sun-facing needles read warm yellow-green (the lit side of a spruce is never the same hue as its shade side)
    tc = mix(tc, vec3(0.05, 0.075, 0.028), 0.6 * smoothstep(0.0, 0.6, dot(nD, uSunDir)));
    // larch: its summer reference, +-10% warmer / cooler per tree (recoloured per frame by ratio, so each crown keeps its
    // own shade of gold in autumn)
    tc = mix(tc, LARCH_REF * mix(vec3(1.1, 1.0, 0.9), vec3(0.9, 1.0, 1.1), fract(tid * 3.1)), larch);
    alb = tc * (0.75 + 0.5 * hash2(floor(pos.xz * 3.0) + floor(pos.y * 3.0))) * (0.72 + 0.5 * hfr);
    mp.b = larch;
    ao *= mix(0.35, 1.0, sqrt(hfr));
    // laden spruce (matte's clump rule on this SDF's whorl geometry): snow clumps collect on the whorl tops
    // (thr 0.10-0.55, so tops read white above C~0.6), the steep rims and undersides stay dark (thr > 1).
    // Where the whorls are not resolved (far stands) the per-pixel split would be noise, so the whole
    // crowns whiten stand by stand over C 0.5-0.95 instead (the same ~250 m stand noise as the far-canopy
    // albedo, plus a per-tree jitter): distant forest lags the meadow, then goes laden in drifts
    float up = smoothstep(0.3, 0.85, nD.y);
    float tn = 0.5 + 0.5 * vn(pos.xz * 1.7 + pos.y * 0.9 + tid * 50.0);
    float tn2 = 0.5 + 0.5 * vn(pos.xz * 4.3 + pos.y * 2.1 + tid * 20.0);
    float stand = 0.5 + 0.5 * vn(pos.xz * 0.004 + 1.0);
    float res = sat(1.7 - fp * 2.2);
    snowT = mix(0.5 + 0.35 * stand + 0.1 * tid, mix(1.05 + 0.5 * tn2, 0.10 + 0.45 * tn + 0.12 * (1.0 - hfr), up), res);
  } else if (mat == 3.0) {
    // sun-bleached timber walls (planked), darker under the eaves where the overhang shades them
    alb = vec3(0.26, 0.20, 0.13) * (0.8 + 0.3 * vn(vec2(pos.y * 4.0, pos.x + pos.z))) * (0.85 + 0.3 * hash2(floor(pos.xz * 0.03) + 0.5));
    ao *= mix(1.0, 0.55, smoothstep(2.4, 4.2, pos.y - hT));
    snowT = 3.0;
  } else {
    // dark-brown shingle roofs, weathered per chalet (33 m cells ~ one chalet) and per shingle row
    alb = vec3(0.09, 0.06, 0.04) * (0.6 + 0.8 * hash2(floor(pos.xz * 0.03))) * (0.85 + 0.3 * hash2(floor(pos.xz * 1.3)));
    snowT = 0.02 + 0.5 * (1.0 - nD.y);
  }
  o0 = vec4(t, mat + (mat == 2.0 ? hfr : grass) * 0.9, sh, ao);
  o1 = vec4(alb, snowT);
  o2 = vec4(octEnc(nD), octEnc(nS));
  mp = floor(clamp(mp, 0.0, 1.0) * 255.0 + 0.5) / 255.0;    // 8-bit steps, so the RGBA16F fallback stores (and shades) the same values
  o3 = mp;
}
`;
})(window.SNOW);
