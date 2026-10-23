// Phase-2 performance gate: live uncapped rAF throughput (no test hook, the quality controller running as in real
// use) for every weather in its typical season, plus the stress states, at 1920x1080 dpr 2 by default.
//   node app/tests/fps.mjs [--w 1920] [--h 1080] [--dpr 2] [--secs 6] [--reps 2] [--stat max|mean] [--gate 60]
//                          [--only a,b] [--html FILE]
// Each run waits for the first bake (state().ready) plus 1.5 s, then counts frames over --secs seconds. Reports
// fps per state (by default the best of --reps runs: the GPU is often shared with other work, which only ever lowers
// a reading; --stat mean for the average), the quality rung the controller sat on in that run (it only steps down
// below ~46 fps, so a rung > 0 is itself a failure sign), the instance counts and console errors. Exit 1 if a gated
// state is below --gate fps or any page logs an error. The heavy-sleet state is informational (an extreme transient
// outside the automatic rules). The load average is printed: judge the gate on a quiet machine.
import { capture } from './cdp.mjs';
import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const W = +opt('w', 1920), H = +opt('h', 1080), DPR = +opt('dpr', 2), SECS = +opt('secs', 6), REPS = +opt('reps', 2), GATE = +opt('gate', 60);
const STAT = opt('stat', 'max');
const APP = path.resolve(opt('html', path.join(HERE, '../index.html')));
const ONLY = opt('only', '');
// [name, query, early js (0.8 s after navigation), gated]
const AMT1 = 'snowSim.amount = 1, 1';
const STATES = [
  ['clear/summer', 'season=summer&weather=clear'],
  ['cumulus/summer', 'season=summer&weather=cumulus'],
  ['overcast/autumn', 'season=autumn&weather=overcast'],
  ['fog/autumn', 'season=autumn&weather=fog'],
  ['rain/summer', 'season=summer&weather=rain'],
  ['snow/winter', 'season=winter&weather=snow'],
  ['blizzard/winter', 'season=winter&weather=blizzard'],
  ['blizzard+cover1', 'season=winter&weather=blizzard&storm=0&cover=1'],
  ['rain amount 1', 'season=summer&weather=rain', AMT1],
  ['rain caps', 'season=summer&weather=rain&wx=precip:1,heavy:1,snowFrac:0', AMT1],
  ['blizzard amount 1', 'season=winter&weather=blizzard&storm=0&cover=1', AMT1],
  ['sleet heavy (info)', 'season=summer&weather=snow&wx=precip:1,heavy:.5,snowFrac:.5,tempOff:-13', AMT1, false],
];
const MEASURE = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300 && !snowSim.state().ready; i++) await wait(50);
  await wait(1500);
  let n = 0, run = true; const f = () => { n++; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f);
  const t0 = performance.now(); await wait(${SECS * 1000}); run = false;
  const fps = n / ((performance.now() - t0) / 1000), s = snowSim.state();
  return JSON.stringify({ fps, lvl: s.perfLevel, q: s.quality, rr: s.renderRes, snow: s.flakeCount, rain: s.rainCount, wx: s.weather.cur, season: s.season });
})()`;

console.log(`fps gate: ${W}x${H} dpr ${DPR}, ${SECS} s per run, ${STAT} of ${REPS} run(s), gate ${GATE} fps, load average ${os.loadavg().map(x => x.toFixed(2)).join(' ')}\n  app ${APP}`);
let fails = 0;
const rows = [];
for (const [name, q, early, gated = true] of STATES) {
  if (ONLY && !ONLY.split(',').some(o => name.startsWith(o))) continue;
  const runs = [];
  for (let r = 0; r < REPS; r++) {
    const res = await capture({ html: APP, q: q + '&ui=0&seed=7', w: W, h: H, dpr: DPR, wait: 200, early: early || '', eval: MEASURE });
    const v = JSON.parse(res.value || '{"fps":0}');
    runs.push(v);
    for (const e of res.errors) { console.log(`    ${name}: ${e}`); fails++; }
  }
  const best = runs.reduce((b, v) => (v.fps > b.fps ? v : b), runs[0]);
  const fps = STAT === 'mean' ? runs.reduce((x, v) => x + v.fps, 0) / runs.length : best.fps, v = best;
  const pass = !gated || (fps >= GATE && v.lvl === 0);
  if (!pass) fails++;
  rows.push({ name, fps, ...v });
  console.log(`${gated ? (pass ? 'PASS' : 'FAIL') : 'info'} ${name.padEnd(19)} ${fps.toFixed(1).padStart(6)} fps  rung ${v.lvl}  render ${v.rr}  snow ${v.snow}  rain ${v.rain}  [${v.season} ${v.wx}]` +
    (runs.length > 1 ? `  runs ${runs.map(x => x.fps.toFixed(0)).join('/')}` : ''));
}
console.log(fails ? `${fails} failure(s)` : 'fps gate passed');
process.exit(fails ? 1 : 0);
