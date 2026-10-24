// The house scene's own checks (Phase-3 owner: lane H).
//   node app/tests/house.mjs [--out DIR] [--only ids,bake,phone,variant,nan,cozy,comp,look] [--html FILE (e.g. another build, for an A/B)]
// 1. ids     the house boots (1920x1080 dpr 2: a 2400x1350 buffer) with zero console errors; the baked G-buffers (read
//            back) of the two default framings (that landscape and a 390x844 phone; the street shows only in portrait)
//            hold every material id of the house table (ARCHITECTURE.md §14: 1..18) and none outside it; SURFACE_HOUSE
//            gets the previous frame (uPrevHdr, wet-ground reflections) and the cloud pass (uSkyH);
// 2. bake    the bake's GPU time (EXT_disjoint_timer_query_webgl2, per stripe, summed; min of 3) and wall time (all
//            stripes, then a 1-px readback; min of 3) for both variants at 2400x1350 and on a 390x844 dpr-3 phone
//            (488x1055); the leafy variant has leaf on the deciduous / fruit crowns, the bare one none (G3.g); the bake
//            stays under the 2 s budget;
// 3. phone   the portrait framing (390x844: eye 1.65 m, pitch 12.5 deg, vfov 58; stage 2b: was 11) and the landscape phone (844x390: the
//            desktop camera: eye 1.65 m, pitch 5 deg, vfov 40), ready with zero errors;
// 4. variant a live leaf drop (a season pick past late November at speed 8): the bare variant is rebaked behind the
//            live scene (state().ready stays true), then dissolved in (mid-dissolve the shown buffer is partly the new
//            one), the buffers swap, no texture / framebuffer leaks, zero errors; and back (leaf-out);
//    nan     the baked G-buffer (G0-G2 read back as floats) holds no NaN / Inf: both variants (a summer and a winter
//            boot), at 1920x1080 dpr 2 and on a 390x844 dpr-3 phone, plus the recorded stripe sequence that once
//            reproduced an Apple-GPU miscompile (stage 2b nanprobe4);
// 5. cozy    uCozy follows the weather (clear < rain / fog); a quake's flicker (derive/events.js) reaches shade@house and
//            comp@house alike.
// 6. comp    (node) the per-scene composite hook (post.js): the valley's comp is FS_COMP without the hook; FS_COMP_SCENE
//            is FS_COMP plus exactly the documented lines (the sceneComp / sceneReveal prototypes, the sceneComp call,
//            the reveal line); against the Phase-2 app (git f311fc6 via tests/ref.mjs; polish: was the gitignored
//            stage-0 copy) the valley's comp recipe is Phase 2's with HAZARD before FS_COMP, every other chunk
//            byte-identical, and FS_COMP is Phase 2's plus exactly lane Z's shake / hazardComp lines (idle-neutral); the
//            house maps comp to 'comp@house' (COMP_HOUSE + FS_COMP_SCENE); every scene gets a comp program; (browser)
//            the valley's composite pixels equal the Phase-2 copy's (snow sparkle on, no hazard), the house runs
//            comp@house;
// 7. look    (node) the house look over the weathers: a clear evening is golden (warm sun, clouds, highlight colour,
//            no halo cost), a deck / rain / fog / snow evening is dusk (lower exposure, uCozy 1, the air scatters the
//            lamps: fog most), a thunderstorm darker than rain; (browser) every weather renders with zero errors.
import { capture, open } from './cdp.mjs';
import { phase2Dir } from './ref.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const APP = path.resolve(opt('html', path.join(HERE, '../index.html')));
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'snow-house')));
const ONLY = opt('only', '');
const want = k => !ONLY || ONLY.split(',').includes(k);
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const IDS = { 1: 'lawn', 2: 'fruit tree', 3: 'palm', 4: 'evergreen', 5: 'deciduous', 6: 'roof', 7: 'siding', 8: 'trim', 9: 'glass', 10: 'garage door',
  11: 'concrete', 12: 'asphalt', 13: 'brick', 14: 'gravel', 15: 'wood', 16: 'lamp', 17: 'soil', 18: 'fixtures' };
const READY = `new Promise(r => { const f = () => window.snowSim && snowSim.state().ready && !SNOW.R.gbNext ? r(1) : setTimeout(f, 30); f(); })`;
const PRE = `(() => { const P = WebGL2RenderingContext.prototype, live = window.__gl = { tex: 0, fb: 0 };
  const wrap = (c, d, k) => { const oc = P[c], od = P[d]; P[c] = function (...a) { const r = oc.apply(this, a); if (r) live[k]++; return r; }; P[d] = function (o) { if (o) live[k]--; return od.call(this, o); }; };
  wrap('createTexture', 'deleteTexture', 'tex'); wrap('createFramebuffer', 'deleteFramebuffer', 'fb'); })();`;
// the shown G-buffer's material histogram, and per variant-relevant id the leaf pixels (G3.g ~1)
const HIST = `(() => {
  const S = SNOW, gl = S.gl, g = S.R.gbCur, n = g.w * g.h, px = new Float32Array(n * 4), hist = {};
  gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.readPixels(0, 0, g.w, g.h, gl.RGBA, gl.FLOAT, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let sky = 0;
  for (let i = 0; i < n; i++) { if (px[i * 4] > 60000) { sky++; continue; } const m = Math.floor(px[i * 4 + 1] + 0.001); hist[m] = (hist[m] || 0) + 1; }
  return JSON.stringify({ hist, sky: sky / n, res: [g.w, g.h], buildMs: snowSim.state().buildMs, prev: !!(S.F.uPrevHdr && S.F.uPrevHdr.tex), skyH: !!(S.F.uSkyH && S.F.uSkyH.tex) });
})()`;
// Bake benchmark: the active scene's bake program into a scratch G-buffer of the canvas size, in 16 stripes; GPU time
// per stripe by timer queries (summed), wall time of all stripes to a 1-px readback; min of reps; then the leaf pixels of
// the deciduous / fruit crowns of the result. Resolves after the queries are available
const BENCH = (variant, reps) => `(async () => {
  const S = SNOW, gl = S.gl, R = S.R, W = R.W, H = R.H, u = S.P.gbuf.u;
  const e8 = R.g3Fmt === 'RGBA8';
  const texs = [0, 1, 2, 3].map(i => i === 3 && e8 ? S.tex(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST) : S.tex(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST));
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const NS = 16, px = new Uint8Array(4);
  const setup = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H);
    gl.useProgram(S.P.gbuf.p); S.uploadF(S.P.gbuf);
    gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uPixAng, 2 * S.TANH / H); gl.uniform1i(u.uIter, S.scene.bakeIter);
    gl.uniform1f(u.uVariant, ${variant}); gl.uniform3f(u.uDissolve, 0, 0, 0); for (let i = 0; i < 4; i++) gl.uniform1i(u['uN' + i], 7);
  };
  const stripe = k => { const y0 = Math.floor(H * k / NS), y1 = Math.floor(H * (k + 1) / NS); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, y0, W, y1 - y0); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disable(gl.SCISSOR_TEST); };
  const sync = () => { gl.readBuffer(gl.COLOR_ATTACHMENT3); gl.readPixels(0, 0, 1, 1, gl.RGBA, e8 ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT, e8 ? px : new Uint16Array(4)); };
  const walls = [], gpus = [];
  for (let r = 0; r < ${reps}; r++) {
    setup(); sync();
    const t0 = performance.now();
    for (let k = 0; k < NS; k++) stripe(k);
    sync(); walls.push(performance.now() - t0);
    if (ext) {
      setup();
      const qs = [];
      for (let k = 0; k < NS; k++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); stripe(k); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (let i = 0; i < 200 && !gl.getQueryParameter(qs[NS - 1], gl.QUERY_RESULT_AVAILABLE); i++) await new Promise(r => requestAnimationFrame(r));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && gl.getQueryParameter(qs[NS - 1], gl.QUERY_RESULT_AVAILABLE)) gpus.push(qs.reduce((s, q) => s + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6, 0));
      qs.forEach(q => gl.deleteQuery(q));
    }
  }
  // the leaf pixels of the deciduous (5) and fruit (2) crowns in the result
  setup(); for (let k = 0; k < NS; k++) stripe(k);
  const f0 = new Float32Array(W * H * 4), f3 = e8 ? new Uint8Array(W * H * 4) : new Float32Array(W * H * 4);
  gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, f0);
  gl.readBuffer(gl.COLOR_ATTACHMENT3); gl.readPixels(0, 0, W, H, gl.RGBA, e8 ? gl.UNSIGNED_BYTE : gl.FLOAT, f3);
  let leaf = 0, wood = 0, haze = 0;
  for (let i = 0; i < W * H; i++) {
    if (f0[i * 4] > 60000) continue;
    const m = Math.floor(f0[i * 4 + 1] + 0.001), g = f3[i * 4 + 1] / (e8 ? 255 : 1), al = f3[i * 4 + 3] / (e8 ? 255 : 1);
    if (m === 2 || m === 5) { if (g > 0.75) leaf++; else if (g < 0.25) wood++; }
    if (al > 0.003 && al < 0.5 || al > 0.503) haze++;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  texs.forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(fbo);
  return JSON.stringify({ res: [W, H], wall: Math.min(...walls), gpu: gpus.length ? Math.min(...gpus) : null, leaf, wood, haze });
})()`;

let seen = {};
if (want('ids') || want('bake')) {
  const p = await open({ html: APP, q: 'scene=house&ui=0&seed=7&season=autumn&weather=clear', w: 1920, h: 1080, dpr: 2 });
  await p.evaluate(READY);
  await new Promise(r => setTimeout(r, 300));
  const v = JSON.parse(await p.evaluate(HIST));
  ok(!p.errors.length, 'the house boots with zero console errors' + (p.errors.length ? ': ' + p.errors.join(' | ') : ''));
  const ids = Object.keys(v.hist).map(Number);
  for (const i of ids) seen[i] = (seen[i] || 0) + v.hist[i];
  console.log(`info first bake ${v.buildMs} ms (wall, striped, the stripe budget adapting) at ${v.res}; sky ${(100 * v.sky).toFixed(1)}%; materials: ` + ids.sort((x, y) => x - y).map(i => `${IDS[i] || i} ${(100 * v.hist[i] / v.res[0] / v.res[1]).toFixed(2)}%`).join(', '));
  if (want('ids')) ok(v.prev && v.skyH, 'SURFACE_HOUSE gets the previous frame (uPrevHdr) and the cloud pass (uSkyH)');
  if (want('bake')) {
    const L = JSON.parse(await p.evaluate(BENCH(0, 3))), B = JSON.parse(await p.evaluate(BENCH(1, 3)));
    console.log(`info bake at ${L.res}: leafy GPU ${L.gpu && L.gpu.toFixed(1)} ms, wall ${L.wall.toFixed(1)} ms; bare GPU ${B.gpu && B.gpu.toFixed(1)} ms, wall ${B.wall.toFixed(1)} ms (load ${os.loadavg()[0].toFixed(1)})`);
    ok(L.wall < 2000 && B.wall < 2000, `the desktop bake stays under 2 s (${L.wall.toFixed(0)} / ${B.wall.toFixed(0)} ms wall at ${L.res})`);
    ok(L.leaf > 2000 && B.leaf === 0 && B.wood > L.wood && B.haze > 1000 && L.haze === 0,
      `the bare variant: no leaf on the deciduous / fruit crowns (leafy ${L.leaf} px, bare ${B.leaf}), more wood (${L.wood} -> ${B.wood} px), twig haze (${B.haze} px)`);
    ok(!p.errors.length, 'the bake benchmark logs no error' + (p.errors.length ? ': ' + p.errors.join(' | ') : ''));
  }
  await p.close();
}
if (want('phone') || want('bake') || want('ids')) {
  for (const [tag, o] of [['phone', { w: 390, h: 844, dpr: 3, mobile: true }], ['landscape-phone', { w: 844, h: 390, dpr: 3, mobile: true }]]) {
    const p = await open({ html: APP, q: 'scene=house&ui=0&seed=7&season=summer&weather=clear', ...o });
    await p.evaluate(READY);
    const c = JSON.parse(await p.evaluate('JSON.stringify({ pos: SNOW.CAM.pos, pitch: SNOW.CAM.pitch * 180 / Math.PI, fov: SNOW.CAM.fovY * 180 / Math.PI, res: snowSim.state().res })'));
    await p.shot(path.join(OUT, `house-${tag}.png`));
    const port = tag === 'phone';
    if (port) { const h = JSON.parse(await p.evaluate(HIST)).hist; for (const i of Object.keys(h)) seen[i] = (seen[i] || 0) + h[i]; }
    const want_ = port ? { pos: [3.4, 1.65, -23], pitch: 12.5, fov: 58 } : { pos: [1.2, 1.65, -22.5], pitch: 5, fov: 40 };
    const near = (x, y) => Math.abs(x - y) < 0.06;
    ok(!p.errors.length && c.pos.every((x, i) => near(x, want_.pos[i])) && near(c.pitch, want_.pitch) && near(c.fov, want_.fov),
      `${tag} ${c.res}: ${port ? 'portrait' : 'landscape'} framing (eye ${c.pos.map(x => x.toFixed(2))}, pitch ${c.pitch.toFixed(2)}, vfov ${c.fov.toFixed(1)}), ready, zero errors` + (p.errors.length ? ': ' + p.errors.join(' | ') : ''));
    if (port && want('bake')) {
      const L = JSON.parse(await p.evaluate(BENCH(0, 3))), B = JSON.parse(await p.evaluate(BENCH(1, 3)));
      console.log(`info bake at ${L.res} (phone): leafy GPU ${L.gpu && L.gpu.toFixed(1)} ms, wall ${L.wall.toFixed(1)} ms; bare GPU ${B.gpu && B.gpu.toFixed(1)} ms, wall ${B.wall.toFixed(1)} ms`);
      ok(L.wall < 400 && B.wall < 400, `the phone bake (${L.res}) stays small on the M-series GPU (${L.wall.toFixed(0)} / ${B.wall.toFixed(0)} ms wall)`);
    }
    await p.close();
  }
}
if (want('ids')) {
  const ids = Object.keys(seen).map(Number), missing = Object.keys(IDS).map(Number).filter(i => !ids.includes(i)), extra = ids.filter(i => !IDS[i]);
  ok(!missing.length && !extra.length, 'every house material id (1..18) is in the default framings (landscape + phone portrait) and none outside the table' + (missing.length ? ': missing ' + missing.map(i => IDS[i]).join(', ') : '') + (extra.length ? ': unknown ' + extra.join(', ') : ''));
}
if (want('variant')) {
  // late autumn at speed 8; a pick past the leaf drop (~25 Nov), then back to spring
  const p = await open({ html: APP, q: 'scene=house&ui=0&seed=7&season=0.735&speed=8&weather=clear', w: 1280, h: 720, preload: PRE });
  await p.evaluate(READY);
  const g0 = JSON.parse(await p.evaluate('JSON.stringify([window.__gl, SNOW.R.gbVar])'));
  // a slow dissolve (8 s) so the mid state can be inspected; the shown buffer's G0 before, mid and after
  await p.evaluate('SNOW.VARIANT_DISSOLVE = 8; window.__g0 = null; snowSim.setSeason(0.79); 1');
  const SNAPG = `(() => { const S = SNOW, gl = S.gl, g = S.R.gbCur, a = new Float32Array(g.w * g.h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, g.w, g.h, gl.RGBA, gl.FLOAT, a); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!window.__g0) { window.__g0 = a; return 0; } let d = 0, n = 0; for (let i = 0; i < a.length; i += 4) { if (window.__g0[i] < 60000 || a[i] < 60000) { n++; if (a[i] !== window.__g0[i] || a[i + 1] !== window.__g0[i + 1] || a[i + 2] !== window.__g0[i + 2]) d++; } } return d / n; })()`;
  await p.evaluate(SNAPG);
  let readyAll = true, started = false, mid = null, t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const s = JSON.parse(await p.evaluate('JSON.stringify({ vb: SNOW.R.varBake, done: SNOW.R.gbDone, dis: SNOW.R.disP, v: SNOW.R.gbVar, ready: snowSim.state().ready })'));
    if (!s.ready) readyAll = false;
    if (s.vb) started = true;
    if (s.vb && s.done >= 0 && s.dis > 0.3 && s.dis < 0.7 && mid === null) { mid = +(await p.evaluate(SNAPG)); await p.shot(path.join(OUT, 'house-dissolve-mid.png')); }
    if (started && !s.vb && s.v === 1) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const fin = +(await p.evaluate(SNAPG));
  const end = JSON.parse(await p.evaluate('JSON.stringify([window.__gl, SNOW.R.gbVar, SNOW.R.varMs, snowSim.state().season])'));
  await p.shot(path.join(OUT, 'house-dissolve-bare.png'));
  ok(started && end[1] === 1 && mid !== null && mid > 0.1 * fin && mid < 0.9 * fin && readyAll && end[0].tex === g0[0].tex && end[0].fb === g0[0].fb && !p.errors.length,
    `leaf drop: the bare variant rebaked behind the live scene (ready throughout: ${readyAll}), dissolved in (mid-dissolve ${mid !== null ? (100 * mid).toFixed(1) : '-'}% of the visible pixels new, ${(100 * fin).toFixed(1)}% at the end), swapped (variant ${g0[1]} -> ${end[1]}, ${end[2].toFixed(0)} ms incl. the slowed dissolve), textures ${g0[0].tex} -> ${end[0].tex}, framebuffers ${g0[0].fb} -> ${end[0].fb}` + (p.errors.length ? ': ' + p.errors.join(' | ') : ''));
  await p.evaluate('SNOW.VARIANT_DISSOLVE = 2; snowSim.setSeason(0.1); 1');
  t0 = Date.now(); let back = null;
  while (Date.now() - t0 < 40000) { back = JSON.parse(await p.evaluate('JSON.stringify([SNOW.R.gbVar, !!SNOW.R.gbNext, window.__gl])')); if (back[0] === 0 && !back[1]) break; await new Promise(r => setTimeout(r, 100)); }
  ok(back[0] === 0 && !back[1] && back[2].tex === g0[0].tex && !p.errors.length, `leaf-out: back to the leafy variant (textures ${back[2].tex}), zero errors`);
  await p.close();
}
if (want('nan')) {
  // the baked G-buffer holds no NaN / Inf (polish: the bake's NaN guards): G0-G2 (half floats; G3 is 8-bit) read back
  // for both variants in both default framings, and once more after the stripe sequence that once reproduced an
  // Apple-GPU miscompile (stage 2b, work/phase3/stage2/s2b/nanprobe4.mjs: NaN normals in whole tile rows)
  const NANS = `(() => { const S = SNOW, gl = S.gl, g = S.R.gbCur, n = g.w * g.h, a = new Float32Array(n * 4), bad = [0, 0, 0], rows = new Set();
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    for (let k = 0; k < 3; k++) { gl.readBuffer(gl.COLOR_ATTACHMENT0 + k); gl.readPixels(0, 0, g.w, g.h, gl.RGBA, gl.FLOAT, a);
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad[k]++; rows.add(((i >> 2) / g.w) | 0); } }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return JSON.stringify({ bad, rows: rows.size, res: [g.w, g.h], v: S.R.gbVar }); })()`;
  const SEQ = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52];
  const STRIPES = `(() => { const seq = ${JSON.stringify(SEQ)}; let k = 0; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(t => { const S = window.SNOW; if (S && S.adaptStripe && !S.__fx) { S.__fx = 1; S.adaptStripe = () => { S.R.gbRows = seq[Math.min(k++, seq.length - 1)]; }; } cb(t); }); })();`;
  const rows = [];
  for (const [tag, season, o] of [['desktop leafy', 'summer', { w: 1920, h: 1080, dpr: 2 }], ['desktop bare', 'winter', { w: 1920, h: 1080, dpr: 2 }],
    ['phone leafy', 'summer', { w: 390, h: 844, dpr: 3, mobile: true }], ['phone bare', 'winter', { w: 390, h: 844, dpr: 3, mobile: true }],
    ['stripe sequence', 'summer', { w: 1600, h: 900, preload: STRIPES, q: '&t=90' }]]) {
    const { q: extra = '', ...view } = o;
    const p = await open({ html: APP, q: `scene=house&ui=0&seed=7&season=${season}&weather=clear` + extra, ...view });
    await p.evaluate(READY);
    const v = JSON.parse(await p.evaluate(NANS));
    rows.push({ tag, ...v, errors: p.errors.length });
    await p.close();
  }
  const okAll = rows.every(r => !r.bad[0] && !r.bad[1] && !r.bad[2] && !r.errors) && rows[0].v === 0 && rows[1].v === 1 && rows[2].v === 0 && rows[3].v === 1;
  ok(okAll, 'the baked G-buffer is finite everywhere (G0-G2 read back; both variants, desktop 2400x1350 and phone 488x1055, the recorded stripe sequence): '
    + rows.map(r => `${r.tag} ${r.res} v${r.v} non-finite ${r.bad.join('/')}${r.rows ? ' in ' + r.rows + ' rows' : ''}${r.errors ? ', ' + r.errors + ' console errors' : ''}`).join('; '));
}
if (want('cozy')) {
  const cozy = {};
  for (const w of ['clear', 'rain', 'fog']) {
    const r = await capture({ html: APP, q: `scene=house&ui=0&seed=7&season=autumn&weather=${w}&t=70&frames=60`, w: 640, h: 360, done: true, settle: 50, eval: 'SNOW.F.uCozy' });
    cozy[w] = r.value;
    if (r.errors.length) { console.log(r.errors.join(' | ')); fails++; }
  }
  ok(cozy.clear > 0 && cozy.rain > cozy.clear && cozy.fog > cozy.clear, `uCozy follows the weather: ${JSON.stringify(cozy)}`);
  // the quake's light flicker (derive/events.js scales F.uCozy after this lane's derive) reaches every pass that draws
  // the lights: the windows and light pools (shade@house) and the halos in the air (comp@house) get the same value
  const p = await open({ html: APP, q: 'scene=house&ui=0&seed=7&season=autumn&weather=rain&t=70', w: 960, h: 540 });
  await p.evaluate(READY);
  const v = JSON.parse(await p.evaluate(`new Promise(res => {
    const S = SNOW, gl = S.gl, out = []; snowSim.trigger('quake');
    const f = () => { const sh = S.R.drawn.shade, co = S.R.drawn.comp;   // (the programs this frame drew: polish, the hook-free twins while idle)
      out.push([S.F.uCozy, gl.getUniform(sh.p, sh.u.uCozy), gl.getUniform(co.p, co.u.uCozy), S.events.s.quake]);
      if (S.events.s.quakeT < 6 && out.length < 20000) requestAnimationFrame(f); else res(JSON.stringify({ out, comp: co.name, shade: sh.name })); };
    requestAnimationFrame(f); })`));
  const same = v.out.every(([f, a, b]) => a === Math.fround(f) && b === Math.fround(f));
  const shock = v.out.filter(r => r[3] > 0.5).map(r => r[0]);
  ok(same && v.shade === 'shade@house' && v.comp === 'comp@house' && shock.length > 10 && Math.min(...shock) < 0.6 * cozy.rain && !p.errors.length,
    `the quake flicker reaches the windows / light pools (shade@house) and the halos (comp@house) alike: uCozy ${cozy.rain} -> ${Math.min(...shock).toFixed(2)} in the main shock (${v.out.length} frames, uploads identical: ${same})` + (p.errors.length ? ': ' + p.errors.join(' | ') : ''));
  await p.close();
}
// ---- 6 / 7 in node: load the app's scripts in a bare VM (as tests/check.mjs does)
const loadVM = dir => {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);   // (main.js boots only with a document)
  const ctx = vm.createContext({ window: { location: { search: '' } }, URLSearchParams, console });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  return ctx.window.SNOW;
};
if (want('comp') || want('look')) {
  const S = loadVM(path.dirname(APP));
  if (want('comp')) {
    const C = S.glsl.chunks, vc = S.glsl.assemble('comp').fs.src, hc = S.glsl.assemble('comp@house').fs.src;
    const calls = src => (src.match(/\bsceneComp\(/g) || []).length;
    // FS_COMP_SCENE minus FS_COMP: exactly the sceneComp prototype and call, and (stage 2b) the sceneReveal prototype
    // and the reveal line that draws the scene's backdrop in place of FS_COMP's flat pale one
    const sl = C.FS_COMP_SCENE.split('\n'), fl = C.FS_COMP.split('\n'), extra = sl.filter(l => !fl.includes(l));
    const PALE = '  c = mix(vec3(0.80, 0.85, 0.90), c, fade);';
    ok(calls(vc) === 0 && calls(hc) === 3 && sl.length === fl.length + 3 && extra.length === 4 && /^vec3 sceneComp\(vec3 c, vec2 uv, vec2 frag\);/.test(extra[0])
      && /^vec3 sceneReveal\(vec2 frag\);/.test(extra[1]) && /^ {2}c = sceneComp\(c, uvS, frag\);/.test(extra[2]) && /^ {2}if \(fade < 1\.0\) c = mix\(sceneReveal\(gl_FragCoord\.xy\), c, fade\);/.test(extra[3])
      && C.FS_COMP_SCENE.replace(/\n[^\n]*sceneComp\([^\n]*/g, '').replace(/\n[^\n]*sceneReveal\(vec2 frag\);[^\n]*/, '').replace(/\n {2}if \(fade < 1\.0\) c = mix\(sceneReveal[^\n]*/, '\n' + PALE) === C.FS_COMP,
      'the composite hook: the valley comp has no hook, comp@house = FS_COMP + a sceneComp prototype and one call, a sceneReveal prototype and the reveal line in place of the pale one (both defined by COMP_HOUSE after it), nothing else');
    // the Phase-2 app (git f311fc6, tests/ref.mjs): the valley comp is Phase 2's but for lane Z's hazard hooks (whose
    // idle neutrality the pixel checks prove: below, tests/scenes.mjs parity, tests/hazards.mjs): undoing FS_COMP's
    // shake / hazardComp lines gives Phase 2's FS_COMP back, and Phase 2's recipe with HAZARD and today's two chunks
    // assembles to today's source
    const REF = phase2Dir();
    if (REF) {
      const R = loadVM(REF), rc = R.glsl.progs.comp, ac = S.glsl.progs.comp;
      const changed = [...new Set([...ac.vs, ...ac.fs])].filter(c => R.glsl.chunks[c] !== C[c]);
      const undo = C.FS_COMP
        .replace(/\n {2}\/\/ the hazards' screen shake[^\n]*\n {2}\/\/[^\n]*\n {2}vec2 uvS = hazardShake\(uv\), frag = gl_FragCoord\.xy \+ \(uvS - uv\) \* uRes;\n {2}vec3 c = hazardComp\(uHdr, uBloom, uBloomStr, uvS\);/,
          '\n  vec3 c = texture(uHdr, uv).rgb + texture(uBloom, uv).rgb * uBloomStr;')
        .replace(/\buvS\b/g, 'uv').replace(/\bfrag\b/g, 'gl_FragCoord.xy');
      const recipe = JSON.stringify({ vs: rc.vs, fs: rc.fs.flatMap(c => c === 'FS_COMP' ? ['HAZARD', 'FS_COMP'] : [c]) }) === JSON.stringify({ vs: ac.vs, fs: ac.fs });
      const p2 = R.glsl.chunks.FS_COMP;
      R.glsl.chunks.HAZARD = C.HAZARD; R.glsl.chunks.FS_COMP = C.FS_COMP; R.glsl.progs.comp = { vs: ac.vs, fs: ac.fs };
      ok(recipe && changed.join() === 'HAZARD,FS_COMP' && undo === p2 && C.FS_COMP !== p2
        && R.glsl.assemble('comp').fs.src === vc && R.glsl.assemble('comp').vs.src === S.glsl.assemble('comp').vs.src,
        `the valley comp is the Phase-2 one plus lane Z's hooks: Phase 2's recipe with HAZARD before FS_COMP, every other chunk byte-identical (changed: ${changed.join(', ') || 'none'}), FS_COMP = Phase 2's + the shake / hazardComp lines`);
    } else ok(false, 'the Phase-2 reference (git f311fc6, tests/ref.mjs) exists for the valley comp check');
    const sets = {};
    for (const id of Object.keys(S.scenes)) { S.useScene(id); const pr = S.scenes[id].progs; sets[id] = pr.comp || 'comp'; }
    S.useScene('valley');
    ok(sets.valley === 'comp' && sets.house === 'comp@house', `every scene has a comp program (${JSON.stringify(sets)})`);
  }
  if (want('look')) {
    // the house's frame derive per weather (settled channels, mid-autumn), the values it hands the passes
    const look = {};
    S.useScene('house'); S.frameCamera(16 / 9);
    for (const w of ['clear', 'cumulus', 'overcast', 'fog', 'rain', 'snow', 'blizzard', 'thunder']) {
      S.initSim(Object.assign({}, S.cfg, { season: 'autumn', weather: w, seed: 7 }));
      S.weather.api.setWeather(w, { instant: true });
      for (let i = 0; i < 30; i++) S.simStep(1 / 30, true);
      S.deriveF();
      const F = S.F;
      look[w] = { sunR: F.uSunCol[0] / Math.max(F.uSunCol[2], 1e-6), exp: F.uExposure, cozy: F.uCozy, air: F.uHouseComp[0], gold: F.uHouseComp[1], cov: F.uCloudCov };
    }
    S.useScene('valley');
    const L = look;
    console.log('info look ' + Object.entries(L).map(([w, v]) => `${w}: sun r/b ${v.sunR.toFixed(2)} exp ${v.exp.toFixed(2)} cozy ${v.cozy.toFixed(2)} air ${v.air.toFixed(4)} gold ${v.gold.toFixed(2)} clouds ${v.cov.toFixed(2)}`).join(' | '));
    ok(L.clear.sunR > 1.8 && L.clear.gold > 0.6 && L.clear.cov >= 0.45 && L.clear.air < 0.002 && L.clear.cozy < 0.5,
      'a clear evening is golden: a warm low sun, golden highlights, a few clouds, clear air (no halo pass), the lights at their baseline');
    ok(['overcast', 'fog', 'rain', 'snow', 'thunder'].every(w => L[w].cozy > 0.85) && L.rain.exp < L.clear.exp && L.fog.air > L.rain.air && L.rain.air > 0.004 && L.thunder.exp < L.rain.exp,
      'a deck / fog / rain / snow / storm evening is dusk: the lights up, darker, the air scatters the lamps (fog most), a thunderstorm darker than rain');
  }
}
if (want('comp')) {
  // the valley's composite in pixels: a crisp winter evening (the snow sparkle on: the composite's own work) equals the
  // Phase-2 copy's (no hazard running; at most the capture-noise floor of tests/scenes.mjs: 1 LSB on a few sky pixels)
  const REF = phase2Dir();
  if (REF) {
    const q = 'ui=0&seed=3&season=winter&weather=clear&t=60&frames=360', o = { q, w: 1280, h: 720, done: true, settle: 100, timeout: 240000 };
    // (polish: max 0; a pair inside the capture-noise floor is captured again up to twice: noise clears, a delta repeats)
    let a0, a1, d;
    for (let k = 0; k < 3; k++) {
      a0 = await capture({ ...o, html: path.join(REF, 'index.html'), out: path.join(OUT, 'comp-valley-phase2.png') });
      a1 = await capture({ ...o, html: APP, out: path.join(OUT, 'comp-valley.png'), eval: 'SNOW.F.uGradeP[2]' });
      d = JSON.parse(execFileSync('python3', [path.join(HERE, 'pdiff.py'), path.join(OUT, 'comp-valley-phase2.png'), path.join(OUT, 'comp-valley.png'), path.join(OUT, 'comp-valley-diff.png')]).toString());
      if (d.max === 0 || !(d.max <= 1 && d.mean < 0.001)) break;
      console.log(`info the valley composite: max ${d.max}, mean ${d.mean} (inside the capture-noise floor): captured again`);
    }
    ok(d.max === 0 && a1.value > 0 && !a0.errors.length && !a1.errors.length,
      `the valley composite is pixel-identical to the Phase-2 copy (winter, sparkle gate ${(+a1.value).toFixed(2)}: max ${d.max}, mean ${d.mean})`);
  } else ok(false, 'the Phase-2 reference (git f311fc6, tests/ref.mjs) exists for the valley composite pixels');
}
if (want('look')) {
  const errs = [];
  for (const w of ['clear', 'cumulus', 'overcast', 'fog', 'rain', 'snow', 'blizzard', 'thunder']) {
    const r = await capture({ html: APP, out: path.join(OUT, `house-look-${w}.png`), q: `scene=house&ui=0&seed=7&season=autumn&weather=${w}&t=60&frames=90`, w: 800, h: 450, done: true, settle: 50,
      eval: 'JSON.stringify([SNOW.P.comp === SNOW.programsFor("house").comp, SNOW.F.uCozy])' });
    if (r.errors.length || r.timedOut) errs.push(w + ': ' + (r.errors.join(' | ') || 'timeout'));
    if (w === 'clear' && !(JSON.parse(r.value || '[false]')[0])) errs.push('the house does not run comp@house');
  }
  ok(!errs.length, 'every weather renders in the house (800x450, autumn) with zero errors and the house composite' + (errs.length ? ': ' + errs.join('; ') : ''));
}
console.log(fails ? `${fails} house check(s) FAILED` : 'house tests passed');
process.exit(fails ? 1 : 0);
