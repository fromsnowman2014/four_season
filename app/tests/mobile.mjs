// Phones and tablets (real GPU, headless Chrome with mobile emulation: touch, (pointer: coarse), an iPhone UA):
//   node app/tests/mobile.mjs [--out DIR]   (DIR: optional screenshots of every device and of the open pop-over)
//  - sizing: the canvas fills its box on every device (390x844 / 430x932 / 844x390 phones, 820x1180 / 1180x820
//    tablets) and its buffer is round(box x min(dpr, 1.25)); the camera framing per aspect (portrait: horizontal fov
//    34 deg, yaw -9, pitch -16, tan(fovY/2) from the formula; landscape: bit for bit the desktop camera), seen by the
//    frame uniforms, the precipitation boxes and the touch hint
//  - resize sequences: the keyboard going away (390x458 -> 390x659) and a rotation (390x844 -> 844x390 -> back): the
//    buffer follows, a re-framed camera rebakes behind the first-load reveal (the old buffer is dropped)
//  - the twice-a-second stale-size check alone (ResizeObserver removed, the box changed without any event) resizes
//    the canvas at an uncapped frame rate (the Phase-1 hotfix bug: the check kept resetting the debounce)
//  - touch: a one-finger drag steers the wind along the re-framed camR, a second finger is ignored, lifting it
//    (pointerup / pointercancel / lostpointercapture) ends the drag, the steer decays; a buttonless mouse sweep does
//    nothing; no page pan / zoom over the scene (touch-action), no overscroll
//  - chrome: the pop-over fits a 390x844 portrait and an 844x390 landscape phone without scrolling, finger-sized
//    targets (icon >= 44 px, season chips >= 36, weather >= 44, sliders >= 32), the hint hides when it opens; on a
//    desktop the pop-over keeps its exact geometry
//  - desktop parity: at 1920x1080 the camera vectors equal the Phase-1 constants bit for bit
//  - the quality ladder (node, js/perf.js on a modelled 60 Hz display, vsync-locked and pipelined, 10-70 ms GPU
//    frames): it settles (bounded rung changes, none late), a 30 fps cap costs one probe, 120 Hz is left alone
// Exit 1 on any failed expectation or console error / warning.
import { open } from './cdp.mjs';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../index.html');
const a = process.argv.slice(2);
const OUT = a.includes('--out') ? path.resolve(a[a.indexOf('--out') + 1]) : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg, extra) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}${extra !== undefined ? '  ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); if (!cond) fails++; };
const errs = (tag, e) => { for (const x of e) console.log(`     ${tag}: ${x}`); if (e.length) fails++; };

// ---- the expected camera (core.js S.frameCamera, written out independently) and the Phase-1 constants
const D = Math.PI / 180, smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const P1 = (() => {   // the Phase-1 camera exactly as core.js computed it before the per-aspect framing
  const pitch = -12 * Math.PI / 180, fovY = 44 * Math.PI / 180;
  const camF = [Math.sin(0.0) * Math.cos(pitch), Math.sin(pitch), Math.cos(0.0) * Math.cos(pitch)];
  const r = [camF[2], 0, -camF[0]], l = Math.hypot(r[0], r[2]), camR = [r[0] / l, 0, r[2] / l];
  const camU = [camF[1] * camR[2] - camF[2] * camR[1], camF[2] * camR[0] - camF[0] * camR[2], camF[0] * camR[1] - camF[1] * camR[0]];
  return { camF, camR, camU, TANH: Math.tan(fovY / 2) };
})();
const str = v => Object.is(v, -0) ? '-0' : String(v);
const camStr = c => JSON.stringify([c.camF.map(str), c.camR.map(str), c.camU.map(str), str(c.TANH)]);
const expectFrame = asp => {
  const t = smooth(1.25, 0.6, asp), tanV = Math.max(P1.TANH, Math.tan(17 * D) / asp);
  return { t, tanV, yaw: -9 * t, pitch: -12 - 4 * t, hfov: 2 * Math.atan(tanV * asp) / D };
};
// in-page probe: the camera as strings (sign of zero kept), sizes, uniforms, the first precipitation layer box
const PROBE = `(() => { const S = SNOW, c = S.canvas, s = v => Object.is(v, -0) ? '-0' : String(v), L = S.LAYERS[0];
  return JSON.stringify({ cam: JSON.stringify([[...S.camF].map(s), [...S.camR].map(s), [...S.camU].map(s), s(S.TANH)]), tanH: S.TANH,
    yaw: S.CAM.yaw / (Math.PI / 180), pitch: S.CAM.pitch / (Math.PI / 180), css: [c.clientWidth, c.clientHeight], buf: [c.width, c.height],
    dpr: devicePixelRatio, vp: [innerWidth, innerHeight], uTanH: S.F.uTanH, uCamF: [...(S.F.uCamF || [])], camF: [...S.camF],
    box: [L.hx, L.hy, L.z1], gbCur: !!S.R.gbCur, gbNext: !!S.R.gbNext, ready: snowSim.state().ready,
    hint: (document.getElementById('hint') || {}).textContent || null }); })()`;
const READY = `(async () => { for (let i = 0; i < 400 && !(snowSim.state().ready && !SNOW.R.gbNext); i++) await new Promise(r => setTimeout(r, 25)); return snowSim.state().ready; })()`;
const want = (css, dpr) => css.map(v => Math.max(64, Math.round(v * Math.min(dpr, 1.25))));
const near = (x, y, e = 1e-9) => Math.abs(x - y) <= e;
const TOUCH_HINT = '화면을 쓸어 바람을 일으켜 보세요';
// in-page: wait until the pop-over's open transition (opacity / scale-in) has finished, so rects are untransformed
const SETTLED = `for (let i = 0; i < 200; i++) { const cs = getComputedStyle(document.getElementById('pop')); if (cs.transform === 'none' && cs.opacity === '1') break; await new Promise(r => setTimeout(r, 20)); }`;

async function session(o, fn) {
  const p = await open({ html: APP, ...o });
  try {
    // open() returns once the navigation is sent: wait until the page's own scripts have booted
    for (let i = 0; i < 200 && (await p.evaluate("typeof snowSim !== 'undefined' && !!SNOW.R")) !== true; i++) await sleep(50);
    await fn(p);
  } catch (e) { console.log('FAIL harness: ' + e.message); fails++; }
  finally { errs(o.tag || 'page', p.errors); await p.close(); }
}
const probe = async p => JSON.parse(await p.evaluate(PROBE));

// ---- 1. the quality ladder in node (js/perf.js unmodified, on a modelled display)
{
  const src = fs.readFileSync(path.join(HERE, '../js/perf.js'), 'utf8');
  const ladder = ({ gpuMs, hz = 60, minutes = 60, cap = 0, seed = 1, pipe = false, px = 0.9 }) => {
    const S = { R: {}, allocScaled() {} };
    vm.runInContext(src, vm.createContext({ window: { SNOW: S }, Math, Float32Array }));
    S.resetPerf();
    let r = seed; const rnd = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;
    const P = 1000 / hz, changes = []; let t = 0, gpuDone = 0, shown = 0;
    while (t < minutes * 60000) {
      const q = S.perf, k = q.rs * q.rs * (q.skySteps === 22 ? 0.9 : 1) * (q.flakeMul < 1 ? 0.93 : 1);
      const cost = gpuMs * (1 - px + px * k) * (1 + 0.04 * (rnd() - 0.5));   // fixed part + pixel part x render scale^2
      let dt;
      if (pipe) { gpuDone = Math.max(gpuDone, shown - 2 * P) + cost; const at = Math.max(shown + P, Math.ceil(gpuDone / P - 1e-9) * P); dt = at - shown; shown = at; }
      else dt = Math.max(1, Math.ceil(cost / P - 1e-9)) * P;                 // every frame waits for its vsync
      if (cap) dt = Math.max(dt, 1000 / cap);
      t += dt;
      const lv = q.level; S.controller(dt / 1000);
      if (q.level !== lv) changes.push(t / 1000);
    }
    return { n: changes.length, late: changes.filter(c => c > 1200).length, final: S.perf.level };
  };
  let maxN = 0, maxLate = 0, runs = 0;
  for (const pipe of [false, true]) for (const px of [0.85, 0.97]) for (let g = 10; g <= 70; g += 0.5) {
    const l = ladder({ gpuMs: g, pipe, px }); runs++; maxN = Math.max(maxN, l.n); maxLate = Math.max(maxLate, l.late);
  }
  ok(maxN <= 12 && maxLate === 0, `quality ladder settles on a 60 Hz display (${runs} one-hour runs, GPU 10-70 ms, vsync-locked + pipelined)`, { maxChangesPerHour: maxN, changesAfter20min: maxLate });
  const locked = ladder({ gpuMs: 22 }), lp = ladder({ gpuMs: 10, cap: 30 }), hz120 = ladder({ gpuMs: 12, hz: 120 }), easy = ladder({ gpuMs: 12 });
  ok(locked.final > 0 && locked.final < 5, 'a vsync-locked phone that misses every vsync (steady 30 fps) steps down to a rung that holds 60', locked);
  ok(lp.final === 0 && lp.n === 2, 'a 30 fps cap (low-power mode): one probe, back to full quality', lp);
  ok(hz120.n === 0 && easy.n === 0, 'a GPU that keeps up (60 Hz, 120 Hz) is never touched', [easy.n, hz120.n]);
}

// ---- 2. static: the meta viewport, the favicon, the canvas / page CSS
{
  const html = fs.readFileSync(APP, 'utf8'), css = fs.readFileSync(path.join(HERE, '../css/ui.css'), 'utf8');
  ok(/<meta name="viewport" content="[^"]*viewport-fit=cover/.test(html) && /<link rel="icon" href="data:image\/svg\+xml,/.test(html), 'viewport-fit=cover and an inline SVG favicon');
  ok(/canvas \{[^}]*position: fixed; inset: 0; width: 100%; height: 100%;[^}]*touch-action: none/.test(css) && /overscroll-behavior: none/.test(css), 'canvas: fixed, 100% of its box, touch-action none; no overscroll');
}

// ---- 3. desktop parity
await session({ tag: 'desktop', w: 1920, h: 1080 }, async p => {
  await p.evaluate(READY);
  const s = await probe(p);
  ok(s.cam === camStr(P1) && s.uTanH === P1.TANH, 'desktop 1920x1080: camera vectors and tan(fovY/2) bit-identical to the Phase-1 constants', s.cam);
  ok(JSON.stringify(s.buf) === JSON.stringify([1920, 1080]) && s.hint === '드래그하여 바람을 일으켜 보세요', 'desktop buffer 1920x1080, mouse hint', [s.buf, s.hint]);
  const g = JSON.parse(await p.evaluate(`(async () => { document.getElementById('icon').click(); ${SETTLED}
    const r = e => { const b = e.getBoundingClientRect(); return [b.right, b.bottom, b.width, b.height].map(Math.round); }, pop = document.getElementById('pop');
    return JSON.stringify({ pop: r(pop), seg: r(pop.querySelector('.seg button'))[3], wx: r(pop.querySelector('.wx button'))[3], range: r(pop.querySelector('input[type=range]'))[3], icon: r(document.getElementById('icon')) }); })()`));
  ok(JSON.stringify(g) === JSON.stringify({ pop: [1898, 1018, 272, 387], seg: 26, wx: 50, range: 14, icon: [1906, 1068, 44, 44] }), 'desktop pop-over geometry unchanged (272x387 at 22 / 62 px, chips 26, sliders 14)', g);
});

// ---- 4. devices: sizing, framing, hint
const DEVICES = [['phone portrait', 390, 844, 3], ['large phone portrait', 430, 932, 3], ['phone landscape', 844, 390, 3], ['tablet portrait', 820, 1180, 2], ['tablet landscape', 1180, 820, 2]];
for (const [name, w, h, dpr] of DEVICES) {
  await session({ tag: name, w, h, dpr, mobile: true }, async p => {
    const ready = await p.evaluate(READY);
    const s = await probe(p), asp = s.buf[0] / s.buf[1], e = expectFrame(asp);
    ok(ready && JSON.stringify(s.css) === JSON.stringify([w, h]) && JSON.stringify(s.buf) === JSON.stringify(want([w, h], dpr)),
      `${name} ${w}x${h} dpr ${dpr}: canvas fills the screen, buffer = round(box x 1.25)`, { css: s.css, buf: s.buf });
    const framed = near(s.tanH, e.tanV, 1e-12) && near(s.yaw, e.yaw, 1e-9) && near(s.pitch, e.pitch, 1e-9) && s.uTanH === s.tanH && JSON.stringify(s.uCamF) === JSON.stringify(s.camF);
    const landscape = e.t === 0 ? s.cam === camStr(P1) : e.hfov >= 34 - 1e-9;
    ok(framed && landscape, `${name}: framing (${e.t === 0 ? 'landscape = desktop camera' : `hfov ${e.hfov.toFixed(2)} >= 34, yaw ${e.yaw.toFixed(2)}, pitch ${e.pitch.toFixed(2)}`}) reaches the uniforms`,
      { tanH: +s.tanH.toFixed(5), yaw: +s.yaw.toFixed(3), pitch: +s.pitch.toFixed(3) });
    ok(near(s.box[0], s.box[2] * s.tanH * asp * 1.1 + 0.3, 1e-9) && near(s.box[1], s.box[2] * s.tanH * 1.1 + 0.3, 1e-9), `${name}: precipitation boxes follow the framing`, s.box.map(v => +v.toFixed(3)));
    ok(s.hint === TOUCH_HINT, `${name}: touch hint`, s.hint);
    if (OUT) await p.shot(path.join(OUT, `device-${w}x${h}.png`));
  });
}

// ---- 5. resize sequences: keyboard dismissed, rotation (and back)
const RESEQ = `(async () => { const R = SNOW.R, t0 = performance.now(); let dropped = null;
  while (performance.now() - t0 < 3000) { if (R.gbNext && dropped === null) dropped = !R.gbCur; if (dropped !== null && !R.gbNext) break; await new Promise(r => setTimeout(r, 5)); }
  return dropped; })()`;
const steps = [['keyboard dismissed', 390, 458, [[390, 659]]], ['rotation', 390, 844, [[844, 390], [390, 844]]]];
for (const [name, w0, h0, seq] of steps) {
  let w = w0, h = h0;
  await session({ tag: name, w, h, dpr: 3, mobile: true }, async p => {
    await p.evaluate(READY);
    let prevT = (await probe(p)).tanH;
    for (const [rw, rh] of seq) {
      await p.resize(rw, rh);
      const dropped = await p.evaluate(RESEQ);
      await p.evaluate(READY);
      const s = await probe(p), e = expectFrame(s.buf[0] / s.buf[1]);
      const moved = !near(prevT, e.tanV, 1e-12);
      ok(JSON.stringify(s.css) === JSON.stringify([rw, rh]) && JSON.stringify(s.buf) === JSON.stringify(want([rw, rh], 3)) && near(s.tanH, e.tanV, 1e-12) && (e.t > 0 || s.cam === camStr(P1)) && (!moved || dropped === true) && s.ready,
        `${name} ${w}x${h} -> ${rw}x${rh}: buffer ${s.buf.join('x')} = round(${s.css.join('x')} x 1.25), re-framed${moved ? ', the old buffer dropped (first-load reveal)' : ''}`, { tanH: +s.tanH.toFixed(5), dropped });
      if (OUT) await p.shot(path.join(OUT, `resize-${name.split(' ')[0]}-${rw}x${rh}.png`));
      prevT = s.tanH; w = rw; h = rh;
    }
  });
}

// ---- 6. the stale-size check on its own (no ResizeObserver, a box change no event reports), at an uncapped rate;
// then the normal path (the observer) for comparison
for (const [name, preload] of [['periodic check alone', 'window.ResizeObserver = undefined;'], ['ResizeObserver', '']]) {
  await session({ tag: name, w: 390, h: 844, dpr: 3, mobile: true, preload }, async p => {
    await p.evaluate(READY);
    const r = JSON.parse(await p.evaluate(`(async () => { const c = SNOW.canvas, f0 = SNOW.frameNo; c.style.height = '80%'; const t0 = performance.now();
      while (performance.now() - t0 < 3000 && c.height !== Math.round(c.clientHeight * 1.25)) await new Promise(r => setTimeout(r, 10));
      const ms = Math.round(performance.now() - t0), fps = Math.round((SNOW.frameNo - f0) / (ms / 1000)); c.style.height = '';
      return JSON.stringify({ ms, fps, h: c.height, want: Math.round(c.clientHeight * 0.8 * 1.25) }); })()`));
    // design: <= 500 ms + the 150 ms debounce (check alone), ~150 ms (observer); the uncapped harness adds up to ~250 ms of
    // GPU back-pressure (resizing the canvas waits for the queued frames). The bug this guards against never fires.
    ok(r.h === r.want && r.ms < (preload ? 1500 : 1000), `${name}: a box change without a window resize re-sizes the canvas in ${r.ms} ms at ${r.fps} fps`, r);
  });
}

// ---- 7. touch: one-finger drag
await session({ tag: 'touch', w: 390, h: 844, dpr: 3, mobile: true }, async p => {
  await p.evaluate(READY);
  const r = JSON.parse(await p.evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms)), S = SNOW, m = S.mouse, c = S.canvas, st = () => snowSim.state(), out = {};
    const pe = (type, x, y, buttons, extra) => c.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true,
      pointerId: 7, pointerType: 'touch', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons, clientX: x, clientY: y, width: 20, height: 20 }, extra || {})));
    out.css = [getComputedStyle(c).touchAction, getComputedStyle(document.body).overscrollBehaviorY];
    // a buttonless mouse sweep: nothing
    let calm = true;
    for (let i = 0; i < 20; i++) { pe('pointermove', 40 + i * 15, 500, 0, { pointerType: 'mouse', pointerId: 1 }); await wait(16); calm = calm && !m.drag && m.segs.length === 0 && st().wind.steer === 0; }
    out.mouseNothing = calm;
    // the steer direction against the re-framed camera, in degrees (a stale camR / fwd would be 9 deg off)
    const ang = (v, d) => +(Math.acos(Math.min(1, (v[0] * d[0] + v[2] * d[2]) / Math.hypot(v[0], v[2]) / Math.hypot(d[0], d[2]))) / (Math.PI / 180)).toFixed(2);
    const fwd = [S.camF[0], 0, S.camF[2]], zero = () => { S.wind.s.steer[0] = S.wind.s.steer[2] = 0; };
    // one finger straight up the screen: the wind blows away from the camera along the ground-projected camF
    zero(); pe('pointerdown', 200, 700, 1);
    for (let i = 1; i <= 16; i++) { pe('pointermove', 200, 700 - i * 12, 1); await wait(16); }
    out.upAngle = ang(S.wind.s.steer, fwd); pe('pointerup', 200, 508, 0); zero();
    // one finger to the right (along camR), with a second finger that must be ignored
    pe('pointerdown', 60, 600, 1); out.down = m.drag && m.pid === 7;
    let maxSteer = 0;
    for (let i = 1; i <= 30; i++) {
      pe('pointermove', 60 + i * 9, 600, 1); await wait(16); maxSteer = Math.max(maxSteer, st().wind.steer);
      if (i === 10) { pe('pointerdown', 300, 300, 1, { pointerId: 8, isPrimary: false }); pe('pointermove', 320, 310, 1, { pointerId: 8, isPrimary: false }); }
    }
    out.secondIgnored = m.drag && m.pid === 7;
    out.rightAngle = ang(S.wind.s.steer, S.camR);
    out.maxSteer = +maxSteer.toFixed(2); out.segs = m.segs.length;
    pe('pointerup', 330, 540, 0, { pointerId: 8, isPrimary: false }); out.otherUpKeeps = m.drag;
    pe('pointerup', 330, 540, 0); out.upEnds = !m.drag;
    const s0 = st().wind.steer; await wait(1500); const s1 = st().wind.steer; out.decay = [+s0.toFixed(2), +s1.toFixed(2)];
    // pointercancel and lostpointercapture end a drag too
    pe('pointerdown', 100, 600, 1); pe('pointermove', 140, 600, 1); pe('pointercancel', 140, 600, 0); out.cancelEnds = !m.drag;
    pe('pointerdown', 100, 600, 1); pe('pointermove', 140, 600, 1); c.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 7, pointerType: 'touch', isPrimary: true })); out.lostEnds = !m.drag;
    return JSON.stringify(out); })()`));
  ok(r.css[0] === 'none' && r.css[1] === 'none', 'no page pan / zoom over the scene (canvas touch-action none), no overscroll', r.css);
  ok(r.mouseNothing, 'a buttonless mouse sweep changes nothing');
  ok(r.down && r.maxSteer > 2 && r.segs > 5 && r.rightAngle < 1 && r.upAngle < 1, 'a one-finger drag steers the wind along the re-framed camera (right -> camR, up -> ground camF) and lays a wake',
    { maxSteer: r.maxSteer, segs: r.segs, degFromCamR: r.rightAngle, degFromCamF: r.upAngle });
  ok(r.secondIgnored && r.otherUpKeeps, 'a second finger is ignored');
  ok(r.upEnds && r.decay[1] < r.decay[0] && r.decay[1] > 0, 'lifting the finger ends the drag, the steer decays', r.decay);
  ok(r.cancelEnds && r.lostEnds, 'pointercancel / lostpointercapture end the drag');
});

// ---- 8. the pop-over on a phone, both orientations
for (const [w, h] of [[390, 844], [844, 390]]) {
  await session({ tag: `pop ${w}x${h}`, w, h, dpr: 3, mobile: true }, async p => {
    await p.evaluate(READY);
    await sleep(700);   // the hint is up
    const r = JSON.parse(await p.evaluate(`(async () => { const $ = id => document.getElementById(id), pop = $('pop'), icon = $('icon');
      const hintBefore = !!$('hint') && $('hint').classList.contains('on');
      icon.click(); ${SETTLED}
      const b = pop.getBoundingClientRect(), all = [...pop.querySelectorAll('*')].map(e => e.getBoundingClientRect()).filter(q => q.width > 0);
      const minH = sel => Math.min(...[...pop.querySelectorAll(sel)].map(e => e.getBoundingClientRect().height)), ib = icon.getBoundingClientRect();
      return JSON.stringify({ rect: [b.left, b.top, b.right, b.bottom].map(Math.round), inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
        children: all.every(q => q.left >= b.left - 0.5 && q.right <= b.right + 0.5 && q.top >= b.top - 0.5 && q.bottom <= b.bottom + 0.5 || q.height <= 1),
        scroll: pop.scrollHeight - pop.clientHeight, overIcon: !(b.right <= ib.left || b.bottom <= ib.top), icon: [ib.width, ib.height],
        seg: minH('.seg button'), wx: minH('.wx button'), range: minH('input[type=range]'), hintBefore, hintAfter: !!$('hint') && $('hint').classList.contains('on') }); })()`));
    ok(r.inside && r.children && r.scroll <= 0 && !r.overIcon, `pop-over ${w}x${h}: fits the screen, nothing scrolls, the icon stays free`, { rect: r.rect, scroll: r.scroll });
    ok(r.icon[0] >= 44 && r.icon[1] >= 44 && r.seg >= 36 && r.wx >= 44 && r.range >= 32, `pop-over ${w}x${h}: finger-sized targets`, { icon: r.icon, seg: r.seg, wx: r.wx, range: r.range });
    ok(r.hintBefore && !r.hintAfter, `pop-over ${w}x${h}: the hint hides when it opens`);
    if (OUT) await p.shot(path.join(OUT, `pop-${w}x${h}.png`));
  });
}

console.log(fails ? `${fails} mobile check(s) FAILED` : 'mobile checks passed');
process.exit(fails ? 1 : 0);
