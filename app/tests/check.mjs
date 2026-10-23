// Static checks for the split app (no browser):
//   node app/tests/check.mjs [--ref work/stage0/app-0a]
// 1. node --check on every js file (syntax); index.html loads every js file, core.js first and main.js last.
// 2. Namespace rule: every file is exactly one expression statement, (function (S) { 'use strict'; ... })(window.SNOW);
//    (core.js creates it: (window.SNOW = {})). A top-level let / const / function / statement fails the check.
// 3. Load-time side effects: every file, main.js included, loads in a bare VM context (no document, no DOM, no GL);
//    main.js boots only when a document exists.
// 4. Registry: every program recipe names registered chunks and assembles; chunk:line mapping round-trips.
// 5. The frozen contract (stage 0b):
//    - the Phase-1 names uStorm / uStormSky are gone; no uniform is declared twice in one assembled stage;
//    - every per-frame program includes ENV right after its precision header; the bake includes neither ENV, ATMOS
//      nor SURFACE, has one sceneQ and one gbMaterials call site, and the materials never call terrainH / sceneQ and
//      read forestDensity once; the bake writes o0..o3;
//    - FS_SHADE is glue: it calls skyPixel, shadeSurface, applyAtmos, applyVeil and surfaceDebug;
//    - every uniform a program declares is set (the G-buffer samplers by bindGB): either in S.F after one sim step + deriveF (node), or
//      explicitly by name in render.js / precip.js; every ENV uniform has a value in S.F;
//    - the sim modules and derive modules have the contract shape.
// 6. Source delta against stage 0a (informational, after the uniform renames): lines added / removed per program;
//    fxaa / down / up must be unchanged.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const a = process.argv.slice(2);
const REF = path.resolve(a.includes('--ref') ? a[a.indexOf('--ref') + 1] : path.join(HERE, '../../work/stage0/app-0a'));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };

const scripts = dir => [...fs.readFileSync(path.join(dir, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
// load the app's scripts into a fresh bare context (no document): returns window.SNOW
function loadApp(dir, files, search = '') {
  const ctx = vm.createContext({ window: { location: { search } }, URLSearchParams, console });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  return ctx.window.SNOW;
}

// load order = the <script src> list of index.html
const files = scripts(APP);
const onDisk = execFileSync('find', [path.join(APP, 'js'), '-name', '*.js']).toString().trim().split('\n').map(f => path.relative(APP, f)).sort();
ok(JSON.stringify([...files].sort()) === JSON.stringify(onDisk), `index.html loads every js file (${files.length})`);
ok(files[0] === 'js/core.js' && files[files.length - 1] === 'js/main.js', 'core.js loads first, main.js last');

// 1 + 2
for (const f of files) {
  const p = path.join(APP, f), src = fs.readFileSync(p, 'utf8');
  let syn = true;
  try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); } catch (e) { syn = false; console.log(e.stderr.toString()); }
  ok(syn, `node --check ${f}`);
  const arg = f === 'js/core.js' ? 'window\\.SNOW = \\{\\}' : 'window\\.SNOW';
  const shape = new RegExp(`^(//[^\\n]*\\n)*\\(function \\(S\\) \\{\\n  'use strict';\\n[\\s\\S]*\\n\\}\\)\\(${arg}\\);\\n$`).test(src);
  let single = true;
  try { new vm.Script('(' + src.trim().replace(/;$/, '') + '\n)'); } catch { single = false; }
  ok(shape && single, `${f} is one IIFE on window.SNOW, nothing else at top level`);
}

// 3
let S = null;
{
  const ctx = vm.createContext({ window: { location: { search: '' } }, URLSearchParams, console });
  for (const f of files) {
    let err = null;
    try { vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f }); } catch (e) { err = e; }
    ok(!err, `${f} loads with no DOM / GL${err ? ': ' + err.message : ''}`);
  }
  S = ctx.window.SNOW;
  const main = fs.readFileSync(path.join(APP, 'js/main.js'), 'utf8');
  ok(/\n  if \(typeof document !== 'undefined'\) boot\(\);\n\}\)\(window\.SNOW\);\n$/.test(main) && !ctx.window.snowSim, 'main.js boots only with a document (the only load-time side effect)');
}

// 4
const progs = Object.keys(S.glsl.progs);
ok(['gbuf', 'sky', 'shade', 'fxaa', 'flake', 'rain', 'down', 'up', 'comp'].every(n => progs.includes(n)), `programs registered: ${progs.join(', ')}`);
const app = {};
for (const n of progs) {
  let e = null;
  try { app[n] = S.glsl.assemble(n); } catch (x) { e = x; }
  ok(!e, `assemble ${n}${e ? ': ' + e.message : ''}`);
}
{ // chunk:line mapping: the first line of every chunk maps to CHUNK:1 and its last line to CHUNK:<count>
  let good = true;
  for (const n of progs) for (const st of ['vs', 'fs']) {
    const part = app[n][st], lines = part.src.split('\n');
    for (const m of part.map) {
      const c = S.glsl.chunks[m.name], cnt = c.split('\n').length;
      if (S.glsl.chunkLine(part.map, m.line) !== m.name + ':1' || S.glsl.chunkLine(part.map, m.line + cnt - 1) !== m.name + ':' + cnt) good = false;
      if (lines.slice(m.line - 1, m.line - 1 + cnt).join('\n') !== c) good = false;
    }
  }
  ok(good, 'compile-error line mapping (assembled line -> chunk:line) round-trips for every chunk');
}

// 5
const C = S.glsl.chunks, P = S.glsl.progs;
const stripComments = src => src.replace(/\/\/[^\n]*/g, '');
// uniform declarations of a GLSL source: [{ name, type }]
const uniformsOf = src => {
  const out = [];
  for (const m of stripComments(src).matchAll(/^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/gm))
    for (const d of m[2].split(',')) out.push({ type: m[1], name: d.trim().replace(/\[.*$/, '') });
  return out;
};
{
  const all = progs.map(n => app[n].vs.src + app[n].fs.src).join('\n');
  ok(!/\buStorm(Sky)?\b/.test(stripComments(all)), 'the Phase-1 uniform names uStorm / uStormSky are gone (uSnowCurtain, uOvercast)');
  const dup = [];
  for (const n of progs) for (const st of ['vs', 'fs']) {
    const seen = new Set();
    for (const u of uniformsOf(app[n][st].src)) { if (seen.has(u.name)) dup.push(`${n}.${st}:${u.name}`); seen.add(u.name); }
  }
  ok(!dup.length, 'no uniform is declared twice in an assembled stage' + (dup.length ? ': ' + dup.join(', ') : ''));
  const envAfter = { sky: ['fs'], shade: ['fs'], flake: ['vs', 'fs'], rain: ['vs', 'fs'], comp: ['fs'] };
  const bad = [];
  for (const [n, sts] of Object.entries(envAfter)) for (const st of sts) {
    const l = P[n][st], i = l.indexOf('ENV');
    if (i !== 1 || !['COMMON', 'PRECISION_F', 'PRECISION_FI'].includes(l[0])) bad.push(`${n}.${st}`);
  }
  ok(!bad.length, 'every per-frame program includes ENV right after its precision header' + (bad.length ? ': ' + bad.join(', ') : ''));
  const gb = P.gbuf.fs, gsrc = stripComments(app.gbuf.fs.src), mats = stripComments(C.GBUF_MATERIALS);
  ok(!gb.some(c => ['ENV', 'ATMOS', 'SURFACE'].includes(c)), `the bake includes neither ENV, ATMOS nor SURFACE (${gb.join(' + ')})`);
  ok((gsrc.match(/\bsceneQ\(/g) || []).length === 2 && (gsrc.match(/\bgbMaterials\(/g) || []).length === 2,
    'the bake has one sceneQ and one gbMaterials call site (plus their definitions)');
  ok(!/\b(terrainH|sceneQ)\(/.test(mats) && (mats.match(/\bforestDensity\(/g) || []).length === 1, 'GBUF_MATERIALS calls no terrainH / sceneQ and forestDensity once');
  ok(/layout\(location = 3\) out vec4 o3;/.test(gsrc) && /\bo3 = mp;/.test(mats) && /o3 = vec4\(0\.0\); return;/.test(gsrc), 'the bake writes G3 (o3) on hits and on the sky');
  const glue = stripComments(C.FS_SHADE);
  ok(['skyPixel(', 'shadeSurface(', 'applyAtmos(', 'applyVeil(', 'surfaceDebug('].every(f => glue.includes(f)) && !/\bfogAtM?\(|\bstratus\(|\bveil\(|\bcloudShadow\(/.test(glue),
    'FS_SHADE is glue: it calls skyPixel / shadeSurface / applyAtmos / applyVeil / surfaceDebug and no atmosphere or veil internals');
}
{ // every declared uniform is set by S.F (after one sim step) or by name in render.js / precip.js
  S.initSim(S.cfg); S.simStep(1 / 60, true); S.deriveF();
  const explicit = new Set(['render.js', 'precip.js'].flatMap(f => [...fs.readFileSync(path.join(APP, 'js', f), 'utf8').matchAll(/\bu\.(u\w+)/g)].map(m => m[1])));
  const missing = [];
  for (const n of progs) for (const st of ['vs', 'fs']) for (const u of uniformsOf(app[n][st].src)) {
    if (/^u[GN]\d$/.test(u.name)) continue;                     // bound by bindGB('uG' + i / 'uN' + i)
    if (!(u.name in S.F) && !explicit.has(u.name)) missing.push(`${n}.${st}:${u.name}`);
  }
  ok(!missing.length, 'every declared uniform is set (S.F or explicit in render.js / precip.js)' + (missing.length ? ': ' + [...new Set(missing)].join(', ') : ''));
  const env = uniformsOf(C.ENV).map(u => u.name).filter(n => !(n in S.F));
  ok(!env.length, `every ENV uniform has a value in S.F (${uniformsOf(C.ENV).length})` + (env.length ? ': missing ' + env.join(', ') : ''));
  const shape = ['climate', 'weather', 'ground', 'wind'].filter(m => {
    const o = S[m];
    return !(o && typeof o.s === 'object' && typeof o.init === 'function' && typeof o.step === 'function' && typeof o.snapshot === 'function' && typeof o.api === 'object');
  });
  ok(!shape.length, 'sim modules have the shape { s, init, step, snapshot, api }' + (shape.length ? ': ' + shape.join(', ') : ''));
  const dshape = ['surface', 'precip', 'atmos'].filter(k => !['init', 'step', 'frame'].every(f => typeof (S.derive[k] || {})[f] === 'function'));
  ok(!dshape.length, 'derive modules have the shape { init, step, frame }' + (dshape.length ? ': ' + dshape.join(', ') : ''));
}

// 6
if (fs.existsSync(path.join(REF, 'index.html'))) {
  const R0 = loadApp(REF, scripts(REF).filter(f => f !== 'js/main.js'));   // stage-0a main.js boots unconditionally
  const ren = t => t.replace(/\buStormSky\b/g, 'uOvercast').replace(/\buStorm\b/g, 'uSnowCurtain');
  const bag = (txt, sign = 1, m = new Map()) => { for (const l of txt.split('\n')) { const k = l.trim(); if (k) m.set(k, (m.get(k) || 0) + sign); } return m; };
  const rows = [];
  for (const n of Object.keys(R0.glsl.progs)) {
    const ref = R0.glsl.assemble(n);
    for (const st of ['vs', 'fs']) {
      const d = bag(ren(ref[st].src), 1, bag(app[n][st].src, -1));
      let add = 0, rem = 0;
      for (const v of d.values()) { if (v < 0) add -= v; else rem += v; }
      rows.push(`${n}.${st} +${add}/-${rem}`);
      if (['fxaa', 'down', 'up'].includes(n)) ok(!add && !rem, `${n}.${st} unchanged since stage 0a`);
    }
  }
  console.log('info source delta vs stage 0a (lines, after renames): ' + rows.join('  '));
} else console.log('info no stage-0a reference at ' + REF);

console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
