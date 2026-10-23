// Headless Chrome capture helper (real GPU through ANGLE/Metal) over the DevTools protocol. No dependencies.
// Library:  import { capture, open } from './cdp.mjs'   (open: a live page session, see below)
// CLI:      node cdp.mjs <html> <out.png> [--q "a=1&b=2"] [--w 1600] [--h 900] [--dpr 1] [--wait ms | --done]
//                                          [--settle ms] [--eval "js expr"]
//   --done   wait for window.__done (the ?frames=N test hook) instead of a fixed time, then --settle ms more
//            (CSS transitions of the chrome finish; the canvas is static because the loop has stopped)
//   --early  js evaluated 0.8 s after navigation, while the loop runs;  --resize WxH  resize the viewport then
//   --act    js evaluated right after __done, before the settle wait (e.g. a click on the chrome)
//   --wait   fixed wait in ms; also reports the uncapped rAF throughput over that window (fps)
// Prints console errors / warnings / exceptions; the result object holds them, plus fps and the --eval value.
// o.deadline (ms, default 300000): a watchdog on every DevTools call; a page that stops answering is reported as an
// error ('harness: ...') with timedOut set, instead of hanging the run.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// open(o): a live page session (Chrome launched, the page navigated, console errors collected) for scripted tests:
//   const p = await open({ html, q, w, h, dpr });  await p.evaluate(js);  await p.shot(file);  await p.resize(w, h);
//   p.errors (console errors / warnings / exceptions so far);  await p.close()
//   o.mobile: emulate a phone (mobile viewport, touch with 5 points: (pointer: coarse) and (hover: none), an iPhone
//   user agent; resize keeps it); o.preload: js run in the page before any of its scripts (e.g. to remove an API)
// Every CDP call is guarded by o.deadline (ms, default 300000) per call, so a page that stops answering fails loudly.
export async function open(o) {
  const W = o.w || 1600, H = o.h || 900, DPR = o.dpr || 1, LIMIT = o.deadline || 300000;
  const port = 9300 + Math.floor(Math.random() * 600);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--disable-gpu-sandbox',
    '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=metal', '--hide-scrollbars', `--window-size=${W},${H}`,
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion', '--enable-gpu-rasterization', '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--enable-precise-memory-info', 'about:blank'], { stdio: 'ignore' });
  const errors = [];
  let ws = null;
  const close = async () => { try { ws && ws.close(); } catch {} try { ch.kill('SIGKILL'); } catch {} await sleep(100); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
  try {
    let tgt;
    for (let i = 0; i < 100 && !tgt; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); tgt = l.find(t => t.type === 'page'); } catch {} }
    if (!tgt) throw new Error('no Chrome target');
    ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
  } catch (e) { await close(); throw e; }
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) errors.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 1200));
    else if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 1200));
    else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) errors.push('log.' + m.params.entry.level + ': ' + m.params.entry.text.slice(0, 600));
  });
  const send = (method, params = {}) => new Promise((r, rej) => {
    const i = ++id, t = setTimeout(() => { pend.delete(i); rej(new Error(`no answer from the page within ${LIMIT / 1000} s (${method})`)); }, LIMIT);
    pend.set(i, m => { clearTimeout(t); r(m); }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.result?.value ?? r.result.exceptionDetails?.exception?.description; };
  const metrics = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: DPR, mobile: !!o.mobile });
  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Page.bringToFront');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await metrics(W, H);
    if (o.mobile) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1' });
    }
    if (o.preload) await send('Page.addScriptToEvaluateOnNewDocument', { source: o.preload });
    await send('Page.navigate', { url: pathToFileURL(path.resolve(o.html)).href + (o.q ? '?' + o.q : '') });
  } catch (e) { await close(); throw e; }
  return {
    errors, send, evaluate, close,
    resize: (w, h) => metrics(w, h),
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); return file; },
  };
}

// capture(o): one page, one result (the options in the header). Never throws: harness failures (no Chrome, a page
// that stops answering) are reported in res.errors as 'harness: ...' with res.timedOut set.
export async function capture(o) {
  const res = { errors: [], fps: null, value: undefined, file: o.out || null, timedOut: false };
  let p = null;
  try {
    p = await open(o);
    res.errors = p.errors;
    await sleep(800);
    // mid-run perturbations (while the loop is running): a viewport resize and / or a js expression
    if (o.resize) await p.resize(o.resize[0], o.resize[1]);
    if (o.early) res.early = await p.evaluate(o.early);
    if (o.done) {
      const t0 = Date.now(), limit = o.timeout || 180000;
      while (!(await p.evaluate('window.__done === true'))) { if (Date.now() - t0 > limit) { res.timedOut = true; break; } await sleep(100); }
      if (o.act) res.act = await p.evaluate(o.act);       // e.g. open the pop-over once the loop has stopped
      await sleep(o.settle ?? 1500);
    } else {
      await p.evaluate('window.__fc=0;(function f(){window.__fc++;requestAnimationFrame(f)})();0');
      const t0 = Date.now();
      await sleep(o.wait ?? 4000);
      const fc = await p.evaluate('window.__fc');
      res.fps = fc / ((Date.now() - t0) / 1000);
    }
    if (o.eval) res.value = await p.evaluate(o.eval);
    if (o.out) await p.shot(o.out);
  } catch (e) { res.errors.push('harness: ' + e.message); res.timedOut = true; }
  finally { if (p) await p.close(); }
  return res;
}

// ---- CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
  const r = await capture({ html: a[0], out: a[1] && !a[1].startsWith('--') ? a[1] : null, q: opt('q', ''), w: +opt('w', 1600), h: +opt('h', 900), dpr: +opt('dpr', 1),
    done: a.includes('--done'), act: opt('act', ''), early: opt('early', ''), resize: a.includes('--resize') ? opt('resize').split('x').map(Number) : null, wait: +opt('wait', 4000), settle: +opt('settle', 1500), eval: opt('eval', '') });
  for (const e of r.errors) console.log(e);
  if (r.timedOut) console.log('TIMEOUT waiting for window.__done');
  if (r.fps !== null) console.log('FPS ~', r.fps.toFixed(1));
  if (r.value !== undefined) console.log('EVAL:', JSON.stringify(r.value));
  if (r.file) console.log('saved', r.file);
  process.exit(0);
}
