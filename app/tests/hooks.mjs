// Browser checks of the contract hooks (real GPU, headless Chrome, file://), deterministic captures:
//   node app/tests/hooks.mjs [--out DIR] [--frames 300]
// 1. ?gb16=1 (the all-RGBA16F G-buffer fallback) renders the same image as the mixed RGBA8 G3 (within the capture
//    noise floor: the base state is captured twice, and two identical captures can differ by a few 1-3/255 pixels)
//    and reports it.
// 2. ?view= for each debug channel: renders without errors, every channel differs from the others (the wet view with
//    ?ground=wet:.8, so it is not flat), and the shaded image is untouched when the hook is absent.
// 3. ?wx=, ?ground= and ?yp= reach the frame: the state reports them and the image changes (Phase 2: the year phase
//    drives the season shading, so ?yp=0.4 turns the late-October meadow into summer).
// Every page must log zero console errors / warnings.
import { capture } from './cdp.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../index.html');
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'snow-hooks')));
const FRAMES = +opt('frames', 300);
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const pdiff = (x, y) => JSON.parse(execFileSync('python3', [path.join(HERE, 'pdiff.py'), x, y]).toString());

async function shot(tag, q) {
  const file = path.join(OUT, tag + '.png');
  const r = await capture({ html: APP, out: file, q: `${q}&ui=0&seed=7&frames=${FRAMES}`, w: 1280, h: 720, done: true, settle: 300, eval: 'JSON.stringify(snowSim.state())' });
  if (r.timedOut) r.errors.push('timeout');
  for (const e of r.errors) console.log(`   ${tag}: ${e}`);
  return { file, st: JSON.parse(r.value || 'null'), errors: r.errors };
}

const base = await shot('base', 't=200&storm=0');
ok(!base.errors.length && base.st.g3 === 'RGBA8', `default G-buffer: G3 is ${base.st.g3}, no console errors`);
const base2 = await shot('base2', 't=200&storm=0');
const ctl = pdiff(base.file, base2.file);
const g16 = await shot('gb16', 't=200&storm=0&gb16=1');
const d16 = pdiff(base.file, g16.file);
ok(!g16.errors.length && g16.st.g3 === 'RGBA16F' && d16.max <= Math.max(1, ctl.max) && d16.mean <= ctl.mean + 0.0005,
  `?gb16=1: G3 is ${g16.st.g3}, image identical to RGBA8 within the capture noise (max diff ${d16.max}, mean ${d16.mean}; ` +
  `two identical captures: max ${ctl.max}, mean ${ctl.mean})`);

const views = {};
for (const v of ['alb', 'snowT', 'g3r', 'g3g', 'g3b', 'g3a', 'cEff', 'wet']) {
  views[v] = await shot('view-' + v, 't=200&storm=0&view=' + v + (v === 'wet' ? '&ground=wet:.8' : ''));
  ok(!views[v].errors.length && views[v].st.flakeCount === 0, `?view=${v}: no errors, no flakes`);
}
const names = Object.keys(views);
let distinct = true;
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  if (pdiff(views[names[i]].file, views[names[j]].file).mean < 1) { distinct = false; console.log(`   ${names[i]} ~ ${names[j]}`); }
}
ok(distinct, 'the debug channels differ from each other');
ok(pdiff(views.alb.file, base.file).mean > 5, '?view= replaces the shaded image');

const wx = await shot('wx', 't=200&storm=0&wx=overcast:1,cloudCov:.95');
ok(!wx.errors.length && wx.st.sky === 1 && pdiff(base.file, wx.file).mean > 5, `?wx=overcast:1,cloudCov:.95 -> state sky ${wx.st.sky}, the image changes`);
const gr = await shot('ground', 't=200&storm=0&ground=cover:1');
ok(!gr.errors.length && gr.st.coverage === 1 && pdiff(base.file, gr.file).mean > 5, `?ground=cover:1 -> state coverage ${gr.st.coverage}, the image changes`);
const yp = await shot('yp', 't=200&storm=0&yp=0.4');
const dyp = pdiff(base.file, yp.file);
ok(!yp.errors.length && yp.st.phase === 0.4 && yp.st.season === 'summer' && yp.st.seasonPinned === false && dyp.mean > 5,
  `?yp=0.4 pins the phase (state ${yp.st.phase} ${yp.st.season}, the season chip stays automatic) and the season shading follows it (mean diff ${dyp.mean})`);

console.log(`captures in ${OUT}`);
console.log(fails ? `${fails} hook check(s) FAILED` : 'hook checks passed');
process.exit(fails ? 1 : 0);
