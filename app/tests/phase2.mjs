// Phase-2 behaviour in the real app (real GPU, headless Chrome, file://):
//   node app/tests/phase2.mjs [--out DIR] [--only hooks,trans,shots,season,drag,decay,determinism,anchor,year]
//                             [--year-secs 150] [--update-golden]
//  hooks        ?weather= / ?season= / ?speed= boot hooks (and junk values are ignored without errors)
//  trans        every weather pick is a ~60 s transition: state sampled at 0 / 30 / 60 / 75 climate-s through
//               snowSim.advance (speed 1, synchronous, so live frames cannot interleave): next / progress / cur, the
//               channels reach the preset at 60 s and hold, no channel jumps (max change per climate-s)
//  shots        the same at real time, speed 8 (60 climate-s = 7.5 s): screenshots at 0 / 30 / 60 / 75 climate-s
//               of three transitions (contact sheets in --out); progress checked against real time
//  season       a season pick eases along the shortest arc over 60 s (monotone, no jumps), holds, 자동 releases it
//  drag         drag-only wind, deterministic (?frames= fixed step): a buttonless sweep leaves the animation state
//               (wind integrals, fall clocks, cloud drift) bit-identical to a page without input; a left drag
//               (PointerEvents, buttons 1) changes the wind integrals that move snow AND rain, uploads the wake to both
//               programs, and leaves the cloud drift and the natural wind bit-identical (clouds ignore the drag)
//  decay        live: after release the steer halves in ~15 s
//  determinism  same ?seed&t -> the same state() and S.F (bit-identical) and the same image (within the capture noise),
//               at t=300 and t=900; another seed differs
//  anchor       the Phase-1 anchor query (?wx Phase-1 channels + ?ground, winter ?yp so the date cannot change it) and
//               ?storm=1: a visual regression against the stage-2 goldens in tests/golden (--update-golden rewrites
//               them), plus an informational difference against stage 0a (Phase 1). Phase 2 changes the wind (veering
//               natural wind), the cloud drift direction and the winter grass by design, so 0a is not a gate
//  year         one year at speed 8 (2.5 min real) with ?seed=7 and the chrome on: zero console errors, the weather /
//               season timeline (printed and saved), no NaN / Infinity in S.F on any frame, uExposure logged per frame
//               with a small max step, no stuck state (every transition completes in ~60 climate-s, the scheduler and
//               the year keep moving, frames keep coming), the JS heap stable; screenshots every 15 s -> year-sheet.png
// Exit 1 on any failed check or console error / warning.
import { capture, open } from './cdp.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../index.html');
const REF0A = path.resolve(HERE, '../../work/stage0/app-0a/index.html');
const GOLD = path.join(HERE, 'golden');
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'snow-phase2')));
const ONLY = opt('only', ''), YEAR_SECS = +opt('year-secs', 150), UPDATE = a.includes('--update-golden');
fs.mkdirSync(OUT, { recursive: true });
const run = k => !ONLY || ONLY.split(',').includes(k);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errs = (tag, e) => { for (const x of e) console.log(`     ${tag}: ${x}`); return e.length === 0; };
const pdiff = (x, y, d) => JSON.parse(execFileSync('python3', [path.join(HERE, 'pdiff.py'), x, y, ...(d ? [d] : [])]).toString());
const TIMING = ['fps', 'frameMs', 'buildMs', 'compileMs'];
// a contact sheet of PNGs (cols x rows, each scaled to w px wide) with a caption per cell
function sheet(files, labels, out, cols, w = 480) {
  const py = `import sys
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); n = (len(sys.argv) - 4) // 2
fs, ls = sys.argv[4:4 + n], sys.argv[4 + n:]
ims = [Image.open(f).convert('RGB') for f in fs]; h = round(ims[0].size[1] * w / ims[0].size[0]); rows = (n + cols - 1) // cols
s = Image.new('RGB', (cols * w, rows * h), (0, 0, 0)); d = ImageDraw.Draw(s)
for i, (im, l) in enumerate(zip(ims, ls)):
    x, y = (i % cols) * w, (i // cols) * h; s.paste(im.resize((w, h)), (x, y))
    d.rectangle([x, y, x + 7 * len(l) + 8, y + 15], fill=(0, 0, 0)); d.text((x + 4, y + 2), l, fill=(255, 255, 255))
s.save(out)`;
  execFileSync('python3', ['-c', py, out, String(cols), String(w), ...files, ...labels]);
}

// ---------------------------------------------------------------- boot hooks
if (run('hooks')) {
  console.log('-- boot hooks');
  const st = async q => { const r = await capture({ html: APP, q: q + '&seed=7', w: 1280, h: 720, wait: 1200, eval: 'JSON.stringify(snowSim.state())' }); return { s: JSON.parse(r.value || 'null'), e: r.errors }; };
  let r = await st('ui=0&weather=rain');
  ok(errs('weather=rain', r.e) && r.s.weather.cur === 'rain' && r.s.weather.manual === 'rain' && r.s.weather.next === null && r.s.precip === 0.65 && r.s.snowFrac < 0.5,
    `?weather=rain boots settled in rain, held: ${JSON.stringify(r.s.weather)} precip ${r.s.precip} snowFrac ${r.s.snowFrac}`);
  r = await st('ui=0&season=summer');
  ok(errs('season=summer', r.e) && r.s.season === 'summer' && r.s.phase === 0.375 && r.s.seasonPinned, `?season=summer pins mid-summer at once: ${r.s.phase} ${r.s.seasonKo}`);
  r = await st('ui=0&season=0.9&weather=auto');
  ok(errs('season=0.9', r.e) && r.s.season === 'winter' && r.s.phase === 0.9 && r.s.seasonPinned && r.s.weather.manual === null && r.s.auto,
    `?season=0.9 pins phase ${r.s.phase} (${r.s.seasonKo}); ?weather=auto leaves the scheduler on`);
  r = await st('ui=0&season=summer&weather=snow');
  ok(errs('summer snow', r.e) && r.s.weather.cur === 'snow' && r.s.snowFrac === 1 && r.s.temp < 1, `a manual snow pick in summer is a cold snap: T ${r.s.temp} C, snowFrac ${r.s.snowFrac}`);
  r = await st('speed=8');
  const cap = await capture({ html: APP, q: 'speed=8&seed=7', w: 1280, h: 720, wait: 1200, eval: "(document.getElementById('icon').click(), new Promise(r => setTimeout(() => r(document.getElementById('speedv').textContent), 300)))" });
  ok(errs('speed=8', [...r.e, ...cap.errors]) && r.s.speed === 8 && cap.value === '1년 = 2분 30초', `?speed=8: speed ${r.s.speed}, the caption reads '${cap.value}' (one year = 2.5 min)`);
  r = await st('ui=0&weather=nope&season=nope&speed=x');
  ok(errs('junk', r.e) && r.s.weather.manual === null && !r.s.seasonPinned && r.s.speed === 1, 'junk ?weather / ?season / ?speed values are ignored');
}

// ---------------------------------------------------------------- transitions through snowSim.advance
const KEYS = ['cloudCov', 'cumulus', 'overcast', 'cirrus', 'fog', 'precip', 'gale', 'heavy', 'tempOff'];
const PRESET = { clear: [0.15, 0, 0, 0.35, 0, 0, 0.05, 0, 1], cumulus: [0.55, 1, 0.1, 0.2, 0, 0, 0.2, 0, 0], overcast: [0.95, 0.2, 0.75, 0, 0.1, 0, 0.3, 0, -1],
  fog: [0.75, 0, 0.5, 0, 1, 0, 0, 0, -1], rain: [0.97, 0, 0.85, 0, 0.2, 0.65, 0.4, 0, 1], snow: [0.75, 0.2, 0.35, 0.4, 0.05, 0.75, 0.15, 0, -3],
  blizzard: [0.98, 0, 1, 0, 0.2, 1, 1, 1, -6] };
if (run('trans')) {
  console.log('-- weather picks: 60 s transitions (snowSim.advance, speed 1)');
  const PICKS = `(picks => {
    const S = SNOW, KEYS = ${JSON.stringify(KEYS)}, P = ${JSON.stringify(PRESET)}, ch = S.weather.s.ch, out = [];
    const dist = w => KEYS.reduce((d, k, i) => k === 'tempOff' ? d : d + Math.abs(ch[k] - P[w][i]), 0);
    const snap = (w, t) => { const x = S.weather.s; return { t, cur: x.cur, next: x.next, progress: +x.progress.toFixed(3), manual: x.manual, dist: +dist(w).toFixed(6) }; };
    for (const w of picks) {
      snowSim.setWeather(w);
      const rec = { w, s: [snap(w, 0)], step: 0, stepT: 0 };
      let prev = KEYS.map(k => ch[k]);
      for (let k = 1; k <= 75; k++) {
        snowSim.advance(1);
        KEYS.forEach((key, i) => { const d = Math.abs(ch[key] - prev[i]); if (key === 'tempOff') rec.stepT = Math.max(rec.stepT, d); else rec.step = Math.max(rec.step, d); prev[i] = ch[key]; });
        if (k === 30 || k === 60 || k === 75) rec.s.push(snap(w, k));
      }
      out.push(rec);
    }
    return JSON.stringify(out);
  })`;
  for (const [season, start, picks] of [['summer', 'clear', ['cumulus', 'overcast', 'fog', 'rain', 'clear']], ['winter', 'clear', ['overcast', 'snow', 'blizzard', 'snow', 'clear']]]) {
    const r = await capture({ html: APP, q: `ui=0&seed=7&season=${season}&weather=${start}`, w: 960, h: 540, wait: 1000, eval: PICKS + `(${JSON.stringify(picks)})` });
    errs(season, r.errors) || fails++;
    for (const rec of JSON.parse(r.value || '[]')) {
      const [s0, s30, s60, s75] = rec.s;
      const good = s0.next === rec.w && s0.progress < 0.01 && s0.dist > 0.05
        && s30.next === rec.w && s30.progress > 0.45 && s30.progress < 0.55 && s30.dist < s0.dist && s30.dist > 0.005
        // at exactly 60 s the accumulated float clock may sit a hair before the end: the channels are there either way
        && (s60.next === null ? s60.cur === rec.w : s60.next === rec.w && s60.progress >= 0.9999) && s60.dist < 1e-4
        && s75.cur === rec.w && s75.next === null && s75.manual === rec.w && s75.dist < 1e-6 && rec.step < 0.08 && rec.stepT < 1;
      ok(good, `${season}: -> ${rec.w.padEnd(8)} t=0 ${s0.cur}->${s0.next} p ${s0.progress} | 30 s p ${s30.progress} off-preset ${s30.dist.toFixed(3)} of ${s0.dist.toFixed(3)} | 60 s ${s60.next ? s60.cur + '->' + s60.next : s60.cur} p ${s60.progress} ` +
        `| 75 s held ${s75.cur} | max channel step ${rec.step.toFixed(3)}/s, tempOff ${rec.stepT.toFixed(2)} C/s`);
    }
  }
}

// ---------------------------------------------------------------- the same at real time, speed 8, with screenshots
if (run('shots')) {
  console.log('-- transitions at speed 8 (real time), screenshots at 0 / 30 / 60 / 75 climate-s');
  for (const [season, from, to] of [['summer', 'clear', 'rain'], ['winter', 'clear', 'snow'], ['autumn', 'clear', 'fog']]) {
    const p = await open({ html: APP, q: `ui=0&seed=7&season=${season}&weather=${from}`, w: 1280, h: 720 });
    try {
      await p.evaluate('new Promise(r => { const f = () => window.snowSim && snowSim.state().ready ? setTimeout(r, 1500) : setTimeout(f, 50); f(); })');
      const t0 = Date.now();
      await p.evaluate(`snowSim.speed = 8, snowSim.setWeather('${to}'), 1`);
      const files = [], labels = [], prog = [];
      for (const tc of [0, 30, 60, 75]) {
        await sleep(Math.max(0, t0 + tc / 8 * 1000 - Date.now()));
        const s = JSON.parse(await p.evaluate('JSON.stringify(snowSim.state().weather)'));
        prog.push(s.next ? s.progress : 1);
        files.push(await p.shot(path.join(OUT, `trans-${season}-${to}-${tc}.png`)));
        labels.push(`${season} ${from}->${to} ${tc} s: ${s.cur}${s.next ? '->' + s.next : ''} p ${(s.next ? s.progress : 1).toFixed(2)}`);
      }
      sheet(files, labels, path.join(OUT, `trans-${season}-${to}-sheet.png`), 2, 640);
      ok(errs(season, p.errors) && prog[0] < 0.1 && prog[1] > 0.35 && prog[1] < 0.65 && prog[2] > 0.95 && prog[3] === 1,
        `${season} ${from} -> ${to} at 8x: progress ${prog.map(x => x.toFixed(2)).join(' / ')} at 0 / 3.75 / 7.5 / 9.4 s real (trans-${season}-${to}-sheet.png)`);
    } finally { await p.close(); }
  }
}

// ---------------------------------------------------------------- season pick ease
if (run('season')) {
  console.log('-- season picks ease over 60 s');
  const EASE = `((target, back) => {
    const S = SNOW, out = { ph: [] };
    const p0 = S.climate.s.phase;
    snowSim.setSeason(target);
    let fwd = true, maxStep = 0, last = p0;
    for (let k = 1; k <= 75; k++) {
      snowSim.advance(1);
      const p = S.climate.s.phase, d = ((p - last + 1.5) % 1) - 0.5;      // signed step on the circle
      if (d < -1e-12) fwd = false;
      maxStep = Math.max(maxStep, Math.abs(d)); last = p;
      if (k === 30 || k === 60 || k === 75) out.ph.push(+p.toFixed(5));
    }
    out.fwd = fwd; out.maxStep = maxStep; out.p0 = +p0.toFixed(5); out.pinned = S.climate.s.pinned !== null; out.chip = snowSim.state().seasonPinned;
    snowSim.setSeason(back); snowSim.advance(60);
    out.after = +S.climate.s.phase.toFixed(5); out.released = S.climate.s.pinned === null;
    return JSON.stringify(out);
  })`;
  const r = await capture({ html: APP, q: 'ui=0&seed=7&season=autumn', w: 960, h: 540, wait: 1000,
    eval: `JSON.stringify([${EASE}('winter', null), ${EASE}('spring', null)].map(JSON.parse))` });
  errs('season', r.errors) || fails++;
  const [w, s] = JSON.parse(r.value || '[{},{}]');
  ok(w.fwd && w.maxStep < 0.0075 && w.ph[1] === 0.875 && w.ph[2] === 0.875 && w.pinned && w.chip && w.released && Math.abs(w.after - 0.925) < 1e-3,
    `autumn -> winter: phase ${w.p0} -> ${w.ph.join(' / ')} at 30 / 60 / 75 s, monotone, max step ${w.maxStep.toFixed(4)}/s, pinned; 자동 -> flows on to ${w.after}`);
  ok(s.fwd && s.maxStep < 0.0075 && s.ph[1] === 0.125 && s.pinned && s.released,
    `winter -> spring takes the short way through the new year: ${s.p0} -> ${s.ph.join(' / ')}, monotone forward, max step ${s.maxStep.toFixed(4)}/s`);
}

// ---------------------------------------------------------------- drag-only wind (deterministic)
if (run('drag')) {
  console.log('-- drag-only wind (?frames= fixed step, sleet: snow and rain both falling)');
  // 50 s of fixed-step sim, several seconds real: the scripted pointer input ends long before. The fixed steps run
  // faster than real time, so the drag velocity (real time) decays sooner per event than live: the steer is smaller
  // here than in interact.mjs / the decay check, which test its size live
  const N = 3000;
  const Q = `ui=0&seed=7&season=winter&weather=snow&wx=snowFrac:.5&frames=${N}`;
  const PE = `const c = document.getElementById('c'), pe = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: y })), wait = ms => new Promise(r => setTimeout(r, ms)), S = SNOW;`;
  const HOVER = `(async () => { ${PE} const r = window.__in = { f0: S.frameNo, still: true };
    for (let i = 0; i <= 60; i++) { pe('pointermove', 150 + i * 20, 300 + (i % 7) * 30, 0); await wait(16);
      r.still = r.still && !S.mouse.drag && S.mouse.vxn === 0 && S.mouse.vyn === 0 && S.mouse.segs.length === 0 && S.wind.s.steer[0] === 0 && S.wind.s.steer[2] === 0; }
    r.f1 = S.frameNo; })(), 1`;
  const DRAG = `(async () => { ${PE} const r = window.__in = { f0: S.frameNo, mnFlake: 0, mnRain: 0, snow: 0, rain: 0, steer: 0 }, gl = S.gl;
    pe('pointerdown', 300, 560, 1);
    for (let i = 1; i <= 40; i++) { pe('pointermove', 300 + i * 22, 560 - i * 5, 1); await wait(16);
      if (i % 4 === 0) { r.mnFlake = Math.max(r.mnFlake, gl.getUniform(S.P.flake.p, S.P.flake.u.uMn)); r.mnRain = Math.max(r.mnRain, gl.getUniform(S.P.rain.p, S.P.rain.u.uMn)); }
      r.snow = Math.max(r.snow, S.precipCount.snow); r.rain = Math.max(r.rain, S.precipCount.rain); r.steer = Math.max(r.steer, snowSim.state().wind.steer); }
    pe('pointerup', 1180, 360, 0); r.f1 = S.frameNo; })(), 1`;
  const ANIM = `JSON.stringify((S => ({ time: S.anim.time, dispA: S.anim.dispA, dispB: S.anim.dispB, fallI: S.anim.fallI, rainI: S.anim.rainI, cloud: S.anim.cloud,
    natural: S.wind.s.natural, windA: S.wind.s.windA, steer: S.wind.s.steer, frames: S.frameNo, input: window.__in || null }))(SNOW))`;
  const go = async (tag, early) => { const r = await capture({ html: APP, q: Q, w: 1280, h: 720, done: true, settle: 100, early, eval: ANIM, timeout: 240000 }); errs(tag, r.errors) || fails++; return JSON.parse(r.value || '{}'); };
  const none = await go('none', ''), hov = await go('hover', HOVER), drag = await go('drag', DRAG);
  const pick = (o, ks) => JSON.stringify(ks.map(k => o[k]));
  const ALL = ['time', 'dispA', 'dispB', 'fallI', 'rainI', 'cloud', 'natural', 'windA', 'steer'];
  ok(hov.input && hov.input.still && hov.input.f1 > 0 && hov.input.f1 < N && pick(hov, ALL) === pick(none, ALL),
    `buttonless sweep (frames ${hov.input && hov.input.f0}-${hov.input && hov.input.f1}): steer / drag velocity / wake exactly 0 on every event, and the animation state ` +
    `(wind integrals, fall clocks, cloud drift) is bit-identical to the page without input`);
  const dA = Math.hypot(...drag.dispA.map((v, i) => v - none.dispA[i]));
  ok(drag.input && drag.input.f1 > 0 && drag.input.f1 < N && drag.input.steer > 0.5 && dA > 1 && pick(drag, ['time', 'cloud', 'natural', 'fallI', 'rainI']) === pick(none, ['time', 'cloud', 'natural', 'fallI', 'rainI']),
    `left drag: steer up to ${drag.input && drag.input.steer.toFixed(1)} m/s moves the particles' wind integral by ${dA.toFixed(1)} m; the cloud drift and the natural wind are bit-identical (clouds ignore the drag)`);
  ok(drag.input && drag.input.mnFlake > 0 && drag.input.mnRain > 0 && drag.input.snow > 0 && drag.input.rain > 0,
    `during the drag both programs get the wake (uMn flake ${drag.input && drag.input.mnFlake}, rain ${drag.input && drag.input.mnRain}) with ${drag.input && drag.input.snow} flakes and ${drag.input && drag.input.rain} drops drawn`);
}

// ---------------------------------------------------------------- steer decay after release (live)
if (run('decay')) {
  console.log('-- steer decay after release (live, physical time)');
  const r = await capture({ html: APP, q: 'ui=0&seed=7&season=winter&weather=snow', w: 1280, h: 720, wait: 1500, deadline: 120000, eval: `(async () => {
    const c = document.getElementById('c'), wait = ms => new Promise(r => setTimeout(r, ms)), S = SNOW;
    const pe = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: y }));
    for (let i = 0; i < 100 && !snowSim.state().ready; i++) await wait(50);
    pe('pointerdown', 300, 500, 1);
    for (let i = 1; i <= 30; i++) { pe('pointermove', 300 + i * 30, 500, 1); await wait(16); }
    pe('pointerup', 1200, 500, 0);
    const steer = () => Math.hypot(S.wind.s.steer[0], S.wind.s.steer[2]);
    await wait(300); const s0 = steer(), t0 = S.anim.time, w0 = performance.now();
    await wait(15000);
    return JSON.stringify({ s0, s15: steer(), dt: S.anim.time - t0, real: (performance.now() - w0) / 1000 });
  })()` });
  const v = JSON.parse(r.value || '{}');
  const ratio = v.s15 / v.s0, expect = Math.pow(0.5, v.dt / 15);
  ok(errs('decay', r.errors) && v.s0 > 2 && ratio > 0.4 && ratio < 0.6 && Math.abs(ratio - expect) < 0.02,
    `released steer ${v.s0 && v.s0.toFixed(2)} -> ${v.s15 && v.s15.toFixed(2)} m/s after ${v.real && v.real.toFixed(1)} s real (${v.dt && v.dt.toFixed(2)} s physical): x${ratio.toFixed(3)} (15 s half-life: x${expect.toFixed(3)})`);
}

// ---------------------------------------------------------------- determinism
if (run('determinism')) {
  console.log('-- determinism: same ?seed&t -> same state, S.F and image');
  const SF = `JSON.stringify({ st: snowSim.state(), F: (F => { const o = {}; for (const k of Object.keys(F)) { const v = F[k]; if (typeof v === 'number') o[k] = v; else if (v && v.length !== undefined) o[k] = Array.from(v); } return o; })(SNOW.F) })`;
  const go = async (tag, q) => {
    const file = path.join(OUT, `det-${tag}.png`);
    const r = await capture({ html: APP, out: file, q: q + '&ui=0&frames=360', w: 1280, h: 720, done: true, settle: 100, eval: SF });
    errs(tag, r.errors) || fails++;
    const v = JSON.parse(r.value || '{}'); for (const k of TIMING) delete v.st[k];
    return { file, st: JSON.stringify(v.st), F: JSON.stringify(v.F), s: v.st };
  };
  for (const t of [300, 900]) {
    const x = await go(`t${t}a`, `seed=7&t=${t}`), y = await go(`t${t}b`, `seed=7&t=${t}`);
    const d = pdiff(x.file, y.file);
    ok(x.st === y.st && x.F === y.F && x.s.ready && d.p99 === 0 && d.mean < 0.01,
      `?seed=7&t=${t}: state and S.F bit-identical (${x.s.season} ${x.s.weather.cur}${x.s.weather.next ? '->' + x.s.weather.next : ''}, cover ${x.s.coverage}), image mean ${d.mean} p99 ${d.p99} max ${d.max}`);
  }
  const z = await go('t300s8', 'seed=8&t=300'), x = await go('t300c', 'seed=7&t=300');
  ok(z.st !== x.st, `?seed=8&t=300 differs from seed 7 (${z.s.weather.cur} vs ${x.s.weather.cur}, wind ${z.s.wind.x} vs ${x.s.wind.x})`);
}

// ---------------------------------------------------------------- Phase-1 anchor visual regression
if (run('anchor')) {
  console.log('-- Phase-1 anchor regression' + (UPDATE ? ' (updating the goldens)' : ''));
  fs.mkdirSync(GOLD, { recursive: true });
  const WX = 'wx=cloudCov:.6,cumulus:0,overcast:0,cirrus:1,fog:0,precip:1,gale:0,heavy:0,tempOff:0,snowFrac:1';
  const ANCH = [['anchor-cover1', `${WX}&ground=cover:1,wet:0&yp=.875`, 'cover=1&storm=0'], ['anchor-cover0', `${WX}&ground=cover:0,wet:0&yp=.875`, 'cover=0&storm=0'],
                ['anchor-storm', 'storm=1&yp=.875', 'storm=1']];
  for (const [name, q, q0] of ANCH) {
    const file = path.join(OUT, name + '.png');
    const r = await capture({ html: APP, out: file, q: q + '&ui=0&seed=7&frames=300', w: 1280, h: 720, done: true, settle: 200 });
    errs(name, r.errors) || fails++;
    const gold = path.join(GOLD, name + '.png');
    if (UPDATE || !fs.existsSync(gold)) { fs.copyFileSync(file, gold); console.log(`     ${UPDATE ? 'updated' : 'created'} ${path.relative(process.cwd(), gold)}`); }
    const d = pdiff(gold, file, path.join(OUT, name + '-diff.png'));
    let info = '';
    if (fs.existsSync(REF0A)) {
      const f0 = path.join(OUT, name + '-0a.png');
      await capture({ html: REF0A, out: f0, q: q0 + '&ui=0&seed=7&frames=300', w: 1280, h: 720, done: true, settle: 200 });
      const d0 = pdiff(f0, file); info = `; vs Phase 1 (0a, ${q0}): mean ${d0.mean} p99 ${d0.p99} (informational: wind, cloud drift, winter grass by design)`;
    }
    ok(d.mean < 0.5 && d.p99 <= 4, `${name}: vs golden mean ${d.mean} p99 ${d.p99} max ${d.max}${info}`);
  }
}

// ---------------------------------------------------------------- one year at speed 8
if (run('year')) {
  console.log(`-- one year at speed 8 (${YEAR_SECS} s real, ?seed=7, chrome on)`);
  const p = await open({ html: APP, q: 'seed=7&speed=8', w: 1280, h: 720, deadline: (YEAR_SECS + 120) * 1000 });
  const INSTR = `(() => {
    const S = SNOW, F = S.F, orig = S.deriveF, w = S.weather.s, c = S.climate.s;
    const rec = window.__yr = { n: 0, nan: [], expo: [], maxStep: 0, maxStepAt: null, tl: [], mem: [], maxDt: 0, seasons: {}, trMax: 0, trOpen: null,
                                t0: c.t, phase0: c.phase, real0: performance.now(), wx: {} };
    let lastE = null, lastNow = performance.now(), key = '', trT = null, lastMem = -1e9;
    S.deriveF = function () {
      orig();
      const now = performance.now();
      if (rec.n > 0) rec.maxDt = Math.max(rec.maxDt, now - lastNow);
      lastNow = now; rec.n++;
      for (const k in F) {
        const v = F[k];
        if (typeof v === 'number') { if (!isFinite(v) && rec.nan.length < 20) rec.nan.push(k + '@' + c.t.toFixed(1)); }
        else if (v && v.length) for (let i = 0; i < v.length; i++) if (!isFinite(v[i])) { if (rec.nan.length < 20) rec.nan.push(k + '@' + c.t.toFixed(1)); break; }
      }
      const e = F.uExposure;
      if (lastE !== null && Math.abs(e - lastE) > rec.maxStep) { rec.maxStep = Math.abs(e - lastE); rec.maxStepAt = { t: +c.t.toFixed(1), from: lastE, to: e, wx: w.cur + '>' + w.next }; }
      lastE = e; rec.expo.push(+e.toFixed(5));
      rec.seasons[S.climate.snapshot().season] = 1; rec.wx[w.cur] = 1;
      const k = w.cur + '>' + (w.next || '');
      if (k !== key) {
        rec.tl.push({ t: +(c.t - rec.t0).toFixed(1), real: +((now - rec.real0) / 1000).toFixed(1), season: S.climate.seasonKo(), cur: w.cur, next: w.next,
                      temp: +w.temp.toFixed(1), cover: +S.ground.s.cover.toFixed(2), snowline: Math.round(S.ground.s.snowline), expo: +e.toFixed(3) });
        key = k;
      }
      if (w.next && trT === null) trT = c.t;
      if (!w.next && trT !== null) { rec.trMax = Math.max(rec.trMax, c.t - trT); trT = null; }
      rec.trOpen = trT === null ? null : c.t - trT;
      if (now - lastMem > 5000 && performance.memory) { lastMem = now; rec.mem.push([+((now - rec.real0) / 1000).toFixed(0), +(performance.memory.usedJSHeapSize / 1048576).toFixed(2)]); }
    };
    return 1;
  })()`;
  try {
    await p.evaluate('new Promise(r => { const f = () => window.snowSim && snowSim.state().ready ? r() : setTimeout(f, 50); f(); })');
    await p.evaluate(INSTR);
    const files = [], labels = [], t0 = Date.now();
    for (let i = 0; i <= YEAR_SECS / 15; i++) {
      await sleep(Math.max(0, t0 + i * 15000 - Date.now()));
      const s = JSON.parse(await p.evaluate('JSON.stringify(snowSim.state())'));
      files.push(await p.shot(path.join(OUT, `year-${String(i).padStart(2, '0')}.png`)));
      labels.push(`${i * 15} s: ${s.season} ${s.weather.cur}${s.weather.next ? '>' + s.weather.next : ''} ${s.temp}C cover ${s.coverage}`);
    }
    const y = JSON.parse(await p.evaluate(`JSON.stringify(Object.assign({}, window.__yr, { tEnd: SNOW.climate.s.t, phaseEnd: SNOW.climate.s.phase, nextAt: SNOW.weather.s.nextAt, auto: SNOW.weather.s.auto,
      frames: SNOW.frameNo, fps: snowSim.state().fps }))`));
    fs.writeFileSync(path.join(OUT, 'year.json'), JSON.stringify({ timeline: y.tl, mem: y.mem, maxStep: y.maxStep, maxStepAt: y.maxStepAt }, null, 1));
    fs.writeFileSync(path.join(OUT, 'year-exposure.json'), JSON.stringify(y.expo));
    sheet(files, labels, path.join(OUT, 'year-sheet.png'), 4, 400);
    console.log('     timeline (climate s since start, real s, season, weather, T, cover, snowline, exposure):');
    for (const e of y.tl) console.log(`       ${String(e.t).padStart(7)} ${String(e.real).padStart(6)}  ${e.season.padEnd(4)} ${(e.cur + (e.next ? ' -> ' + e.next : '')).padEnd(20)} ${String(e.temp).padStart(5)} C  cover ${e.cover}  snowline ${e.snowline}  expo ${e.expo}`);
    const dur = y.tEnd - y.t0, nTr = y.tl.filter(e => e.next).length, nWx = Object.keys(y.wx).length;
    ok(errs('year', p.errors), `zero console errors over ${y.n} frames (${(y.n / YEAR_SECS).toFixed(0)} fps mean)`);
    ok(Math.abs(dur / (YEAR_SECS * 8) - 1) < 0.05 && Object.keys(y.seasons).length === 4,
      `a full year: ${dur.toFixed(0)} climate-s in ${YEAR_SECS} s real (phase ${y.phase0.toFixed(3)} -> ${y.phaseEnd.toFixed(3)}), seasons seen: ${Object.keys(y.seasons).join(' ')}`);
    ok(!y.nan.length, `no NaN / Infinity in S.F on any frame${y.nan.length ? ': ' + y.nan.join(', ') : ''}`);
    ok(y.maxStep < 0.03, `uExposure continuous: max step ${y.maxStep.toFixed(5)} per frame (${y.maxStepAt ? `at ${y.maxStepAt.t} s, ${y.maxStepAt.wx}` : ''}; range ${Math.min(...y.expo).toFixed(3)}..${Math.max(...y.expo).toFixed(3)}; per-frame log in year-exposure.json)`);
    ok(nTr >= 5 && nWx >= 4 && y.trMax <= 62 && (y.trOpen === null || y.trOpen <= 62) && y.auto && y.nextAt > y.tEnd && y.maxDt < 1000,
      `no stuck state: ${nTr} transitions over ${nWx} weathers (${Object.keys(y.wx).join(' ')}), longest transition ${y.trMax.toFixed(1)} climate-s, next change scheduled at ${y.nextAt.toFixed(0)} > ${y.tEnd.toFixed(0)}, longest frame gap ${y.maxDt.toFixed(0)} ms`);
    if (y.mem.length >= 6) {
      const half = Math.floor(y.mem.length / 2), mx = arr => Math.max(...arr.map(m => m[1]));
      const m1 = mx(y.mem.slice(0, half)), m2 = mx(y.mem.slice(half));
      ok(m2 - m1 < 20, `JS heap stable: peak ${m1.toFixed(1)} MB in the first half, ${m2.toFixed(1)} MB in the second (samples every 5 s in year.json)`);
    } else console.log('     (performance.memory unavailable: heap not checked)');
  } finally { await p.close(); }
}

console.log(`output in ${OUT}`);
console.log(fails ? `${fails} phase-2 check(s) FAILED` : 'phase-2 checks passed');
process.exit(fails ? 1 : 0);
