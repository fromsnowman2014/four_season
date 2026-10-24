// =====================================================================================
//  sim/events.js (Phase-3 owner: lane Z, hazards) — the natural hazards: earthquakes, wildfire smoke and lightning
//  strikes, as deterministic timelines. Pure JS: no GL, no DOM. derive/events.js maps the state to uniforms (the flash,
//  the shake, the smoke look, the bolt geometry), precip.js draws the bolts, the dust and the ash / ember particles.
//
//  S.events = { s, init(cfg), step(dt, ff), snapshot(), api }     (stepped in PHYSICAL seconds, after the wind)
//    s.t         the hazard clock (s since boot; advances in fastForward too, exactly like the live steps)
//    s.auto      hazardsAuto: rare quakes and late-summer / autumn wildfires on their own (default false)
//    s.quake     0..1 the quake envelope now x the event's magnitude (P waves, the S-wave main shock, aftershocks;
//                QUAKE_DUR s), s.quakeT its age (s; -1 = none), s.quakeMag the magnitude 0.6..1, s.quakeN the event's
//                counter (its shake noise, dust plumes and cracks), s.crackT the age of the newest cracks (s; -1 = none:
//                they open with the main shock and fade over CRACK_FADE s)
//    s.smoke     0..1 the wildfire-smoke amount now (ramp in, hold, clear; FIRE_DUR s), s.fireT its age (-1 = none),
//                s.fireN the fire's counter (where its columns stand), s.fireClock the time since it broke out (s; a
//                renewal keeps it running: the columns' animation clock never jumps)
//    s.flash     0..1 the lightning flash envelope now (2-4 return strokes over 0.2-0.8 s), s.strikes the strike count,
//                s.strike the last strike { n, t0, kind, az, dist, u, dur, amp, pulses }:
//                  kind  'cg' cloud-to-ground, 'ic' intra-cloud (a crawler under the deck), 'heat' (a distant flash
//                        below the horizon: a strike triggered under a clear sky)
//                  az    azimuth from the camera's forward (rad, + = right), dist (m): a scene-neutral placement; each
//                        scene maps them (derive/events.js), u: six more uniforms for the scene's placement / shape
//                  dur, amp, pulses [[t (s after t0), amplitude]]: the strokes (fast attack, ~45 ms decay)
//    s.nextAuto  the hazard clock of the next automatic quake (hazardsAuto)
//  Lightning: the weather's ch.lightning (0..1; the 'thunder' state, ?wx=lightning:x) is a strike rate of up to
//  1 / STRIKE_MEAN s. A hazard accumulator integrates the rate; natural strike n fires when it reaches -ln(1 - u_n).
//  Every random number is counter based (S.rand(seed, n, 1000 + k); natural strikes, triggered strikes, quakes, fires
//  and the automatic hazards have counters of their own): UI actions, the scene and the speed never shift the natural
//  sequence, and the same ?seed&t give the same strikes.
//  hazardsAuto: quakes every 30-60 min (physical time, uniform); wildfires through a seasonal hazard rate (late summer
//  and autumn, phase ~.38-.74) normalised to about one fire per year at 1x speed, at least FIRE_GAP s apart.
//  API: trigger('quake' | 'wildfire' | 'strike') starts one now (returns the snapshot; unknown kinds do nothing);
//  hazardsAuto (accessor). Boot hook ?event=quake|wildfire|strike (main.js, after ?t).
// =====================================================================================
(function (S) {
  'use strict';
  const { clamp, smooth } = S;
  const QUAKE_DUR = 15, FIRE_DUR = 180, STRIKE_MEAN = 8, CRACK_FADE = 60;
  const QUAKE_GAP = [1800, 3600];          // s between automatic quakes (uniform)
  const FIRE_GAP = 900;                    // s: no automatic fire within this long after the last one ended
  const KINDS = ['quake', 'wildfire', 'strike'];
  const s = { t: 0, auto: false, quake: 0, quakeT: -1, quakeMag: 0, quakeN: 0, crackT: -1, smoke: 0, fireT: -1, fireN: 0, fireClock: 0,
              flash: 0, strikes: 0, strike: null, nextAuto: 0 };
  // nat: the next natural strike's index (its own counter, so a triggered strike never shifts the natural sequence);
  // man: triggered strikes (indices from 1e5); quakes from 2e6, fires from 3e6, the automatic schedule from 1e6 / 4e6
  let seed = 1, acc = 0, quakeT0 = -1e9, crackT0 = -1e9, fireT0 = -1e9, autoIdx = 0, quakeIdx = 0, fireIdx = 0, nat = 0, man = 0;
  let fireAcc = 0, fireAutoIdx = 0, fireStart = 0;
  const R = (n, k) => S.rand(seed, n, 1000 + k);
  const thr = n => -Math.log(1 - R(n, 0) * 0.999999);
  const sq = x => x * x;

  // quake envelope over its age a (s): P waves (a weak, fast tremor, 0-2.5 s), the S-wave main shock (peak ~3-4.5 s,
  // easing out by ~9 s), two aftershocks (~10.6 and 13 s), all gone by QUAKE_DUR
  function quakeEnv(a) {
    if (a < 0 || a > QUAKE_DUR) return 0;
    const p = 0.25 * smooth(0, 1.2, a);
    const sw = smooth(2.2, 3.2, a) * (1 - smooth(4.5, 9.0, a));
    const af = 0.35 * Math.exp(-sq((a - 10.6) / 0.6)) + 0.2 * Math.exp(-sq((a - 13.0) / 0.5));
    return clamp(Math.max(p * (1 - smooth(2.5, 3.5, a)), sw, af), 0, 1) * (1 - smooth(QUAKE_DUR - 1, QUAKE_DUR, a));
  }
  // smoke over the fire's age: ramp in over 25 s, hold, clear over the last 30 s
  const smokeEnv = a => a < 0 || a > FIRE_DUR ? 0 : smooth(0, 25, a) * (1 - smooth(FIRE_DUR - 30, FIRE_DUR, a));
  // a strike's flash envelope over its age a: its pulses (fast attack, ~45 ms decay; a heat flash flickers softer)
  function flashEnv(st, a) {
    if (!st || a < 0 || a > st.dur + 0.4) return 0;
    const tau = st.kind === 'heat' ? 0.07 : 0.045;
    let e = 0;
    for (const [pt, pa] of st.pulses) if (a >= pt) e += pa * Math.exp(-(a - pt) / tau) * smooth(0, 0.008, a - pt);
    return clamp(e, 0, 1);
  }
  // how cloudy the sky is for a triggered strike: under a clear or fair sky it is a distant heat flash instead
  function cloudy() { const c = S.weather.s.ch; return Math.max(c.overcast, c.precip, 0.8 * c.cumulus * c.cloudCov); }
  // strike n (deterministic from the seed and n): its kind, placement, duration, brightness and return strokes. kind:
  // natural strikes are cloud-to-ground (70%) or intra-cloud; a triggered one under a clear sky is heat lightning
  function makeStrike(n, triggered) {
    const heat = triggered && cloudy() < 0.35;
    const kind = heat ? 'heat' : R(n, 6) < 0.3 ? 'ic' : 'cg';
    const np = 2 + Math.floor(R(n, 4) * 3), dur = (heat ? 0.35 : 0.2) + 0.6 * R(n, 3), pulses = [];
    for (let i = 0; i < np; i++) pulses.push([i === 0 ? 0 : dur * (i / np + 0.15 * (R(n, 10 + i) - 0.5)), i === 0 ? 1 : 0.45 + 0.55 * R(n, 20 + i)]);
    // azimuth: biased toward the middle of the view (most strikes are in frame, some only light the clouds aside)
    const ua = 2 * R(n, 1) - 1, az = 1.25 * Math.sign(ua) * Math.pow(Math.abs(ua), 1.35);
    const u = [R(n, 30), R(n, 31), R(n, 32), R(n, 33), R(n, 34), R(n, 35)];
    return { n, t0: s.t, kind, az, dist: 400 * Math.pow(15, R(n, 2)), u, dur, amp: (heat ? 0.35 : 0.6) + 0.4 * R(n, 5), pulses };
  }
  function fire(n, triggered) { s.strike = makeStrike(n, triggered); s.strikes++; }
  // start a hazard now (no envelope update)
  function start(kind) {
    if (kind === 'quake') {
      // a quake during the main shock of another keeps going (no restart of a shaking frame); its cracks restart
      quakeT0 = s.t; s.quakeN = quakeIdx; s.quakeMag = 0.6 + 0.4 * R(2e6 + quakeIdx, 0); quakeIdx++;
    } else if (kind === 'wildfire') {
      if (s.fireT < 0) { s.fireN = fireIdx++; fireT0 = fireStart = s.t; } else fireT0 = s.t - Math.min(s.fireT, 25);   // renewed without dimming
    } else if (kind === 'strike') fire(1e5 + man++, true);
  }
  // the envelopes at s.t
  function envelopes() {
    const qa = s.t - quakeT0;
    s.quakeT = qa <= QUAKE_DUR ? qa : -1;
    s.quake = quakeEnv(qa) * s.quakeMag;
    // the cracks open with the main shock (2.5 s into the quake) and fade over CRACK_FADE s
    if (qa >= 2.5 && qa < 2.5 + CRACK_FADE && crackT0 < quakeT0 + 2.5) crackT0 = quakeT0 + 2.5;
    s.crackT = s.t - crackT0 >= 0 && s.t - crackT0 <= CRACK_FADE ? s.t - crackT0 : -1;
    s.fireT = s.t - fireT0 <= FIRE_DUR ? s.t - fireT0 : -1;
    s.smoke = smokeEnv(s.t - fireT0);
    s.fireClock = s.fireT >= 0 ? s.t - fireStart : 0;
    s.flash = s.strike ? flashEnv(s.strike, s.t - s.strike.t0) * s.strike.amp : 0;
  }
  // the automatic wildfire's seasonal hazard rate (per physical s): late summer and autumn (phase .38-.74), normalised
  // so that a free-running year at 1x (1200 s) integrates to 2: a fire in ~86% of the years (one at most: FIRE_GAP)
  const FIRE_NORM = 1200 * 0.3 / 2;
  const fireGate = ph => smooth(0.36, 0.44, ph) * (1 - smooth(0.66, 0.75, ph));

  S.events = {
    s,
    init(cfg) {
      seed = cfg.seed >>> 0; acc = 0; quakeT0 = crackT0 = fireT0 = -1e9; autoIdx = 0; quakeIdx = 0; fireIdx = 0; nat = 0; man = 0;
      fireAcc = 0; fireAutoIdx = 0; fireStart = 0;
      Object.assign(s, { t: 0, auto: false, quake: 0, quakeT: -1, quakeMag: 0, quakeN: 0, crackT: -1, smoke: 0, fireT: -1, fireN: 0, fireClock: 0,
        flash: 0, strikes: 0, strike: null, nextAuto: 0 });
    },
    step(dt) {
      s.t += dt;
      // lightning: the weather's strike rate, integrated; natural strike nat fires at its threshold
      const rate = clamp(S.weather.s.ch.lightning || 0, 0, 1) / STRIKE_MEAN;
      if (rate > 0) {
        acc += rate * dt;
        while (acc >= thr(nat)) { acc -= thr(nat); fire(nat++, false); }
      }
      // automatic hazards (off by default): quakes every 30-60 min; wildfires in late summer / autumn
      if (s.auto) {
        if (s.t >= s.nextAuto) {
          start('quake'); autoIdx++;
          s.nextAuto = s.t + QUAKE_GAP[0] + (QUAKE_GAP[1] - QUAKE_GAP[0]) * R(1e6 + autoIdx, 1);
        }
        if (s.fireT < 0 && s.t - fireT0 > FIRE_DUR + FIRE_GAP) {
          fireAcc += fireGate(S.climate.s.phase) / FIRE_NORM * dt;
          if (fireAcc >= -Math.log(1 - R(4e6 + fireAutoIdx, 0) * 0.999999)) { fireAcc = 0; fireAutoIdx++; start('wildfire'); }
        }
      }
      envelopes();
    },
    snapshot: () => ({ hazards: { quake: +s.quake.toFixed(4), smoke: +s.smoke.toFixed(4), flash: +s.flash.toFixed(4), strikes: s.strikes,
      lightning: +(S.weather.s.ch.lightning || 0).toFixed(4), auto: s.auto } }),
    api: {
      // start a hazard now: 'quake' (QUAKE_DUR s; a new one restarts it), 'wildfire' (FIRE_DUR s; a running fire is
      // renewed without dimming), 'strike' (one lightning strike, whatever the weather: a distant heat flash under a
      // clear sky). Returns the snapshot
      trigger(kind) {
        kind = String(kind);
        if (KINDS.includes(kind)) { start(kind); envelopes(); }
        return S.events.snapshot();
      },
      get hazardsAuto() { return s.auto; },
      set hazardsAuto(v) {
        const on = !!v;
        if (on && !s.auto) s.nextAuto = s.t + QUAKE_GAP[0] + (QUAKE_GAP[1] - QUAKE_GAP[0]) * R(1e6 + autoIdx, 1);
        s.auto = on;
        if (S.syncUI) S.syncUI();
      },
    },
  };
})(window.SNOW);
