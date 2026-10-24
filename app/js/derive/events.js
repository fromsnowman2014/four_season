// =====================================================================================
//  derive/events.js (Phase-3 owner: lane Z, hazards) — the hazards' per-frame look: S.events.s (+ the thunder weather)
//  -> S.F, run last by S.deriveF (render.js; after the scene's derive), so it may override what was set before it. The
//  override rule (ARCHITECTURE.md §4): it never mutates an earlier derive's array (S.lighting.*, the house's), it
//  copies it into its own and assigns that; and it assigns nothing at all while no hazard and no thunderstorm runs, so
//  S.F (and the image) is then exactly what the other derives made. Pure JS (no GL, no DOM).
//
//  S.derive.events = { init(), step(dt, ff), frame(F), draw }
//    step   the quake's overscan follower (the zoom eases out after the shaking), the quake's sway kick: the tree-
//           sway phase S.anim.swayPh is pushed back and forth with the shaking (a zero-mean offset, removed as the
//           quake ends; never during a fast-forward), so every tree / palm sways hard through the frozen FS_SHADE path
//    frame  - thunderstorm (ch.lightning): a lower deck (uCloudQ.x); a darker sky, ambient and haze unless the scene's
//             derive owns its storm palette (stormLook: the house; the override order, ARCHITECTURE.md §4)
//           - lightning (S.events.s.strike / flash): the strike placed for this scene and camera (az / dist mapped by
//             the scene: valley strikes on the far ridges, the forest slopes and the wall; house strikes behind the
//             palms and the roofline, a few close; intra-cloud crawlers under the deck; heat flashes far below the
//             horizon), uFlash uFlashPos uFlashFoot, the flash's ambient on uSkyAmb (the baked AO and normals of every
//             surface), on uSkyZen / uSkyHor (the rain streaks and the sky light) and on uFogCol (the lit rain haze);
//             the bolt geometry for the bolt draw (draw.bolt: a branching world-space channel, cached per strike)
//           - earthquake: uQuake (offset, roll, intensity), uQuakeZ (overscan zoom, motion blur), the particles'
//             parallax jitter (draw.jitter, precip.js), the dust plumes (draw.dust), the crack decals (uCrack, uCrackQ)
//           - wildfire smoke: the atmosphere override (an orange-brown haze, a dim red sun, a sepia sky, lower contrast,
//             no snow sparkle), uSmoke, uSmokeSun (the veiled sun disc in view), uFire / uFireQ (the far fire's glow
//             and smoke columns: valley behind the left massif, house over the backyard trees), the ash / ember rates
//    draw   what precip.js draws after the precipitation: { bolt, dust, jitter } (null when off)
// =====================================================================================
(function (S) {
  'use strict';
  const { clamp, smooth, lerp } = S;
  // ---- hazard uniforms (always assigned; neutral while their hazard is off)
  const flash = new Float32Array(4), flashPos = new Float32Array([0, 1500, 4000, 0]), flashFoot = new Float32Array(4);
  const quake = new Float32Array(4), quakeZ = new Float32Array([1, 0, 0, 0]);
  const smokeU = new Float32Array(4), smokeSun = new Float32Array(4), fireU = new Float32Array(4), fireQ = new Float32Array(4);
  const crack = new Float32Array(4), crackQ = new Float32Array(4);
  // ---- overrides of earlier derives (own arrays: copied from F, modified, assigned back)
  const ov = { uSkyAmb: new Float32Array(3), uSkyZen: new Float32Array(3), uSkyHor: new Float32Array(3), uFogCol: new Float32Array(3),
    uHorBand: new Float32Array(3), uSunCol: new Float32Array(3), uFogP: new Float32Array(4), uCloudQ: new Float32Array(4),
    uGrade: new Float32Array(3), uGradeP: new Float32Array(3) };
  function own(F, k) { const a = ov[k], src = F[k]; if (src !== a) for (let i = 0; i < a.length; i++) a[i] = src[i]; F[k] = a; return a; }
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  // ---- the scenes' hazard staging (camera-relative: the house lane may move things; the strikes, fire and cracks
  // follow its camera)
  const SCENE = {
    valley: {
      footY: -1400, lightFootY: -300,           // the drawn channel ends deep under the terrain (the G-buffer depth test
                                                // cuts it where it meets a slope, a ridge or the wall); its light from above -300 m
      D0: 2200,                                 // flash distance scale (m)
      crack: { ahead: 520, side: 40, radius: 520, cell: 22 },
      fire: { az: -0.42, half: 0.2, base: 0.06 }, sun: { az: -0.12, el: 0.12 },
      haze: 1 / 8000,                           // smoke haze density at the ground (1/m; stage 2b: 1/5200 -> 1/8000, the massif and the columns read through the orange air)
    },
    house: {
      footY: -3, lightFootY: 0, D0: 700,
      crack: { ahead: 12.5, side: 1.5, radius: 15, cell: 1.15 },
      fire: { az: 0.24, half: 0.2, base: 0.15 }, sun: { az: -0.1, el: 0.3 },
      haze: 1 / 1100,
    },
  };
  const sceneCfg = () => SCENE[S.sceneId] || SCENE.valley;
  // the camera's horizontal frame (unit forward / right in xz) and its horizontal half-fov
  const cf = [0, 1], cr = [1, 0];
  function camFrame() {
    const fl = Math.hypot(S.camF[0], S.camF[2]) || 1;
    cf[0] = S.camF[0] / fl; cf[1] = S.camF[2] / fl; cr[0] = S.camR[0]; cr[1] = S.camR[2];
    const asp = S.R && S.R.W ? S.R.W / S.R.H : 16 / 9;
    return Math.atan(S.TANH * asp);
  }
  const dirAt = az => [cf[0] * Math.cos(az) + cr[0] * Math.sin(az), cf[1] * Math.cos(az) + cr[1] * Math.sin(az)];
  // the scene's landscape (16:9) framing, found once per scene by a dry run of its frameCamera (the camera state is
  // restored exactly): the far fire, the veiled sun and the cracks are fixed in the world (behind the massif, over
  // the backyard trees, on the street), whatever the aspect (a phone's portrait camera turns / steps back)
  const land = { id: '', pos: [0, 0, 0], f: [0, 1], r: [1, 0] };
  function landFrame() {
    if (land.id === S.sceneId) return land;
    const C = S.CAM, keep = { pos: C.pos.slice(), yaw: C.yaw, pitch: C.pitch, fovY: C.fovY, tanH: S.TANH };
    S.scene.frameCamera(16 / 9);
    const fl = Math.hypot(S.camF[0], S.camF[2]) || 1;
    land.pos = C.pos.slice(); land.f = [S.camF[0] / fl, S.camF[2] / fl]; land.r = [S.camR[0], S.camR[2]]; land.id = S.sceneId;
    S.setCamera(keep.pos, keep.yaw, keep.pitch, keep.tanH, keep.fovY);
    return land;
  }
  const landDir = az => [land.f[0] * Math.cos(az) + land.r[0] * Math.sin(az), land.f[1] * Math.cos(az) + land.r[1] * Math.sin(az)];

  // =====================================================================================
  //                                   lightning
  // =====================================================================================
  // the strike placed in this scene: kind, the light segment (top / foot or the crawler's ends), the drawn segment
  const place = { key: '', kind: 0, top: [0, 0, 0], foot: [0, 0, 0], lfoot: [0, 0, 0], dist: 1000 };
  function placeStrike(st, F) {
    const sc = sceneCfg(), cam = S.CAM.pos, hh = camFrame(), u = st.u, house = S.sceneId === 'house';
    const base = F.uCloudQ[0];
    const az = st.az * hh;                      // st.az is in [-1.25, 1.25] half-fovs: most strikes in frame
    const d2 = dirAt(az);
    place.kind = st.kind === 'heat' ? 2 : st.kind === 'ic' ? 1 : 0;
    if (place.kind === 2) {
      // a heat flash: a distant storm 40-90 km out, below the horizon (its glow only)
      const d = 40000 + 50000 * u[0], y = cam[1] + d * (0.01 + 0.03 * u[1]);
      place.top = [cam[0] + d2[0] * d, y, cam[2] + d2[1] * d]; place.foot = place.top.slice(); place.lfoot = place.top.slice(); place.dist = d;
      return;
    }
    if (place.kind === 1) {
      // an intra-cloud crawler under the deck: across the view, 1.5-5 km long, a few km out
      const d = house ? 2500 + 5000 * u[0] : 3000 + 6000 * u[0], len = house ? 1500 + 2500 * u[1] : 2000 + 3000 * u[1];
      const y = base - 60 - 160 * u[2];
      const ang = (u[3] - 0.5) * 1.2, ax = cr[0] * Math.cos(ang) + cf[0] * Math.sin(ang), az2 = cr[1] * Math.cos(ang) + cf[1] * Math.sin(ang);
      const cx = cam[0] + d2[0] * d, cz = cam[2] + d2[1] * d;
      place.top = [cx - ax * len / 2, y, cz - az2 * len / 2]; place.foot = [cx + ax * len / 2, y, cz + az2 * len / 2];
      place.lfoot = place.foot; place.dist = d;
      return;
    }
    // cloud to ground: valley 0.7-6.3 km (the forest slopes, the far ridges, the wall, the far valley); house behind
    // the trees and the roofline
    const lt = Math.log(st.dist / 400) / Math.log(15);
    // (house: most bolts 2-6 km out, whole from the deck base to the trees; some 0.3-1 km, tall and bright, their
    // tops above the frame; one in ~7 very close)
    const d = house ? (u[0] < 0.14 ? 90 + 140 * u[1] : u[0] < 0.4 ? 300 * Math.pow(3.3, lt) : 2000 * Math.pow(3, lt)) : 700 * Math.pow(9, lt);
    const tx = cam[0] + d2[0] * d, tz = cam[2] + d2[1] * d, ty = base + 40 + 140 * u[2];
    // the channel leans (stage 2b: a near strike leans in proportion to its distance, so it stays where its azimuth put
    // it instead of swinging across or out of the frame)
    const lk = Math.min(1, 1.5 * d / (ty - sc.footY));
    const h = ty - sc.footY, la = (u[3] - 0.5) * 0.45 * h * lk, lb = (u[4] - 0.5) * 0.3 * h * lk;
    place.top = [tx, ty, tz];
    place.foot = [tx + cr[0] * la + cf[0] * lb, sc.footY, tz + cr[1] * la + cf[1] * lb];
    const f = (sc.lightFootY - ty) / (sc.footY - ty);
    place.lfoot = [lerp(tx, place.foot[0], f), sc.lightFootY, lerp(tz, place.foot[2], f)];
    place.dist = d;
  }

  // ---- the bolt: a branching channel as strands of points (uBolt[] in precip.js: xyz + w = level x 4 + start x 2 +
  // intensity (0..0.999)); a segment joins point i to i + 1 unless i + 1 starts a strand
  const MAXP = 160;                        // = uBolt[160] in VS_BOLT
  const bolt = { n: 0, pts: new Float32Array(MAXP * 4), I: new Float32Array(4), C: new Float32Array(4), key: '' };
  let np = 0;
  function push(p, lev, start, inten) {
    if (np >= MAXP) return false;
    const o = np * 4;
    bolt.pts[o] = p[0]; bolt.pts[o + 1] = p[1]; bolt.pts[o + 2] = p[2];
    bolt.pts[o + 3] = lev * 4 + (start ? 2 : 0) + clamp(inten, 0, 0.999);
    np++;
    return true;
  }
  // midpoint displacement from a to b over L levels (2^L segments): each midpoint moves across the segment by
  // rough x its length (vertical moves scaled by vy: a crawler stays flat)
  function mpd(a, b, L, rough, rnd, vy) {
    let P = [a, b];
    const g = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
    for (let l = 0; l < L; l++) {
      // coarse levels wander more (the channel's big zigzags), fine levels kink
      const rl = rough * (1.35 - 0.1 * l);
      const Q = [P[0]];
      for (let i = 0; i < P.length - 1; i++) {
        const p = P[i], q = P[i + 1];
        const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], len = Math.hypot(dx, dy, dz) || 1;
        const d = [dx / len, dy / len, dz / len];
        // two unit vectors across d
        let u1 = Math.abs(d[1]) < 0.9 ? [d[2], 0, -d[0]] : [0, -d[2], d[1]];
        const l1 = Math.hypot(u1[0], u1[1], u1[2]) || 1; u1 = [u1[0] / l1, u1[1] / l1, u1[2] / l1];
        const u2 = [d[1] * u1[2] - d[2] * u1[1], d[2] * u1[0] - d[0] * u1[2], d[0] * u1[1] - d[1] * u1[0]];
        const a1 = g() * rl * len, a2 = g() * rl * len;
        Q.push([(p[0] + q[0]) / 2 + u1[0] * a1 + u2[0] * a2, (p[1] + q[1]) / 2 + (u1[1] * a1 + u2[1] * a2) * vy, (p[2] + q[2]) / 2 + u1[2] * a1 + u2[2] * a2], q);
      }
      P = Q;
    }
    return P;
  }
  function genBolt(st) {
    const rnd = S.mulberry32(S.hash32((S.cfg.seed >>> 0) * 7919 + st.n * 131 + 17));
    np = 0;
    const T = place.top, B = place.foot;
    if (place.kind === 1) {
      // crawler: a flat, long main strand with many horizontal branches, a few short feelers hanging down
      const main = mpd(T, B, 6, 0.2, rnd, 0.35);
      main.forEach((p, i) => push(p, 0, i === 0, 0.85 - 0.25 * Math.abs(i / (main.length - 1) - 0.5)));
      const len = Math.hypot(B[0] - T[0], B[2] - T[2]);
      for (let k = 0; k < 9 && np < MAXP - 17; k++) {
        const o = main[4 + Math.floor(rnd() * (main.length - 8))];
        const ang = rnd() * 6.283, bl = len * (0.12 + 0.22 * rnd()), drop = rnd() < 0.3 ? bl * (0.3 + 0.5 * rnd()) : bl * 0.05;
        const e = [o[0] + Math.cos(ang) * bl, o[1] - drop, o[2] + Math.sin(ang) * bl];
        const br = mpd(o, e, 4, 0.24, rnd, 0.5);
        br.forEach((p, i) => push(p, 1, i === 0, 0.6 * (1 - i / br.length) + 0.06));
      }
    } else {
      const main = mpd(T, B, 6, 0.21, rnd, 1);
      main.forEach((p, i) => push(p, 0, i === 0, 0.95));
      // branch lengths from the channel's visible height (to the light foot: the drawn foot is deep under the terrain)
      const H = T[1] - B[1], Hv = T[1] - place.lfoot[1], dn = [(B[0] - T[0]) / H, -1, (B[2] - T[2]) / H];
      const nb = 4 + Math.floor(rnd() * 4);
      const subs = [];
      for (let k = 0; k < nb && np < MAXP - 17; k++) {
        const fi = 0.06 + 0.62 * rnd(), i0 = Math.floor(fi * (main.length - 1)), o = main[i0];
        const ang = rnd() * 6.283, side = 0.45 + 0.9 * rnd();
        let dx = dn[0] + Math.cos(ang) * side, dy = -1, dz = dn[2] + Math.sin(ang) * side;
        const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
        const bl = Hv * (0.07 + 0.2 * rnd()) * Math.sqrt(1 - fi);
        const e = [o[0] + dx * bl, o[1] + dy * bl, o[2] + dz * bl];
        const br = mpd(o, e, 4, 0.26, rnd, 1);
        br.forEach((p, i) => push(p, 1, i === 0, 0.62 * (1 - i / br.length) + 0.05));
        if (rnd() < 0.6) subs.push([br, bl]);
      }
      for (const [br, bl] of subs) {
        if (np > MAXP - 9) break;
        const o = br[3 + Math.floor(rnd() * 8)], ang = rnd() * 6.283, sl = bl * (0.3 + 0.35 * rnd());
        const e = [o[0] + Math.cos(ang) * sl * 0.7, o[1] - sl * 0.75, o[2] + Math.sin(ang) * sl * 0.7];
        const sb = mpd(o, e, 3, 0.28, rnd, 1);
        sb.forEach((p, i) => push(p, 2, i === 0, 0.38 * (1 - i / sb.length) + 0.04));
      }
    }
    bolt.n = np;
  }

  // =====================================================================================
  //                                   earthquake
  // =====================================================================================
  // the shake (closed form in the quake's age tau): a low-frequency sway (the S waves) and a fast jitter (strongest in
  // the P waves), plus roll; amplitudes in uv (x: of the width, y: of the height) and rad, times the envelope
  const QA = { x: [0.0072, 0.0026], y: [0.004, 0.0034], r: [0.0055, 0.0014] };
  let qseed = 1;
  const nz = (k, x) => S.vn1(qseed + k * 101, x);
  const hfK = tau => 1 + 1.2 * (1 - smooth(2.4, 3.6, tau));
  const lfK = tau => 0.15 + 0.85 * smooth(1.8, 3.2, tau);
  function shake(tau, e, out) {
    const h = hfK(tau), l = lfK(tau);
    out[0] = e * (QA.x[0] * l * nz(1, tau * 1.6) + QA.x[1] * h * nz(2, tau * 7.9));
    out[1] = e * (QA.y[0] * l * nz(3, tau * 2.0) + QA.y[1] * h * nz(4, tau * 10.7));
    out[2] = e * (QA.r[0] * l * nz(5, tau * 0.85) + QA.r[1] * h * nz(6, tau * 4.6));
  }
  const sh0 = [0, 0, 0], sh1 = [0, 0, 0];
  let eZ = 0, swayKick = 0;                // the overscan follower; the sway phase offset applied so far
  const jitter = new Float32Array(3);
  const dust = { on: false, t: 0, seed: 0, kind: 0, k: 0, col: new Float32Array(4) };
  const ROCK_DUST = [0.44, 0.42, 0.39], STREET_DUST = [0.5, 0.45, 0.38], POWDER = [0.82, 0.86, 0.92];

  // =====================================================================================
  //                                   wildfire smoke
  // =====================================================================================
  // smoke optical depth through the sun's path: red survives, blue does not
  const SMOKE_T = [0.8, 1.55, 2.5];        // (stage 2b: redder)
  const SMOKE_TINT = [0.7, 0.36, 0.15];

  const draw = { bolt: null, dust: null, jitter: null };
  S.derive.events = {
    draw,
    init() { eZ = 0; swayKick = 0; bolt.key = ''; bolt.n = 0; },
    step(dt, ff) {
      const ev = S.events.s;
      const e = ev.quake;
      eZ = e > eZ ? e : eZ * Math.exp(-dt / 1.1);
      if (eZ < 1e-4) eZ = 0;
      if (ff) return;
      // the sway kick: the tree-sway phase follows the shaking (zero-mean, returns to the plain phase as it ends)
      let k = 0;
      if (ev.quakeT >= 0) { qseed = S.hash32((S.cfg.seed >>> 0) + 7777 * (ev.quakeN + 1)); k = Math.min(1, e * 1.4) * 1.8 * nz(9, ev.quakeT * 2.7); }
      if (k !== swayKick) { S.anim.swayPh += k - swayKick; swayKick = k; }
    },
    frame(F) {
      const ev = S.events.s, ch = S.weather.s.ch, sc = sceneCfg(), house = S.sceneId === 'house';
      const rain = ch.precip * (1 - ch.snowFrac);
      flash.fill(0); flashFoot.fill(0); flashPos[0] = 0; flashPos[1] = 1500; flashPos[2] = 4000; flashPos[3] = 0;
      quake.fill(0); quakeZ[0] = 1; quakeZ[1] = quakeZ[2] = quakeZ[3] = 0;
      smokeU.fill(0); smokeSun.fill(0); fireU.fill(0); fireQ.fill(0); crack.fill(0); crackQ.fill(0);
      draw.bolt = null; draw.dust = null; draw.jitter = null;

      // ---- thunderstorm: a darker, lower deck (the lightning channel eases in and out with the weather). A scene derive
      // that owns its storm palette (stormLook: the house's dusk already darkens for ch.lightning) keeps it; the deck
      // still lowers (the strikes start from it)
      const lg = clamp(ch.lightning || 0, 0, 1);
      const sd = S.scene && S.scene.derive ? S.derive[S.scene.derive] : null;
      if (lg > 0) {
        const g = smooth(0, 1, lg);
        if (!(sd && sd.stormLook)) {
          for (const k of ['uSkyAmb', 'uSkyZen', 'uSkyHor', 'uFogCol', 'uHorBand']) {
            const a = own(F, k), m = 1 - (k === 'uSkyAmb' ? 0.3 : k === 'uSkyZen' ? 0.42 : 0.42) * g;
            a[0] *= m; a[1] *= m; a[2] *= m * (1 + 0.04 * g);    // a slightly bluer, darker storm light
          }
          // (stage 2b) and the exposure keeps it dark: derive/atmos lifts a dark rain day (up to x1.55), which turned
          // the valley's thunderstorm into a bright, hazy rain day; a storm reads heavier than rain, and the strokes pop
          F.uExposure *= 1 - 0.22 * g;
          const sn = own(F, 'uSunCol'); for (let i = 0; i < 3; i++) sn[i] *= 1 - 0.35 * g;   // the deck swallows the sun
          own(F, 'uGradeP')[1] += 0.08 * g;                     // a little more contrast under the storm
        }
        own(F, 'uCloudQ')[0] *= 1 - 0.2 * g;                    // the deck hangs lower (~920 m under the storm)
      }

      // ---- lightning
      const st = ev.strike, age = st ? ev.t - st.t0 : 1e9;
      if (st && age >= 0 && age < st.dur + 0.7) {
        placeStrike(st, F);
        const fc = [0.78, 0.86, 1.0];                           // cool white
        // the camera's distance from the channel (its nearest point) sets how bright the flash is here
        const T = place.top, L = place.kind === 0 ? place.lfoot : place.foot, cam = S.CAM.pos;
        const ab = [T[0] - L[0], T[1] - L[1], T[2] - L[2]], ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
        const hc = clamp(((cam[0] - L[0]) * ab[0] + (cam[1] - L[1]) * ab[1] + (cam[2] - L[2]) * ab[2]) / ab2, 0, 1);
        const dc = Math.hypot(L[0] + ab[0] * hc - cam[0], L[1] + ab[1] * hc - cam[1], L[2] + ab[2] * hc - cam[2]);
        const kd = place.kind === 2 ? 0.5 : (place.kind === 1 ? 0.75 : 1) / (1 + Math.pow(dc / sc.D0, 1.5));
        const I = ev.flash * kd;
        if (I > 0) {
          for (let i = 0; i < 3; i++) flash[i] = fc[i] * I * 2.6;
          flash[3] = ev.flash;
          flashPos[0] = T[0]; flashPos[1] = T[1]; flashPos[2] = T[2]; flashPos[3] = Math.sqrt(ab2);
          flashFoot[0] = L[0]; flashFoot[1] = L[1]; flashFoot[2] = L[2]; flashFoot[3] = place.kind;
          // the flash's ambient (every surface through its AO and normals), the sky light (what the rain drops and the
          // wet ground mirror: the lit deck; the clouds' gaps) and the lit rain haze
          const ka = place.kind === 2 ? 0.04 : 1;
          const amb = own(F, 'uSkyAmb'), zen = own(F, 'uSkyZen'), hor = own(F, 'uSkyHor'), fog = own(F, 'uFogCol');
          for (let i = 0; i < 3; i++) {
            amb[i] += fc[i] * I * 0.9 * ka; zen[i] += fc[i] * I * 2.0 * ka; hor[i] += fc[i] * I * 2.2 * ka; fog[i] += fc[i] * I * 0.4 * ka;
          }
        }
        // the bolt: the channel glows through every stroke (the main channel; the branches mostly in the first),
        // with a faint continuing current and a short warm afterglow
        if (place.kind !== 2) {
          const key = st.n + ':' + S.sceneId + ':' + S.CAM.pos.join(',') + ':' + S.camF.join(',');
          if (key !== bolt.key) { genBolt(st); bolt.key = key; }
          const cc = st.amp * (age < st.dur ? 0.12 * (1 - 0.5 * age / st.dur) : Math.max(0, 0.06 * (1 - (age - st.dur) / 0.5)));
          const main = ev.flash + cc, br = st.amp * Math.exp(-age / 0.06) + 0.3 * ev.flash;
          bolt.I[0] = main; bolt.I[1] = br; bolt.I[2] = 0.8; bolt.I[3] = 9;
          // the cooling channel: warmer while the continuing current dominates
          const warm = cc / (cc + ev.flash + 1e-4);
          bolt.C[0] = 1.0; bolt.C[1] = 1 - 0.18 * warm; bolt.C[2] = 1 - 0.45 * warm; bolt.C[3] = F.uCloudQ[0];
          if (main > 0.002) draw.bolt = bolt;
          // (stage 2b) the stroke blooms: the channel's glare spreads over the clouds and the rain around it
          F.uBloomStr += 0.4 * clamp(ev.flash * st.amp, 0, 1);
        }
      }

      // ---- earthquake: the shake, its overscan and blur, the particles' parallax, the dust, the cracks
      if (ev.quakeT >= 0 || eZ > 0) {
        const tau = Math.max(ev.quakeT, 0), e = ev.quake;
        qseed = S.hash32((S.cfg.seed >>> 0) + 7777 * (ev.quakeN + 1));
        if (ev.quakeT >= 0 && e > 0) {
          shake(tau, e, sh0); shake(tau - 1 / 60, e, sh1);
          quake[0] = sh0[0]; quake[1] = sh0[1]; quake[2] = sh0[2]; quake[3] = e;
          quakeZ[1] = sh0[0] - sh1[0]; quakeZ[2] = sh0[1] - sh1[1];
          // the parallax of a shaking camera: the nearest particles move most (a ~2 cm translation)
          for (let i = 0; i < 3; i++) jitter[i] = -(S.camR[i] * sh0[0] + S.camU[i] * sh0[1]) * 1.6;
          draw.jitter = jitter;
        }
        // the overscan zoom: keeps the shaken, rolled frame's edges out of view (a bound of the shake's amplitude)
        const asp = S.R && S.R.W ? S.R.W / S.R.H : 16 / 9, h = hfK(tau), l = lfK(tau);
        const bx = eZ * (QA.x[0] * l + QA.x[1] * h), by = eZ * (QA.y[0] * l + QA.y[1] * h), br = eZ * (QA.r[0] * l + QA.r[1] * h);
        const m = Math.max(bx + br * 0.5 / asp, by + br * 0.5 * asp);
        quakeZ[0] = eZ > 0 ? 1 / (1 - 2 * (m + 0.003 * smooth(0, 0.05, eZ))) : 1;   // (+ room for the blur taps)
        // the house's window / porch / street-lamp light flickers with the shaking (the wiring shakes; a few short
        // drop-outs in the main shock). §1 lets this lane scale uCozy; lane H may take it over in its own shading
        // (S.derive.house.quakeFlicker = true) and read uQuake instead
        if (house && ev.quakeT >= 0 && e > 0 && typeof F.uCozy === 'number' && !(S.derive.house && S.derive.house.quakeFlicker)) {
          const fl = 0.5 + 0.5 * nz(11, tau * 9.0), drop = smooth(0.55, 0.8, nz(12, tau * 3.1)) * smooth(0.5, 0.8, e);
          F.uCozy *= 1 - clamp(e * 1.2, 0, 1) * (0.55 * (1 - fl) + 0.4 * drop);
        }
      }
      // dust: from the main shock for ~40 s (plumes stream down the cliffs / puff off the street edges, then settle)
      const qa = ev.quakeT >= 0 ? ev.quakeT : -1;
      if (ev.crackT >= 0 && ev.crackT < 38 || qa >= 2.4) {
        dust.on = true; dust.t = ev.crackT >= 0 ? ev.crackT : qa - 2.5; dust.seed = S.hash32((S.cfg.seed >>> 0) * 31 + ev.quakeN + 5) >>> 8;
        dust.kind = house ? 1 : 0;
        // what the ground gives: dry ground dust; wet ground little; under snow the house's street stays still, while
        // the valley's cliffs shed powder snow instead of rock flour (white plumes)
        const g = S.ground.s, surf = S.derive.surface;
        const snowy = house ? smooth(0.1, 0.5, surf.visCover) : smooth(0.15, 0.7, surf.coverAt(1300));
        dust.k = ev.quakeMag * (1 - 0.65 * smooth(0.1, 0.8, g.wet)) * (house ? 1 - snowy : 1 + 0.3 * snowy);
        for (let i = 0; i < 3; i++) dust.col[i] = house ? STREET_DUST[i] : lerp(ROCK_DUST[i], POWDER[i], snowy);
        if (dust.k > 0.01) draw.dust = dust;
      }
      // the cracks: open with the main shock in a few tenths of a second, fade over a minute
      if (ev.crackT >= 0) {
        const c = sc.crack, L = landFrame(), cam = L.pos;
        const cx = cam[0] + L.f[0] * c.ahead + L.r[0] * c.side, cz = cam[2] + L.f[1] * c.ahead + L.r[1] * c.side;
        const ang = (S.rand(S.cfg.seed, 2e6 + ev.quakeN, 7) - 0.5) * 0.7;
        crack[0] = cx; crack[1] = cz; crack[2] = c.radius;
        crack[3] = smooth(0, 0.5, ev.crackT) * (1 - smooth(18, 60, ev.crackT));
        crackQ[0] = L.r[0] * Math.cos(ang) + L.f[0] * Math.sin(ang); crackQ[1] = L.r[1] * Math.cos(ang) + L.f[1] * Math.sin(ang);
        crackQ[2] = c.cell; crackQ[3] = house ? 1 : 0;
      }

      // ---- wildfire smoke (rain dampens it: washes the haze, quenches the embers)
      F.uAshRate = 0; F.uEmberRate = 0;
      if (ev.smoke > 0) {
        const sm = ev.smoke * (1 - 0.45 * smooth(0, 0.6, rain));
        const sun = own(F, 'uSunCol'), amb = own(F, 'uSkyAmb'), zen = own(F, 'uSkyZen'), hor = own(F, 'uSkyHor');
        const band = own(F, 'uHorBand'), fog = own(F, 'uFogCol'), fogP = own(F, 'uFogP'), grade = own(F, 'uGrade'), gp = own(F, 'uGradeP');
        const lA = lum(amb), lZ = lum(zen), lH = lum(hor), lS = lum(sun);
        for (let i = 0; i < 3; i++) {
          // the sun through the smoke: dim and red; the sky light scattered by the smoke: brown-orange
          sun[i] = lerp(sun[i], sun[i] * Math.exp(-SMOKE_T[i]), sm);
          // (stage 2b: the 2020 orange sky rather than a beige fog: a saturated amber-orange low sky and haze under a
          // dark rust pall overhead, warm orange-brown ambient light, a warmer grade)
          amb[i] = lerp(amb[i], (lA * 1.0 + 0.03 * lS) * [1.34, 0.92, 0.58][i], sm);
          zen[i] = lerp(zen[i], Math.max(lZ, 0.18) * [1.25, 0.72, 0.4][i] * 0.5, sm);
          hor[i] = lerp(hor[i], Math.max(lH, 0.25) * [1.8, 0.82, 0.28][i], sm);
          band[i] = lerp(band[i], Math.max(lH, 0.25) * [1.95, 0.86, 0.26][i], sm);
          fog[i] = lerp(fog[i], Math.max(lum(fog), 0.22) * [1.7, 0.8, 0.3][i] * 0.76, sm);
          grade[i] *= lerp(1, [1.06, 0.98, 0.88][i], sm);
        }
        fogP[0] = lerp(fogP[0], Math.max(fogP[0], sc.haze), sm);
        // (stage 2b) the smoke lies low: half the haze's scale height, so the sky darkens from the glowing orange low down
        // to the rust-brown pall overhead (the sky pixel sees the zenith colour through the thinner smoke up there)
        fogP[1] = lerp(fogP[1], 0.5 * fogP[1], sm);
        gp[0] += 0.06 * sm;                                    // a little muted (stage 2b: was .24, a washed sepia)
        gp[1] *= 1 - 0.2 * sm;                                 // lower contrast
        gp[2] *= 1 - smooth(0, 0.25, sm);                      // no snow sparkle in the smoke
        F.uExposure *= 1 - 0.14 * sm;                           // (stage 2b: a dimmer, deeper orange day; was x1.15, a bright ochre)
        smokeU[0] = SMOKE_TINT[0]; smokeU[1] = SMOKE_TINT[1]; smokeU[2] = SMOKE_TINT[2]; smokeU[3] = sm;
        // the veiled sun disc and the far fire, fixed in the scene (relative to its landscape framing)
        landFrame();
        const sd = landDir(sc.sun.az), ce = Math.sqrt(1 - sc.sun.el * sc.sun.el);
        smokeSun[0] = sd[0] * ce; smokeSun[1] = sc.sun.el; smokeSun[2] = sd[1] * ce;
        smokeSun[3] = sm * (1 - 0.85 * smooth(0.3, 0.9, ch.overcast));
        const fd = landDir(sc.fire.az);
        fireU[0] = fd[0]; fireU[1] = fd[1]; fireU[2] = sc.fire.half; fireU[3] = sm * (1 - 0.6 * smooth(0.3, 0.9, ch.overcast));
        // the columns lean downwind (the natural wind across the fire's direction)
        const w = S.wind.s.natural, across = w[0] * (-fd[1]) + w[2] * fd[0];
        fireQ[0] = sc.fire.base; fireQ[1] = clamp(across * 0.08, -0.9, 0.9); fireQ[2] = ev.fireClock; fireQ[3] = (ev.fireN * 0.37) % 1;
        F.uAshRate = ev.smoke * (1 - 0.6 * smooth(0, 0.6, rain));
        F.uEmberRate = Math.pow(ev.smoke, 1.5) * Math.pow(1 - smooth(0, 0.5, rain), 2);
      }

      F.uFlash = flash; F.uFlashPos = flashPos; F.uFlashFoot = flashFoot; F.uQuake = quake; F.uQuakeZ = quakeZ;
      F.uSmoke = smokeU; F.uSmokeSun = smokeSun; F.uFire = fireU; F.uFireQ = fireQ; F.uCrack = crack; F.uCrackQ = crackQ;
      F.uDustRate = draw.dust ? 1 : 0;
    },
  };
})(window.SNOW);
