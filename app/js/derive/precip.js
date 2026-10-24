// =====================================================================================
//  derive/precip.js (stage-1 owner: lane E; Phase 3: lane Z) — precipitation: the sim state -> S.F (rates, curtain, wet snow, the
//  distant veils and rain curtains, the flake / rain shutters, fall factors, wind and clocks), and the
//  precipitation clocks. Pure JS (no GL, no DOM). Reads S.weather.s (ch.precip, ch.snowFrac, ch.heavy, ch.gale,
//  temp, curtain, white, tail) and S.wind.s; the counts (precip.js) scale the rates with S.amountMul().
//
//  S.derive.precip = { init(), step(dt, ff), frame(F) }       frame runs second (after surface, before atmos)
//    init / step   the clocks, all integrals over PHYSICAL time (a rate change never jumps a phase or a particle):
//                  S.anim.fallI  snow fall integral (fall factor kS; uFallV = kS = d fallI / dt)
//                  S.anim.tumI   tumble integral (uTumT, wrapped by TW = 120)
//                  S.anim.rainI  rain fall integral (fall factor kR; uRainV = kR = d rainI / dt)
//                  S.anim.ashI, emberI  the wildfire ash / ember fall integrals (factor 1: their speed ranges are in
//                  the layer descriptors, embers' negative: they rise)
//                  S.anim.veilI[4] snow veil scroll, veilR[4] rain veil scroll, gustR[2] rain gust bands: wrapped by the
//                  256 noise period; like Phase 1's veil they hold during fastForward
//                  The wet-snow factor is slewed in physical time (tau 4 s): it scales non-integrated amplitudes
//                  (flutter, size), so a jump in temperature (a pick at 8x, a test hook) cannot jerk the flakes.
//    frame(F)      uSnowCurtain uPrecipSnow uPrecipRain uSnowFrac uGale uHeavy uWetSnow
//                  uVeilDir uVeilAmt uVeilT (snow veil), uRainDir uRainVeil uRainT uRainShaft (rain veil + curtains)
//                  uExpo uFallV uTumT (flakes), uExpoRain uRainV uRainGust (rain), uWindA uWindB uFlakeT
// =====================================================================================
(function (S) {
  'use strict';
  const { lerp, smooth, camR, worldR } = S;
  const veilDir = new Float32Array(2), veilT = new Float32Array(4);
  const rainDir = new Float32Array(2), rainT = new Float32Array(4), rainShaft = new Float32Array(4), rainGust = new Float32Array(2);
  // wet snow (big heavy aggregates) from the meadow temperature: only in the thaw band above the freezing point,
  // where the flakes partly melt and stick together (the sleet zone: snowFrac ramps out over 1..3 deg C), and only
  // partially (at most WET_MAX of the crystals turn into clumps, so crisp six-armed crystals keep falling between the
  // aggregates). Below +0.4 deg C the snow is the dry Phase-1 snowfall (the late-autumn opening at about -2.5 deg C);
  // above ~2.6 deg C the last few flakes stay dry
  const WET_MAX = 0.6;
  const wetOf = T => WET_MAX * smooth(0.4, 1.5, T) * (1 - smooth(2.1, 2.6, T));
  // fall factors (one source of truth for the integrals and the shaders' velocities): the blizzard curtain and wet
  // clumps fall faster (wet snow ~1.5-2.4 m/s); heavy rain has slightly bigger, faster drops
  const snowK = (c, w) => 1 + 0.9 * c + 0.8 * w;
  const rainK = r => 1 + 0.06 * r;
  const RAIN_V = 7.2;                         // m/s: typical drop speed, for the apparent slant of the distant rain
  const st = { wet: 0, kS: 1, kR: 1 };
  const rainRate = ch => ch.precip * (1 - ch.snowFrac);

  S.derive.precip = {
    init() {
      const a = S.anim, wx = S.weather.s;
      a.fallI = 0; a.tumI = 0; a.rainI = 0; a.ashI = 0; a.emberI = 0; a.veilI = [0, 0, 0, 0]; a.veilR = [0, 0, 0, 0]; a.gustR = [0, 0];
      st.wet = wetOf(wx.temp); st.kS = snowK(wx.curtain, st.wet); st.kR = rainK(rainRate(wx.ch));
    },
    step(dt, ff) {
      const a = S.anim, wx = S.weather.s, c = wx.curtain;
      st.wet += (wetOf(wx.temp) - st.wet) * (1 - Math.exp(-dt / 4));
      st.kS = snowK(c, st.wet); st.kR = rainK(rainRate(wx.ch));
      // shader clocks as integrals (so storm ramps / wind changes never jump a phase): fall, tumble, rain
      a.fallI += st.kS * dt;
      a.tumI += (1 + 0.8 * c) * (1 - 0.5 * st.wet) * dt;
      a.rainI += st.kR * dt;
      a.ashI += dt; a.emberI += dt;
      if (ff) return;
      // (the scroll integrals take the lateral wind in the world's reference frame, S.worldR: the valley's camera, so
      // they never depend on the scene shown; frame() below uses the live camera for the directions on screen)
      const w = S.wind.s.windA, wl = w[0] * worldR[0] + w[2] * worldR[2];
      const vdx = wl / (1.2 + 1.5 * c), vl = Math.hypot(vdx, 1);             // apparent fall direction of the distant veil
      const vI = a.veilI;
      vI[0] = (vI[0] + (2.2 + 4.0 * c) * dt) % 256; vI[1] = (vI[1] + (1.4 + 2.6 * c) * dt) % 256;
      vI[2] = (vI[2] + (0.05 - 0.25 * vdx / vl) * dt) % 256; vI[3] = (vI[3] + 0.25 / vl * dt) % 256;
      // rain veil: the grain sheets fall fast along the rain's apparent direction, the density drifts with the wind
      const rdx = wl / (RAIN_V * st.kR), rl = Math.hypot(rdx, 1), vR = a.veilR;
      vR[0] = (vR[0] + 2.6 * st.kR * dt) % 256; vR[1] = (vR[1] + 1.2 * st.kR * dt) % 256;
      vR[2] = (vR[2] + (0.02 - 0.12 * rdx / rl) * dt) % 256; vR[3] = (vR[3] + 0.05 / rl * dt) % 256;
      // rain gust bands sweep downwind (screen x) and drift down a little
      const g = a.gustR;
      g[0] = (g[0] - (0.05 * wl) * dt) % 256; g[1] = (g[1] + 0.06 * dt) % 256;
    },
    frame(F) {
      const wx = S.weather.s, ch = wx.ch, c = wx.curtain, a = S.anim, w = S.wind.s;
      const pr = ch.precip * (1 - ch.snowFrac);
      F.uSnowCurtain = c;
      F.uPrecipSnow = ch.precip * ch.snowFrac;
      F.uPrecipRain = pr;
      F.uSnowFrac = ch.snowFrac; F.uGale = ch.gale; F.uHeavy = ch.heavy;
      F.uWetSnow = st.wet;
      const wl = w.windA[0] * camR[0] + w.windA[2] * camR[2];
      // the distant snow veil (VEIL): apparent fall direction, amount (Phase 1's faint floor scaled by the snowfall
      // rate, + the whiteout, + the residual veil while a storm clears, gated by the snowfall like the atmosphere's
      // tail extinction (derive/atmos.js): 0 in dry weather), scroll
      veilDir[0] = wl / (1.2 + 1.5 * c); veilDir[1] = -1.0; F.uVeilDir = veilDir;
      F.uVeilAmt = 0.012 * Math.min(1, F.uPrecipSnow) + 0.18 * smooth(0, 1, wx.white) + 0.04 * wx.tail * smooth(0, 0.3, F.uPrecipSnow);
      for (let i = 0; i < 4; i++) veilT[i] = a.veilI[i];
      F.uVeilT = veilT;
      // the rain veil and the far rain curtains (VEIL): the faint mid-distance grain, and grey shafts hanging under
      // the cloud base (optical depth per km from the rain rate; slant = the wind over the drop speed)
      rainDir[0] = wl / (RAIN_V * st.kR); rainDir[1] = -1.0; F.uRainDir = rainDir;
      const ra = 0.6 + 0.4 * S.amountMul();             // the user's amount thins / thickens the distant rain too
      F.uRainVeil = 0.05 * smooth(0, 0.8, pr) * (1 + 0.5 * ch.gale) * ra;
      for (let i = 0; i < 4; i++) rainT[i] = a.veilR[i];
      F.uRainT = rainT;
      rainShaft[0] = 0.24 * smooth(0, 1, pr) * (0.7 + 0.6 * pr) * ra;   // (stage 2b: the far curtains read over the valley)
      rainShaft[1] = 1 - ch.overcast;                   // sunlit share: shafts under broken cloud catch the sun
      // the slant of the distant curtains (clamped: a gale lays them over by at most ~40 deg)
      const sl = Math.min(1, 0.85 / Math.max(1e-6, Math.hypot(w.windA[0], w.windA[2]) / RAIN_V));
      rainShaft[2] = w.windA[0] / RAIN_V * sl; rainShaft[3] = w.windA[2] / RAIN_V * sl;
      F.uRainShaft = rainShaft;
      // flakes: calm = fast shutter, crisp hero crystals; rain: a slow shutter, so a drop is the streak of its path
      // (~1.3 frames of motion at 60 fps: consecutive frames join into continuous rain)
      F.uExpo = lerp(1 / 220, 1 / 55, smooth(0, 1, c));
      F.uFallV = st.kS;
      F.uExpoRain = 1 / 45;
      F.uRainV = st.kR;
      rainGust[0] = a.gustR[0]; rainGust[1] = a.gustR[1]; F.uRainGust = rainGust;
      F.uWindA = w.windA; F.uWindB = w.windB;
      F.uFlakeT = a.time % 120; F.uTumT = a.tumI % 120;
    },
  };
})(window.SNOW);
