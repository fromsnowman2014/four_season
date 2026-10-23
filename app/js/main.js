// =====================================================================================
//  main.js — the orchestrator (frozen): the animation clocks, one sim step in the contract order, fastForward /
//  advance, window.snowSim (state() + every sim module's api), the frame loop and boot. The only file with load-time
//  side effects: it boots at the end when a document exists (in node, for tests/sim.mjs, it only registers).
//
//  Per live step (dt real s): input -> climate / weather / ground (dt x speed climate s, substeps <= 0.25 s) -> wind
//  (dt) -> the animation integrals (dt): dispA / dispB here, the derive modules' own (cloud; fallI, tumI, rainI,
//  veilI, veilR, gustR), the tree-sway phase here. Then per frame: S.deriveF() -> S.render().
// =====================================================================================
(function (S) {
  'use strict';
  const { clamp, lerp, camR } = S;
  const cfg = S.cfg;
  const FRAMES = cfg.frames;
  const R = S.R, perf = S.perf;
  const MODS = ['climate', 'weather', 'ground', 'wind'];
  const DERIVE = ['surface', 'precip', 'atmos'];
  const SUB = 0.25;      // the climate substep limit (climate s) and the fastForward / advance step (s)

  // =====================================================================================
  //                                   animation state
  // =====================================================================================
  // Physical time only (never scaled by the climate speed): particle motion, flutter, sway and the twinkle clocks.
  //   time    animation clock (s): shader clocks (uTime, uFlakeT, uTwinkleT), the natural wind, ?fixed frame indices
  //   wall    wall clock (s): UI timers, wake segment ages, bake swap / reveal timing; never fast-forwarded
  //   fps     smoothed frame rate (snowSim.state)
  //   dispA, dispB   integrals of S.wind.s.windA / windB (m): the only wind the particles see (lattice-wrapped)
  //   swayPh  tree-sway phase (rad, wrapped by 2 pi)
  // The derive modules add their own integrals in init() (derive/atmos.js: cloud; derive/precip.js: fallI, tumI,
  // rainI, veilI, veilR, gustR) and advance them in step(dt, ff).
  const anim = S.anim = { time: 0, wall: 0, fps: 60, dispA: [0, 0, 0], dispB: [0, 0, 0], swayPh: 0 };

  S.initSim = function (c) {
    anim.time = 0; anim.wall = 0; anim.dispA = [0, 0, 0]; anim.dispB = [0, 0, 0]; anim.swayPh = 0;
    for (const m of MODS) S[m].init(c);
    for (const k of DERIVE) S.derive[k].init();
  };

  // One sim step of dt real seconds. ff: inside fastForward / advance: no input and no wall clock (the wind steer only
  // decays), the periodic phases (sway, veil / rain-veil scrolls) hold; climate, weather and ground run exactly the
  // live steps, so ?t and snowSim.advance are deterministic
  function simStep(dt, ff) {
    if (!ff) { anim.wall += dt; anim.time += dt; S.stepInput(dt); }
    const dtc = dt * S.climate.s.speed, n = Math.max(1, Math.ceil(dtc / SUB - 1e-9)), h = dtc / n;
    for (let i = 0; i < n; i++) { S.climate.step(h, ff); S.weather.step(h, ff); S.ground.step(h, ff); }
    S.wind.step(dt, ff);
    const wA = S.wind.s.windA, wB = S.wind.s.windB;
    for (let i = 0; i < 3; i++) { anim.dispA[i] += wA[i] * dt; anim.dispB[i] += wB[i] * dt; }
    for (const k of DERIVE) S.derive[k].step(dt, ff);
    if (!ff) {
      const wl = wA[0] * camR[0] + wA[2] * camR[2];
      anim.swayPh = (anim.swayPh + (1.3 + 0.08 * Math.abs(wl)) * dt) % (2 * Math.PI);
    } else anim.time += dt;
  }
  // run T real seconds of sim with the fastForward step (deterministic: ?t at boot, snowSim.advance in the console)
  function advance(T) { for (let t = 0; t < T; t += SUB) simStep(Math.min(SUB, T - t), true); }
  S.simStep = simStep; S.advance = advance;

  // snowSim.state(): the Phase-1 fields first, then every module's snapshot (keys never override earlier ones)
  S.state = function () {
    const wx = S.weather.s, w = S.wind.s;
    const st = { coverage: +S.ground.s.cover.toFixed(4), storm: +wx.curtain.toFixed(4), sky: +wx.ch.overcast.toFixed(4), tail: +wx.tail.toFixed(4),
      windX: +((w.windA[0] + w.windB[0]) / 2).toFixed(3), windZ: +((w.windA[2] + w.windB[2]) / 2).toFixed(3),
      flakeCount: S.precipCount.snow, fps: +anim.fps.toFixed(1), ready: R.readyTime >= 0, amount: wx.amount, auto: wx.auto,
      quality: perf.rs, perfLevel: perf.level, frameMs: +perf.avgMs.toFixed(1), buildMs: Math.round(R.buildMs), compileMs: Math.round(S.compileMs), res: [R.W, R.H], renderRes: [R.Ws, R.Hs] };
    for (const m of MODS) { const snap = S[m].snapshot(); for (const k of Object.keys(snap)) if (!(k in st)) st[k] = snap[k]; }
    st.rainCount = S.precipCount.rain;
    st.g3 = R.g3Fmt;
    return st;
  };
  // window.snowSim: state, advance, and the api of every sim module (accessors kept): climate (setSeason, speed),
  // weather (setWeather, setStorm, triggerBlizzard, amount, auto), ground (setCoverage, reset, resetSnow), wind
  S.makeApi = function () {
    const api = { state: S.state, advance(sec) { advance(Math.max(0, +sec || 0)); return S.state(); } };
    for (const m of MODS) Object.defineProperties(api, Object.getOwnPropertyDescriptors(S[m].api));
    return api;
  };

  // =====================================================================================
  //                                   frame loop + boot
  // =====================================================================================
  let lastNow = 0;
  S.frameNo = 0;
  // one frame: real dt (clamped) -> stripe budget -> fixed step under ?fixed / ?frames -> sim step -> S.F -> render ->
  // quality controller -> chrome
  function frame() {
    if (!FRAMES || S.frameNo + 1 < FRAMES) requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    let dt = clamp(now - lastNow, 0, 0.1); lastNow = now;   // clamp tab switches / stalls
    if (R.bakeFrame) { S.adaptStripe(dt); R.bakeFrame = false; }   // dt is the cost of the previous (stripe) frame
    if (cfg.fixed || FRAMES) dt = 1 / 60;
    if (dt > 0) { anim.fps = lerp(anim.fps, 1 / Math.max(dt, 1e-3), 0.05); }
    simStep(dt, false);
    if (!S.ctxLost) {
      S.deriveF();
      S.render();
      if (!cfg.fixed && R.readyTime >= 0 && anim.wall - R.readyTime > 3 && !R.gbNext) S.controller(dt);
    }
    S.updateUI();
    S.checkSize();            // twice a second: a stale canvas size (a missed resize event on a phone) schedules a resize
    S.frameNo++;
    if (FRAMES && S.frameNo >= FRAMES) window.__done = true;   // test hook: the loop has stopped
  }

  function boot() {
    S.initContext();          // fatal (throws) without WebGL2
    S.bindGLEvents();
    { const [w, h] = S.targetSize(); S.frameCamera(w / h); }       // this viewport's framing before the sim starts (its wind is camera-relative)
    S.initSim(cfg);
    S.bindInput();
    S.bindUI();
    S.syncUI();
    window.snowSim = S.makeApi();
    lastNow = performance.now() / 1000;
    advance(cfg.t0); anim.time = cfg.t0;                           // ?t: the same steps as snowSim.advance
    if (cfg.cover !== null) S.ground.api.setCoverage(cfg.cover);   // ?cover applies after the fast-forward
    try { S.initGL(); } catch (e) { S.fatal('초기화 실패: ' + e.message); }
    requestAnimationFrame(frame);
  }
  if (typeof document !== 'undefined') boot();
})(window.SNOW);
