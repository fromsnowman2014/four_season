// =====================================================================================
//  GLSL: ATMOS chunk (stage-1 owner: lane C). Analytic sky + cirrus, the stratus deck, the cloud slab and its 2D
//  coverage field (shared by the clouds and their ground shadows), cloudShadow, aerial perspective (haze, the valley
//  mist / fog sea, storm extinction), the drifting mist banks, and the two entry points the shading pass calls:
//  skyPixel (a sky pixel before the veil) and applyAtmos (fog, deck structure and clouds over a lit surface).
//  Needs COMMON + ENV. Included by sky, shade, comp (sparkle cloud shadow), the flake VS and the rain VS. Not included
//  by the G-buffer bake, so atmosphere edits never touch (or recompile) the bake shader.
//  Its own uniforms (set by derive/atmos.js): uHorBand, uCloudP, uCloudQ, uMistQ.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.ATMOS = `
uniform vec3 uHorBand;       // pale haze band at the horizon (season; the sky colour under a deck)
uniform vec4 uCloudP;        // cloud field: x near cut left (m), y near cut right (m), z cut fade (m), w base undulation (m p-p)
uniform vec4 uCloudQ;        // x slab base (m), y slab top (m), z near grey deck (ragged base), w left/right cut split (sin azimuth)
uniform vec4 uMistQ;         // fog sea: x top swell (m, +-), y sun glow, z fog-sea weight, w unused

// Sky radiance (analytic): Rayleigh-ish zenith/horizon gradient + Mie halo around the sun,
// plus a thin, streaky cirrus veil high up (a 2D noise sheet at ~9 km), its amount set by uCirrus.
vec3 skyColor(vec3 rd) {
  float mu = dot(rd, uSunDir);
  float y = clamp(rd.y, 0.0, 1.0);
  vec3 c = mix(uSkyHor, uSkyZen, pow(y + 0.015, 0.5));
  c = mix(c, mix(uSkyHor, uHorBand, 0.5), exp(-max(rd.y, 0.0) * 30.0) * 0.5);   // pale haze band at the horizon
  if (rd.y > 0.0 && uCirrus > 0.001) {
    // dome projection (rd.y + 0.35) instead of a flat 9 km sheet: the visible sky only spans rd.y 0.02-0.17,
    // where a plane is foreshortened ~50:1 into horizontal scanlines; the dome keeps the wisps ~2:1
    // uCirrus = 1 is the Phase-1 veil (thin, widespread); less cirrus is fewer but crisper, streakier wisps (fair-
    // weather cirrus fibratus): a higher, narrower threshold, a little more opacity, the pattern stretched sideways
    vec2 q = rd.xz / (rd.y + 0.35) * 2500.0 * mix(vec2(0.45, 1.5), vec2(1.0), uCirrus) + uCloudOff * 0.12;
    float v = tnoise(q * 0.0007 + 2.0) * 0.5 + tnoise(q * 0.0017 + 7.0) * 0.3 + tnoise(q * 0.0041 + 4.0) * 0.2;
    float cir = smoothstep(mix(0.66, 0.52, uCirrus), mix(0.76, 0.8, uCirrus), v) * mix(0.2, 0.1, uCirrus) * smoothstep(0.0, 0.15, uCirrus)
              * (1.0 - 0.5 * uOvercast) * smoothstep(0.015, 0.09, rd.y);
    c = mix(c, vec3(0.9, 0.93, 0.98) * dot(uSunCol, vec3(0.11)), cir);
  }
  float s = max(mu, 0.0);
  c += uSunCol * (0.018 * pow(s, 3.0) + 0.05 * pow(s, 24.0) + 0.9 * pow(s, 1200.0));
  return c;
}
// stratus deck: brightness modulation (about -0.45..+0.3) of the overcast underside, projected on a low
// dome: a slow ragged base sheet, a fast low scud layer racing under it (the deck visibly moves), and a
// zenith-to-horizon gradient (the deck is darkest overhead, the horizon is lit by the ground below). Applied to
// the whiteout itself too (the snow curtain is lit by the deck above it), so a storm sky keeps cloud
// structure instead of collapsing into one flat grey field. Both layers drift with the cloud wind (uCloudOff) on top
// of their Phase-1 clock scroll
float stratus(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec2 q = rd.xz / (y + 0.15) * 2.0 + uCloudOff * 0.0004 + vec2(uTime * 0.01, 0.0);
  float st = tnoise(q) * 0.5 + tnoise(q * 2.3 + 3.0) * 0.3 + tnoise(q * 5.1 + 7.0) * 0.2;
  vec2 q2 = rd.xz / (y + 0.08) * 3.0 + uCloudOff * 0.0012 + vec2(uTime * 0.05, uTime * 0.01);
  float sc = tnoise(q2 + 11.0) * 0.6 + tnoise(q2 * 2.1 + 5.0) * 0.4;
  float m = 0.8 * (st - 0.5) + 0.4 * (sc - 0.5) - 0.18 * smoothstep(0.0, 0.25, y);
  return m * smoothstep(-0.03, 0.1, rd.y);
}

// Large-scale cloud placement ("weather map"): ~6 km and ~2 km cells.
float weather(vec2 q) { return tnoise(q * 0.00016 + vec2(3.1, 7.7)) * 0.62 + tnoise(q * 0.00047 + vec2(9.0, 1.3)) * 0.38; }
// The 2D cloud coverage of the slab (0..1 inside a cloud field, before the billow erosion), shared by the cloud pass
// and the ground shadows so the shadows belong to the clouds that are drawn. Cumulus (uCumulus) break the weather map
// into separate cells (lobes of ~670 / 310 / 150 m, still grouped by the weather map) with blue gaps between them: at
// cloudCov .55 about 45% of the ground lies in shadow, in patches of ~0.2-1 km (mean ~500 m)
float cloudCover(vec2 q) {
  float wm = weather(q);
  if (uCumulus > 0.001) {
    float cu = wm * 0.15 + tnoise(q * 0.0015 + vec2(5.3, 2.9)) * 0.4 + tnoise(q * 0.0032 + vec2(1.7, 8.1)) * 0.3 + tnoise(q * 0.0068 + vec2(4.4, 6.6)) * 0.15;
    wm = mix(wm, (cu - 0.5) * 1.5 + 0.5, uCumulus);         // x1.5: back to the weather map's spread
  }
  return sat((wm - (1.0 - uCloudCov)) / max(uCloudCov, 0.05));
}
// 2D stand-in of the cloud pass's billow erosion (its octaves at the cumulus scale), for the shadow footprint
float billow2(vec2 q) { return tnoise(q * 0.003) * 0.5 + tnoise(q * 0.0063 + 3.7) * 0.3 + tnoise(q * 0.013 + 1.1) * 0.2; }
// Cloud shadow on the ground at p: 1 = sunlit. The point is projected along the sun to the cloud layer. The Phase-1
// field (uCumulus = 0: smaller-celled than the far clouds, ~1 km lobes) cross-fades into the cumulus cells' own
// footprint: the coverage eroded by the 2D billow noise the clouds are eroded by, sharp-edged like real cumulus shadows.
// Strength uShadowAmp, fading under a deck (no direct sun to cast them)
float cloudShadow(vec3 p) {
  float hm = mix(0.5 * (uCloudQ.x + uCloudQ.y), uCloudQ.x + 450.0, uCumulus);
  vec2 q = p.xz + uSunDir.xz / uSunDir.y * (hm - p.y) + uCloudOff;
  float sh = 0.0;
  if (uCumulus < 0.999) {
    float w = weather(q) * 0.4 + tnoise(q * 0.0012 + 2.0) * 0.35 + tnoise(q * 0.0031 + 7.0) * 0.25;
    float shape = sat((w - (1.0 - uCloudCov)) / max(uCloudCov, 0.05));
    shape += 0.16 * (tnoise(q * 0.0075 + 5.0) - 0.5);          // ragged edges that follow the cloud detail
    sh = smoothstep(0.06, 0.28, shape);
  }
  if (uCumulus > 0.001) {
    float d = cloudCover(q) * 1.1 - (1.0 - billow2(q)) * 0.58 + 0.2;
    sh = mix(sh, smoothstep(0.02, 0.16, d), uCumulus);
  }
  return 1.0 - uShadowAmp * sh * (1.0 - 0.7 * uOvercast);
}

// fog-sea top undulation (m) around the ray's entry into the layer: slow ~800 m swells drifting with half the cloud
// wind (tongues of fog climb the slopes and fall back)
float mistSwell(vec2 xz) {
  vec2 q = (xz + uCloudOff * 0.5) * 0.0012;
  return uMistQ.x * ((tnoise(q + 3.3) * 0.65 + tnoise(q * 2.7 + 8.1) * 0.35) * 2.0 - 1.0);
}
// The fog sea's banks (fog days, stage 2b). Seen from the camera (132 m) the analytic sea (top ~-72 m) can only ever
// end in one straight line at the horizon. The banks give it a living top: in the mid field (1.5-8 km) low billows
// heave the sea surface by ~+-130 m (they stay under the line of sight to the far slopes); far out (beyond ~8-15 km,
// the left massif and the far valley) banks pile up against the mountains and climb them in tongues up to ~700 m where
// the ~6 km swells are high, with clear gaps between them where the ridges and the forest stand out. fogTopH: the top
// (absolute m) at xz, d the horizontal distance from the camera; drifts with a third of the cloud wind.
// fogBanks marches it (10 geometric steps from 1.2 km to the hit / 40 km / above the highest top, plus one sample at the
// hit itself so the fog hugs the slope it lies on) and returns its optical depth and the brightness of what it sees
// (sunlit tops brighter, the bank bodies a cooler grey)
float fogTopH(vec2 xz, float d, bool full) {
  vec2 q = (xz + uCloudOff * 0.35) * 0.00052;
  // the cheap version (bracketing the surface: 3 fetches: the swells, the ~6 km groups and the ~430 m billows riding
  // on the swells, whose crests are the silhouettes of the domes) leaves out the finer octaves of the swells (their mean)
  float n = tnoise(q + 4.7) * 0.64 + (full ? tnoise(q * 2.4 + 1.9) * 0.28 + tnoise(q * 6.1 + 7.3) * 0.08 : 0.18);
  float big = tnoise(q * 0.3 + 8.3);
  float mid = smoothstep(800.0, 2400.0, d), far = smoothstep(8000.0, 15000.0, d);
  float b2 = tnoise(q * 4.6 + 2.6);
  // far out: banks piling up against the mountains, up to ~1300 m, never a flat plateau (no saturating term: the swells
  // and the billows shape every top)
  return -uMistP.x - 40.0 * mid + mid * (220.0 * (n - 0.45) + 150.0 * (b2 - 0.5)) + far * 1000.0 * smoothstep(0.2, 0.9, big) * smoothstep(0.2, 0.95, n) * (0.6 + 0.7 * b2);
}
// the sunlit share of the bank top at xz: its slope toward the sun (a crest's sunward flank is lit, its lee lies in
// the shade of the crest)
float bankSun(vec2 xz, float d, float top) {
  vec2 sh = normalize(uSunDir.xz) * 220.0;
  float sl = (fogTopH(xz + sh, d, true) - top) / 220.0;
  return clamp((uSunDir.y + 0.88 * sl) / sqrt(1.0 + sl * sl), 0.0, 1.0);
}
vec2 fogBanks(float t, vec3 rd) {
  // where a bank can be: within 8 km its top stays under ~+90 m (the camera is at 132 m: an upward ray never meets
  // it), beyond it under ~1400 m. Rays that cannot reach one skip the march (the sky, the walls above the camera)
  float hl = length(rd.xz);
  float tA = rd.y > 0.0 ? max(700.0, 8000.0 / max(hl, 1e-3)) : 700.0, tB = min(t, 40000.0);
  if (rd.y > 0.0) tB = min(tB, (1400.0 - uCamPos.y) / rd.y);
  if (tB <= tA) return vec2(0.0, 1.0);
  // the lowest point of the ray segment (its end for a descending ray) above the highest top a bank can have at that
  // distance (fogTopH's bound): no bank on this ray (the slopes above the sea, the forest band's upper part)
  float tL = rd.y < 0.0 ? tB : tA, dL = tL * hl;
  if (uCamPos.y + rd.y * tL > -uMistP.x + 160.0 * smoothstep(800.0, 2400.0, dL) + 1300.0 * smoothstep(8000.0, 15000.0, dL) + 45.0) return vec2(0.0, 1.0);
  // march the bank top as a height field (cheap version): the depth of the ray below it (m) at geometric samples, as
  // many as the span needs (4 over a short one, 8 over the whole valley); the last one is the hit itself (the slope
  // a tongue of fog lies on)
  float lr = log(tB / tA), N = clamp(ceil(lr * 2.8) + 2.0, 4.0, 8.0);
  float dmax = -1e9, tMax = tA, tIn = -1.0, tOut = tA, tPrev = tA;
  for (int i = 0; i <= 8; i++) {
    if (float(i) > N) break;
    float tt = tA * exp(lr * float(i) / N);
    vec3 p = uCamPos + rd * tt;
    float dl = fogTopH(p.xz, tt * hl, false) - p.y;
    if (dl > 0.0 && tIn < 0.0) { tIn = tt; tOut = tPrev; }
    if (dl > dmax) { dmax = dl; tMax = tt; }
    tPrev = tt;
  }
  // the soft top: a few metres near by (the forest band's crowns stand out of it), ~12 m far out
  float soft = 4.0 + 8.0 * smoothstep(1500.0, 7000.0, tMax * hl);
  if (dmax < -6.0 * soft - 60.0) return vec2(0.0, 1.0);
  // the surface the ray meets (bisection between the last sample above and the first below), or where it grazes; the
  // depth there with the full detail
  float tc = tMax;
  if (tIn > 0.0) {
    for (int k = 0; k < 3; k++) {
      float tm = 0.5 * (tOut + tIn);
      vec3 p = uCamPos + rd * tm;
      if (fogTopH(p.xz, tm * hl, false) - p.y > 0.0) tIn = tm; else tOut = tm;
    }
    tc = 0.5 * (tOut + tIn);
  } else {
    vec3 pm = uCamPos + rd * tMax;
    dmax = fogTopH(pm.xz, tMax * hl, true) - pm.y;
    if (dmax < -5.0 * soft) return vec2(0.0, 1.0);
  }
  vec3 pc = uCamPos + rd * tc;
  float dc = tc * hl, top = fogTopH(pc.xz, dc, true);
  // the sun on the billows (0..1); the far banks flatten toward a level top's light
  float lit = mix(bankSun(pc.xz, dc, top), uSunDir.y, 0.4 * smoothstep(6000.0, 20000.0, dc));
  // optical depth: the path below the (soft) top, i.e. the deepest point the ray reaches over its descent rate (a steep
  // near ray sees the crowns and the ground 15 m under the top through a veil, a grazing far ray is white within a
  // few metres; the slope is capped so a ray skimming a crest does not see kilometres of it), 1/120 m inside; patchy:
  // wisps thin it in ~300-500 m streaks
  float wisp = 0.55 + 0.9 * tnoise(pc.xz * 0.0023 + 6.2);
  float dEff = soft * log(1.0 + exp(clamp(dmax / soft, -20.0, 20.0)));
  return vec2(dEff / max(abs(rd.y), 0.04) / 120.0 * wisp, lit);
}
// Aerial perspective: analytic integral of an exponential-height haze, an exponential mist layer (the Phase-1 valley
// mist; on fog days a dense shallow fog sea, uMistP, with its far banks) and a uniform storm whiteout. Returns
// inscatter (rgb) and transmittance (a). Mist density at altitude y: uFogP.w * exp(-(y - level) / H), level =
// -uMistP.x (+ the swell).
// banks: whether the fog sea's banks are evaluated (the shading pass: terrain and sky); fogAt (the particles' vertex
// shaders within ~250 m, the cloud pass) leaves them out, so their code never reaches those shaders
vec4 fogAtMB(float t, vec3 rd, float mistMod, bool banks) {
  float y0 = uCamPos.y;
  float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float k = 1.0 / uFogP.y;
  float odH = uFogP.x * exp(-y0 * k) * (1.0 - exp(clamp(-ry * t * k, -30.0, 30.0))) / (ry * k);
  float H = uMistP.y;
  float lvl = -uMistP.x, sw = 0.0;
  vec3 pe = uCamPos + rd * t;
  if (uMistQ.x > 0.0) {
    // where the ray meets the fog top (or its end): the swell lifts / lowers the whole layer for this ray, and the top
    // softens with distance (a crisp sea surface near by, a diffuse shoreline on the far slopes, not a lake edge)
    float te = rd.y < -1e-4 ? min(t, (y0 - lvl) / -rd.y) : t;
    pe = uCamPos + rd * te;
    sw = mistSwell(pe.xz);
    // far out the sea lies a little lower (its banks, fogBanks, rise above it): the troughs between them let the
    // ridges show
    lvl += sw - 60.0 * uMistQ.z * smoothstep(2500.0, 9000.0, te * length(rd.xz));
    if (rd.y < -1e-4) H *= 1.0 + 0.8 * uMistQ.z * smoothstep(800.0, 5000.0, te);   // only rays that come down onto it
  }
  float km = 1.0 / H;
  float odM = uFogP.w * exp(-(y0 - lvl) * km) * (1.0 - exp(clamp(-ry * t * km, -30.0, 30.0))) / (ry * km);
  // fog days: the analytic sea is the near layer only (the chalet basin, the forest band); beyond ~3 km the banks
  // (fogBanks) are the sea, with their billowy, sun-shaded top
  odM *= 1.0 - uMistQ.z * smoothstep(900.0, 1500.0, length((pe - uCamPos).xz));
  float odS = uFogP.z * t;
  odH = max(odH, 0.0); odM = max(odM, 0.0) * mistMod;
  // the fog sea's banks (fog days): their optical depth and the sun on their top
  float odB = 0.0, sunB = 0.0;
  if (banks && uMistQ.z > 0.0 && t > 700.0) { vec2 b = fogBanks(t, rd); odB = b.x * uMistQ.z; sunB = b.y; }
  float od = odH + odM + odB + odS;
  float T = exp(-od);
  float mu = max(dot(rd, uSunDir), 0.0);
  vec3 cH = uFogCol + uSunCol * (0.03 * pow(mu, 6.0));
  vec3 cFm = mix(uFogCol, vec3(dot(uFogCol, vec3(0.33))), 0.35);
  vec3 cM = cFm * 1.02 + uSunCol * 0.012;
  // a bank: a cool blue-grey body lit by the sun on its sunward flanks (crests glow white, the lee and the troughs
  // stay a soft grey); csB: the drifting cloud shadows on it
  float csB = uMistQ.z > 0.0 ? cloudShadow(vec3(pe.x, lvl, pe.z)) : 1.0;
  vec3 cB = cFm * vec3(0.42, 0.44, 0.5) + uSunCol * 0.78 * sunB * csB;
  vec3 cS = uFogCol;
  vec3 c = (cH * odH + cM * odM + cB * odB + cS * odS) / max(od, 1e-6);
  vec4 r = vec4(c * (1.0 - T), T);
  if (uMistQ.z > 0.0) {
    // the fog sea glows white where the sun reaches its top (cloud shadows drift over it); its crests catch more light
    // than the troughs and a finer billow rolls over it, so the opaque sea keeps a soft texture. The haze and the
    // storm extinction lie in front of the low layer: composited over it in order, so the far sea fades into the haze
    vec2 bq = (pe.xz + uCloudOff * 0.5) * 0.0045;
    float bil = tnoise(bq + 1.7) * 0.6 + tnoise(bq * 2.3 + 6.1) * 0.4;
    // (lit like a level bank, so the near sea and the banks beyond it are one surface)
    vec3 cMs = cFm * vec3(0.42, 0.44, 0.5) + uSunCol * 0.78 * uSunDir.y * csB;
    cM = mix(cM, cMs, uMistQ.z) * (1.0 + 0.3 * sw / uMistQ.x + 0.24 * (bil - 0.5));
    float odF = odH + odS, TF = exp(-odF), odMB = odM + odB, TM = exp(-odMB);
    vec3 cF = (cH * odH + cS * odS) / max(odF, 1e-6);
    vec3 cMB = (cM * odM + cB * odB) / max(odMB, 1e-6);
    r = mix(r, vec4(cF * (1.0 - TF) + TF * cMB * (1.0 - TM), T), uMistQ.z);
  }
  return r;
}
vec4 fogAtM(float t, vec3 rd, float mistMod) { return fogAtMB(t, rd, mistMod, true); }
vec4 fogAt(float t, vec3 rd) { return fogAtMB(t, rd, 1.0, false); }
// drifting mist banks: density modulation sampled at the hit (or 6 km out), continuous across the horizon. The
// banks drift with half the cloud wind (natural wind only); floor / gain from uMistP.zw
float mistBanks(vec3 rd, float t) {
  float tl = min(t, 6000.0);
  vec3 p = uCamPos + rd * tl;
  vec2 q = (p.xz + uCloudOff * 0.5) * 0.00045;
  float n = tnoise(q) * 0.55 + tnoise(q * 2.3 + 4.1) * 0.3 + tnoise(q * 4.7 + 9.0) * 0.15;   // 2.2 km / 1 km / 470 m bands
  return uMistP.z + uMistP.w * smoothstep(0.35, 0.8, n);
}

// ---- entry points of the shading pass (FS_SHADE). cl: the cloud pass (premultiplied radiance, transmittance),
// cT: its opacity-weighted mean distance in km (0 = no cloud)
// a sky pixel: analytic radiance seen through ~30 km of haze, then the cloud slab composited in front, the whiteout
// toward the horizon and the deck structure (the veil is applied after this, by the caller)
vec3 skyPixel(vec3 rd, vec4 cl) {
  vec3 col = skyColor(rd);
  vec4 fs = fogAtM(30000.0, rd, 0.6);
  col = col * fs.a + fs.rgb;
  col = col * cl.a + cl.rgb;
  if (uFogP.z > 0.0) {      // the storm whiteout toward the horizon (only under a storm extinction)
    vec4 f = fogAt(30000.0, rd);
    col = mix(col, f.rgb / max(1.0 - f.a, 1e-3), clamp(uFogP.z * 900.0, 0.0, 1.0) * smoothstep(0.35, -0.02, rd.y) * 0.95);
  }
  col *= 1.0 + stratus(rd) * uOvercast * (1.0 + 0.9 * uPrecipRain);   // deck structure (a rain deck: darker scud, luminous rifts), before the veil
  return col;
}
// a lit surface at distance t: aerial perspective + storm whiteout (+ drifting mist banks / the fog sea), the deck
// structure in the whiteout, and the clouds in front of the terrain. The cloud pass stops its march at the terrain,
// so a pixel's own clouds lie in front (cT <= t); what bleeds across a silhouette from the half-res cloud buffer of
// a sky neighbour lies behind the terrain and is rejected (a distance-proportional test: no halo at any range)
vec3 applyAtmos(vec3 col, float t, vec3 rd, vec4 cl, float cT) {
  vec4 f = fogAtM(t, rd, mistBanks(rd, t));
  col = col * f.a + f.rgb;
  col *= 1.0 + stratus(rd) * uOvercast * (1.0 - f.a);     // deck structure in the whiteout (continuous with the sky)
  if (cT > 0.0) col = mix(col, col * cl.a + cl.rgb, 1.0 - smoothstep(t, t * 1.08 + 250.0, cT * 1000.0));
  return col;
}
`;
})(window.SNOW);
