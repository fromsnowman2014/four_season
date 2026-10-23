// =====================================================================================
//  perf.js — the adaptive quality ladder (frame-time controller) and the bake stripe budget. Registers only.
// =====================================================================================
(function (S) {
  'use strict';
  // Adaptive quality ladder, cheapest visual loss first: render scale 1 -> .87 -> .74 -> .6, then fewer cloud steps,
  // then fewer flakes. Per 90-frame window it compares the mean dt with the window's 10th-percentile dt (the display's
  // own frame period when the GPU keeps up): a slow mean that is also jittery above that floor is a GPU that cannot
  // keep up. A rung down is followed by two windows of cooldown; a run of windows at the display's cadence steps back up
  // (the run required doubles after each step down), so a transient blizzard cannot pin the calm scene low.
  // Two guards for phones (vsync-locked 60 Hz displays):
  //  - The ladder never climbs back into a rung it had to leave after climbing into it: a step down out of a rung that
  //    was reached by a step up makes the rung below the ceiling (minLevel) until the next resize / context restore.
  //    A step up is also judged on the very next window (a cadence clearly worse than before steps straight back), so
  //    a failed probe costs one window. Without this a GPU on the edge flapped between two rungs every ~2 minutes for
  //    ever; now every rung is re-entered at most once and the ladder settles.
  //  - A slow but steady cadence (<= ~38 fps, no jitter) is either a 30 Hz display / a low-power or throttled frame
  //    rate (nothing to gain) or a GPU that misses every vsync (a vsync-locked phone shows a steady 30 fps, which the
  //    jitter test alone takes for a 30 Hz display). One probe at the cheapest rung tells them apart: if the cadence
  //    improves the ladder stays there and climbs back rung by rung (each step judged); if not it returns and never
  //    probes again (slowOK) until the next resize.
  const PERF_RS = [1, 0.87, 0.74, 0.6];
  const PERF_WIN = 90;
  const TOP = 5;
  const perf = S.perf = { level: 0, rs: 1, skySteps: 36, flakeMul: 1, n: 0, cool: 0, good: 0, goodNeed: 10, skip: 0,
                          frameMs: 1000 / 60, avgMs: 0, dts: new Float32Array(PERF_WIN),
                          minLevel: 0, upMs: 0, cameUp: false, probeFrom: -1, probeMs: 0, probeMin: 0, slowOK: false };
  function setLevel(level) {
    if (level > perf.level && perf.cameUp) perf.minLevel = Math.max(perf.minLevel, perf.level + 1);   // left a rung it had climbed into
    perf.cameUp = level < perf.level;
    perf.level = level;
    perf.skySteps = level >= 4 ? 22 : 36;
    perf.flakeMul = level >= 5 ? 0.7 : 1;
    const rs = PERF_RS[Math.min(level, 3)];
    if (rs !== perf.rs) { perf.rs = rs; S.allocScaled(); }
  }
  S.resetPerf = function () {   // the GPU budget changed (new canvas size / restored context): start the ladder over
    perf.level = 0; perf.rs = 1; perf.skySteps = 36; perf.flakeMul = 1;
    perf.n = 0; perf.cool = 0; perf.good = 0; perf.skip = 2;
    perf.minLevel = 0; perf.upMs = 0; perf.cameUp = false; perf.probeFrom = -1; perf.slowOK = false;
  };
  // Stripe budget, from the wall dt of the frame that drew the previous stripe (the browser queues GPU work a frame or
  // two deep, so the feedback lags that much; growth is slow enough not to overshoot far). The stripe grows while its
  // frame stays inside the limit and shrinks hard when it overruns (then grows gently). First load, with nothing else
  // to show: frames up to 34 ms (a 30 Hz display's own frames pass; the reveal takes ~1-2 s on an M-series GPU).
  // Rebake behind a live scene: the frame must stay close to the display's own frame period (perf.frameMs)
  S.adaptStripe = function (dt) {
    const R = S.R;
    const base = perf.frameMs / 1000;
    const limit = R.gbCur ? Math.max(1.35 * base, base + 0.006) : 0.034;
    if (dt > limit) { R.gbRows = Math.max(1, Math.floor(R.gbRows * 0.6)); R.gbMiss = true; }
    else R.gbRows = Math.min(Math.ceil(R.gbRows * (R.gbMiss ? 1.03 : 1.15)), Math.ceil(R.H / 6));
  };
  // quality controller (see perf), once per PERF_WIN frames of a ready, bake-free scene; the 2 frames after a bake are
  // skipped (they still carry the last stripe). perf.frameMs, the display's frame period estimate, also sets the
  // rebake stripe budget (adaptStripe)
  S.controller = function (dt) {
    if (perf.skip > 0) { perf.skip--; return; }
    perf.dts[perf.n++] = dt;
    if (perf.n < PERF_WIN) return;
    perf.n = 0;
    let sum = 0; for (let i = 0; i < PERF_WIN; i++) sum += perf.dts[i];
    perf.dts.sort();                                           // Float32Array: numeric
    const floor = Math.max(4, perf.dts[PERF_WIN / 10] * 1000), avg = sum / PERF_WIN * 1000;
    perf.frameMs = floor; perf.avgMs = avg;
    if (perf.probeFrom >= 0) {               // the window after a steady-slow probe at the cheapest rung
      const from = perf.probeFrom; perf.probeFrom = -1; perf.good = 0;
      if (avg >= 0.8 * perf.probeMs) { setLevel(from); perf.minLevel = perf.probeMin; perf.cameUp = false; perf.slowOK = true; perf.skip = 2; }   // not the GPU: back as it was, no more probes
      return;                                // else the GPU was the limit: stay, climb back with the usual good runs
    }
    if (perf.upMs > 0) {                     // the window after a step up
      const was = perf.upMs; perf.upMs = 0;
      if (avg > 1.15 * was && avg > 18) { setLevel(perf.level + 1); perf.skip = 2; perf.good = 0; return; }
    }
    if (perf.cool > 0) { perf.cool--; return; }
    if (avg > 21.5 && avg > 1.2 * floor) {
      perf.good = 0;
      if (perf.level < TOP) { setLevel(perf.level + 1); perf.cool = 2; perf.goodNeed = Math.min(80, perf.goodNeed * 2); }
    } else if (avg > 26 && !perf.slowOK && perf.level < TOP) {
      perf.probeFrom = perf.level; perf.probeMs = avg; perf.probeMin = perf.minLevel; perf.good = 0; setLevel(TOP); perf.skip = 2;
    } else if (avg <= 1.02 * floor && perf.level > perf.minLevel) {
      if (++perf.good >= perf.goodNeed) { perf.upMs = avg; setLevel(perf.level - 1); perf.good = 0; perf.skip = 2; }
    } else perf.good = 0;
  };
})(window.SNOW);
