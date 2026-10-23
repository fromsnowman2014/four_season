// Browser smoke test of the split app over file:// (real GPU, headless Chrome):
//   node app/tests/smoke.mjs [--out DIR]
// 1. a plain load (no query, chrome visible, live clock) runs for 6 s with zero console errors / warnings and gets ready;
// 2. a deliberately broken chunk registered at runtime fails to compile with the error mapped to CHUNK:line.
import { capture } from './cdp.mjs';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../index.html');
const a = process.argv.slice(2);
const OUT = path.resolve(a.includes('--out') ? a[a.indexOf('--out') + 1] : path.join(os.tmpdir(), 'snow-smoke'));
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

{
  const r = await capture({ html: APP, out: path.join(OUT, 'plain.png'), wait: 6000, eval: 'JSON.stringify(snowSim.state())' });
  const st = JSON.parse(r.value || 'null');
  ok(!r.errors.length, 'plain file:// load: no console errors / warnings / exceptions' + (r.errors.length ? '\n     ' + r.errors.join('\n     ') : ''));
  ok(st && st.ready, `plain load is ready (fps ${r.fps.toFixed(0)}, ${st && st.res}, ${st && st.flakeCount} flakes)`);
}
{
  const inject = `(() => {
    const S = SNOW;
    S.glsl.chunks.BROKEN = '\\nfloat broken() {\\n  return undefinedThing;\\n}\\n';
    S.glsl.progs.broken = { vs: ['VS_FULL'], fs: ['COMMON', 'ENV', 'ATMOS', 'BROKEN'] };
    let msg = 'no error';
    try { S.buildPrograms(); } catch (e) { msg = e.message; }
    delete S.glsl.progs.broken; delete S.glsl.chunks.BROKEN;
    return msg;
  })()`;
  const r = await capture({ html: APP, q: 'ui=0', wait: 1500, eval: inject });
  ok(r.value === 'shader compile failed: broken.fs at BROKEN:3', `compile error names the chunk and line: "${r.value}"`);
  const log = r.errors.find(e => e.includes('[broken.fs] shader compile error'));
  ok(log && /ERROR: 0:\d+ \[BROKEN:3\]:/.test(log) && log.includes('(BROKEN:3):   return undefinedThing;'), 'console log maps ERROR lines and the context listing to BROKEN:3');
  ok(r.errors.length === 1, `only the intended error was logged (${r.errors.length})`);
}
console.log(fails ? `${fails} smoke check(s) FAILED` : 'smoke passed');
process.exit(fails ? 1 : 0);
