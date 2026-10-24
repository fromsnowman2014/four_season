// Phase-3 stage-0 test: the multi-scene engine and the contracts the stage-1 lanes build on.
//   node app/tests/scenes.mjs [--out DIR] [--only node,parity,hooks,house,switch,resize,bundle] [--ref FILE]
// node (no browser):
//   - the sim is the Phase-2 sim: fresh contexts of this app and of the Phase-2 copy (git f311fc6 via tests/ref.mjs, --ref)
//     give the same state() and S.F on the reference's keys after the same ?t, for several seeds / seasons whose
//     histories hold no thunderstorm (Phase 3: thunder comes on its own in summer / late spring, lane Z; the chain
//     itself stays the Phase-2 one: tests/hazards.mjs);
//   - the events scheduler is deterministic (same seed + t -> the same strikes), counter based (a triggered strike or
//     quake never shifts the natural strike sequence), seeds differ; the quake / wildfire / flash envelopes; thunder
//     (a manual pick) brings the lightning channel and strikes; ?wx=lightning:x works; hazardsAuto;
// browser (headless Chrome on the real GPU, ?frames=N captures):
//   parity  the valley pixel-identical to the Phase-2 copy at several states, a phone size included, with the same
//           state() and S.F on the reference's keys (max diff 0; polish: a pair inside the capture-noise floor, 1 LSB
//           on a few pixels under heavy load, is captured again up to twice, so only noise is forgiven: exact());
//   hooks   the hazards show (Phase 3 lane Z): ?event=quake / wildfire and ?wx=...,lightning:1 change the valley; a strike
//           that has ended leaves it pixel-identical to the reference; ?scene / ?event reach state();
//   house   the house placeholder boots ready with zero console errors at 1920x1080 and on a 390x844 dpr-3 phone
//           (portrait framing), its image has content, every ?view debug channel renders;
//   switch  once the first scene is shown its programs and every other scene's are built (the prewarm, gl.js: every
//           recipe a scene uses, the hook-free '~idle' twins included: S.programRecipes()); 20 scene switches (and 6 mid-bake ones) then create no GL object at all (textures,
//           framebuffers, programs constant) and log no error; valley -> house -> valley returns the valley identical to an
//           unswitched run (?frames, the switches at fixed frames; snow, a blizzard's gale, rain on a phone; the same
//           state() and S.F; at most 1 LSB on a few sky pixels: the restarted half-float cloud history);
//   resize  the house through a viewport change (re-framed, re-baked) and a context loss / restore (its programs
//           rebuilt) with no error; a switch between a loss and its event (polish: the context-loss race) logs nothing;
//   bundle  tools/build.mjs still produces a single file whose pixels equal the multi-file app (valley and house).
import { capture, open } from './cdp.mjs';
import { phase2Dir } from './ref.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const APP_DIR = path.resolve(HERE, '..'), APP = path.join(APP_DIR, 'index.html');
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'snow-scenes')));
// the Phase-2 reference (tests/ref.mjs: extracted from git; a missing one fails every check that needs it)
const REF = opt('ref') ? path.resolve(opt('ref')) : phase2Dir() ? path.join(phase2Dir(), 'index.html') : '(no Phase-2 reference: git f311fc6)';
const ONLY = opt('only', '');
const want = k => !ONLY || ONLY.split(',').includes(k);
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (extra !== undefined ? '  ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); if (!c) fails++; };
// (a missing capture, e.g. a harness failure, reads as a full difference instead of crashing the run)
const pdiff = (x, y, d) => fs.existsSync(x) && fs.existsSync(y) ? JSON.parse(execFileSync('python3', [path.join(HERE, 'pdiff.py'), x, y, d]).toString())
  : { max: 255, mean: 255, missing: true };
const TIMING = ['fps', 'frameMs', 'buildMs', 'compileMs'];
const sameOn = (ref, app) => !!ref && !!app && Object.keys(ref).every(k => JSON.stringify(ref[k]) === JSON.stringify(app[k]));
const diffKeys = (ref, app) => Object.keys(ref).filter(k => JSON.stringify(ref[k]) !== JSON.stringify(app[k]));
// Pixel identity up to the capture-noise floor: the bake's stripe pacing follows the wall clock (perf.js adaptStripe),
// so under a heavy machine load the last stripe can land on another frame; the cloud pass, which saw the unbaked rows as
// sky until then, keeps a one-ulp residue in its half-float history on a few sky pixels. The Phase-2 copy against itself
// with only that pacing perturbed differs by exactly this (max 1, mean 0.0); on a quiet machine every capture is max 0
const same = d => d.max <= 1 && d.mean < 0.001;
// Exact parity (polish): max 0. That noise is random from capture to capture, so a pair inside it is captured again,
// up to twice; noise clears, a deterministic delta (a codegen change, however small) repeats and fails. pair(k) does
// one attempt and returns an object with its pdiff as d
async function exact(tag, pair) {
  let r;
  for (let k = 0; k < 3; k++) {
    r = await pair(k);
    if (r.d.max === 0 || !same(r.d)) break;
    console.log(`info ${tag}: max ${r.d.max}, mean ${r.d.mean} (inside the capture-noise floor): captured again`);
  }
  return r;
}

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
const bundle = S => { S.deriveF(); const o = {}; for (const [k, v] of Object.entries(S.F)) if (k !== 'uNoise') o[k] = typeof v === 'number' ? v : Array.from(v); return o; };
const snap = S => { const o = S.state(); for (const k of TIMING) delete o[k]; return o; };
if (want('node')) {
  const refDir = path.dirname(REF);
  if (fs.existsSync(REF)) {
    const bad = [];
    for (const q of ['seed=7&t=600', 'seed=7&t=900&speed=8', 'seed=1&season=summer&t=300', 'seed=5&season=winter&weather=blizzard&t=200', 'seed=2&wx=precip:1,snowFrac:.4&t=120']) {
      const R0 = boot(refDir, q), A = boot(APP_DIR, q);
      const rs = snap(R0), as = snap(A), rf = bundle(R0), af = bundle(A);
      const ds = diffKeys(rs, as), df = diffKeys(rf, af);
      if (ds.length || df.length) bad.push(`${q}: state ${ds.join(',')} F ${df.join(',')}`);
    }
    ok(!bad.length, 'the sim is the Phase-2 sim: state() and S.F equal the Phase-2 copy on its keys (5 queries incl. speed 8, a blizzard, ?wx)', bad.join(' | ') || undefined);
  } else ok(false, 'the Phase-2 reference exists for the sim equality: ' + REF);
  {
    const A = boot(APP_DIR, 'seed=7&wx=lightning:1&t=240'), B = boot(APP_DIR, 'seed=7&wx=lightning:1&t=240'), C = boot(APP_DIR, 'seed=8&wx=lightning:1&t=240');
    const st = S => JSON.stringify([S.events.s.strikes, S.events.s.strike]);
    const n = A.events.s.strikes;
    ok(n >= 15 && n <= 50 && st(A) === st(B) && st(A) !== st(C), `?wx=lightning:1 strikes deterministically (${n} strikes in 240 s, same seed identical, another seed differs)`);
    // a triggered strike and a quake never shift the natural sequence
    const D = boot(APP_DIR, 'seed=7&wx=lightning:1');
    D.advance(100); D.api.trigger('strike'); D.api.trigger('quake'); D.advance(140);
    ok(D.events.s.strikes === n + 1 && JSON.stringify(D.events.s.strike) === JSON.stringify(A.events.s.strike),
      `a triggered strike counts but never shifts the natural sequence (${D.events.s.strikes} = ${n} + 1)`);
    const E = boot(APP_DIR, 'seed=7');
    const env = [];
    E.api.trigger('quake');
    for (let t = 0; t < 16; t += 0.5) { env.push(E.events.s.quake); E.advance(0.5); }
    const peak = Math.max(...env), pAt = env.indexOf(peak) * 0.5;
    ok(peak > 0.55 && pAt >= 2 && pAt <= 6 && env[1] > 0 && env[1] < 0.3 && E.events.s.quake === 0 && E.events.s.quakeT === -1,
      `quake envelope: P waves, the S-wave peak ${peak.toFixed(2)} at ${pAt} s, gone after 15 s`);
    E.api.trigger('wildfire'); E.advance(10); const s10 = E.events.s.smoke; E.advance(50); const s60 = E.events.s.smoke; E.advance(130);
    ok(s10 > 0.1 && s10 < 0.6 && s60 > 0.99 && E.events.s.smoke === 0, `wildfire smoke ramps in (${s10.toFixed(2)} at 10 s, ${s60.toFixed(2)} at 60 s) and clears by 180 s`);
    E.api.trigger('strike'); E.advance(0.02);
    const f1 = E.events.s.flash; E.advance(1.5);
    ok(f1 > 0.2 && E.events.s.flash === 0 && E.state().hazards.strikes === 1, `a triggered strike flashes (${f1.toFixed(2)}) and fades within ~1 s`);
    E.api.trigger('nonsense'); ok(E.state().hazards.strikes === 1, 'an unknown trigger kind does nothing');
    const T = boot(APP_DIR, 'seed=4&season=summer');
    T.api.setWeather('thunder'); T.advance(61);
    const ts = T.state();
    T.advance(120);
    ok(ts.weather.cur === 'thunder' && T.weather.s.ch.lightning === 1 && ts.precip > 0.6 && ts.snowFrac === 0 && T.events.s.strikes > 3,
      `a manual 'thunder' pick: rain + lightning 1 (${T.events.s.strikes} strikes in 120 s)`);
    // Phase 3: thunderstorms come on their own, only in late spring / summer (lane Z: tests/hazards.mjs has the rest)
    let seen = 0, offSeason = 0;
    for (const seed of [1, 2, 3]) { const Y = boot(APP_DIR, `seed=${seed}&season=0`); Y.api.setSeason(null); Y.api.speed = 8; for (let i = 0; i < 300; i++) { Y.advance(1); if ((Y.weather.s.next || Y.weather.s.cur) === 'thunder' || Y.weather.s.ch.lightning > 0) { seen++; const ph = Y.climate.s.phase; if (ph < 0.08 || ph > 0.55) offSeason++; } } }
    ok(seen > 0 && !offSeason, `the automatic weather reaches 'thunder' in late spring / summer only (3 seeds x 2 years at speed 8: ${seen} s of storm)`);
    const H = boot(APP_DIR, 'seed=7');
    H.api.hazardsAuto = true; H.advance(1500);
    ok(H.api.hazardsAuto === true && H.events.s.auto && (H.events.s.quakeT >= 0 || H.events.s.fireT >= 0 || H.events.s.nextAuto > 240), `hazardsAuto schedules hazards on its own (next at ${H.events.s.nextAuto.toFixed(0)} s)`);
    ok(['setScene', 'scene', 'trigger', 'hazardsAuto'].every(k => k in H.api) && typeof Object.getOwnPropertyDescriptor(H.api, 'scene').get === 'function'
      && typeof Object.getOwnPropertyDescriptor(H.api, 'hazardsAuto').get === 'function', 'snowSim API: setScene, scene (getter), trigger, hazardsAuto (accessor)');
  }
}

// ------------------------------------------------------------------------------------------------ browser
const stateOf = `JSON.stringify({ st: snowSim.state(), F: (F => { const o = {}; for (const k of Object.keys(F)) { const v = F[k]; if (typeof v === 'number') o[k] = v; else if (v && v.length !== undefined) o[k] = Array.from(v); } return o; })(SNOW.F) })`;
async function shot(html, tag, q, o = {}) {
  const file = path.join(OUT, tag + '.png');
  if (fs.existsSync(file)) fs.rmSync(file);
  let r;
  // one retry when the harness itself failed (Chrome slow to start on a loaded machine): never a page error
  for (let k = 0; k < 2; k++) {
    r = await capture({ html, out: file, q, w: o.w || 1280, h: o.h || 720, dpr: o.dpr || 1, mobile: o.mobile, preload: o.preload, done: true, settle: 300, eval: stateOf, timeout: 240000 });
    if (!r.errors.some(e => e.startsWith('harness:'))) break;
    console.log(`info retrying ${tag}: ${r.errors.join(' | ')}`);
  }
  if (r.timedOut) r.errors.push('timeout waiting for window.__done');
  const v = r.value ? JSON.parse(r.value) : { st: null, F: null };
  if (v.st) for (const k of TIMING) delete v.st[k];
  return { file, st: v.st, F: v.F, errors: r.errors };
}
const STATES = [
  ['boot', 'ui=0&seed=7&season=autumn'],
  ['winter-snow', 'ui=0&seed=3&season=winter&weather=snow&t=60'],
  ['summer-rain', 'ui=0&seed=5&season=summer&weather=rain&t=90'],
  ['fog', 'ui=0&seed=2&season=autumn&weather=fog&t=90'],
  ['blizzard', 'ui=0&storm=1&seed=7'],
  ['chrome', 'seed=7&season=spring&weather=cumulus&t=30', { frames: 600 }],
  ['phone', 'ui=0&seed=7&season=winter&weather=snow&t=40', { w: 390, h: 844, dpr: 3, mobile: true }],
];
if (want('parity')) {
  if (!fs.existsSync(REF)) { ok(false, 'the Phase-2 reference exists: ' + REF); }
  else for (const [name, q, o = {}] of STATES) {
    const fq = `${q}&frames=${o.frames || 420}`;
    const { r, p, d } = await exact(`parity ${name}`, async () => {
      const r = await shot(REF, `ref-${name}`, fq, o), p = await shot(APP, `app-${name}`, fq, o);
      return { r, p, d: pdiff(r.file, p.file, path.join(OUT, `diff-${name}.png`)) };
    });
    const sameS = sameOn(r.st, p.st), sameF = sameOn(r.F, p.F);
    ok(d.max === 0 && sameS && sameF && !r.errors.length && !p.errors.length,
      `valley parity ${name}: max diff ${d.max} (mean ${d.mean}), state ${sameS ? 'identical' : 'DIFFERS ' + diffKeys(r.st, p.st)}, S.F ${sameF ? 'identical' : 'DIFFERS ' + diffKeys(r.F, p.F)}`,
      [...r.errors, ...p.errors].join(' | ') || undefined);
  }
}
if (want('hooks') && !fs.existsSync(REF)) ok(false, 'the Phase-2 reference exists for the hazard hooks: ' + REF);
if (want('hooks') && fs.existsSync(REF)) {
  const base = 'ui=0&seed=7&season=summer&weather=cumulus&t=30&frames=420';
  const r = await shot(REF, 'hk-ref', base);
  // Phase 3 (lane Z): the hazards show; a strike from boot is over by frame 420 and leaves the valley pixel-identical
  for (const [tag, extra, test, shows] of [['quake', '&event=quake', s => s.hazards.quake > 0, true], ['wildfire', '&event=wildfire', s => s.hazards.smoke > 0, true], ['strike', '&event=strike', s => s.hazards.strikes === 1, false]]) {
    const { p, d } = await exact(`?event=${tag}`, async k => {
      if (k) await shot(REF, 'hk-ref', base);
      const p = await shot(APP, 'hk-' + tag, base + extra);
      return { p, d: pdiff(r.file, p.file, path.join(OUT, `hk-diff-${tag}.png`)) };
    });
    ok((shows ? d.mean > 1 : d.max === 0) && test(p.st) && p.st.scene === 'valley' && !p.errors.length,
      `?event=${tag} reaches the state (${JSON.stringify(p.st.hazards)}) and ${shows ? 'shows' : 'has ended: the valley pixel-identical'} (max ${d.max}, mean ${d.mean})`, p.errors.join(' | ') || undefined);
  }
  const wx = 'ui=0&seed=7&season=summer&wx=cloudCov:.9,overcast:.8,precip:.6,snowFrac:0,tempOff:8&t=60&frames=420';
  const r2 = await shot(REF, 'hk-ref-wx', wx), p2 = await shot(APP, 'hk-wx', wx.replace('tempOff:8', 'tempOff:8,lightning:1'));
  const d2 = pdiff(r2.file, p2.file, path.join(OUT, 'hk-diff-wx.png'));
  ok(d2.mean > 1 && p2.st.hazards.lightning === 1 && p2.st.hazards.strikes > 3 && !p2.errors.length, `?wx=...,lightning:1 strikes (${p2.st.hazards.strikes}) under a darker storm deck (mean change ${d2.mean})`, p2.errors.join(' | ') || undefined);
  const s = await shot(APP, 'hk-scene', 'ui=0&seed=7&scene=nowhere&frames=60');
  ok(s.st.scene === 'valley' && !s.errors.length, '?scene=<unknown> boots the valley');
}
if (want('house')) {
  const q = 'scene=house&ui=0&seed=7&season=autumn&weather=clear&t=30&frames=300';
  const lumStd = f => +execFileSync('python3', ['-c', `from PIL import Image, ImageStat; im = Image.open('${f}').convert('L'); print(ImageStat.Stat(im).stddev[0])`]).toString();
  for (const [tag, o] of [['desktop', { w: 1920, h: 1080 }], ['phone', { w: 390, h: 844, dpr: 3, mobile: true }], ['landscape-phone', { w: 844, h: 390, dpr: 3, mobile: true }]]) {
    const p = await capture({ html: APP, out: path.join(OUT, `house-${tag}.png`), q, ...o, done: true, settle: 300, timeout: 240000,
      eval: `JSON.stringify({ st: snowSim.state(), pitch: SNOW.CAM.pitch * 180 / Math.PI, pos: SNOW.CAM.pos, gbuf: SNOW.P.gbuf.name, shade: SNOW.P.shade.name, cozy: SNOW.F.uCozy })` });
    const v = JSON.parse(p.value || '{}'), sd = lumStd(path.join(OUT, `house-${tag}.png`));
    ok(!p.errors.length && v.st && v.st.ready && v.st.scene === 'house' && v.gbuf === 'gbuf@house' && v.shade === 'shade@house' && sd > 25 && v.cozy > 0,
      `house ${tag}: ready with zero errors, its programs, an image with content (luma sd ${sd.toFixed(1)}), camera pitch ${v.pitch && v.pitch.toFixed(1)} deg at z ${v.pos && v.pos[2].toFixed(1)}`, p.errors.join(' | ') || undefined);
  }
  const views = ['alb', 'snowT', 'g3r', 'g3g', 'g3b', 'g3a', 'cEff', 'wet'];
  const errs = [];
  for (const v of views) { const r = await capture({ html: APP, out: path.join(OUT, `house-view-${v}.png`), q: `scene=house&ui=0&seed=7&view=${v}&frames=200`, w: 640, h: 360, done: true, settle: 100 }); errs.push(...r.errors); }
  ok(!errs.length, `every ?view debug channel renders in the house (${views.join(' ')})`, errs.join(' | ') || undefined);
}
const PRE = `(() => { const P = WebGL2RenderingContext.prototype, live = window.__gl = { tex: 0, fb: 0, prog: 0 };
  const wrap = (c, d, k) => { const oc = P[c], od = P[d]; P[c] = function (...a) { const r = oc.apply(this, a); if (r) live[k]++; return r; }; P[d] = function (o) { if (o) live[k]--; return od.call(this, o); }; };
  wrap('createTexture', 'deleteTexture', 'tex'); wrap('createFramebuffer', 'deleteFramebuffer', 'fb'); wrap('createProgram', 'deleteProgram', 'prog'); })();`;
const READY = `new Promise(r => { const f = () => window.snowSim && snowSim.state().ready && !SNOW.R.gbNext ? r(1) : setTimeout(f, 30); f(); })`;
if (want('switch')) {
  const p = await open({ html: APP, q: 'ui=0&seed=7', w: 1280, h: 720, preload: PRE });
  await p.evaluate(READY);
  // the prewarm (gl.js): after the first ready every scene's programs are built in the background
  const pw = JSON.parse(await p.evaluate(`new Promise(r => { const t0 = performance.now(), f = () => SNOW.prewarm.state === 'done' || performance.now() - t0 > 60000
    ? r(JSON.stringify({ pw: SNOW.prewarm, built: SNOW.builtPrograms().length + SNOW.prewarmedPrograms().length, recipes: SNOW.programRecipes().length })) : setTimeout(f, 50); f(); })`));
  const g0 = JSON.parse(await p.evaluate('JSON.stringify(window.__gl)'));
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const id = i % 2 ? 'valley' : 'house';
    const r = await p.evaluate(`(() => { const r = snowSim.setScene('${id}'); return JSON.stringify([r, snowSim.scene, snowSim.state().ready]); })()`);
    const [ret, sc, rdy] = JSON.parse(r);
    if (ret !== id || sc !== id || rdy !== false) seen.add(`switch ${i}: ${r}`);
    await p.evaluate(READY);
  }
  const g1 = JSON.parse(await p.evaluate('JSON.stringify(window.__gl)'));
  for (let i = 0; i < 6; i++) { await p.evaluate(`snowSim.setScene('${i % 2 ? 'valley' : 'house'}')`); await new Promise(r => setTimeout(r, 40)); }
  await p.evaluate(READY);
  const g2 = JSON.parse(await p.evaluate('JSON.stringify(Object.assign(window.__gl, { same: snowSim.setScene("valley") }))'));
  ok(pw.pw.state === 'done' && pw.built === pw.recipes && g0.prog === pw.recipes, `the prewarm compiles every scene's programs after the first ready (${pw.built} of ${pw.recipes} recipes, ${g0.prog} GL programs, ${pw.pw.ext ? 'KHR_parallel_shader_compile' : 'idle callbacks'})`);
  ok(!seen.size && g1.tex === g0.tex && g1.fb === g0.fb && g1.prog === g0.prog && g2.tex === g0.tex && g2.fb === g0.fb && g2.prog === g0.prog && !p.errors.length,
    `20 switches + 6 mid-bake switches: no GL leak, nothing built (textures ${g0.tex} -> ${g1.tex} -> ${g2.tex}, framebuffers ${g0.fb} -> ${g1.fb} -> ${g2.fb}, programs ${g0.prog} -> ${g1.prog} -> ${g2.prog}), setScene returns the scene, not ready until its bake`,
    [...seen, ...p.errors].join(' | ') || undefined);
  await p.close();
  // without KHR_parallel_shader_compile (hidden) the prewarm builds them in idle callbacks; the first switch then builds
  // nothing either
  {
    const NOEXT = `(() => { const g = WebGL2RenderingContext.prototype.getExtension; WebGL2RenderingContext.prototype.getExtension = function (n) { return n === 'KHR_parallel_shader_compile' ? null : g.call(this, n); }; })();`;
    const q = await open({ html: APP, q: 'scene=house&ui=0&seed=7', w: 960, h: 540, preload: NOEXT + PRE });
    await q.evaluate(READY);
    const v = JSON.parse(await q.evaluate(`new Promise(r => { const t0 = performance.now(), f = () => SNOW.prewarm.state === 'done' || performance.now() - t0 > 60000
      ? (() => { const n0 = window.__gl.prog, b0 = SNOW.builtPrograms().length + SNOW.prewarmedPrograms().length; snowSim.setScene('valley'); r(JSON.stringify({ pw: SNOW.prewarm, b0, n0, n1: window.__gl.prog, ms: SNOW.sceneCompileMs, recipes: SNOW.programRecipes().length })); })() : setTimeout(f, 50); f(); })`));
    await q.evaluate(READY);
    ok(v.pw.state === 'done' && !v.pw.ext && v.b0 === v.recipes && v.n1 === v.n0 && !q.errors.length,
      `the prewarm without KHR_parallel_shader_compile (idle callbacks, from the house): ${v.b0} of ${v.recipes} recipes built, the first switch builds none (programs ${v.n0} -> ${v.n1}, ${v.ms.toFixed(1)} ms in programsFor)`, q.errors.join(' | ') || undefined);
    await q.close();
  }
  // valley -> house -> valley at fixed frames, then the valley is pixel-identical to an unswitched run
  const SW = `(function w() { const S = window.SNOW; if (S && S.frameNo >= 90 && !window.__a) { window.__a = 1; snowSim.setScene('house'); }
    if (S && S.frameNo >= 200 && !window.__b) { window.__b = 1; snowSim.setScene('valley'); } if (!window.__b) requestAnimationFrame(w); })();`;
  // (polish: the sim's camera-relative state, the gale line and the screen-space scroll / sway integrals, follows the
  // world's reference frame, core.js S.worldR / worldF, not the live camera: the world is the same whatever the place,
  // in a gale and in portrait too, so no weather is excluded any more)
  for (const [tag, q, o] of [['snow', 'ui=0&seed=7&season=winter&weather=snow&t=20&frames=700', {}], ['blizzard', 'ui=0&seed=7&season=winter&weather=blizzard&t=20&frames=700', {}],
    ['rain-phone', 'ui=0&seed=5&season=summer&weather=rain&t=20&frames=700', { w: 390, h: 844, dpr: 3, mobile: true }]]) {
    const r = await shot(APP, `sw-straight-${tag}`, q, o), s = await shot(APP, `sw-switched-${tag}`, q, { ...o, preload: SW });
    const d = pdiff(r.file, s.file, path.join(OUT, `sw-diff-${tag}.png`));
    // (the house derive's own outputs, uCozy and uHouse*, stay in S.F after a visit: no valley program reads them)
    for (const v of [r, s]) if (v.F) for (const k of Object.keys(v.F)) if (/^uHouse|^uCozy$/.test(k)) delete v.F[k];
    // (a switch restarts the cloud pass's temporal history by contract: its half-float EMA re-converges to within one
    // 8-bit step, so a few dozen sky pixels may differ by 1 LSB; anything more is a real difference)
    ok(same(d) && sameOn(r.st, s.st) && sameOn(r.F, s.F) && !s.errors.length,
      `valley -> house -> valley (${tag}): the valley returns identical to an unswitched run (max ${d.max}, mean ${d.mean}: the restarted sky history), the same state and S.F`,
      [...s.errors, ...(sameOn(r.st, s.st) ? [] : ['state ' + diffKeys(r.st, s.st)]), ...(sameOn(r.F, s.F) ? [] : ['F ' + diffKeys(r.F, s.F)])].join(' | ') || undefined);
  }
}
if (want('resize')) {
  const p = await open({ html: APP, q: 'scene=house&ui=0&seed=7&season=winter&weather=snow&t=60', w: 1280, h: 720 });
  await p.evaluate(READY);
  const c0 = JSON.parse(await p.evaluate('JSON.stringify([SNOW.CAM.pitch, SNOW.CAM.pos[2]])'));
  await p.resize(600, 1000);
  await new Promise(r => setTimeout(r, 400));
  await p.evaluate(READY);
  const c1 = JSON.parse(await p.evaluate('JSON.stringify([SNOW.CAM.pitch, SNOW.CAM.pos[2], SNOW.R.W, SNOW.R.H, snowSim.scene])'));
  await p.evaluate("(() => { const e = SNOW.gl.getExtension('WEBGL_lose_context'); e.loseContext(); setTimeout(() => e.restoreContext(), 300); return 1; })()");
  await new Promise(r => setTimeout(r, 900));
  await p.evaluate(READY);
  const c2 = JSON.parse(await p.evaluate('JSON.stringify([SNOW.P.gbuf.name, SNOW.P.shade.name, snowSim.scene, snowSim.state().ready, SNOW.builtPrograms().length])'));
  await p.evaluate("snowSim.setScene('valley')"); await p.evaluate(READY);
  const c3 = JSON.parse(await p.evaluate('JSON.stringify([SNOW.P.gbuf.name, snowSim.scene, snowSim.state().ready])'));
  ok(c1[0] > c0[0] && c1[1] < c0[1] && c1[2] < c1[3] && c1[4] === 'house' && c2[0] === 'gbuf@house' && c2[1] === 'shade@house' && c2[2] === 'house' && c2[3] && c3[0] === 'gbuf' && c3[2] && !p.errors.length,
    `house: a portrait resize re-frames (pitch ${(c0[0] * 57.3).toFixed(1)} -> ${(c1[0] * 57.3).toFixed(1)} deg, z ${c0[1].toFixed(1)} -> ${c1[1].toFixed(1)}) and rebakes; a context loss rebuilds the house programs (${c2[4]} built); back to the valley`,
    p.errors.join(' | ') || undefined);
  // (polish) a switch in the gap between a loss and its webglcontextlost event (gl.isContextLost() already true): nothing
  // runs against the dead context (it logged 11 framebuffer errors), and the restore builds the switched-to scene
  const n0 = p.errors.length;
  await p.evaluate("(() => { const e = SNOW.gl.getExtension('WEBGL_lose_context'); e.loseContext(); snowSim.setScene('house'); setTimeout(() => e.restoreContext(), 300); return 1; })()");
  await new Promise(r => setTimeout(r, 900));
  await p.evaluate(READY);
  const c4 = JSON.parse(await p.evaluate('JSON.stringify([SNOW.P.gbuf.name, snowSim.scene, snowSim.state().ready, SNOW.ctxLost])'));
  ok(c4[0] === 'gbuf@house' && c4[1] === 'house' && c4[2] && !c4[3] && p.errors.length === n0,
    `a switch between a context loss and its event does nothing against the dead context; the restore builds the house (${c4.join(', ')})`, p.errors.slice(n0).join(' | ') || undefined);
  await p.close();
}
if (want('bundle')) {
  const out = path.join(OUT, 'bundle', 'snow.html');
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), path.relative(ROOT, out)], { cwd: ROOT });
  for (const [tag, q] of [['valley', 'ui=0&seed=7&season=winter&weather=snow&t=30&frames=360'], ['house', 'scene=house&ui=0&seed=7&season=summer&weather=rain&t=60&frames=360']]) {
    const { b, d } = await exact(`bundle ${tag}`, async () => {
      const m = await shot(APP, `bd-multi-${tag}`, q), b = await shot(out, `bd-single-${tag}`, q);
      return { b, d: pdiff(m.file, b.file, path.join(OUT, `bd-diff-${tag}.png`)) };
    });
    ok(d.max === 0 && !b.errors.length && b.st.scene === tag, `tools/build.mjs single file == multi-file pixels (${tag}: max ${d.max})`, b.errors.join(' | ') || undefined);
  }
}
console.log(fails ? `${fails} scene check(s) FAILED` : 'scene tests passed');
process.exit(fails ? 1 : 0);
