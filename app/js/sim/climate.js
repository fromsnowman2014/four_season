// =====================================================================================
//  sim/climate.js (stage-1 owner: lane A) — the year clock. Pure JS: no GL, no DOM (loads in node, tests/sim.mjs).
//  YEAR = 1200 climate-s at speed 1 (a season every 5 min). The phase starts from the real date (1 Mar = 0; whole
//  calendar days, so ?seed&t reproduce exactly within a day) unless ?season= / ?yp= is given. A season pick (setSeason) never jumps: the phase eases along the shortest arc to its
//  target over PIN_EASE climate-s, then holds; releasing it (null) lets the year flow on from where it is.
//
//  S.climate = { s, init(cfg), step(dtc, ff), snapshot(), api, seasonKo(phase) }     (main.js steps it first, in
//  climate seconds; seasonKo is the Korean season label of state().seasonKo and the pop-over's status line)
//    s.t        climate seconds since boot (advances by real dt x speed)
//    s.phase    year phase in [0, 1): 0 = start of spring (~1 Mar), .25 summer, .5 autumn, .75 winter
//    s.pinned   null (the year runs), or the phase the season is held at (?season= / setSeason)
//    s.speed    climate seconds per real second (0..8; the UI offers 0.25, 0.5, 1, 2, 4, 8; 0 = paused, api only)
//    s.seasonW  [spring, summer, autumn, winter]: smooth cyclic weights centred mid-season, summing to 1
//    s.tSeason  the seasonal meadow temperature without the weather (deg C): 4 + 10 sin(2 pi (phase - 0.125))
//  ff (fastForward / advance) is passed through; the climate does not depend on it.
//  Debug hook ?yp= pins s.phase after every step (and at init).
// =====================================================================================
(function (S) {
  'use strict';
  const YEAR = 1200;           // climate-s per year at speed 1
  const PIN_EASE = 60;         // climate-s: a season pick eases to its phase over one weather-transition length
  const NAMES = ['spring', 'summer', 'autumn', 'winter'];
  const KO = ['봄', '여름', '가을', '겨울'];
  const s = { t: 0, phase: 0, pinned: null, speed: 1, seasonW: [0, 0, 0, 1], tSeason: 0 };
  let yp = null;
  // the pin ease: phase(t) = from + arc * smooth(t0, t0 + PIN_EASE, t), arc the signed shortest way to s.pinned
  const ease = { from: 0, arc: 0, t0: -1e9 };
  const wrap = x => x - Math.floor(x);
  // a season name, or a phase 0..1 (string or number) -> phase; null for none / 'auto'
  function phaseOf(v) {
    if (v === null || v === undefined || v === '' || v === 'auto') return null;
    const i = NAMES.indexOf(String(v));
    if (i >= 0) return (i + 0.5) / 4;
    const n = parseFloat(v);
    return isFinite(n) ? wrap(n) : null;
  }
  // year phase of a calendar date (0 on 1 March), by whole calendar days: the start phase must not depend on the time
  // of day, or the same ?seed&t would give a different state from one run to the next (determinism)
  function datePhase(d) {
    const y = d.getFullYear();
    let days = (Date.UTC(y, d.getMonth(), d.getDate()) - Date.UTC(y, 2, 1)) / 864e5;
    if (days < 0) days += 365.25;
    return (days / 365.25) % 1;
  }
  function derive() {
    // smoothstep partition of unity: neighbouring seasons cross-fade over a quarter year, peaking mid-season
    for (let i = 0; i < 4; i++) {
      let d = Math.abs(s.phase - (i + 0.5) / 4); d = Math.min(d, 1 - d);
      const a = Math.max(0, 1 - d / 0.25);
      s.seasonW[i] = a * a * (3 - 2 * a);
    }
    s.tSeason = 4 + 10 * Math.sin(2 * Math.PI * (s.phase - 0.125));
  }
  const seasonIdx = (ph = s.phase) => Math.floor(ph * 4) % 4;     // = argmax of seasonW (the weights peak mid-quarter)
  // Korean name with an early / mid / late prefix (초봄, 한여름, 늦가을, ...): the first 30% of a season is early, the
  // last 45% late (Korean usage: late October is already 늦가을). The one season label: state().seasonKo and the
  // pop-over's status line (ui.js, through S.climate.seasonKo) both use it
  function seasonKo(ph = s.phase) {
    const i = seasonIdx(ph), f = ph * 4 - Math.floor(ph * 4);
    if (f < 0.3) return '초' + KO[i];
    if (f >= 0.55) return '늦' + KO[i];
    return (i === 1 || i === 3 ? '한' : '') + KO[i];
  }

  S.climate = {
    s,
    seasonKo,                  // (phase = s.phase) -> the Korean season label
    init(cfg) {
      yp = cfg.yp;
      s.t = 0; s.speed = S.clamp(+cfg.speed || 0, 0, 8);
      s.pinned = phaseOf(cfg.season);                       // a boot pin applies at once (no ease)
      ease.t0 = -1e9; ease.arc = 0;
      s.phase = yp !== null ? yp : s.pinned !== null ? s.pinned : datePhase(cfg.date);
      ease.from = s.phase;
      derive();
    },
    step(dtc) {
      s.t += dtc;
      if (s.pinned !== null) s.phase = wrap(ease.from + ease.arc * S.smooth(ease.t0, ease.t0 + PIN_EASE, s.t));
      else s.phase = wrap(s.phase + dtc / YEAR);
      if (yp !== null) s.phase = yp;
      derive();
    },
    snapshot: () => ({ season: NAMES[seasonIdx()], seasonKo: seasonKo(), phase: +s.phase.toFixed(4), speed: s.speed, seasonPinned: s.pinned !== null }),
    api: {
      // name | 0..1 | null ('auto' = null: the year runs on from where it is). A name eases to its mid-season phase,
      // a number to that phase. Returns the climate snapshot
      setSeason(v) {
        const p = phaseOf(v);
        if (p === null) s.pinned = null;
        else {
          s.pinned = p;
          ease.from = s.phase; ease.t0 = s.t;
          ease.arc = wrap(p - s.phase + 0.5) - 0.5;        // signed shortest arc in (-0.5, 0.5]
        }
        return S.climate.snapshot();
      },
      get speed() { return s.speed; },
      set speed(v) { s.speed = S.clamp(+v || 0, 0, 8); },
    },
  };
})(window.SNOW);
