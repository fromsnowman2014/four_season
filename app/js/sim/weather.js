// =====================================================================================
//  sim/weather.js (stage-1 owner: lane A) — the weather state and its channels. Pure JS: no GL, no DOM.
//  Seven states, each a target over the channels (PRESET below). Every change is a staged transition of D = 60
//  climate-s that starts from the CURRENT channel values (so a pick in mid-transition never jumps): clouds lead,
//  precipitation lags in and leads out, the gale sits between, fog has its own window, the sky clears last.
//  A season-dependent Markov scheduler picks the next state; a manual pick transitions and then holds.
//
//  S.weather = { s, init(cfg), step(dtc, ff), snapshot(), api }     (stepped after the climate, in climate seconds)
//    s.t         the weather clock (S.climate.s.t)
//    s.cur, s.next, s.progress, s.manual, s.nextAt
//                cur: the state the weather is in (while a transition runs, the one it is leaving); next: the
//                transition target (null when settled); progress 0..1 (1 settled); manual: the held pick (null =
//                automatic); nextAt: climate time of the next scheduled change (0 = none: manual or auto off)
//    s.auto      the scheduler runs (Phase-1 "automatic storms"; false holds the current weather)
//    s.amount    the user precipitation amount 0..1; S.amountMul() = 0.2 + 1.6 amount scales flake counts and snowfall
//    s.ch        the channels, 0..1 unless noted:
//                cloudCov  weather-map cloud coverage (= uCloudCov)        cumulus   near cumulus and their shadows
//                overcast  the stratus deck / storm light                  cirrus    cirrus amount (1 = Phase-1 veil)
//                fog       valley fog                                      precip    precipitation rate
//                gale      gale strength (the wind blends into the gale by smooth(gale))
//                heavy     heavy-snowfall / blizzard intensity             tempOff   temperature offset (deg C)
//                snowFrac  snow share of the precipitation: follows 1 - smooth(1, 3, temp) (snow below 1 C, rain above
//                          3 C) at most 1/SF_TIME per climate-s, so a fast temperature swing (a season pick, a pick
//                          across the freezing line) turns snow into rain through ~15 s of sleet, never at once
//    s.temp      meadow temperature, deg C (S.climate.s.tSeason + ch.tempOff)
//    s.curtain   0..1 the snow curtain = heavy x snowFrac (Phase 1 sim.storm): flake turbulence, extinction, veil
//    s.white     0..1 the whiteout = curtain x a slow gust beat (physical time)
//    s.tail      0..1 residual thinning snow after the curtain opens: follows the curtain up (~4 s), decays ~25 s
//    s.heading   gale direction offset (rad): each event draws one, eased over the gale window of its transition
//  Randomness is counter based, S.rand(seed, eventIdx, k), so UI actions never shift the seeded sequence.
//  ff is ignored: fastForward runs exactly the live steps. Debug hook ?wx= overrides s.ch after every step
//  (temp, snowFrac, curtain and white follow it; an explicit snowFrac in ?wx wins over the derived one).
// =====================================================================================
(function (S) {
  'use strict';
  const { lerp, smooth, clamp } = S;
  const D = 60;                                  // climate-s: one weather transition
  const DWELL = [70, 180];                       // climate-s between scheduled transition starts (uniform)
  const SF_TIME = 15;                            // climate-s: the fastest full snow <-> rain conversion
  const FIRST_COLD = 2.5;                        // deg C: the opening snowfall is at least this far below freezing
  const STATES = ['clear', 'cumulus', 'overcast', 'fog', 'rain', 'snow', 'blizzard'];
  const KEYS = ['cloudCov', 'cumulus', 'overcast', 'cirrus', 'fog', 'precip', 'gale', 'heavy', 'tempOff'];
  // canonical presets (the contract lanes C/D/E tune against via ?wx=); order = KEYS
  const PRESET = {
    clear:    [0.15, 0,   0,    0.35, 0,    0,    0.05, 0,  1],
    cumulus:  [0.55, 1,   0.1,  0.2,  0,    0,    0.2,  0,  0],
    overcast: [0.95, 0.2, 0.75, 0,    0.1,  0,    0.3,  0, -1],
    fog:      [0.75, 0,   0.5,  0,    1,    0,    0,    0, -1],
    rain:     [0.97, 0,   0.85, 0,    0.2,  0.65, 0.4,  0,  1],
    snow:     [0.75, 0.2, 0.35, 0.4,  0.05, 0.75, 0.15, 0, -3],    // Phase-1 sunlit snowfall: broken sun, not grey
    blizzard: [0.98, 0,   1,    0,    0.2,  1,    1,    1, -6],
  };
  const IS_PRECIP = { rain: 1, snow: 1, blizzard: 1 };
  // ---- the Markov scheduler: P(i -> j) ∝ ROW[season][j] · LINK[i][j] · feasible(j), rows blended by seasonW.
  // ROW: how much each season favours a state; LINK: the structural affinity of a move (0 = forbidden: no self
  // transitions, precipitation only out of overcast / cumulus / fog, blizzard only out of snow / overcast).
  // Columns in STATES order: clear cumulus overcast fog rain snow blizzard
  const ROW = [
    [1.0, 1.1, 0.7, 0.5, 1.5, 0.35, 0.2],  // spring: mixed, showery, late snow early on
    [1.5, 1.7, 0.4, 0.2, 0.75, 0,  0],     // summer: sunny and cumulus days, some showers
    [0.8, 0.4, 1.0, 1.6, 1.1, 0.6, 0.2],   // autumn: fog and rain, first snow late
    [0.55, 0.2, 1.0, 0.35, 0.3, 2.8, 1.1], // winter: snowy (sunny spells between the snowfalls)
  ];
  // dwell bias per season and state (-1 short .. +1 long): the dwell is 70 + 110 u^g with g = 2^(-1.5 bias), so the
  // mean is 125 s neutral, ~150 s at +1, ~100 s at -1 (always inside 70-180): winter snow lingers and the grey
  // gateways pass quickly, summer showers are brief
  const DWELL_BIAS = [
    [0, 0, -0.3, -0.3, 0.2, 0.2, -0.3],      // spring
    [0.5, 0.5, -0.5, -0.5, -0.5, 0, 0],      // summer
    [0, -0.3, 0, 0.5, 0.3, 0.3, -0.3],       // autumn
    [0, -0.6, -0.6, -0.6, 0, 1, 0],          // winter
  ];
  const LINK = {
    clear:    [0,   1.4, 1.0, 0.8, 0,   0,   0],
    cumulus:  [1.2, 0,   1.0, 0.4, 1.4, 0.6, 0],
    overcast: [0.7, 0.7, 0,   0.8, 2.0, 2.0, 1.0],
    fog:      [1.5, 0.8, 1.0, 0,   0.6, 0.6, 0],
    rain:     [0.8, 1.0, 1.5, 0.9, 0,   0,   0],
    snow:     [1.0, 0.5, 1.4, 0.5, 0,   0,   1.6],
    blizzard: [0.6, 0,   1.0, 0.2, 0,   2.0, 0],
  };
  // ---- transition windows in progress units (0..1 of D), by channel and direction (up = the target is higher)
  function windowOf(k, up, intoPrecip, outOfPrecip) {
    switch (k) {
      case 'cloudCov': case 'overcast': case 'cumulus': return up ? [0, 0.6] : [0.4, 1];       // clouds lead, sky clears last
      case 'cirrus': return up ? [0, 0.5] : [0.25, 0.85];
      case 'fog': return up ? [0.15, 0.8] : [0, 0.6];                                            // fog forms slowly, lifts early
      case 'precip': return up ? [0.4, 1] : [0, 0.55];                                           // lags in, leads out
      case 'heavy': return up ? [0.5, 1] : [0, 0.45];
      case 'gale': return up ? [0.25, 0.8] : [0.15, 0.75];                                       // between clouds and precip
      default: return intoPrecip ? [0, 0.45] : outOfPrecip ? [0.5, 1] : [0.1, 0.9];             // tempOff: precip type set first
    }
  }

  const ch = { cloudCov: 0.6, cumulus: 0, overcast: 0, cirrus: 1, fog: 0, precip: 1, gale: 0, heavy: 0, tempOff: 0, snowFrac: 1 };
  const s = { t: 0, cur: 'snow', next: null, progress: 1, manual: null, nextAt: 0, auto: true, amount: 0.5,
              ch, temp: 0, curtain: 0, white: 0, tail: 0, heading: 0,
              forced: null };   // the legacy forced storm level (?storm=1 / setStorm), null = none
  // the running transition: from-channel values, target state, start time, per-channel windows, heading ease
  // first: the opening snowfall (cold snap, see targetOf), cleared by the first transition
  const tr = { from: {}, to: 'snow', t0: -1e9, win: {}, h0: 0, h1: 0, first: false };
  let wx = null, seed = 1, eventIdx = 0, sf2 = 1;     // sf2: snowFrac before any ?wx override (the rate-limited state)
  S.amountMul = () => 0.2 + 1.6 * s.amount;

  const presetOf = (name, k) => PRESET[name][KEYS.indexOf(k)];
  // the target of a channel. tempOff of a MANUAL (or forced) precipitation pick is pushed so the pick shows what was
  // asked for in any season (a cold snap for snow in summer, a thaw for rain in winter); it follows tSeason live.
  // The opening snowfall (the first weather, until the first transition) is a cold snap too: at least FIRST_COLD
  // below freezing, so the first snow of late autumn falls as crisp, dry Phase-1 crystals (not the wet-snow band
  // around 0 deg C) and settles at once
  function targetOf(name, k) {
    const v = presetOf(name, k);
    if (k === 'tempOff' && tr.first && name === 'snow' && s.manual === null && s.forced === null) return Math.min(v, -FIRST_COLD - S.climate.s.tSeason);
    if (k !== 'tempOff' || (s.manual === null && s.forced === null)) return v;
    const tS = S.climate.s.tSeason;
    if (name === 'snow') return Math.min(v, -0.5 - tS);
    if (name === 'blizzard') return Math.min(v, -2 - tS);
    if (name === 'rain') return Math.max(v, 3.5 - tS);
    return v;
  }
  // temperature feasibility of an automatic draw (a conflicting draw is redrawn = dropped from the row): rain that
  // would fall as snow (T < 1 C), snow that would fall as rain (T > 3 C), blizzard unless it is freezing (T < 0)
  function feasible(name) {
    const tS = S.climate.s.tSeason, T = tS + presetOf(name, 'tempOff');
    if (name === 'rain') return T >= 1;
    if (name === 'snow') return T <= 3;
    if (name === 'blizzard') return s.temp < 0 && T < 1;
    return true;
  }
  // next state from `from` (null: the first weather, no link mask) with the uniform u
  function draw(from, u) {
    const w = S.climate.s.seasonW, p = new Array(7);
    let sum = 0;
    for (let j = 0; j < 7; j++) {
      const row = w[0] * ROW[0][j] + w[1] * ROW[1][j] + w[2] * ROW[2][j] + w[3] * ROW[3][j];
      p[j] = row * (from ? LINK[from][j] : 1) * (feasible(STATES[j]) ? 1 : 0);
      sum += p[j];
    }
    if (sum <= 0) return from === 'clear' ? 'cumulus' : 'clear';     // never happens with the tables above
    let acc = 0;
    for (let j = 0; j < 7; j++) { acc += p[j] / sum; if (u < acc) return STATES[j]; }
    for (let j = 6; j >= 0; j--) if (p[j] > 0) return STATES[j];
  }
  function dwell(i, k, name) {
    const w = S.climate.s.seasonW, j = STATES.indexOf(name);
    const bias = w[0] * DWELL_BIAS[0][j] + w[1] * DWELL_BIAS[1][j] + w[2] * DWELL_BIAS[2][j] + w[3] * DWELL_BIAS[3][j];
    return DWELL[0] + (DWELL[1] - DWELL[0]) * Math.pow(S.rand(seed, i, k), Math.pow(2, -1.5 * bias));
  }
  // the state the weather is heading to (the scheduler's "current" state)
  const target = () => tr.to;

  // start a transition to `name` from the current channel values (instant: settle at once, test / legacy hooks)
  function begin(name, instant) {
    tr.first = false;
    const intoP = !!IS_PRECIP[name], outP = !IS_PRECIP[name] && (IS_PRECIP[tr.to] || ch.precip > 0.01);
    s.cur = s.progress < 0.5 && s.next ? s.cur : tr.to;
    tr.to = name; tr.t0 = instant ? s.t - D : s.t;
    for (const k of KEYS) {
      tr.from[k] = ch[k];
      tr.win[k] = windowOf(k, targetOf(name, k) > ch[k], intoP, outP);
    }
    tr.h0 = s.heading;
    // the new event's gale heading, +-35 deg about the prevailing gale line, eased the short way round
    const h = (S.rand(seed, eventIdx, 2) - 0.5) * 1.2;
    tr.h1 = tr.h0 + Math.atan2(Math.sin(h - tr.h0), Math.cos(h - tr.h0));
    s.next = name; s.progress = 0;
    evalChannels(0, instant);
  }
  // one scheduled event: draw the next state from the current one, and the time of the event after it
  function schedule() {
    const from = target();
    const name = draw(from, S.rand(seed, eventIdx, 0));
    begin(name, false);
    s.nextAt = s.t + dwell(eventIdx, 1, name);
    eventIdx++;
  }
  // resume the scheduler from wherever the weather is (auto back on, a manual pick or forced storm released). The
  // held state's target may differ from its automatic one (tempOff of a manual precipitation pick), so it eases back
  // through a transition of its own; the next scheduled change comes a dwell later
  function resume(wasHeld) {
    if (wasHeld) begin(tr.to, false);
    s.nextAt = s.t + dwell(eventIdx, 3, tr.to);
  }

  // storm whiteout: the plateau sits at ~86% and only gust peaks (a slow beat of two sines) push it to 100%
  function gustPeak(t) { return smooth(0.62, 1.0, 0.5 + 0.5 * (0.6 * Math.sin(t * 0.23 + 2.5) + 0.4 * Math.sin(t * 0.41 + 4.0))); }
  // the transition at s.t -> the channels (+ ?wx) -> temp, snowFrac, curtain, whiteout. dtc: the climate time since
  // the last evaluation (the snowFrac rate limit); snap: settle snowFrac on its temperature value (init, instant picks)
  function evalChannels(dtc, snap) {
    const p = clamp((s.t - tr.t0) / D, 0, 1);
    if (s.forced !== null) {
      // legacy forced storm: snow .. blizzard by the level, at once
      for (const k of KEYS) ch[k] = lerp(targetOf('snow', k), targetOf('blizzard', k), s.forced);
      s.heading = 0;
    } else {
      for (const k of KEYS) { const w = tr.win[k]; ch[k] = lerp(tr.from[k], targetOf(tr.to, k), smooth(w[0], w[1], p)); }
      const gw = tr.win.gale;
      s.heading = lerp(tr.h0, tr.h1, smooth(gw[0], gw[1], p));
    }
    s.progress = p;
    if (p >= 1 && s.next) { s.cur = s.next; s.next = null; }
    S.override(ch, wx);
    s.temp = S.climate.s.tSeason + ch.tempOff;
    const sf = 1 - smooth(1, 3, s.temp), lim = (dtc || 0) / SF_TIME;
    ch.snowFrac = snap || wx ? sf : sf2 + clamp(sf - sf2, -lim, lim);     // the debug hook ?wx snaps too
    if (wx && 'snowFrac' in wx) ch.snowFrac = wx.snowFrac;
    sf2 = ch.snowFrac;
    s.curtain = ch.heavy * ch.snowFrac;
    s.white = s.curtain * (0.86 + 0.14 * gustPeak(S.anim ? S.anim.time : 0));
  }

  S.weather = {
    s,
    init(cfg) {
      wx = cfg.wx; seed = cfg.seed >>> 0; eventIdx = 0;
      s.t = S.climate.s.t; s.auto = cfg.storm !== '0'; s.forced = null; s.amount = 0.5;
      s.manual = null; s.next = null; s.progress = 1; s.tail = 0; s.heading = 0;
      for (const k of KEYS) ch[k] = presetOf('clear', k);
      s.temp = S.climate.s.tSeason + ch.tempOff;
      // the first weather: snow whenever the season allows it (the Phase-1 opening, snow falling on the late-autumn
      // meadow), else a draw from the season row; it starts at full strength
      const first = S.climate.s.tSeason + presetOf('snow', 'tempOff') < 1 ? 'snow' : draw(null, S.rand(seed, 0, 0));
      tr.to = 'clear'; begin(first, true); s.cur = first; s.next = null;
      tr.first = first === 'snow'; evalChannels(0, true);
      s.nextAt = dwell(0, 1, first); eventIdx = 1;
      if (cfg.storm === '1') S.weather.api.setStorm(1);                        // legacy: an instant, held blizzard
      else if (cfg.storm === '0') { begin('clear', true); s.cur = 'clear'; s.next = null; }   // legacy: clear, auto off
      if (cfg.weather) S.weather.api.setWeather(cfg.weather, { instant: true });
      if (!s.auto || s.manual !== null) s.nextAt = 0;
      s.tail = s.curtain;
    },
    step(dtc) {
      s.t = S.climate.s.t;
      if (s.auto && s.manual === null && s.forced === null) {
        // a season change (or pin) can leave an automatic precipitation state on the wrong side of the rain / snow
        // line: end it early instead of labelling rain as snow for the rest of its dwell
        // (not before the minimum dwell)
        if (!s.next && IS_PRECIP[tr.to] && !feasible(tr.to) && !(tr.to === 'blizzard' && s.temp < 0)) s.nextAt = Math.min(s.nextAt, Math.max(s.t, tr.t0 + DWELL[0]));
        if (s.t >= s.nextAt) schedule();
      }
      evalChannels(dtc, false);
      // tail: fast attack (4 s) behind the curtain, slow release (25 s) once it opens
      const tau = s.curtain > s.tail ? 4 : 25;
      s.tail += (s.curtain - s.tail) * (1 - Math.exp(-dtc / tau));
    },
    snapshot: () => ({ weather: { cur: s.cur, next: s.next, progress: +s.progress.toFixed(3), manual: s.manual, nextAt: +s.nextAt.toFixed(2) },
      temp: +s.temp.toFixed(2), snowFrac: +ch.snowFrac.toFixed(4), precip: +ch.precip.toFixed(4), white: +s.white.toFixed(4) }),
    api: {
      // pick a weather state (clear, cumulus, overcast, fog, rain, snow, blizzard): a 60 climate-s transition, then
      // it holds; 'auto' (or null) resumes the scheduler from the current weather. opt.instant settles at once (test
      // and legacy hooks only). Returns the weather snapshot
      setWeather(name, opt) {
        const instant = !!(opt && opt.instant);
        if (name === 'auto' || !name) {
          if (s.manual !== null || s.forced !== null || !s.auto) {
            const held = s.manual !== null || s.forced !== null;
            s.manual = null; s.forced = null; s.auto = true; resume(held);
          }
        } else if (PRESET[name]) {
          const again = s.manual === name && s.forced === null;
          s.forced = null; s.manual = String(name); s.nextAt = 0;
          // a pick of the state the weather is already in still eases (its manual tempOff target may differ)
          if (instant) begin(name, true);
          else if (!again) begin(name, false);
        }
        if (instant) evalChannels(0, true);
        return S.weather.snapshot();
      },
      // legacy (Phase 1): force the storm level 0..1 at once (snow .. blizzard), null = back to automatic weather
      setStorm(v) {
        if (v === null || v === undefined) { if (s.forced !== null) { s.forced = null; s.manual = null; resume(true); } }
        else { s.forced = clamp(+v, 0, 1); s.manual = null; s.nextAt = 0; s.cur = s.forced > 0.5 ? 'blizzard' : 'snow'; s.next = null; tr.to = s.cur; tr.t0 = s.t - D; }
        evalChannels(0, v !== null && v !== undefined);
      },
      // legacy (Phase 1, the 폭설 button): a blizzard now (60 s transition) that ends after dur like a Phase-1 front:
      // the scheduler moves on from it then (unless automatic weather is off)
      triggerBlizzard(dur = 100) {
        s.forced = null; s.manual = null;
        begin('blizzard', false);
        s.nextAt = s.auto ? s.t + Math.max(D + 10, dur) : 0;
      },
      get amount() { return s.amount; }, set amount(v) { s.amount = clamp(+v || 0, 0, 1); S.syncUI(); },
      get auto() { return s.auto; },
      set auto(v) {
        const on = !!v;
        if (on && !s.auto) { s.auto = true; if (s.manual === null && s.forced === null) resume(false); }
        else if (!on) { s.auto = false; s.nextAt = 0; }
        S.syncUI();
      },
    },
  };
})(window.SNOW);
