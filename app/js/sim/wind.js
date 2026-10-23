// =====================================================================================
//  sim/wind.js (stage-1 owner: lane A) — the wind. Pure JS: no GL, no DOM (the pointer arrives through S.mouse).
//  natural: closed form in the animation clock and the seed. A breeze whose direction veers slowly about the
//  prevailing line (seeded 1D value noise S.vn1, ~+-50 deg over minutes) and whose speed follows the season and
//  the Phase-1 gust beat, blended into the gale by smooth(ch.gale) along the event's gale line (the Phase-1 line,
//  rotated by the weather heading and partly by the veer).
//  steer: ONLY while the left button is held (S.mouse.drag), the drag velocity becomes a horizontal wind: screen
//  right -> camR, screen up -> away from the camera (camF on the ground), 10 m/s per viewport per second, capped
//  at 14 m/s, fast attack (0.12 s; easing 1.5 s when the drag slows). After release it decays with a 15 s
//  half-life. Plain pointer motion (no button) never changes the wind.
//  windA / windB follow natural + steer with 1.1 s / 0.4 s lags.
//
//  S.wind = { s, init(cfg), step(dt, ff), snapshot(), api }     (stepped in PHYSICAL seconds, after the ground)
//    s.windA, s.windB   [x, y, z] m/s, the slow and the quick wind response. Flakes mix them affinely; main.js
//                       integrates them into S.anim.dispA / dispB (the only positional wind the particles see)
//    s.target           the wind target of this step (natural + steer)
//    s.natural          [x, 0, z] the natural part of the target (breeze / gale, no steer): what clouds follow
//    s.steer            [x, 0, z] the user's drag wind (m/s)
//    s.bias, s.gust     the steer along camR and along the ground-projected camF (m/s)
//    s.baseWind         the calm base wind: [0.9, 0, 0.35] or ?wind=X,Z (a ?wind base does not veer)
//  Reads S.anim.time, S.climate.s.seasonW, S.weather.s.ch.gale / s.heading and S.mouse (drag, vxn, vyn).
//  ff (fastForward / advance): no pointer (the steer only decays); otherwise the same step.
// =====================================================================================
(function (S) {
  'use strict';
  const { lerp, smooth, camR, camF } = S;
  const STEER_K = 10, STEER_MAX = 14, STEER_HALF = 15;   // m/s per (viewport / s); cap m/s; release half-life s
  const SEASON_SPEED = [1.35, 0.85, 1.15, 1.0];          // breeze speed factor: spring, summer, autumn, winter
  // the ground-projected camF, refreshed per step: the camera is re-framed per aspect ratio (S.frameCamera mutates
  // camR / camF in place), and the steer and the gale line follow the view
  const fwd = [0, 0, 1];
  function setFwd() { const l = Math.hypot(camF[0], camF[2]); fwd[0] = camF[0] / l; fwd[2] = camF[2] / l; }
  const s = { windA: [0, 0, 0], windB: [0, 0, 0], target: [0, 0, 0], natural: [0, 0, 0], steer: [0, 0, 0], bias: 0, gust: 0, baseWind: [0.9, 0, 0.35] };
  let seed = 1, veers = true, baseAng = 0, baseMag = 1;

  // the natural wind at time t (s.natural)
  function natural(t) {
    const wx = S.weather.s, w = S.climate.s.seasonW;
    // direction: the prevailing line veering slowly (two octaves of seeded value noise, periods ~90 s and ~25 s)
    const veer = veers ? 0.75 * S.vn1(seed * 31 + 7, t / 90) + 0.2 * S.vn1(seed * 31 + 8, t / 25) : 0;
    const ang = baseAng + veer;
    // speed: the season, the Phase-1 gust beat, and slower seeded lulls / freshening
    const g1 = Math.sin(t * 0.37) * 0.5 + Math.sin(t * 0.91 + 1.3) * 0.3 + Math.sin(t * 2.3 + 0.4) * 0.2;
    const sp = baseMag * (w[0] * SEASON_SPEED[0] + w[1] * SEASON_SPEED[1] + w[2] * SEASON_SPEED[2] + w[3] * SEASON_SPEED[3])
      * (1 + 0.45 * g1) * (1 + 0.3 * S.vn1(seed * 31 + 9, t / 40));
    const cx = Math.cos(ang) * sp, cz = Math.sin(ang) * sp;
    // gale: slow swell (g2) times a phase-modulated gust train (1.3 / 2.9 / 6.1 rad/s beat), along the Phase-1 gale
    // line (mostly screen-right, a little away from the camera) turned by the event heading and 40% of the veer
    const g2 = Math.sin(t * 0.53 + 2.0) * 0.45 + Math.sin(t * 1.37 + 0.7) * 0.35 + Math.sin(t * 3.1) * 0.2;
    const gustTrain = 1 + 0.22 * Math.sin(t * 1.3 + 0.9) + 0.14 * Math.sin(t * 2.9 + 1.8) + 0.08 * Math.sin(t * 6.1);
    const mag = (10.5 + 3.0 * g2) * gustTrain;
    const gx = camR[0] * 0.88 + camF[0] * 0.3, gz = camR[2] * 0.88 + camF[2] * 0.3;
    const h = wx.heading + 0.4 * veer, c = Math.cos(h), sn = Math.sin(h);
    let sx = gx * c - gz * sn, sz = gx * sn + gz * c;
    const l = Math.hypot(sx, sz); sx /= l; sz /= l;
    const ss = smooth(0, 1, wx.ch.gale);
    s.natural[0] = lerp(cx, sx * mag, ss); s.natural[1] = 0; s.natural[2] = lerp(cz, sz * mag, ss);
  }
  // the drag steer: follows the drag velocity while the button is held, decays after release
  function steer(dt, ff) {
    const m = S.mouse, st = s.steer;
    if (!ff && m && m.drag) {
      let tx = (m.vxn || 0) * STEER_K * camR[0] + (m.vyn || 0) * STEER_K * fwd[0];
      let tz = (m.vxn || 0) * STEER_K * camR[2] + (m.vyn || 0) * STEER_K * fwd[2];
      const tl = Math.hypot(tx, tz);
      if (tl > STEER_MAX) { tx *= STEER_MAX / tl; tz *= STEER_MAX / tl; }
      const k = 1 - Math.exp(-dt / (Math.hypot(tx, tz) > Math.hypot(st[0], st[2]) ? 0.12 : 1.5));
      st[0] += (tx - st[0]) * k; st[2] += (tz - st[2]) * k;
    } else {
      const k = Math.pow(0.5, dt / STEER_HALF);
      st[0] *= k; st[2] *= k;
    }
    s.bias = st[0] * camR[0] + st[2] * camR[2];
    s.gust = st[0] * fwd[0] + st[2] * fwd[2];
  }

  S.wind = {
    s,
    init(cfg) {
      const w = cfg.wind;
      veers = !(w.length === 2 && w.every(isFinite));
      s.baseWind = veers ? [0.9, 0, 0.35] : [w[0], 0, w[1]];
      baseAng = Math.atan2(s.baseWind[2], s.baseWind[0]); baseMag = Math.hypot(s.baseWind[0], s.baseWind[2]);
      seed = cfg.seed >>> 0;
      s.steer = [0, 0, 0]; s.bias = 0; s.gust = 0;
      natural(S.anim.time);
      s.target = [...s.natural]; s.windA = [...s.natural]; s.windB = [...s.natural];
    },
    step(dt, ff) {
      setFwd();
      natural(S.anim.time);
      steer(dt, ff);
      const kA = 1 - Math.exp(-dt / 1.1), kB = 1 - Math.exp(-dt / 0.4);
      for (let i = 0; i < 3; i++) {
        s.target[i] = s.natural[i] + s.steer[i];
        s.windA[i] += (s.target[i] - s.windA[i]) * kA;
        s.windB[i] += (s.target[i] - s.windB[i]) * kB;
      }
    },
    snapshot: () => ({ wind: { x: +((s.windA[0] + s.windB[0]) / 2).toFixed(3), z: +((s.windA[2] + s.windB[2]) / 2).toFixed(3), steer: +Math.hypot(s.steer[0], s.steer[2]).toFixed(3) } }),
    api: {},
  };
})(window.SNOW);
