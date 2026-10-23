// RETIRED AS A GATE (stage 2a): Phase 2 changes the image and the state by design (seasons, real weather, the
// veering natural wind, the cloud drift direction), so the app no longer matches stage 0a. Kept as a comparison tool;
// tests/phase2.mjs keeps the Phase-1 anchor query as a visual regression (goldens in tests/golden, plus an
// informational difference against stage 0a).
//
// Parity test: the app against a reference build at the same deterministic states. The reference is the stage-0a
// split (work/stage0/app-0a, itself pixel-identical to Phase 1); --ref work/stage0/ref.html compares with the
// Phase-1 single file instead.
//
//   node app/tests/parity.mjs [--frames 900] [--w 1600] [--h 900] [--dpr 1] [--out DIR] [--ref FILE] [--control] [--only a,b]
//
// Both pages run with the test hook ?frames=N (exactly N frames at a fixed 1/60 s step, then the loop stops and
// window.__done is set), so a capture does not depend on frame timing. N is large enough that the bake, the reveal
// and the chrome's hint / icon lifecycle (ready + 7.5 s) have all settled. Per state it reports the per-pixel
// difference (max over RGB, 8-bit) as mean / p99 / max, compares snowSim.state() on the reference's keys (minus the
// timing fields; the app adds the Phase-2 snapshot fields), compares the frame bundle S.F numerically on the
// reference's keys (with the stage-0b renames uStorm -> uSnowCurtain, uStormSky -> uOvercast), and lists console
// errors. --control also captures the reference twice to measure the capture noise floor.
// Pass: mean < 0.5 and p99 <= 4 on every state, identical state and S.F, and no console errors.
import { capture } from './cdp.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const FRAMES = +opt('frames', 900), W = +opt('w', 1600), H = +opt('h', 900), DPR = +opt('dpr', 1);
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'snow-parity')));
const REF = path.resolve(opt('ref', path.join(HERE, '../../work/stage0/app-0a/index.html')));
const APP = path.resolve(HERE, '../index.html');
const CONTROL = a.includes('--control');
const ONLY = opt('only', '');                            // comma-separated state names
fs.mkdirSync(OUT, { recursive: true });

// [name, query, frames (default --frames), act (js run once the loop has stopped), mid-run perturbation].
// Extra checks beyond the five required states: 'front' and 'hooks' (the rest of the URL hooks), 'pop' (the hint is showing at frame 200, ready ~0.6 s + 0.5..5.5 s,
// and the icon is clicked to open the pop-over), 'resize' (the viewport changes aspect while running: a second
// G-buffer is baked behind the live scene and wiped in) and 'ctxloss' (WEBGL_lose_context, restored 0.3 s later:
// initGL rebuilds everything and the scene re-reveals). The last two end long after their rebake.
const LOSE = "(() => { const e = document.getElementById('c').getContext('webgl2').getExtension('WEBGL_lose_context'); e.loseContext(); setTimeout(() => e.restoreContext(), 300); return 1; })()";
const STATES = [
  ['calm', 'ui=0&seed=7'],
  ['t200', 't=200&storm=0&ui=0&seed=7'],
  ['cover1', 'cover=1&storm=0&ui=0&seed=7'],
  ['storm', 'storm=1&ui=0&seed=7'],
  ['ui', 'seed=7'],
  ['pop', 'seed=7', 200, "document.getElementById('icon').click(), 1"],
  ['front', 't=230&ui=0&seed=7'],                                  // inside the first scheduled front (stormEnv, tail, heading)
  ['hooks', 'fixed=1&t=400&wind=-3,1&cover=0.4&seed=3&ui=0'],     // ?fixed clocks, ?wind, an unheld ?cover, a later schedule
  ['resize', 'ui=0&seed=7', 0, '', { resize: [1280, 960] }],
  ['ctxloss', 'seed=7', 0, '', { early: LOSE }],
];
const TIMING = ['fps', 'frameMs', 'buildMs', 'compileMs'];
// the state and the frame bundle (numbers and vectors; the noise sampler is skipped). The Phase-1 single file has
// no SNOW namespace: F is null there and only the state is compared
const stateOf = `JSON.stringify({ st: window.snowSim ? snowSim.state() : null, F: window.SNOW ? (F => { const o = {};
  for (const k of Object.keys(F)) { const v = F[k]; if (typeof v === 'number') o[k] = v; else if (v && v.length !== undefined) o[k] = Array.from(v); } return o; })(SNOW.F) : null })`;
const RENAME = { uStorm: 'uSnowCurtain', uStormSky: 'uOvercast' };
const clean = s => { if (!s) return s; const o = JSON.parse(s); for (const k of TIMING) delete o[k]; return o; };
// the reference's keys only (the app reports more)
const sameOn = (ref, app) => !!ref && !!app && Object.keys(ref).every(k => JSON.stringify(ref[k]) === JSON.stringify(app[k]));
// S.F on the reference's keys: { same, worst: max abs difference, missing / differing names }
function cmpF(ref, app) {
  if (!ref || !app) return { same: true, n: 0, worst: 0, bad: [] };
  let worst = 0; const bad = [];
  for (const k of Object.keys(ref)) {
    const k2 = RENAME[k] || k, a = [].concat(ref[k]), b = app[k2] === undefined ? null : [].concat(app[k2]);
    if (!b || b.length !== a.length) { bad.push(k2 + ' (missing)'); continue; }
    const d = Math.max(...a.map((x, i) => Math.abs(x - b[i])));
    if (d > 0) { bad.push(`${k2} (${d.toExponential(2)})`); worst = Math.max(worst, d); }
  }
  return { same: !bad.length, n: Object.keys(ref).length, worst, bad };
}
const pdiff = (x, y, d) => JSON.parse(execFileSync('python3', [path.join(HERE, 'pdiff.py'), x, y, d]).toString());

async function shot(html, tag, q, frames, act, mid) {
  const file = path.join(OUT, `${tag}.png`);
  const r = await capture({ html, out: file, q: `${q}&frames=${frames || FRAMES}`, w: W, h: H, dpr: DPR, done: true, act, settle: 1500, eval: stateOf, ...mid });
  if (r.timedOut) r.errors.push('timeout waiting for window.__done');
  const v = r.value ? JSON.parse(r.value) : { st: null, F: null };
  return { file, state: clean(v.st && JSON.stringify(v.st)), F: v.F, errors: r.errors };
}

console.log(`parity: ${FRAMES} frames @ 1/60 s, ${W}x${H} dpr ${DPR}\n  ref ${REF}\n  app ${APP}\n  out ${OUT}`);
let ok = true;
const rows = [];
for (const [name, q, frames, act, mid] of STATES) {
  if (ONLY && !ONLY.split(',').includes(name)) continue;
  const ref = await shot(REF, `ref-${name}`, q, frames, act, mid);
  const app = await shot(APP, `app-${name}`, q, frames, act, mid);
  const d = pdiff(ref.file, app.file, path.join(OUT, `diff-${name}.png`));
  const sameState = sameOn(ref.state, app.state), f = cmpF(ref.F, app.F);
  const errs = [...ref.errors.map(e => 'ref ' + e), ...app.errors.map(e => 'app ' + e)];
  let ctl = null;
  if (CONTROL) { const ref2 = await shot(REF, `ref2-${name}`, q, frames, act, mid); ctl = pdiff(ref.file, ref2.file, path.join(OUT, `ctl-${name}.png`)); }
  const pass = d.mean < 0.5 && d.p99 <= 4 && sameState && f.same && !errs.length;
  ok = ok && pass;
  rows.push({ name, q, frames: frames || FRAMES, ...d, sameState, sameF: f.same, Fdiff: f.bad, errs, ctl, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name.padEnd(7)} mean ${d.mean.toFixed(4)}  p99 ${d.p99}  max ${d.max}  px>4 ${d.px_gt4}  state ${sameState ? 'identical' : 'DIFFERS'}  S.F ${f.same ? `identical (${f.n})` : 'DIFFERS'}` +
    (ctl ? `   | control ref-vs-ref: mean ${ctl.mean.toFixed(4)} p99 ${ctl.p99} max ${ctl.max}` : '') + `   [${q}, ${frames || FRAMES} frames${act ? ', ' + act : ''}${mid ? ', ' + JSON.stringify(mid).slice(0, 40) : ''}]`);
  if (!sameState) console.log('   ref', JSON.stringify(ref.state), '\n   app', JSON.stringify(app.state));
  if (!f.same) console.log('   S.F differs: ' + f.bad.join(', '));
  for (const e of errs) console.log('   ' + e);
}
fs.writeFileSync(path.join(OUT, 'parity.json'), JSON.stringify(rows, null, 1));
console.log(ok ? 'ALL PASS' : 'PARITY FAILED');
process.exit(ok ? 0 : 1);
