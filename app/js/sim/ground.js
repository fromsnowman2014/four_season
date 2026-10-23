// =====================================================================================
//  sim/ground.js (stage-1 owner: lane A) — the ground state. Pure JS: no GL, no DOM.
//  The meadow snowpack (cover: snowfall minus melt), the ground wetness, and the altitude snowline.
//
//  S.ground = { s, init(cfg), step(dtc, ff), snapshot(), api }     (stepped after the weather, in climate seconds)
//    s.cover     0..1 snow cover level, compared against the baked snowT (Phase-1 threshold semantics)
//    s.wet       0..1 ground wetness
//    s.snowline  altitude (m) below which the per-frame snowline bares the ground (effectiveCover, SURFACE)
//    s.hold      the cover is held (?cover= with ?storm=0)
//    s.melt, s.meltFrom   the eased reset: seconds into it (null when idle) and the cover it started from
//  Per climate-s (T the meadow temperature, sun = 1 - overcast, rain = precip (1 - snowFrac)):
//    snowfall  +(1/ACC)(1 + 4 heavy) amountMul precip snowFrac, ACC = 200 s (stage 2b: the Phase-1 rate 1/300 at its
//              precip 1; the snow preset falls at precip .75, so 1/200 keeps the Phase-1 pace on the meadow: roofs
//              white within a minute, the meadow patchy-white in two, and a real winter snowpack)
//    melt      -(max(T, 0)/900 (1 + 1.5 sun) (0.3 + 0.7 cover) + rain/120)   (only while there is cover; stage 2b: the
//              last patches, the shaded and high ground where snowT is lowest, hold out longer than a full pack, so a
//              spring meadow melts out over about half a minute instead of in seconds)
//    wet       rain wets toward min(1, 1.6 rain) with tau 20 s; it dries with tau 120 s / ((0.35 + 0.65 sun)
//              (1 + 0.1 wind m/s)); melting snow adds 0.6 x the melted cover x (1 - wet)
//    snowline  a seasonal level (SEASONAL below, metres) that fresh snow pulls down: while it precipitates, the
//              level descends (tau 12 s / precip) to the snow level (T - 1.5)/0.0065 m (the 1.5 C isotherm by the
//              6.5 C/km lapse rate, meadow ~0 m); it relaxes back up with tau 100 s / ((0.25 + 0.75 sun)
//              (1 + max(T, 0)/5)) (summer fresh snow is gone in ~1-2 min, spring snow lingers), and down to a falling
//              seasonal level with tau 20 s. While the meadow holds snow (cover > 0.005) the level is drawn below it
//              (MEADOW_CAP, tau 8 s) and cannot rise above it, so the cover alone decides there.
//  World altitudes (terrain): valley floor ~-1000 m, meadow -100..40 m, camera 132 m, treeline ~330 m, the far
//  peaks' snowfields ~1900-2500 m (at cover 0 the bake whitens flat ground above ~1.8-2.3 km; a snowline of
//  2200-2300 m leaves only the topmost couloirs white).
//  Climatological spin-up (stage 2b): a pinned season starts from the ground that time of year has (CLIM: phase ->
//  cover, wetness; the snowline is the seasonal one, under the meadow while it holds snow): deep winter snow, the
//  patchy melting snow of early spring, bare summer meadows with only the high couloirs white, the first dustings of
//  late autumn. A boot ?season= pin starts there at once; a season picked from the UI (setSeason with a phase or a
//  name) eases there over SPIN climate-s: the free-running ground (snowfall, melt, wetting, drying go on in a shadow
//  copy) is blended into the target season's climatology by a smoothstep in climate time, then runs on its own. ?yp
//  (a debug pin) has none; ?cover and ?ground still override.
//  ff is ignored (fastForward runs the live steps). Debug hook ?ground= overrides s after every step, e.g.
//  cover:.3,wet:.8,snowline:2200.
// =====================================================================================
(function (S) {
  'use strict';
  const { smooth, clamp } = S;
  const LAPSE = 0.0065;          // C per m
  const ACC = 200;               // climate-s: a full snowpack at precip 1 (amountMul 1, no heavy snowfall)
  const LOW = -1600;             // m: below the valley floor (no snowline effect anywhere)
  // m: the snowline while the meadow holds snow. SURFACE's offset spans the 300 m half-width plus a per-pixel shift of
  // up to ~-180 m (sun exposure) and +-130 m (noise), so the meadow (-100..40 m) is untouched only from about -450 m
  // down (measured with ?view=cEff: -350 still bared ~1% of the meadow, -450 / -550 none)
  const MEADOW_CAP = -550;
  // the seasonal snowline (m) at year-phase keypoints, cosine-eased between them (cyclic): early spring 1100 rising
  // to 2100 at the start of summer and 2300 in late summer (only the top couloirs white), lowering through autumn
  // to 1500 by late autumn, then below the valley floor for the winter
  const SEASONAL = [[0, 1100], [0.25, 2100], [0.4, 2300], [0.5, 2150], [0.7, 1500], [0.78, LOW], [0.95, LOW], [1, 1100]];
  function seasonal(ph) {
    let i = 0;
    while (i < SEASONAL.length - 2 && ph >= SEASONAL[i + 1][0]) i++;
    const [p0, a0] = SEASONAL[i], [p1, a1] = SEASONAL[i + 1], u = (ph - p0) / (p1 - p0);
    return a0 + (a1 - a0) * (0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1)));
  }
  // the ground's climatology: [phase, cover, wetness], cosine-eased between keypoints (cyclic). Winter builds a deep pack
  // (mid-winter ~.9: white to the valley floor); early spring is patchy and melting (wet), the meadow bare by late
  // spring; summer and autumn bare (the snowline keeps the high couloirs / the first peak dustings), late autumn's first
  // dustings on the meadow
  // [phase, cover, wetness, snowline m] (the wetness is the spring meltwater; summer / autumn rain wets the ground
  // through the weather): spring melts out from below (the snowline climbs through the meadow while the
  // slopes above stay white), summer leaves the high couloirs, the first dusting reaches the meadow in late autumn
  const CLIM = [[0, 0.93, 0.1, -700], [0.05, 0.92, 0.3, -450], [0.1, 0.9, 0.36, -120], [0.15, 0.86, 0.36, 120], [0.2, 0.7, 0.3, 650],
                [0.25, 0.3, 0.2, 1500], [0.3, 0, 0.06, 2100], [0.45, 0, 0.02, 2300], [0.55, 0, 0.02, 2050], [0.68, 0, 0.04, 1550],
                [0.74, 0.1, 0.08, MEADOW_CAP], [0.8, 0.6, 0.04, LOW], [0.86, 0.97, 0.02, LOW], [0.95, 0.99, 0.02, LOW], [1, 0.93, 0.1, -700]];
  const SPIN = 60;               // climate-s: a season picked from the UI brings its ground in over one transition
  function interp(T, ph, k) {
    let i = 0;
    while (i < T.length - 2 && ph >= T[i + 1][0]) i++;
    const a = T[i], b = T[i + 1], u = clamp((ph - a[0]) / (b[0] - a[0]), 0, 1);
    return a[k] + (b[k] - a[k]) * (0.5 - 0.5 * Math.cos(Math.PI * u));
  }
  function climatology(ph, o) {
    o.cover = interp(CLIM, ph, 1); o.wet = interp(CLIM, ph, 2); o.snowline = interp(CLIM, ph, 3);
    return o;
  }
  const s = { cover: 0, wet: 0, snowline: -10000, hold: false, melt: null, meltFrom: 0 };
  let gr = null;
  // the spin-up: target (the picked season's climatology), its start (climate s), the free-running shadow state
  const spin = { on: false, t0: 0, tgt: { cover: 0, wet: 0, snowline: 0 }, free: { cover: 0, wet: 0, snowline: 0 } };
  let lastPin = null;

  S.ground = {
    s,
    init(cfg) {
      gr = cfg.ground;
      s.cover = 0; s.wet = 0; s.melt = null; s.meltFrom = 0;
      s.hold = cfg.cover !== null && cfg.storm === '0';
      // the seasonal level, or the fresh-snow level when the first weather already precipitates (the opening snowfall);
      // a pinned season (?season=) starts from its climatology
      const wx = S.weather.s, cl = S.climate.s;
      spin.on = false; lastPin = cl.pinned;
      if (cl.pinned !== null) climatology(cl.pinned, s);
      s.snowline = Math.min(cl.pinned !== null ? s.snowline : seasonal(cl.phase), wx.ch.precip > 0.02 ? (wx.temp - 1.5) / LAPSE : Infinity);
      S.override(s, gr);
    },
    step(dtc) {
      const wx = S.weather.s, ch = wx.ch, T = wx.temp, cl = S.climate.s;
      const sun = 1 - ch.overcast, rain = ch.precip * (1 - ch.snowFrac);
      // a season picked from the UI: from here the ground runs in the shadow copy and is blended into the climatology of
      // the picked season over SPIN climate-s (a release, null, lets the ground run on from where it is)
      if (cl.pinned !== lastPin) {
        lastPin = cl.pinned;
        if (cl.pinned !== null && !s.hold) {
          spin.on = true; spin.t0 = cl.t - dtc; climatology(cl.pinned, spin.tgt);
          spin.free.cover = s.cover; spin.free.wet = s.wet; spin.free.snowline = s.snowline;
        } else spin.on = false;
      }
      const g = spin.on ? spin.free : s;
      // ---- the snowpack
      let melted = 0;
      if (s.melt !== null) {
        s.melt += dtc;
        g.cover = s.meltFrom * (1 - smooth(0, 1.5, s.melt));
        if (s.melt >= 1.5) { g.cover = 0; s.melt = null; }
      } else if (!s.hold) {
        const fall = (1 / ACC) * (1 + 4 * ch.heavy) * S.amountMul() * ch.precip * ch.snowFrac;
        // the snow left lies near and above the snowline: it melts at the air temperature there (up to 600 m above the
        // meadow), so in a spring thaw the meadow melts out first and the slopes above stay white for minutes
        const Tm = T - LAPSE * clamp(g.snowline + 300, 0, 600);
        const meltR = g.cover > 0 ? Math.max(Tm, 0) / 900 * (1 + 1.5 * sun) * (0.3 + 0.7 * g.cover) + rain / 120 : 0;
        const c = clamp(g.cover + (fall - meltR) * dtc, 0, 1);
        melted = Math.max(0, Math.min(meltR * dtc, g.cover + fall * dtc - c));
        g.cover = c;
      }
      // ---- wetness: rain wets fast, sun and wind dry slowly, melt water adds a little
      const wetIn = Math.min(1, 1.6 * rain);
      if (wetIn > g.wet) g.wet += (wetIn - g.wet) * (1 - Math.exp(-dtc / 20));
      else {
        const w = S.wind.s.natural, wind = Math.hypot(w[0], w[2]);
        g.wet += (wetIn - g.wet) * (1 - Math.exp(-dtc * (0.35 + 0.65 * sun) * (1 + 0.1 * wind) / 120));
      }
      g.wet = Math.min(1, g.wet + 0.6 * melted * (1 - g.wet));
      // ---- the snowline: seasonal, pulled down by fresh snow. While snow lies (cover > 0.005) it is held under the meadow
      // (the cover alone decides there), except in a thaw (no snow falling and the meadow above 1.5 C): then it climbs
      // toward the 4 C isotherm and the meadow melts out from below, sunny ground first (stage 2b)
      const meadow = g.cover > 0.005, thaw = T > 1.5 && ch.precip * ch.snowFrac < 0.02;
      const capL = thaw ? Math.max(MEADOW_CAP, (T - 4) / LAPSE) : MEADOW_CAP;
      const sea = meadow ? Math.min(seasonal(cl.phase), capL) : seasonal(cl.phase);
      const zs = (T - 1.5) / LAPSE;
      let L = g.snowline;
      if (ch.precip > 0.02 && zs < L) {
        L += (zs - L) * (1 - Math.exp(-dtc * ch.precip / 12));
        // snowing onto a meadow that already holds snow (a snow level near the meadow, e.g. -0.5 C -> -308 m): the cap
        // applies here too, so SURFACE's 300 m transition never bares sunny meadow pixels under falling snow
        if (meadow && L > MEADOW_CAP) L += (MEADOW_CAP - L) * (1 - Math.exp(-dtc / 8));
      } else if (L < sea) L += (sea - L) * (1 - Math.exp(-dtc * (0.25 + 0.75 * sun) * (1 + Math.max(T, 0) / 5) / 100));
      else L += (sea - L) * (1 - Math.exp(-dtc / (meadow && !thaw ? 8 : 20)));
      g.snowline = L;
      // ---- the spin-up blend (smooth in climate time, so the ground eases in with the season's colours)
      if (spin.on) {
        // the snowline leads (over the first 60%): snow comes in as patches that spread, and melts out from below
        const e = smooth(spin.t0, spin.t0 + SPIN, cl.t), eL = smooth(spin.t0, spin.t0 + 0.6 * SPIN, cl.t), f = spin.free, tg = spin.tgt;
        s.cover = f.cover + (tg.cover - f.cover) * e;
        s.wet = f.wet + (tg.wet - f.wet) * e;
        s.snowline = f.snowline + (tg.snowline - f.snowline) * eL;
        if (e >= 1) spin.on = false;
      }
      S.override(s, gr);
    },
    snapshot: () => ({ wet: +s.wet.toFixed(4), snowline: Math.round(s.snowline) }),
    api: {
      setCoverage(v) { s.cover = clamp(+v || 0, 0, 1); s.melt = null; spin.on = false; },
      reset() { s.cover = 0; s.melt = null; spin.on = false; },
      resetSnow() { s.meltFrom = s.cover; s.melt = 0; spin.on = false; },     // the eased reset (1.5 s)
    },
  };
})(window.SNOW);
