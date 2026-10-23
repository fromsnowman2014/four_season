// =====================================================================================
//  derive/atmos.js (stage-1 owner: lane C) — sky, light and atmosphere: the sim state -> S.F, and the cloud drift
//  integral. Pure JS (no GL calls, no DOM). The single place that maps the weather channels, the season and the ground
//  to the light: sun / ambient / sky / fog colours, haze and extinction, the valley mist and the fog sea, the cloud
//  slab, cloud-shadow strength, exposure, white balance and grade.
//
//  Palette model: four season keys of the clear-day palette (winter = the Phase-1 palette exactly), blended by the
//  season weights. Falling snow pulls the keys toward winter (snow air is cold and clean), which keeps the Phase-1
//  anchor (?wx= Phase-1 channels) on the Phase-1 palette whatever the date. Weather then moves the clear palette:
//  `od` (smoothed overcast) toward an overcast palette keyed by the ground / precipitation (snow-lit grey = Phase-1
//  storm, wet-meadow grey for rain, bright soft grey for fog days), haze and mist densities follow fog / rain / storm.
//
//  S.derive.atmos = { init(), step(dt, ff), frame(F) }
//    init / step   S.anim.cloud: the integrated cloud drift (m, never wrapped). It follows the NATURAL wind only
//                  (S.wind.s.natural, low-passed over ~25 s so gusts do not jerk the sky), never the pointer steer.
//                  Clouds and their ground shadows move WITH the wind: the shaders sample q = p.xz + uCloudOff, so the
//                  offset integrates minus the cloud velocity.
//    frame(F)      runs last of the three derive frames (after surface and precip), so it may read F.uCover / F.uWet
//                  and F.uSnowCurtain:
//                  uSunCol uSkyAmb uSkyZen uSkyHor uFogCol uFogP uCloudOff uCloudCov uOvercast uCumulus uFogDay uMistP
//                  uCirrus uShadowAmp uExposure uBloomStr, and lane C's own: uHorBand uCloudP uCloudQ uMistQ, uSkyResp
//                  (sky pass), uGrade / uGradeP (composite)
// =====================================================================================
(function (S) {
  'use strict';
  const { lerp, smooth, clamp } = S;

  const lighting = S.lighting = { sun: new Float32Array(3), amb: new Float32Array(3), zen: new Float32Array(3), hor: new Float32Array(3), fog: new Float32Array(3), fogP: new Float32Array(4) };
  // storm: the horizon sky is snow-lit and brighter than the whiteout inscatter (fog), so fogged rock reads as a
  // grey silhouette against it instead of merging with the sky. LIT[0] = the Phase-1 clear palette (the winter key),
  // LIT[1] = the Phase-1 storm palette (snow-lit grey: snow falling or lying)
  const LIT = { amb: [[0.30, 0.40, 0.60], [0.46, 0.50, 0.57]], zen: [[0.10, 0.25, 0.64], [0.40, 0.44, 0.50]], hor: [[0.36, 0.50, 0.78], [0.56, 0.60, 0.66]], fog: [[0.44, 0.56, 0.80], [0.44, 0.48, 0.54]] };
  function mix3(o, a, b, t) { o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); }
  // Storm extinction (Phase 1): plateaus at ~0.00011 (with the storm haze: T ~0.5 at the 3 km wall, ~0.65 at the
  // 1.5 km forest band), only the gust peaks (wd -> 1) push it x5 to a true whiteout; the tail keeps a faint floor
  function stormExt(wd, tail) { return 0.00012 * Math.pow(wd, 1.5) * (1 + 4.0 * smooth(0.95, 1.0, wd)) + 0.00008 * tail; }

  // ---- season keys: [spring, summer, autumn, winter], linear radiance. Winter is the Phase-1 clear day.
  //   spring: fresh, clean blue light, a little valley mist; summer: strong warm sun, milky haze, a pale horizon;
  //   autumn: golden low light (warm sun, warm haze band) under a deep clear sky; winter: crisp blue, cold balance
  const SEASON = {
    sunI: [3.15, 3.35, 2.95, 3.1],
    sun: [[1.0, 0.965, 0.91], [1.0, 0.958, 0.87], [1.0, 0.87, 0.68], [1.0, 0.955, 0.89]],
    amb: [[0.30, 0.41, 0.60], [0.33, 0.41, 0.55], [0.32, 0.36, 0.48], LIT.amb[0]],
    zen: [[0.10, 0.27, 0.66], [0.13, 0.29, 0.62], [0.08, 0.22, 0.62], LIT.zen[0]],
    // (stage 2b: deeper clear-day skies: the summer milk is a light veil over blue, not grey; autumn air is clear)
    hor: [[0.38, 0.53, 0.80], [0.42, 0.56, 0.80], [0.36, 0.48, 0.76], LIT.hor[0]],
    fog: [[0.43, 0.57, 0.82], [0.50, 0.60, 0.77], [0.44, 0.54, 0.74], LIT.fog[0]],
    band: [[0.72, 0.78, 0.87], [0.82, 0.83, 0.84], [0.86, 0.80, 0.70], [0.70, 0.76, 0.86]],   // pale haze band at the horizon
    haze: [1 / 36000, 1 / 24000, 1 / 36000, 1 / 42000],      // haze density at y = 0 (1/m)
    hazeH: [2300, 2700, 2300, 2200],                          // haze scale height (m): summer convective, winter inversion
    mist: [1 / 26000, 1 / 34000, 1 / 28000, 1 / 30000],     // valley mist at its reference level (1/m)
    wb: [[0.985, 1.0, 1.015], [1.01, 1.0, 0.985], [1.02, 1.0, 0.97], [0.97, 1.0, 1.035]],  // white balance (composite)
  };
  // overcast palettes (amb, zen, hor, fog): a wet green meadow under a low grey deck (cool, not murky), a dry
  // overcast, and a bright soft fog day; the snow-lit grey is LIT[1]. The deck stays darker than the Phase-1
  // snow-lit sky so its structure reads after the exposure lift
  const RAINP = { amb: [0.30, 0.34, 0.40], zen: [0.24, 0.27, 0.31], hor: [0.36, 0.39, 0.44], fog: [0.36, 0.39, 0.44] };
  const DULLP = { amb: [0.36, 0.39, 0.45], zen: [0.34, 0.37, 0.42], hor: [0.50, 0.52, 0.56], fog: [0.48, 0.51, 0.56] };
  const FOGP = { amb: [0.42, 0.45, 0.51], zen: [0.46, 0.50, 0.57], hor: [0.66, 0.69, 0.74], fog: [0.64, 0.67, 0.72] };

  const tmp = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0] };
  // season blend of a key table into o
  function seasonMix(o, keys, w) {
    for (let i = 0; i < 3; i++) o[i] = keys[0][i] * w[0] + keys[1][i] * w[1] + keys[2][i] * w[2] + keys[3][i] * w[3];
    return o;
  }
  const sMix1 = (keys, w) => keys[0] * w[0] + keys[1] * w[1] + keys[2] * w[2] + keys[3] * w[3];
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  // frame outputs (lane C's own uniforms are declared in ATMOS / FS_SKY / FS_COMP)
  const horBand = new Float32Array(3), mistP = new Float32Array(4), mistQ = new Float32Array(4);
  const cloudP = new Float32Array(4), cloudQ = new Float32Array(4), cloudOff = new Float32Array(2);
  const grade = new Float32Array(3), gradeP = new Float32Array(3);
  const sw = new Float32Array(4);
  // the exposure reference: horizontal irradiance proxy of the Phase-1 clear day (sun x 0.5 + ambient)
  const E_REF = 0.5 * 3.1 * lum([1.0, 0.955, 0.89]) + lum(LIT.amb[0]);
  const last = new Float32Array(6);        // previous frame's cloud inputs (EMA reset on a jump)
  let haveLast = false;
  let cv = null;                           // low-passed cloud velocity (m/s, xz)

  S.derive.atmos = {
    init() { S.anim.cloud = [0, 0]; cv = null; haveLast = false; },
    step(dt) {
      // cloud velocity: 3x the natural (no pointer) wind plus 10 m/s along it, low-passed over ~25 s
      const n = S.wind.s.natural, nl = Math.hypot(n[0], n[2]);
      const ux = nl > 1e-3 ? n[0] / nl : 1, uz = nl > 1e-3 ? n[2] / nl : 0;
      const tx = 3 * n[0] + 10 * ux, tz = 3 * n[2] + 10 * uz;
      if (!cv) cv = [tx, tz];
      const k = 1 - Math.exp(-dt / 25);
      cv[0] += (tx - cv[0]) * k; cv[1] += (tz - cv[1]) * k;
      const c = S.anim.cloud;
      c[0] -= cv[0] * dt; c[1] -= cv[1] * dt;     // q = p + off: the pattern moves by -off
    },
    frame(F) {
      const wx = S.weather.s, ch = wx.ch, cs = S.climate.s;
      // the snow the camera sees: the cover level after the per-frame snowline, through the shared offset model
      // (derive/surface.js coverAt = SURFACE's effectiveCover without its per-pixel shift; surface.frame ran first) at
      // the meadow (visCover, most of the frame), the slopes (~800 m) and the summits (~2000 m). With the neutral
      // snowline this is uCover itself (Phase 1)
      const surf = S.derive.surface;
      const cover = 0.7 * surf.visCover + 0.2 * surf.coverAt(800) + 0.1 * surf.coverAt(2000);
      const precip = ch.precip, snowFrac = ch.snowFrac;
      const snowFall = precip * snowFrac, rain = precip * (1 - snowFrac);
      // the deck's light response starts at overcast .15: thin cloud (the snow preset's .35) is broken sun, not grey;
      // 0 and 1 are Phase 1's ends (calm, storm)
      const od = smooth(0.15, 1, ch.overcast), wd = smooth(0, 1, wx.white);
      const fog = smooth(0, 1, ch.fog), cum = ch.cumulus;
      // season weights, pulled toward winter by falling snow (and a little by lying snow)
      // (stage 2b: at most 70% from falling snow, so a late-autumn first snow keeps some of the golden low sun on the
      // larches and the tawny meadow; mid-winter, the Phase-1 anchor, is the winter key anyway)
      const wk = clamp(Math.max(0.7 * smooth(0, 0.5, snowFall), 0.5 * cover), 0, 1);
      for (let i = 0; i < 4; i++) sw[i] = cs.seasonW[i] * (1 - wk) + (i === 3 ? wk : 0);
      // snow-lit grey (snow falling or lying) vs the green-meadow overcast palettes
      const snowy = clamp(Math.max(smooth(0, 0.3, snowFall), cover), 0, 1);
      // crisp air of fair weather (clear, cumulus): no deck, no fog, no precipitation (0 at the Phase-1 anchor)
      const crisp = (1 - od) * (1 - fog) * (1 - smooth(0, 0.3, precip));

      // ---- sun: season colour x intensity; overcast takes it down (the storm keeps ~20% for snow relief; a grey
      // deck over a green meadow keeps less: no hard shadows), fog days dim it a little more
      const sunK = (1 - 0.8 * od - 0.12 * od * (1 - snowy)) * (1 - 0.25 * fog * (1 - od));
      const sunI = sMix1(SEASON.sunI, sw) * sunK;
      seasonMix(tmp.a, SEASON.sun, sw);
      for (let i = 0; i < 3; i++) lighting.sun[i] = tmp.a[i] * sunI;
      // ---- ambient / sky / fog colours: clear season palette -> overcast palette by od
      const pal = (key, out) => {
        seasonMix(tmp.a, SEASON[key], sw);
        // clear days: a slightly deeper horizon (less milk) than the Phase-1 calm
        if (key === 'hor' || key === 'fog') { seasonMix(tmp.c, SEASON.zen, sw); mix3(tmp.a, tmp.a, tmp.c, 0.12 * crisp); }
        // the overcast palette for this ground: dull grey -> rain grey -> fog day, then snow-lit grey
        mix3(tmp.b, DULLP[key], RAINP[key], smooth(0, 0.5, rain));
        mix3(tmp.b, tmp.b, FOGP[key], fog);
        mix3(tmp.b, tmp.b, LIT[key][1], snowy);
        mix3(out, tmp.a, tmp.b, Math.max(od, 0.6 * fog));
      };
      pal('amb', lighting.amb); pal('zen', lighting.zen); pal('hor', lighting.hor); pal('fog', lighting.fog);
      seasonMix(horBand, SEASON.band, sw);
      mix3(horBand, horBand, lighting.hor, Math.max(od, fog));      // the band is a clear-air effect
      // ---- haze / extinction / mist
      // haze: the season's clear-day haze -> the deck's haze (dry 1.8x the winter haze, rain 3.8x, snowing 5.5x = Phase
      // 1's 1/42000 (1 + 4.5 od)); fog days thicken it a little more
      const rk = smooth(0, 0.6, rain);
      // heavier rain thickens the air: the rain's extinction and its share of the deck haze scale with the rain rate and
      // the user's amount (as the particles and the far curtains do, derive/precip.js), relative to the canonical rain
      // preset (rate .65) at the default amount (amountMul 1), where the factor is 1: x1.18 at amount 1, ~x1.5 at rate 1
      const heavyR = Math.pow(rain * (0.6 + 0.4 * S.amountMul()) / 0.65, 0.6);
      const fs = smooth(0.4, 1.0, ch.fog);           // the fog sea forms only on fog days (fog .2 under rain / storms: more valley mist)
      // (stage 2b: rain air is clearer than it was: the valley keeps its depth under the deck, the far ridges dissolve
      // into it layer by layer instead of the whole left half going flat grey)
      const hazeDeck = (1.8 + 1.0 * rk * heavyR + 3.7 * smooth(0, 0.6, snowFall)) / 42000;    // a snowing deck: Phase 1's 5.5x
      // a fog-sea day is an inversion: the air above the sea is clearer than a grey day's (the ridges stand out crisply
      // over the white sea)
      lighting.fogP[0] = lerp(sMix1(SEASON.haze, sw) * (1 - 0.3 * crisp), hazeDeck, od) * (1 - 0.45 * fs);
      lighting.fogP[1] = sMix1(SEASON.hazeH, sw);
      lighting.fogP[2] = stormExt(wd, wx.tail * smooth(0, 0.3, snowFall)) + 0.000008 * rk * heavyR;   // the tail is thinning snow
      // the mist layer: the Phase-1 valley mist (reference level -650 m, 260 m scale) rises into the fog sea on fog days:
      // a dense, shallow layer (12 m scale) whose top (~-72 m, swelling +-20 m) floods the valley and the chalet basin
      // while the near meadow, the crowns of the forest band and every ridge stand above it. uFogP.w: the density at
      // the reference level (1/m)
      // (a snowing deck: Phase 1's (1 + 4.7 od); a dry deck keeps the season's, rain fills the valley with low cloud)
      // (stage 2b: fair weather thins it to a light valley haze (crisp): in the sun of a clear day the dense floor
      // mist read as a lone glowing blob over the far valley)
      // calm: no snow falling and no fog sea (dry or rainy days): the valley mist stays an even haze there too
      const calm = (1 - smooth(0, 0.3, snowFall)) * (1 - fs);
      const mist = sMix1(SEASON.mist, sw) * (1 + 4.7 * smooth(0, 0.6, snowFall) * od) * (1 + 2 * ch.fog * (1 - 0.6 * rk)) * (1 - Math.max(0.6 * crisp, 0.45 * calm));
      lighting.fogP[3] = mist * Math.pow(180 * mist, -fs);   // geometric blend mist -> 1/180: the sea rises / drains smoothly
      const even = Math.max(crisp, 0.8 * calm);
      mistP[0] = lerp(650, 72, fs);           // reference level depth (level -x m)
      // scale height (m): on calm days a deeper, even layer (a valley haze over the whole valley, not a dense film
      // pooled on the valley floor, which glowed as one bright spot under a grey sky)
      mistP[1] = lerp(lerp(260, 560, even), 12, fs);
      // (stage 2b: fair weather keeps the mist an even valley haze: a dense bank at the valley floor ~5 km out read as
      // a lone glowing blob)
      mistP[2] = lerp(lerp(0.3, 0.55, even), 0.8, fs);        // bank floor
      mistP[3] = lerp(lerp(1.3, 0.35, even), 0.45, fs);       // bank gain
      mistQ[0] = 20 * fs;                     // fog-sea top swell (m, +-), drifting with half the cloud wind
      mistQ[1] = 0.22 * fs;                   // sun glow of the fog-sea top (x sun visibility)
      mistQ[2] = fs;                          // fog-sea weight (soft far shoreline, sea texture, haze in front)
      mistQ[3] = 0;
      F.uMistP = mistP; F.uMistQ = mistQ;
      F.uSunCol = lighting.sun; F.uSkyAmb = lighting.amb; F.uSkyZen = lighting.zen; F.uSkyHor = lighting.hor; F.uFogCol = lighting.fog;
      F.uFogP = lighting.fogP; F.uHorBand = horBand;

      // ---- clouds
      cloudOff[0] = S.anim.cloud[0]; cloudOff[1] = S.anim.cloud[1];
      F.uCloudOff = cloudOff;
      F.uCloudCov = ch.cloudCov;
      F.uOvercast = ch.overcast;
      F.uCumulus = cum; F.uFogDay = ch.fog; F.uCirrus = ch.cirrus;
      // the slab: Phase 1 renders only the far field (left of centre from 19 km, right from 13 km). Cumulus open it to
      // the whole sky band (the nearest slab the camera sees is ~8 km out at the top of the frame) but keep the far cut
      // in front of the left massif (its jagged summit, 17.5 km out, stays a clean silhouette: a flat cumulus base
      // across it reads as a mesa). A grey deck (overcast, rain) closes in everywhere, the massif's summit included,
      // and under rain it lowers to ~1150 m so the tops of the walls go into the cloud. Not under a snow curtain: the
      // blizzard keeps the Phase-1 storm sky
      const deck = smooth(0.3, 0.9, ch.overcast) * (1 - smooth(0, 0.3, F.uSnowCurtain));
      const near = Math.max(cum, deck);
      cloudP[0] = lerp(lerp(19000, 18000, cum), 9000, deck);   // cut distance, left of the side split
      cloudP[1] = lerp(13000, 3000, near);     // cut distance, right of it
      cloudP[2] = lerp(5000, 2500, near);      // cut fade (m)
      cloudP[3] = lerp(700, 160, cum);         // base undulation (m, peak to peak): cumulus share a flat condensation level
      // slab base (m): a dry grey deck is a high lid (~2900 m, the massif's summit just grazing it; a flat base across
      // the massif at 1500-2000 m read as a table mountain), a rain deck hangs low (~1150 m: the walls go into it)
      cloudQ[0] = lerp(lerp(1500, 1700, cum), lerp(2900, 1150, rk), deck);
      cloudQ[1] = lerp(3600, 4400, deck * (1 - rk));   // slab top (m)
      cloudQ[2] = deck;                        // the near grey deck (its ragged, soft base)
      cloudQ[3] = lerp(0, -0.3, near);         // side split: sin(azimuth) where the left cut starts to give way
      F.uCloudP = cloudP; F.uCloudQ = cloudQ;
      // cloud shadows: Phase 1 0.65, crisp deep shadows under fair-weather cumulus
      F.uShadowAmp = lerp(0.65, 0.85, cum);
      // sky-pass EMA (0.3 per frame in render.js): a jump of the cloud inputs (debug hooks, instant picks, setStorm)
      // restarts the accumulation for one frame instead of ghosting the old clouds for ~10 frames
      let jump = 0;
      [ch.cloudCov, cum, ch.overcast, ch.fog, lighting.sun[0], lighting.amb[2]].forEach((v, i) => {
        if (haveLast) jump = Math.max(jump, Math.abs(v - last[i]) / (i >= 4 ? Math.max(last[i], 0.05) : 1));   // light: relative
        last[i] = v;
      });
      haveLast = true;
      F.uSkyResp = jump > 0.08 ? 1 : 0;      // a 60 s transition at 8x on a 10 fps device moves ~0.013 per frame

      // ---- exposure: Phase 1 (full cover sits sunlit snow below the ACES shoulder) x a partial auto-exposure on
      // the light level (overcast / rain days on a green meadow are lifted ~1.3-1.55x so they read soft, not murky).
      // Snow in view or a snow curtain keeps the Phase-1 storm exposure (the storm stays moody)
      const E = 0.5 * lum(lighting.sun) + lum(lighting.amb);
      // (stage 2b: a rain day is lifted less: it stays a little darker and moodier than a dry grey day)
      const comp = Math.min(1.55 - 0.3 * rk, Math.pow(E_REF / E, 0.45));
      const keep = Math.max(cover, smooth(0, 0.5, F.uSnowCurtain), 0.6 * smooth(0, 0.3, snowFall));
      F.uExposure = lerp(1.0, 0.54, Math.pow(cover, 1.3)) * lerp(1.0, 1.05, F.uSnowCurtain) * lerp(comp, 1, keep) * (1 - 0.1 * fog);
      F.uBloomStr = 0.12 + 0.05 * fog;
      // ---- grade: season white balance (rain cools it), desaturation (overcast, rain), S-curve (flatter in rain / fog)
      seasonMix(grade, SEASON.wb, sw);
      const rg = rk * od;
      grade[0] *= 1 - 0.02 * rg; grade[2] *= 1 + 0.02 * rg;
      F.uGrade = grade;
      gradeP[0] = 0.1 * od + 0.02 * rg + 0.06 * fog;    // desaturation (rain: wet colours stay rich)
      gradeP[1] = 0.2 * (1 - 0.2 * rg - 0.35 * fog);    // S-curve strength
      // sparkle gate (direct sun); above 1 on crisp fair days (stage 2b): denser, brighter glints on clear winter snow
      gradeP[2] = (1 - od) * (1 - 0.7 * fog) * (1 + 0.9 * crisp);
      F.uGradeP = gradeP;
    },
  };
})(window.SNOW);
