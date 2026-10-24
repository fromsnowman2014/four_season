// Phase-2 performance gate: live uncapped rAF throughput (no test hook, the quality controller running as in real
// use) for every weather in its typical season, plus the stress states, at 1920x1080 dpr 2 by default; Phase 3 adds
// the house scene's states.
//   node app/tests/fps.mjs [--w 1920] [--h 1080] [--dpr 2] [--secs 6] [--reps 2] [--stat max|mean] [--gate 60]
//                          [--only a,b] [--html FILE]
// Each run waits for the first bake (state().ready), then for the frame rate to settle (polish: 1 s rAF windows, at
// least 3 after ready, until two in a row agree within 10%, at most 12: in the uncapped headless harness the bake can
// leave a deep GPU queue, frames stalling and then bursting for a few seconds after ready, which the old fixed 1.5 s
// wait mixed into the mean), then runs the state's action (a hazard trigger), waits 1.5 s and counts frames over --secs
// seconds. Reports
// fps per state (by default the best of --reps runs: the GPU is often shared with other work, which only ever lowers
// a reading; --stat mean for the average), the quality rung the controller sat on in that run (it only steps down
// below ~46 fps, so a rung > 0 is itself a failure sign), the instance counts and console errors. Exit 1 if a gated
// state is below --gate fps or any page logs an error. The heavy-sleet state is informational (an extreme transient
// outside the automatic rules). The load average is printed: judge the gate on a quiet machine.
// Phase 3 (stage 2a): the hazards in both scenes (a thunderstorm with a strike every 0.4 s, the quake's main shock,
// a quake in rain, a full wildfire, all at once), triggered once the scene is ready (as tests/hazards.mjs did).
// A run whose measurement the harness lost (a non-string value under a heavily shared machine, a page that stopped
// answering) is retried, up to --reps + 3 attempts; a state with no measurement at all fails.
// Polish: two stress rows, the most expensive combinations: the house in snow at amount 1 under full wildfire smoke
// (ash, embers), and the valley blizzard at amount 1 over cover 1 with full smoke, a quake's main shock and a strike
// every 0.4 s.
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
// [name, query, early js (0.8 s after navigation), gated, js once the frame rate has settled (before the 1.5 s wait)]
const AMT1 = 'snowSim.amount = 1, 1';
const STRIKES = "window.__iv = setInterval(() => snowSim.trigger('strike'), 400);";
const HAZARDS = [
  ['thunder+strikes', 'season=summer&weather=thunder', STRIKES],
  ['quake main shock', 'season=summer&weather=clear', "snowSim.trigger('quake'); snowSim.advance(1);"],
  ['quake in rain', 'season=summer&weather=rain', "snowSim.trigger('quake'); snowSim.advance(1);"],
  ['wildfire full', 'season=autumn&weather=clear', "snowSim.trigger('wildfire'); snowSim.advance(40);"],
  ['all at once', 'season=summer&weather=thunder', `snowSim.trigger('wildfire'); snowSim.advance(40); snowSim.trigger('quake'); snowSim.advance(1); ${STRIKES}`],
];
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
  // Phase 3: the house scene, every weather (lane H keeps these gated): its golden-hour clouds, the composite's light
  // halos and wisps, the wet-ground reflections, the snow relief
  ['house clear/summer', 'scene=house&season=summer&weather=clear'],
  ['house cumulus/summer', 'scene=house&season=summer&weather=cumulus'],
  ['house overcast/autumn', 'scene=house&season=autumn&weather=overcast'],
  ['house fog/autumn', 'scene=house&season=autumn&weather=fog'],
  ['house rain/summer', 'scene=house&season=summer&weather=rain'],
  ['house rain amount 1', 'scene=house&season=autumn&weather=rain', AMT1],
  ['house snow/winter', 'scene=house&season=winter&weather=snow'],
  ['house blizzard/winter', 'scene=house&season=winter&weather=blizzard'],
  ['house blizzard+cover1', 'scene=house&season=winter&weather=blizzard&storm=0&cover=1'],
  ['house thunder/summer', 'scene=house&season=summer&weather=thunder'],
  // Phase 3: the hazards x the scenes
  ...['valley', 'house'].flatMap(sc => HAZARDS.map(([n, q, act]) => [`${sc === 'valley' ? '' : 'house '}hz ${n}`, (sc === 'house' ? 'scene=house&' : '') + q, '', true, act])),
  // polish: the stress combinations
  ['house snow amt1+fire', 'scene=house&season=winter&weather=snow', AMT1, true, "snowSim.trigger('wildfire'); snowSim.advance(40);"],
  ['blizzard amt1+all hz', 'season=winter&weather=blizzard&storm=0&cover=1', AMT1, true, `snowSim.trigger('wildfire'); snowSim.advance(40); snowSim.trigger('quake'); snowSim.advance(1); ${STRIKES}`],
];
const MEASURE = act => `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300 && !snowSim.state().ready; i++) await wait(50);
  const win = () => new Promise(r => { let n = 0, run = true; const f = () => { n++; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f);
    const t0 = performance.now(); setTimeout(() => { run = false; r(n / ((performance.now() - t0) / 1000)); }, 1000); });
  let prev = await win(), settle = 1;
  for (; settle < 12; settle++) { const cur = await win(); if (settle >= 3 && Math.abs(cur - prev) <= 0.1 * Math.max(cur, prev)) break; prev = cur; }
  ${act || ''}
  await wait(1500);
  let n = 0, run = true; const f = () => { n++; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f);
  const t0 = performance.now(); await wait(${SECS * 1000}); run = false;
  const fps = n / ((performance.now() - t0) / 1000), s = snowSim.state();
  return JSON.stringify({ fps, settle: settle + 1, lvl: s.perfLevel, q: s.quality, rr: s.renderRes, snow: s.flakeCount, rain: s.rainCount, wx: s.weather.cur, season: s.season, c: SNOW.precipCount });
})()`;

console.log(`fps gate: ${W}x${H} dpr ${DPR}, ${SECS} s per run, ${STAT} of ${REPS} run(s), gate ${GATE} fps, load average ${os.loadavg().map(x => x.toFixed(2)).join(' ')}\n  app ${APP}`);
let fails = 0;
const rows = [];
for (const [name, q, early, gated = true, act] of STATES) {
  if (ONLY && !ONLY.split(',').some(o => name.startsWith(o))) continue;
  const runs = [];
  for (let tries = 0; runs.length < REPS && tries < REPS + 3; tries++) {
    const res = await capture({ html: APP, q: q + '&ui=0&seed=7', w: W, h: H, dpr: DPR, wait: 200, early: early || '', eval: MEASURE(act) });
    for (const e of res.errors) if (!e.startsWith('harness:')) { console.log(`    ${name}: ${e}`); fails++; }
    let v = null;
    try { if (typeof res.value === 'string') v = JSON.parse(res.value); } catch {}
    if (!v || typeof v.fps !== 'number') { console.log(`    ${name}: retrying, the harness lost the measurement (${JSON.stringify(res.value)}${res.errors.length ? ': ' + res.errors.join(' | ') : ''})`); continue; }
    runs.push(v);
  }
  if (!runs.length) { console.log(`FAIL ${name.padEnd(22)} no measurement`); fails++; continue; }
  const best = runs.reduce((b, v) => (v.fps > b.fps ? v : b), runs[0]);
  const fps = STAT === 'mean' ? runs.reduce((x, v) => x + v.fps, 0) / runs.length : best.fps, v = best;
  const pass = !gated || (fps >= GATE && v.lvl === 0);
  if (!pass) fails++;
  rows.push({ name, fps, ...v });
  const hz = v.c && (v.c.ash || v.c.ember || v.c.dust) ? `  ash ${v.c.ash}  ember ${v.c.ember}  dust ${v.c.dust}` : '';
  console.log(`${gated ? (pass ? 'PASS' : 'FAIL') : 'info'} ${name.padEnd(22)} ${fps.toFixed(1).padStart(6)} fps  rung ${v.lvl}  render ${v.rr}  snow ${v.snow}  rain ${v.rain}${hz}  [${v.season} ${v.wx}]  settled ${v.settle} s` +
    (runs.length > 1 ? `  runs ${runs.map(x => x.fps.toFixed(0)).join('/')}` : ''));
}
console.log(fails ? `${fails} failure(s)` : 'fps gate passed');
process.exit(fails ? 1 : 0);
