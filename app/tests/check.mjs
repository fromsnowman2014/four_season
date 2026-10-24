// Static checks for the split app (no browser):
//   node app/tests/check.mjs [--ref DIR (default: the Phase-2 app, git f311fc6 via tests/ref.mjs)]
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
// 5b. Phase 3: the scene registry (valley + house: contract shape, recipes registered, profiles with the valley's keys,
//    every scene program's uniforms set with its scene active), the house bake rules (no ENV / ATMOS / SURFACE /
//    HAZARD, one sceneQ and one houseMaterials call site, writes o3), the hazard hooks in the frozen glue; (polish) the
//    hook-free twins: HAZARD_IDLE has HAZARD's five hook signatures, every recipe with HAZARD has a '~idle' twin that
//    assembles without it, and the hooks' early-outs are the ones render.js's hazardsIdle() mirrors.
// 6. Source delta against the Phase-2 app (git f311fc6, tests/ref.mjs: reproducible from the repository; informational,
//    after the Phase-1 uniform renames): lines added / removed per program; fxaa / down / up must be unchanged (they are
//    also stage 0a's and Phase 1's); a missing reference fails.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { phase2Dir } from './ref.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const a = process.argv.slice(2);
const REF = a.includes('--ref') ? path.resolve(a[a.indexOf('--ref') + 1]) : phase2Dir() || '(no Phase-2 reference: git f311fc6)';
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
  const envAfter = { sky: ['fs'], shade: ['fs'], 'shade@house': ['fs'], flake: ['vs', 'fs'], rain: ['vs', 'fs'], comp: ['fs'] };
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
  // ---- Phase 3: the house bake follows the bake rules; the hazard hooks are called from the frozen glue
  {
    const hb = P['gbuf@house'].fs, hsrc = stripComments(app['gbuf@house'].fs.src), hm = stripComments(C.HOUSE_MAT);
    ok(!hb.some(c => ['ENV', 'ATMOS', 'SURFACE', 'SURFACE_HOUSE', 'HAZARD'].includes(c)), `the house bake includes neither ENV, ATMOS, SURFACE nor HAZARD (${hb.join(' + ')})`);
    ok((hsrc.match(/\bsceneQ\(/g) || []).length === 2 && (hsrc.match(/\bhouseMaterials\(/g) || []).length === 2 && !/\bsceneQ\(/.test(hm),
      'the house bake has one sceneQ and one houseMaterials call site (plus their definitions); its materials make no scene query');
    ok(/layout\(location = 3\) out vec4 o3;/.test(hsrc) && /\bo3 = floor\(/.test(hm) && /o3 = vec4\(0\.0\); return;/.test(hsrc), 'the house bake writes G3 (o3) on hits and on the sky');
    const hooks = { FS_SKY: ['hazardSky('], FS_SHADE: ['hazardLight(', 'hazardSurface('], FS_COMP: ['hazardShake(', 'hazardComp('] };
    const miss = Object.entries(hooks).flatMap(([c, fs]) => fs.filter(f => !stripComments(C[c]).includes(f)).map(f => c + ':' + f));
    ok(!miss.length, 'the frozen glue calls the hazard hooks (sky: hazardSky; shade: hazardLight, hazardSurface; comp: hazardShake, hazardComp)' + (miss.length ? ': missing ' + miss.join(', ') : ''));
    const withHaz = ['sky', 'sky@house', 'shade', 'shade@house', 'comp'].filter(n => { const l = P[n].fs; return l.indexOf('HAZARD') !== l.length - 2; });
    ok(!withHaz.length, 'sky / sky@house / shade / shade@house / comp include HAZARD right before their glue' + (withHaz.length ? ': ' + withHaz.join(', ') : ''));
    // (polish) the hook-free twins: HAZARD_IDLE defines the five hooks with HAZARD's signatures; every recipe with
    // HAZARD has a '~idle' twin that assembles without it; the hooks' early-outs are the ones render.js's hazardsIdle
    // mirrors (a hook whose early-out changes fails here until the predicate follows)
    const sig = (src, f) => { const m = new RegExp(`\\n(\\w+ ${f}\\([^)]*\\))`).exec('\n' + stripComments(src)); return m ? m[1].replace(/\s+/g, ' ') : null; };
    const HOOKS = ['hazardSky', 'hazardLight', 'hazardSurface', 'hazardShake', 'hazardComp'];
    const badSig = HOOKS.filter(f => !sig(C.HAZARD, f) || sig(C.HAZARD, f) !== sig(C.HAZARD_IDLE || '', f));
    ok(!badSig.length, 'HAZARD_IDLE defines the five hooks with HAZARD\'s signatures' + (badSig.length ? ': ' + badSig.join(', ') : ''));
    const twins = progs.filter(n => P[n].fs.includes('HAZARD')), badTwin = [];
    for (const n of twins) { try { const t = S.glsl.assemble(n + '~idle').fs.src; if (/\buniform vec4 uFlash\b/.test(t)) badTwin.push(n); } catch (e) { badTwin.push(n + ' (' + e.message + ')'); } }
    ok(twins.length >= 6 && !badTwin.length, `every recipe with HAZARD has a hook-free '~idle' twin (${twins.join(', ')})` + (badTwin.length ? ': ' + badTwin.join(', ') : ''));
    const H = stripComments(C.HAZARD);
    const gates = [/vec3 hazardSky\([^)]*\) \{\s*if \(uFlash\.w > 0\.0 && [^{]*\{[^}]*\}\s*if \(uSmoke\.w <= 0\.0\) return acc;/, /vec3 hazardLight\([^)]*\) \{\s*if \(uFlash\.w <= 0\.0 && uSmoke\.w <= 0\.0\) return col;/,
      /vec3 hazardSurface\([^)]*\) \{\s*if \(uCrack\.w <= 0\.0\) return col;/, /vec2 hazardShake\([^)]*\) \{\s*if \(uQuakeZ\.x <= 1\.0 && uQuake\.w <= 0\.0\) return uv;/,
      /vec3 hazardComp\([^)]*\) \{\s*if \(dot\(uQuakeZ\.yz, uQuakeZ\.yz\) < 1e-12\) return texture\(hdr, uv\)\.rgb \+ texture\(bloom, uv\)\.rgb \* bloomStr;/];
    const badGate = HOOKS.filter((f, i) => !gates[i].test(H));
    ok(!badGate.length, 'the hazard hooks\' early-outs are the ones render.js hazardsIdle() mirrors (flash, smoke, crack, quake, blur)' + (badGate.length ? ': changed in ' + badGate.join(', ') + ' (update hazardsIdle and this check)' : ''));
  }
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
  const shape = ['climate', 'weather', 'ground', 'wind', 'events'].filter(m => {
    const o = S[m];
    return !(o && typeof o.s === 'object' && typeof o.init === 'function' && typeof o.step === 'function' && typeof o.snapshot === 'function' && typeof o.api === 'object');
  });
  ok(!shape.length, 'sim modules have the shape { s, init, step, snapshot, api }' + (shape.length ? ': ' + shape.join(', ') : ''));
  const dshape = ['surface', 'precip', 'atmos', 'house', 'events'].filter(k => !['init', 'step', 'frame'].every(f => typeof (S.derive[k] || {})[f] === 'function'));
  ok(!dshape.length, 'derive modules have the shape { init, step, frame }' + (dshape.length ? ': ' + dshape.join(', ') : ''));
}

// 5b. Phase 3: the scene registry (js/scenes/*.js; ARCHITECTURE.md §14)
{
  const ids = Object.keys(S.scenes), V = S.scenes.valley;
  ok(ids.includes('valley') && ids.includes('house') && S.sceneId === 'valley', `scenes registered: ${ids.join(', ')}; the valley is active at load`);
  const keysOf = o => Object.keys(o).sort().join(',');
  const bad = [];
  for (const id of ids) {
    const sc = S.scenes[id];
    if (sc.id !== id || typeof sc.frameCamera !== 'function' || typeof sc.name !== 'string') bad.push(id + ': id / name / frameCamera');
    if (!(sc.sun.length === 3 && Math.abs(Math.hypot(...sc.sun) - 1) < 1e-9 && sc.sun[1] > 0)) bad.push(id + ': sun (unit, above the horizon)');
    if (!Object.values(sc.progs).every(r => S.glsl.progs[r]) || !sc.progs.gbuf || !sc.progs.shade) bad.push(id + ': progs (gbuf, shade -> registered recipes)');
    if (!(Number.isInteger(sc.bakeIter) && sc.bakeIter > 0)) bad.push(id + ': bakeIter');
    if (sc.derive !== null && !(S.derive[sc.derive] && typeof S.derive[sc.derive].frame === 'function')) bad.push(id + ': derive');
    if (keysOf(sc.atmos) !== keysOf(V.atmos) || keysOf(sc.atmos.mist) !== keysOf(V.atmos.mist) || keysOf(sc.atmos.cloud) !== keysOf(V.atmos.cloud) || keysOf(sc.surface) !== keysOf(V.surface)) bad.push(id + ': atmos / surface profile keys');
  }
  ok(!bad.length, 'every scene has the contract shape (id, name, frameCamera, unit sun, progs, bakeIter, derive, atmos, surface)' + (bad.length ? ': ' + bad.join('; ') : ''));
  // every scene's derive frame sets the uniforms its own programs declare (node: derive with the scene active)
  const missing = [];
  for (const id of ids) {
    S.useScene(id); S.frameCamera(16 / 9); S.deriveF();
    for (const r of Object.values(S.scenes[id].progs)) for (const st of ['vs', 'fs']) for (const u of uniformsOf(app[r][st].src))
      if (!/^u[GN]\d$/.test(u.name) && !(u.name in S.F) && !['uRes', 'uPixAng', 'uIter', 'uSky', 'uSkyD', 'uSway', 'uGb', 'uHdr', 'uBloom', 'uScene', 'uFrame', 'uTwinkleT', 'uPrev', 'uPrevD', 'uBlend', 'uSteps'].includes(u.name)) missing.push(`${r}.${st}:${u.name}`);
  }
  S.useScene('valley'); S.frameCamera(16 / 9);
  ok(!missing.length, 'every scene program uniform has a value with its scene active' + (missing.length ? ': ' + missing.join(', ') : ''));
}

// 6
if (fs.existsSync(path.join(REF, 'index.html'))) {
  const R0 = loadApp(REF, scripts(REF).filter(f => f !== 'js/main.js'));   // (a stage-0a main.js boots unconditionally)
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
      if (['fxaa', 'down', 'up'].includes(n)) ok(!add && !rem, `${n}.${st} unchanged since Phase 2`);
    }
  }
  console.log('info source delta vs Phase 2 (lines, after renames): ' + rows.join('  '));
  // (polish) the hook-free twins against Phase 2: what the idle frame runs
  const tw = [];
  for (const n of ['sky', 'shade', 'comp']) {
    const d = bag(ren(R0.glsl.assemble(n).fs.src), 1, bag(S.glsl.assemble(n + '~idle').fs.src, -1));
    let add = 0, rem = 0;
    for (const v of d.values()) { if (v < 0) add -= v; else rem += v; }
    tw.push(`${n}~idle.fs +${add}/-${rem}`);
  }
  console.log('info the hook-free twins vs Phase 2 (lines): ' + tw.join('  '));
} else ok(false, 'the Phase-2 reference exists for the source delta: ' + REF);

console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
