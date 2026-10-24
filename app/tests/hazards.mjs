// The natural hazards (Phase-3 owner: lane Z): thunderstorms + lightning, earthquakes, wildfire smoke.
//   node app/tests/hazards.mjs [--only node,render,parity,det,leak,fps] [--out DIR] [--ref FILE] [--gate 60]
// node (no browser):
//   - thunder's Markov edges: the automatic chain draws exactly the Phase-2 states at the Phase-2 times (compared with
//     the Phase-2 copy, git f311fc6 via tests/ref.mjs; a missing copy fails): an event differs only by being shown as a thunderstorm;
//     thunderstorms come mostly in summer / late spring, never in winter, never twice in a row; the thunder preset;
//   - determinism: the same ?seed&t give the same strikes (kind, placement, strokes) and the same hazard uniforms,
//     bolt geometry and shake; a triggered strike / quake / fire never shifts the natural strikes;
//   - envelopes: the quake (P waves, the main shock, aftershocks; the overscan zoom 1.02-1.04 at the peak, exactly 1
//     and no offset once it has eased out), the strokes (2-4 over 0.2-0.8 s), the smoke (20-30 s ramp, ~180 s), the
//     cracks (open with the main shock, gone after ~60 s); a heat flash under a clear sky;
//   - the override rule: with no hazard and no thunder every S.F entry is the other derives' own (the same objects);
//     after a quake, a fire or a strike has ended, S.F is bit-identical to a run that never had one; the override order
//     under a thunderstorm (stage 2a, ARCHITECTURE.md §4): the valley's sky darkened by the events, the house keeping its
//     own storm dusk (its derive's stormLook), both decks lowered;
//   - hazardsAuto: quakes 30-60 min apart; wildfires only in late summer / autumn, about one a year at 1x; seeded.
// browser (headless Chrome on the real GPU, ?frames captures):
//   render  every hazard in both scenes (valley, house) renders with zero console errors and visibly changes the frame
//           (a strike's flash, the quake's shake / dust / cracks, the smoke); a strike in clear weather is a heat flash;
//   parity  with no hazard the valley is pixel-identical to the Phase-2 copy (3 states; max 0, capture noise retried);
//   det     a strike and a quake at fixed frames give identical images twice;
//   leak    hazards over many cycles and scene switches create no GL object (textures, framebuffers, programs);
//   fps     (only with --only fps: since stage 2a these rows are part of the performance gate, tests/fps.mjs 'hz ...',
//           which all.sh runs) uncapped fps >= --gate (60) at 1920x1080 dpr 2 for each hazard x scene (thunder with a
//           strike every 0.4 s, the quake's main shock, full smoke with ash and embers), quality rung 0. Judge on a quiet
//           machine.
import { capture, open } from './cdp.mjs';
import { phase2Dir } from './ref.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..'), APP = path.join(APP_DIR, 'index.html');
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const ONLY = opt('only', ''), want = k => !ONLY || ONLY.split(',').includes(k);
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'snow-hazards')));
const GATE = +opt('gate', 60);
fs.mkdirSync(OUT, { recursive: true });
// the Phase-2 copy: --ref, else the one tests/ref.mjs extracts from git (f311fc6); null fails the checks that need it
function findRef() {
  if (opt('ref')) return path.resolve(opt('ref'));
  const d = phase2Dir();
  return d ? path.join(d, 'index.html') : null;
}
const REF = findRef();
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails++; };
const info = m => console.log('info ' + m);

// ------------------------------------------------------------------------------------------------ node
const scriptsOf = dir => [...fs.readFileSync(path.join(dir, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
function boot(dir, q = '') {
  const ctx = vm.createContext({ window: { location: { search: q ? '?' + q : '' } }, URLSearchParams, console });
  for (const f of scriptsOf(dir)) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  const S = ctx.window.SNOW;
  S.cfg.date = new Date(2026, 9, 22);
  S.initSim(S.cfg);
  S.advance(S.cfg.t0); S.anim.time = S.cfg.t0;
  if (S.cfg.cover !== null) S.ground.api.setCoverage(S.cfg.cover);
  S.api = S.makeApi();
  return S;
}
const flat = v => typeof v === 'number' ? v : v && v.length !== undefined ? Array.from(v) : v;
const bundle = S => { S.deriveF(); const o = {}; for (const [k, v] of Object.entries(S.F)) if (k !== 'uNoise') o[k] = flat(v); return JSON.stringify(o); };
const HAZ_U = ['uFlash', 'uFlashPos', 'uFlashFoot', 'uQuake', 'uQuakeZ', 'uSmoke', 'uSmokeSun', 'uFire', 'uFireQ', 'uCrack', 'uCrackQ'];

if (want('node')) {
  // ---- thunder's Markov edges
  {
    const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
    const share = SEASONS.map(() => ({})), late = { n: 0, thunder: 0 };
    let mism = 0, events = 0, storms = 0, twice = 0, compared = false;
    for (let seed = 1; seed <= 4; seed++) {
      const A = boot(APP_DIR, `seed=${seed * 17}&season=0`), B = REF ? boot(path.dirname(REF), `seed=${seed * 17}&season=0`) : null;
      for (const S of B ? [A, B] : [A]) { S.api.setSeason(null); S.api.speed = 8; }
      let prev = null;
      for (let i = 0; i < 10 * 600; i++) {
        A.advance(0.25); if (B) B.advance(0.25);
        const ta = A.weather.s.next || A.weather.s.cur, ph = A.climate.s.phase, si = Math.floor(ph * 4) % 4;
        share[si][ta] = (share[si][ta] || 0) + 1;
        if (ph > 0.14 && ph < 0.25) { late.n++; if (ta === 'thunder') late.thunder++; }
        if (ta !== prev) { events++; if (ta === 'thunder') { storms++; if (prev === 'thunder') twice++; } prev = ta; }
        if (B) {
          compared = true;
          const tb = B.weather.s.next || B.weather.s.cur;
          if (!(ta === tb || (ta === 'thunder' && (tb === 'rain' || tb === 'overcast'))) || A.weather.s.nextAt !== B.weather.s.nextAt) mism++;
        }
      }
    }
    const pct = (si, k) => { const t = Object.values(share[si]).reduce((x, y) => x + y, 0); return (share[si][k] || 0) / t; };
    if (compared) ok(!mism, `thunder's Markov edges keep the Phase-2 chain: every event at the Phase-2 time with the Phase-2 (base) state (4 seeds x 10 years at 8x, ${events} events)`, mism ? `${mism} mismatching steps` : '');
    else ok(false, 'the Phase-2 copy (git f311fc6, tests/ref.mjs) exists for the Markov-chain comparison');
    ok(storms > 4 && pct(1, 'thunder') > 0.04 && pct(3, 'thunder') === 0 && pct(1, 'thunder') > 4 * pct(2, 'thunder') && late.thunder > 0 && !twice,
      `thunderstorms come on their own, mostly in summer / late spring (${storms} storms; summer ${(100 * pct(1, 'thunder')).toFixed(1)}%, late spring ${(100 * late.thunder / late.n).toFixed(1)}%, autumn ${(100 * pct(2, 'thunder')).toFixed(1)}%, winter 0), never twice in a row`);
    const T = boot(APP_DIR, 'seed=4&season=summer&weather=thunder');
    const c = T.weather.s.ch;
    ok(T.state().weather.cur === 'thunder' && c.lightning === 1 && c.precip >= 0.8 && c.gale >= 0.6 && c.overcast === 1 && c.snowFrac === 0,
      `the thunder preset: heavy rain ${c.precip}, gusts ${c.gale}, a full deck, lightning 1`);
  }
  // ---- determinism and counter independence
  {
    const A = boot(APP_DIR, 'seed=9&season=summer&weather=thunder&t=200'), B = boot(APP_DIR, 'seed=9&season=summer&weather=thunder&t=200');
    const C = boot(APP_DIR, 'seed=10&season=summer&weather=thunder&t=200');
    const sig = S => JSON.stringify([S.events.s.strikes, S.events.s.strike]);
    ok(sig(A) === sig(B) && sig(A) !== sig(C) && A.events.s.strikes > 10, `strikes are deterministic (${A.events.s.strikes} in 200 s; the same seed identical, another seed differs)`);
    // the hazard uniforms + the bolt geometry right after a triggered strike, twice
    const look = S => { S.api.trigger('strike'); S.advance(0.03); const f = bundle(S); const b = S.derive.events.draw.bolt; return f + (b ? Array.from(b.pts.slice(0, b.n * 4)).join(',') : 'none'); };
    const D = boot(APP_DIR, 'seed=9&season=summer&weather=thunder&t=50'), E = boot(APP_DIR, 'seed=9&season=summer&weather=thunder&t=50');
    const ld = look(D);
    ok(ld === look(E) && D.derive.events.draw.bolt && D.derive.events.draw.bolt.n > 60, `a strike's flash, uniforms and bolt (${D.derive.events.draw.bolt && D.derive.events.draw.bolt.n} points) are deterministic`);
    const N = boot(APP_DIR, 'seed=9&wx=lightning:1');
    N.advance(60); N.api.trigger('strike'); N.api.trigger('quake'); N.api.trigger('wildfire'); N.advance(140);
    const M = boot(APP_DIR, 'seed=9&wx=lightning:1'); M.advance(200);
    ok(JSON.stringify(N.events.s.strike) === JSON.stringify(M.events.s.strike) && N.events.s.strikes === M.events.s.strikes + 1,
      'a triggered strike, quake and fire never shift the natural strikes');
    // the shake is a function of the quake's age: two runs agree frame by frame
    const Q1 = boot(APP_DIR, 'seed=3'), Q2 = boot(APP_DIR, 'seed=3');
    let same = true;
    for (const S of [Q1, Q2]) S.api.trigger('quake');
    for (let i = 0; i < 60; i++) { Q1.simStep(1 / 30, false); Q2.simStep(1 / 30, false); if (bundle(Q1) !== bundle(Q2)) same = false; }
    ok(same, 'the quake (shake, zoom, blur, cracks) is deterministic frame by frame');
  }
  // ---- envelopes
  {
    const E = boot(APP_DIR, 'seed=7&season=summer&weather=clear');
    E.api.trigger('quake');
    const env = [], zoom = [], off = [];
    for (let t = 0; t < 30; t += 0.1) { E.simStep(0.1, false); E.deriveF(); env.push(E.events.s.quake); zoom.push(E.F.uQuakeZ[0]); off.push(Math.hypot(E.F.uQuake[0], E.F.uQuake[1])); }
    const peak = Math.max(...env), pAt = env.indexOf(peak) * 0.1, zMax = Math.max(...zoom);
    const p1 = Math.max(...env.slice(0, 22)), af = Math.max(...env.slice(95, 140));
    ok(p1 > 0.05 && p1 < 0.35 && pAt > 2.5 && pAt < 6 && af > 0.1 && af < peak && env[155] === 0,
      `quake: P waves ${p1.toFixed(2)}, the main shock ${peak.toFixed(2)} at ${pAt.toFixed(1)} s, aftershocks ${af.toFixed(2)}, over by 15 s`);
    ok(zMax >= 1.015 && zMax <= 1.045 && zoom[zoom.length - 1] === 1 && off[off.length - 1] === 0 && Math.max(...off) > 0.004,
      `the overscan zoom peaks at ${zMax.toFixed(3)} (1.02-1.04 class) while shaking, then exactly 1 with no offset; the shake reaches ${(Math.max(...off) * 100).toFixed(1)}% of the frame`);
    // no frame edge ever shows: the four output corners, shaken (zoom, roll, offset) and blurred (+- half the motion),
    // stay inside the rendered frame at every 1/60 s of three quakes, landscape and portrait
    let outside = 0, worst = 1;
    for (const [w, h] of [[1920, 1080], [390, 844]]) for (const sd of [1, 2, 3]) {
      const Z = boot(APP_DIR, `seed=${sd}`); Z.R.W = w; Z.R.H = h; Z.api.trigger('quake');
      const asp = w / h;
      for (let i = 0; i < 17 * 60; i++) {
        Z.simStep(1 / 60, false); Z.deriveF();
        const q = Z.F.uQuake, z = Z.F.uQuakeZ, cr = Math.cos(q[2]), sr = Math.sin(q[2]);
        for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (const b of [-0.5, 0.5]) {
          const cx = (u - 0.5) * asp / z[0], cy = (v - 0.5) / z[0];
          const x = (cr * cx - sr * cy) / asp + 0.5 + q[0] + b * z[1], y = sr * cx + cr * cy + 0.5 + q[1] + b * z[2];
          if (q[3] > 0) worst = Math.min(worst, x, y, 1 - x, 1 - y);
          if (x < 0 || x > 1 || y < 0 || y > 1) outside++;
        }
      }
    }
    ok(!outside, `no frame edge shows while shaking (3 quakes, 16:9 and a portrait phone; closest corner ${(worst * 100).toFixed(2)}% inside)`);
    // the house's lights flicker with the shaking (uCozy), and only while it shakes
    const Hq = boot(APP_DIR, 'seed=7&season=autumn&weather=rain'); Hq.useScene('house'); Hq.frameCamera(16 / 9);
    Hq.deriveF(); const cz0 = Hq.F.uCozy; Hq.api.trigger('quake');
    const cz = []; for (let i = 0; i < 18 * 30; i++) { Hq.simStep(1 / 30, false); Hq.deriveF(); cz.push(Hq.F.uCozy); }
    const czMin = Math.min(...cz.slice(60, 200)), czEnd = cz[cz.length - 1];
    ok(cz0 > 0.5 && czMin < 0.6 * cz0 && czEnd === cz0, `the house's window light flickers in the main shock (uCozy ${cz0.toFixed(2)} -> ${czMin.toFixed(2)}) and is steady again after it`);
    // cracks: open with the main shock, fade over ~60 s
    const C = boot(APP_DIR, 'seed=7'); C.api.trigger('quake');
    const cr = [];
    for (let t = 0; t < 70; t += 1) { C.advance(1); C.deriveF(); cr.push(C.F.uCrack[3]); }
    ok(cr[1] === 0 && cr[4] > 0.9 && cr[30] > 0.2 && cr[30] < 0.9 && cr[64] === 0, `cracks open with the main shock (${cr[4].toFixed(2)} at 5 s) and fade (${cr[30].toFixed(2)} at 31 s, gone by 65 s)`);
    // strokes
    const L = boot(APP_DIR, 'seed=7&season=summer&weather=thunder');
    let bad = 0;
    for (let i = 0; i < 40; i++) {
      L.api.trigger('strike'); const st = L.events.s.strike;
      if (!(st.pulses.length >= 2 && st.pulses.length <= 4 && st.dur >= 0.2 && st.dur <= 0.8 && st.pulses.every(p => p[0] >= 0 && p[0] <= st.dur) && st.kind !== 'heat')) bad++;
    }
    ok(!bad, 'every strike has 2-4 strokes within 0.2-0.8 s; under a storm a triggered strike is a bolt');
    const H = boot(APP_DIR, 'seed=7&season=summer&weather=clear'); H.api.trigger('strike');
    ok(H.events.s.strike.kind === 'heat', 'under a clear sky a triggered strike is a distant heat flash');
    // smoke
    const W = boot(APP_DIR, 'seed=7&season=autumn&weather=clear'); W.api.trigger('wildfire');
    const sm = [];
    for (let t = 0; t < 185; t += 1) { W.advance(1); sm.push(W.events.s.smoke); }
    const r50 = sm.findIndex(v => v >= 0.5), r99 = sm.findIndex(v => v >= 0.99);
    const o50 = sm.findIndex((v, i) => i > 100 && v <= 0.5), o01 = sm.findIndex((v, i) => i > 100 && v <= 0.01);
    ok(r50 >= 8 && r50 <= 16 && r99 >= 18 && r99 <= 30 && sm[100] === 1 && sm[183] === 0 && o01 - sm.findIndex((v, i) => i > 100 && v < 0.99) <= 31,
      `smoke ramps in over ${r99 + 1} s (half at ${r50 + 1} s), holds, clears over the last ~30 s (half at ${o50 + 1} s), gone by 180 s`);
    W.api.trigger('wildfire'); W.advance(60); W.deriveF();
    ok(W.F.uSmoke[3] > 0.9 && W.F.uAshRate > 0.9 && W.F.uEmberRate > 0.9 && W.F.uGradeP[2] === 0 && W.F.uSmokeSun[3] > 0.5 && W.F.uFire[3] > 0.5,
      'full smoke: the haze, ash, embers, the veiled sun and the far fire; no snow sparkle');
    const WR = boot(APP_DIR, 'seed=7&season=autumn&weather=rain'); WR.api.trigger('wildfire'); WR.advance(60); WR.deriveF();
    ok(WR.F.uSmoke[3] < 0.7 && WR.F.uEmberRate < 0.05 && WR.F.uAshRate < 0.6, `rain dampens the fire (smoke ${WR.F.uSmoke[3].toFixed(2)}, embers ${WR.F.uEmberRate.toFixed(3)})`);
  }
  // ---- the override rule
  {
    const A = boot(APP_DIR, 'seed=5&season=summer&weather=clear&t=40');
    A.deriveF();
    const L = A.lighting;
    ok(A.F.uSkyAmb === L.amb && A.F.uSunCol !== undefined && A.F.uFogCol === L.fog && A.F.uFogP === L.fogP && HAZ_U.every(k => k in A.F) && A.F.uQuakeZ[0] === 1,
      'with no hazard and no thunder derive/events.js overrides nothing (S.F holds the atmosphere\'s own arrays) and its uniforms are neutral');
    for (const [kind, end] of [['quake', 120], ['wildfire', 240], ['strike', 30]]) {
      const X = boot(APP_DIR, 'seed=5&season=summer&weather=clear'), Y = boot(APP_DIR, 'seed=5&season=summer&weather=clear');
      X.advance(10); Y.advance(10); X.api.trigger(kind); X.advance(end); Y.advance(end);
      ok(bundle(X) === bundle(Y), `after a ${kind} has ended S.F is bit-identical to a run that never had one`);
    }
    // the override order (stage 2a, ARCHITECTURE.md §4): atmos -> the scene's derive -> events. A scene derive that
    // owns its storm palette (the house: stormLook) keeps it under a thunderstorm; the valley's sky is darkened by the
    // events; both get the lower deck. The transient hazards then compose over whatever palette is current: a flash
    // adds light, the smoke recolours it, the quake flickers the house's lights (checked above)
    const look = id => {
      const T = boot(APP_DIR, 'seed=4&season=summer&weather=thunder&t=30'); T.useScene(id); T.frameCamera(16 / 9);
      for (let i = 0; i < 600 && T.events.s.flash > 0; i++) T.simStep(1 / 60, false);    // (between strokes)
      const ev = T.derive.events.frame; T.derive.events.frame = () => {}; T.deriveF();
      const before = { zen: flat(T.F.uSkyZen), amb: flat(T.F.uSkyAmb), deck: T.F.uCloudQ[0] };
      T.derive.events.frame = ev; T.deriveF();
      return { before, zen: flat(T.F.uSkyZen), amb: flat(T.F.uSkyAmb), deck: T.F.uCloudQ[0], flash: T.events.s.flash };
    };
    const lv = look('valley'), lh = look('house');
    ok(lv.flash === 0 && lh.flash === 0 && lv.zen[2] < 0.7 * lv.before.zen[2] && lv.amb[2] < 0.8 * lv.before.amb[2] && JSON.stringify(lh.zen) === JSON.stringify(lh.before.zen)
      && JSON.stringify(lh.amb) === JSON.stringify(lh.before.amb) && lv.deck < 0.85 * lv.before.deck && lh.deck < 0.85 * lh.before.deck,
      `the override order under a thunderstorm: the valley's sky darkened by the events (zenith ${lv.before.zen[2].toFixed(3)} -> ${lv.zen[2].toFixed(3)}), the house keeps its own storm dusk (stormLook), both decks lower (${lv.before.deck.toFixed(0)} -> ${lv.deck.toFixed(0)} m, ${lh.before.deck.toFixed(0)} -> ${lh.deck.toFixed(0)} m)`);
  }
  // ---- hazardsAuto
  {
    const quakes = [], fires = [];
    for (let seed = 1; seed <= 4; seed++) {
      const S = boot(APP_DIR, `seed=${seed}&season=0`); S.api.setSeason(null);
      S.api.hazardsAuto = true;
      let qN = 0, f = false;
      for (let t = 0; t < 6 * 1200; t += 1) {
        S.advance(1);
        const s = S.events.s;
        if (s.quakeT >= 0 && s.quakeT < 1) quakes.push([seed, s.t]);
        if (s.fireT >= 0 && !f) fires.push([seed, s.t, S.climate.s.phase]);
        f = s.fireT >= 0;
      }
    }
    const gaps = []; for (let i = 1; i < quakes.length; i++) if (quakes[i][0] === quakes[i - 1][0]) gaps.push(quakes[i][1] - quakes[i - 1][1]);
    const perYear = fires.length / (4 * 6);
    ok(gaps.length >= 4 && gaps.every(g => g >= 1799 && g <= 3601), `hazardsAuto: quakes every 30-60 min (${quakes.length} in 4 x 2 h; gaps ${Math.min(...gaps).toFixed(0)}-${Math.max(...gaps).toFixed(0)} s)`);
    ok(fires.every(f => f[2] > 0.36 && f[2] < 0.76) && perYear > 0.4 && perYear < 1.6, `hazardsAuto: wildfires only in late summer / autumn, ${perYear.toFixed(2)} a year at 1x (phases ${fires.map(f => f[2].toFixed(2)).join(' ')})`);
    const O = boot(APP_DIR, 'seed=1'); O.advance(4000);
    ok(!O.api.hazardsAuto && O.events.s.quakeT < 0 && O.events.s.fireT < 0, 'hazardsAuto is off by default');
    const P1 = boot(APP_DIR, 'seed=2&season=0'), P2 = boot(APP_DIR, 'seed=2&season=0');
    for (const S of [P1, P2]) { S.api.setSeason(null); S.api.hazardsAuto = true; S.advance(3000); }
    ok(JSON.stringify([P1.events.s.quakeN, P1.events.s.nextAuto, P1.events.s.fireN]) === JSON.stringify([P2.events.s.quakeN, P2.events.s.nextAuto, P2.events.s.fireN]), 'hazardsAuto is deterministic with ?seed');
  }
}

// ------------------------------------------------------------------------------------------------ browser
const pdiff = (x, y, d) => fs.existsSync(x) && fs.existsSync(y) ? JSON.parse(execFileSync('python3', [path.join(HERE, 'pdiff.py'), x, y, d]).toString()) : { max: 255, mean: 255 };
// triggers a hazard at frame K of a ?frames run (rAF hook installed before the page's scripts)
const at = (K, js) => `(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(t => { const S = window.SNOW; if (S && S.frameNo === ${K} && !window.__trig) { window.__trig = 1; ${js} } cb(t); }); })();`;
async function shot(html, tag, q, o = {}) {
  const file = path.join(OUT, tag + '.png');
  let r;
  for (let k = 0; k < 2; k++) {
    r = await capture({ html, out: file, q, w: o.w || 1280, h: o.h || 720, dpr: o.dpr || 1, done: true, settle: 150, preload: o.preload, timeout: 240000,
      eval: 'JSON.stringify({ hz: snowSim.state().hazards, scene: snowSim.scene, ready: snowSim.state().ready, c: SNOW.precipCount })' });
    if (!r.errors.some(e => e.startsWith('harness:'))) break;
  }
  return { file, v: r.value ? JSON.parse(r.value) : null, errors: r.errors };
}
if (want('render')) {
  for (const scene of ['valley', 'house']) {
    const base = `scene=${scene}&ui=0&seed=7`;
    const plain = await shot(APP, `r-${scene}-plain`, `${base}&season=summer&weather=thunder&wx=lightning:0.0001&t=60&frames=420`);
    const cases = [
      ['strike', `${base}&season=summer&weather=thunder&wx=lightning:0.0001&t=60&frames=420`, at(418, "snowSim.trigger('strike')"), v => v.hz.strikes === 1 && v.hz.flash > 0.2, 'r-' + scene + '-plain'],
      ['quake', `${base}&season=summer&weather=thunder&wx=lightning:0.0001&t=60&frames=640`, at(400, "snowSim.trigger('quake')"), v => v.hz.quake > 0.3 && v.c.dust > 0, null],
      ['wildfire', `${base}&season=autumn&weather=clear&t=60&frames=420`, at(300, "snowSim.trigger('wildfire'); snowSim.advance(40)"), v => v.hz.smoke > 0.9 && v.c.ash > 1000 && v.c.ember > 10, null],
    ];
    for (const [kind, q, pre, test] of cases) {
      const r = await shot(APP, `r-${scene}-${kind}`, q, { preload: pre });
      const ref = kind === 'strike' ? plain : await shot(APP, `r-${scene}-${kind}-ref`, q);
      const d = pdiff(ref.file, r.file, path.join(OUT, `r-${scene}-${kind}-diff.png`));
      ok(!r.errors.length && r.v && r.v.ready && r.v.scene === scene && test(r.v) && d.mean > 2,
        `${scene} ${kind}: renders with zero errors and shows (mean change ${d.mean})`, r.errors.join(' | ') + (r.v ? ' ' + JSON.stringify(r.v.hz) : ''));
    }
    // heat lightning under a clear sky: a faint flash low on the horizon (no bolt)
    const hq = `${base}&season=summer&weather=clear&t=30&frames=420`;
    const h0 = await shot(APP, `r-${scene}-clear`, hq), h1 = await shot(APP, `r-${scene}-heat`, hq, { preload: at(417, "snowSim.trigger('strike')") });
    const dh = pdiff(h0.file, h1.file, path.join(OUT, `r-${scene}-heat-diff.png`));
    ok(!h1.errors.length && dh.max > 8 && dh.mean < 6, `${scene}: a strike under a clear sky is a soft distant heat flash (max ${dh.max}, mean ${dh.mean})`, h1.errors.join(' | '));
  }
}
if (want('parity')) {
  if (!REF) ok(false, 'the Phase-2 copy (git f311fc6, tests/ref.mjs) exists for the valley parity check');
  else for (const [tag, q] of [['summer-clear', 'ui=0&seed=5&season=summer&weather=clear&t=40&frames=420'], ['winter-snow', 'ui=0&seed=3&season=winter&weather=snow&t=60&frames=420'], ['autumn-rain', 'ui=0&seed=2&season=autumn&weather=rain&t=90&frames=420']]) {
    // (polish: max 0; a pair inside the capture-noise floor, max 1 and mean < 0.001, is captured again up to twice:
    // noise clears, a deterministic delta repeats)
    let p, d;
    for (let k = 0; k < 3; k++) {
      const r = await shot(REF, `p-ref-${tag}`, q); p = await shot(APP, `p-app-${tag}`, q);
      d = pdiff(r.file, p.file, path.join(OUT, `p-diff-${tag}.png`));
      if (d.max === 0 || !(d.max <= 1 && d.mean < 0.001)) break;
      info(`parity ${tag}: max ${d.max}, mean ${d.mean} (inside the capture-noise floor): captured again`);
    }
    ok(d.max === 0 && !p.errors.length, `valley parity with no hazard (${tag}): max diff ${d.max}, mean ${d.mean}`, p.errors.join(' | '));
  }
}
if (want('det')) {
  for (const [tag, q, pre] of [['strike', 'scene=house&ui=0&seed=4&season=summer&weather=thunder&wx=lightning:0.0001&t=60&frames=420', at(417, "snowSim.trigger('strike')")],
    ['quake', 'ui=0&seed=4&season=summer&weather=clear&t=30&frames=560', at(360, "snowSim.trigger('quake')")]]) {
    const r1 = await shot(APP, `d-${tag}-1`, q, { preload: pre }), r2 = await shot(APP, `d-${tag}-2`, q, { preload: pre });
    const d = pdiff(r1.file, r2.file, path.join(OUT, `d-${tag}-diff.png`));
    ok(d.max <= 1 && d.mean < 0.002 && !r1.errors.length && !r2.errors.length, `a ${tag} at fixed frames renders identically twice (max ${d.max})`);
  }
}
const PRE_GL = `(() => { const P = WebGL2RenderingContext.prototype, live = window.__gl = { tex: 0, fb: 0, prog: 0, buf: 0 };
  const wrap = (c, d, k) => { const oc = P[c], od = P[d]; P[c] = function (...a) { const r = oc.apply(this, a); if (r) live[k]++; return r; }; P[d] = function (o) { if (o) live[k]--; return od.call(this, o); }; };
  wrap('createTexture', 'deleteTexture', 'tex'); wrap('createFramebuffer', 'deleteFramebuffer', 'fb'); wrap('createProgram', 'deleteProgram', 'prog'); wrap('createBuffer', 'deleteBuffer', 'buf'); })();`;
const READY = `new Promise(r => { const f = () => window.snowSim && snowSim.state().ready && !SNOW.R.gbNext ? r(1) : setTimeout(f, 30); f(); })`;
const wait = ms => new Promise(r => setTimeout(r, ms));
if (want('leak')) {
  const p = await open({ html: APP, q: 'ui=0&seed=7&season=summer&weather=thunder', w: 960, h: 540, preload: PRE_GL });
  await p.evaluate(READY);
  await p.evaluate("snowSim.setScene('house')"); await p.evaluate(READY); await p.evaluate("snowSim.setScene('valley')"); await p.evaluate(READY);
  // (polish: the hazards' programs are lazy, gl.js: the baseline waits for the prewarm, which creates every program)
  await p.evaluate(`new Promise(r => { const t0 = performance.now(), f = () => SNOW.prewarm.state === 'done' || performance.now() - t0 > 60000 ? r(1) : setTimeout(f, 50); f(); })`);
  const g0 = JSON.parse(await p.evaluate('JSON.stringify(window.__gl)'));
  for (let i = 0; i < 6; i++) {
    await p.evaluate("snowSim.trigger('quake'); snowSim.trigger('wildfire'); snowSim.trigger('strike'); 1");
    await wait(500);
    await p.evaluate("snowSim.trigger('strike'); 1");
    await wait(400);
    await p.evaluate(`snowSim.setScene('${i % 2 ? 'valley' : 'house'}')`); await p.evaluate(READY);
  }
  await p.evaluate("snowSim.setScene('valley')"); await p.evaluate(READY);
  const g1 = JSON.parse(await p.evaluate('JSON.stringify(window.__gl)'));
  ok(g1.tex === g0.tex && g1.fb === g0.fb && g1.prog === g0.prog && g1.buf === g0.buf && !p.errors.length,
    `no GL leak over 6 hazard cycles + scene switches (textures ${g0.tex} -> ${g1.tex}, framebuffers ${g0.fb} -> ${g1.fb}, programs ${g0.prog} -> ${g1.prog}, buffers ${g0.buf} -> ${g1.buf})`, p.errors.join(' | '));
  await p.close();
}
if (ONLY.split(',').includes('fps')) {
  const MEASURE = (act) => `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 300 && !snowSim.state().ready; i++) await wait(50);
    ${act}
    await wait(1500);
    let n = 0, run = true; const f = () => { n++; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f);
    const t0 = performance.now(); await wait(6000); run = false;
    const fps = n / ((performance.now() - t0) / 1000), s = snowSim.state();
    return JSON.stringify({ fps, lvl: s.perfLevel, hz: s.hazards, c: SNOW.precipCount });
  })()`;
  const STRIKES = "window.__iv = setInterval(() => snowSim.trigger('strike'), 400);";
  const rows = [
    ['thunder + strikes', 'season=summer&weather=thunder', STRIKES],
    ['quake (main shock)', 'season=summer&weather=clear', "snowSim.trigger('quake'); snowSim.advance(1);"],
    ['quake in rain', 'season=summer&weather=rain', "snowSim.trigger('quake'); snowSim.advance(1);"],
    ['wildfire (full)', 'season=autumn&weather=clear', "snowSim.trigger('wildfire'); snowSim.advance(40);"],
    ['all at once', 'season=summer&weather=thunder', `snowSim.trigger('wildfire'); snowSim.advance(40); snowSim.trigger('quake'); snowSim.advance(1); ${STRIKES}`],
  ];
  console.log(`fps gate: 1920x1080 dpr 2, gate ${GATE}, load average ${os.loadavg().map(x => x.toFixed(2)).join(' ')}`);
  for (const scene of ['valley', 'house']) for (const [name, q, act] of rows) {
    // two measured runs (a run whose measurement the harness lost, e.g. under a heavily shared GPU, is retried, up to 4
    // attempts); any console error fails the row
    let best = null, errs = [], good = 0;
    for (let rep = 0; rep < 4 && good < 2; rep++) {
      const r = await capture({ html: APP, q: `scene=${scene}&${q}&ui=0&seed=7`, w: 1920, h: 1080, dpr: 2, wait: 200, eval: MEASURE(act) });
      errs.push(...r.errors.filter(e => !e.startsWith('harness:')));
      let v = null;
      try { if (typeof r.value === 'string') v = JSON.parse(r.value); } catch {}
      if (!v) { info(`retrying ${scene} ${name}: the harness lost the measurement (${JSON.stringify(r.value)})`); continue; }
      good++;
      if (!best || v.fps > best.fps) best = v;
    }
    if (!best) { best = { fps: 0, lvl: -1 }; errs.push('no measurement'); }
    ok(best.fps >= GATE && best.lvl === 0 && !errs.length, `fps ${scene.padEnd(6)} ${name.padEnd(20)} ${best.fps.toFixed(1)} fps, rung ${best.lvl}  ${JSON.stringify(best.c)}`, errs.join(' | '));
  }
}
console.log(fails ? `${fails} hazard check(s) FAILED` : 'hazard tests passed');
process.exit(fails ? 1 : 0);
