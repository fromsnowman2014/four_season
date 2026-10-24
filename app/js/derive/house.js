// =====================================================================================
//  derive/house.js (Phase-3 owner: lane H) — the house scene's per-frame look: the sim state -> S.F, run by
//  S.deriveF (render.js) after derive/atmos.js and only while the house is the active scene (scenes/house.js derive:
//  'house'); derive/events.js runs after it. Pure JS (no GL, no DOM).
//    uCozy   0..1: the window, porch and street-lamp light (SURFACE_HOUSE): a golden-hour baseline, stronger under a
//            deck, in fog, rain, snow and storms (the hazards may flicker it after this: derive/events.js)
//  The house is always seen at the end of the day. Two looks over the shared atmosphere, blended by the weather:
//   - golden hour (fair weather, g): a warm low sun, a cooler, deeper sky light (the shade), a deep blue anti-solar
//     sky fading to a pale horizon under a peach evening haze, a few sunset clouds and cirrus streaks lit by the low
//     sun, a warm white balance;
//   - dusk (a deck, fog, precipitation: ev): the late grey light of a cozy evening, dimmer and bluer, so the warm
//     windows, the porch lantern and the street lamp carry the scene (uCozy 1).
//  Rule: never mutate the arrays an earlier derive set (S.lighting.*: derive/atmos.js recomputes from them and keys its
//  sky-history reset on them); write your own and assign them to F.
//  The bake variant (init / step, whatever the scene, like every derive clock): the deciduous and fruit trees are
//  bare from the leaf drop (~25 November, year phase .745) to the leaf-out (1 March, phase 0), with a small hysteresis;
//  S.setBakeVariant (gl.js) makes the engine rebake the house behind the live scene and dissolve it in (render.js).
//  S.derive.house = { init(), step(dt, ff), frame(F), variant }
// =====================================================================================
(function (S) {
  'use strict';
  const { smooth, lerp } = S;
  const sun = new Float32Array(3), hor = new Float32Array(3), zen = new Float32Array(3), band = new Float32Array(3), amb = new Float32Array(3), fog = new Float32Array(3), fogP = new Float32Array(4);
  const grade = new Float32Array(3), gradeP = new Float32Array(3), comp = new Float32Array(4), skyH = new Float32Array(4), cloudQ = new Float32Array(4);
  // golden hour (relative tints over the season's light, absolute sky targets of a clear evening)
  const SUN_T = [1.14, 0.76, 0.46];         // the low sun through a long air path
  const AMB_T = [0.78, 0.86, 1.04];         // the sky light opposite the sun: cooler, a little weaker (deeper shade)
  const ZEN = [0.018, 0.075, 0.38];         // the deep blue anti-solar zenith at sunset
  const HOR = [0.4, 0.6, 0.74];             // the pale anti-solar sky low down (a clear turquoise-white: a blue mixed with the
                                            // peach glow passes through a pale aqua and a warm cream, not lilac)
  const HAZE = [0.78, 0.6, 0.42];           // the warm evening haze over the horizon (apricot)
  const WB_G = [1.035, 1.0, 0.95];          // golden white balance
  const SKY_RATE = 7.5, SKY_GLOW = 0.9, SKY_SUNWARD = 0.035;   // the golden sky's gradient: zenith rate, horizon glow, sunward glow
  // dusk under a deck / in fog / in precipitation (relative): the light of a late grey evening
  const DUSK_AMB = [0.62, 0.68, 0.8], DUSK_SKY = [0.6, 0.66, 0.78], DUSK_FOG = [0.62, 0.66, 0.76];
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // bare from the leaf drop to the leaf-out (year phase; 0 = 1 March), with a hysteresis of HYST at both ends
  const DROP = 0.745, HYST = 0.006;
  const bareAt = (ph, cur) => cur ? !(ph >= HYST && ph < DROP - HYST) : (ph >= DROP + HYST && ph < 1 - HYST);
  function setVariant(v) { S.derive.house.variant = v; if (S.setBakeVariant) S.setBakeVariant(v); }

  S.derive.house = {
    variant: 0,
    // (stage 2a, the override order: ARCHITECTURE.md §4) this derive owns the house's thunderstorm palette (the darker,
    // cooler storm dusk below, keyed on ch.lightning), so derive/events.js does not darken the sky again; it still
    // lowers the deck and adds the flashes, the smoke and the quake's light flicker over this look
    stormLook: true,
    init() { const ph = S.climate.s.phase; setVariant(ph >= DROP ? 1 : 0); S.F.uHouseComp = comp; S.F.uHouseSky = skyH; },
    step() {
      const v = bareAt(S.climate.s.phase, S.derive.house.variant === 1) ? 1 : 0;
      if (v !== S.derive.house.variant) setVariant(v);
    },
    frame(F) {
      const ch = S.weather.s.ch, L = S.lighting;
      const od = smooth(0.15, 1, ch.overcast);
      const fg = smooth(0, 0.8, ch.fog);
      const pr = smooth(0, 0.5, ch.precip);
      const gloom = Math.max(od, fg, pr);
      F.uCozy = 0.4 + 0.6 * gloom;
      // golden hour: strongest on a clear evening, fading into the grey light of a deck or fog
      const g = (1 - 0.85 * od) * (1 - 0.6 * fg);
      // dusk: the deck / fog / precipitation evening (the snow-lit grey stays brighter: snow reflects the last light)
      // (the yard's visible snow: the house keeps its own milder snowline, derive/surface.js)
      const snowy = Math.max(S.derive.surface.visCover, smooth(0, 0.3, ch.precip * ch.snowFrac));
      const ev = gloom * (1 - 0.35 * snowy);
      // (the absolute targets keep the season / weather brightness of the sky and the haze)
      const hk = lum(L.hor) / 0.46, fk = lum(L.fog) / 0.52, zk = S.clamp(lum(L.zen) / 0.26, 0.8, 1.2);
      for (let i = 0; i < 3; i++) {
        sun[i] = L.sun[i] * lerp(1, SUN_T[i], g) * lerp(1, 0.75, ev) * lerp(1, 0.4, fg);   // (fog: a veiled sun, soft shadows)
        amb[i] = L.amb[i] * lerp(1, AMB_T[i], g) * lerp(1, DUSK_AMB[i], ev);
        zen[i] = lerp(L.zen[i], ZEN[i] * zk, 0.85 * g) * lerp(1, DUSK_SKY[i], ev);
        hor[i] = lerp(L.hor[i], HOR[i] * hk, 0.8 * g) * lerp(1, DUSK_SKY[i], ev);
        fog[i] = lerp(L.fog[i], HAZE[i] * fk, 0.8 * g) * lerp(1, DUSK_FOG[i], ev);
        band[i] = lerp(F.uHorBand[i], lum(F.uHorBand) * [1.0, 0.84, 0.54][i] * 1.1, 0.7 * g);
      }
      // a thunderstorm evening: a heavier, darker, cooler sky (the lightning lights it: derive/events.js)
      const st = smooth(0, 1, ch.lightning || 0);
      for (let i = 0; i < 3; i++) { zen[i] *= lerp(1, [0.62, 0.66, 0.74][i], st); hor[i] *= lerp(1, [0.7, 0.74, 0.8][i], st); amb[i] *= lerp(1, 0.85, st); }
      // a fog evening: the mist itself dark and blue (the windows and the lamps glow in it)
      const fe = fg * (1 - 0.5 * snowy);
      for (let i = 0; i < 3; i++) { fog[i] *= lerp(1, [0.56, 0.62, 0.76][i], fe); amb[i] *= lerp(1, 0.75, fe); zen[i] *= lerp(1, 0.7, fe); hor[i] *= lerp(1, 0.66, fe); }
      F.uSunCol = sun; F.uSkyAmb = amb; F.uSkyHor = hor; F.uHorBand = band; F.uSkyZen = zen; F.uFogCol = fog;
      // the evening air over the suburb: a warm haze thick toward the horizon (the sky glows peach behind the trees)
      // on fair days; untouched in fog / rain / snow
      for (let i = 0; i < 4; i++) fogP[i] = L.fogP[i];
      fogP[0] *= lerp(1, 1.3, g * (1 - smooth(0, 0.4, ch.precip)));
      fogP[1] = lerp(fogP[1], 900, g);
      F.uFogP = fogP;
      // a few sunset clouds and cirrus streaks on a clear evening (the clear preset is nearly cloudless)
      // (stage 2b: fair-weather cumulus thinned more (-30%): fewer, larger clouds with blue between them instead of a
      // busy field of small far fragments)
      const cu = F.uCumulus * g;
      F.uCloudCov = Math.max(F.uCloudCov * (1 - 0.3 * ch.cumulus * g), 0.48 * g * (1 - 0.35 * cu));
      // fair-weather cumulus over the house hang lower (base ~1150 m instead of the valley's 1700 m): the cells read
      // larger and fewer from the street, the far band of small fragments thins out
      for (let i = 0; i < 4; i++) cloudQ[i] = F.uCloudQ[i];
      cloudQ[0] = lerp(cloudQ[0], 1150, cu);
      F.uCloudQ = cloudQ;
      F.uCirrus = Math.max(F.uCirrus, 0.6 * g);
      // cloud shadows: the shadow of a cloud ~7 km toward the low sun; softer, so the house rarely sits in deep shade
      F.uShadowAmp *= 0.55;
      // exposure: a golden evening a little richer; a dusk darker (the lights carry it)
      F.uExposure *= lerp(1.0, 0.72, ev) * lerp(1, 0.96, g) * lerp(1, 0.84, fe) * lerp(1, 0.86, st);
      F.uBloomStr = F.uBloomStr + 0.1 * fg + 0.05 * pr;
      for (let i = 0; i < 3; i++) grade[i] = F.uGrade[i] * lerp(1, WB_G[i], g);
      F.uGrade = grade;
      // (the sparkle gate: stage 2b, sunlit snow at golden hour glints denser and brighter: the low warm sun across a
      // white yard sits near the ACES shoulder, where the shared glints barely showed)
      gradeP[0] = F.uGradeP[0] * (1 - 0.5 * g); gradeP[1] = F.uGradeP[1] + 0.08 * g; gradeP[2] = F.uGradeP[2] * (1 + 0.9 * g);
      F.uGradeP = gradeP;
      // the composite (COMP_HOUSE): the air that scatters the lamps' light (a clear evening's haze, rain, falling snow,
      // fog), the golden highlights, the halo gain
      comp[0] = 0.0012 + 0.022 * fg + 0.006 * smooth(0, 0.6, ch.precip * (1 - ch.snowFrac)) + 0.009 * smooth(0, 0.6, ch.precip * ch.snowFrac);
      comp[1] = Math.max(0.85 * g, 0.6 * ev);           // (dusk: the lamps and windows glow amber, not white)
      comp[2] = 40;
      F.uHouseComp = comp;
      // the golden-hour sky (SURFACE_HOUSE sceneSky, stage 2b): a deep blue zenith over a peach glow on the treeline,
      // warmer toward the low sun; fades into ATMOS's sky under a deck, in fog and in precipitation
      skyH[0] = g * (1 - pr); skyH[1] = SKY_RATE; skyH[2] = SKY_GLOW; skyH[3] = SKY_SUNWARD;
      F.uHouseSky = skyH;
    },
  };
})(window.SNOW);
