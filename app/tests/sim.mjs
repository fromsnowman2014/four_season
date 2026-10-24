// Node unit tests of the sim (no DOM, no GL): every app script, main.js included, loads into a bare VM context
// (main.js boots only when a document exists), then the orchestrator is driven directly.
//   node app/tests/sim.mjs            (add --quiet to skip the statistics tables)
// Contract: module and API shapes, the state() Phase-2 fields, determinism (same seed and t -> the same snapshot and
// S.F, from fresh contexts; seeds differ), advance() composition and ?t, the debug hooks ?yp ?wx ?ground ?view, the
// legacy ?storm / ?cover / setStorm / triggerBlizzard, the season weights.
// Phase 2 (lane A): the year length and speed scaling, the season-pin ease, the first-weather rule, manual picks
// (60 s transition, hold, 'auto' resumes), the Markov scheduler (structure, temperature rules, per-season statistics
// and dwell over many simulated years), no channel jump under random UI actions, the ground over a simulated year
// (cover, melt, wetness, snowline: monthly means), the wind (plain pointer motion changes nothing, drag steers, the
// release decays with a 15 s half-life), and the counter-based RNG (speed / amount changes never alter the sequence).
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const QUIET = process.argv.includes('--quiet');
const FILES = [...fs.readFileSync(path.join(APP, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const SRC = FILES.map(f => [f, fs.readFileSync(path.join(APP, f), 'utf8')]);
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
const log = (...a) => { if (!QUIET) console.log(...a); };
const TIMING = ['fps', 'frameMs', 'buildMs', 'compileMs'];
const STATES = ['clear', 'cumulus', 'overcast', 'fog', 'rain', 'snow', 'blizzard'];
const ALL = [...STATES, 'thunder'];   // Phase 3 (lane Z): thunderstorms come on their own (summer / late spring)
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const KEYS = ['cloudCov', 'cumulus', 'overcast', 'cirrus', 'fog', 'precip', 'gale', 'heavy', 'tempOff'];
const PRESET = {   // the canonical preset table (the contract with lanes C / D / E)
  clear: [0.15, 0, 0, 0.35, 0, 0, 0.05, 0, 1], cumulus: [0.55, 1, 0.1, 0.2, 0, 0, 0.2, 0, 0], overcast: [0.95, 0.2, 0.75, 0, 0.1, 0, 0.3, 0, -1],
  fog: [0.75, 0, 0.5, 0, 1, 0, 0, 0, -1], rain: [0.97, 0, 0.85, 0, 0.2, 0.65, 0.4, 0, 1], snow: [0.75, 0.2, 0.35, 0.4, 0.05, 0.75, 0.15, 0, -3],
  blizzard: [0.98, 0, 1, 0, 0.2, 1, 1, 1, -6] };

// a fresh app context for a query string, booted the way main.js boots (initSim, advance(?t), ?cover)
function boot(q = '', date = new Date(2026, 9, 22)) {
  const ctx = vm.createContext({ window: { location: { search: q ? '?' + q : '' } }, URLSearchParams, console });
  for (const [f, src] of SRC) vm.runInContext(src, ctx, { filename: f });
  const S = ctx.window.SNOW;
  S.cfg.date = date;                                  // fixed calendar date (22 Oct: late autumn, phase ~.643)
  S.initSim(S.cfg);
  S.advance(S.cfg.t0); S.anim.time = S.cfg.t0;
  if (S.cfg.cover !== null) S.ground.api.setCoverage(S.cfg.cover);
  S.api = S.makeApi();
  return S;
}
const snap = S => { const o = S.state(); for (const k of TIMING) delete o[k]; return JSON.stringify(o); };
const bundle = S => { S.deriveF(); const o = {}; for (const [k, v] of Object.entries(S.F)) if (k !== 'uNoise') o[k] = typeof v === 'number' ? v : Array.from(v); return JSON.stringify(o); };
// run climate time Tc (s) at the current speed, through the same fastForward steps as ?t / snowSim.advance
const runC = (S, Tc) => S.advance(Tc / Math.max(S.climate.s.speed, 1e-9));
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const presetOk = (S, name, tol = 1e-9) => KEYS.every((k, i) => k === 'tempOff' || near(S.weather.s.ch[k], PRESET[name][i], tol));
const target = S => S.weather.s.next || S.weather.s.cur;
const seasonOf = ph => SEASONS[Math.floor(ph * 4) % 4];
const pad = (x, n = 7) => String(x).padStart(n);

// ---- shapes
{
  const S = boot();
  for (const m of ['climate', 'weather', 'ground', 'wind']) {
    const o = S[m];
    ok(o && typeof o.s === 'object' && ['init', 'step', 'snapshot'].every(f => typeof o[f] === 'function') && typeof o.api === 'object',
      `S.${m} = { s, init, step, snapshot, api }`);
    const sn = o.snapshot();
    ok(sn && JSON.stringify(JSON.parse(JSON.stringify(sn))) === JSON.stringify(sn), `S.${m}.snapshot() is plain JSON data`);
  }
  for (const k of ['surface', 'precip', 'atmos']) ok(['init', 'step', 'frame'].every(f => typeof S.derive[k][f] === 'function'), `S.derive.${k} = { init, step, frame }`);
  const api = S.api;
  const want = ['state', 'advance', 'setSeason', 'setWeather', 'speed', 'setStorm', 'triggerBlizzard', 'setCoverage', 'reset', 'resetSnow', 'amount', 'auto'];
  ok(want.every(k => k in api), 'snowSim API: ' + want.join(', '));
  ok(['speed', 'amount', 'auto'].every(k => typeof Object.getOwnPropertyDescriptor(api, k).get === 'function'), 'snowSim speed / amount / auto are live accessors');
  const st = S.state();
  const fields = ['coverage', 'storm', 'sky', 'tail', 'windX', 'windZ', 'flakeCount', 'amount', 'auto',          // Phase 1
                  'season', 'seasonKo', 'phase', 'speed', 'seasonPinned', 'weather', 'temp', 'snowFrac', 'precip', 'white', 'wet', 'snowline', 'wind', 'rainCount'];
  ok(fields.every(k => k in st), 'state() reports the Phase-1 and Phase-2 fields');
  ok(['cur', 'next', 'progress', 'manual', 'nextAt'].every(k => k in st.weather) && ['x', 'z', 'steer'].every(k => k in st.wind), 'state().weather and state().wind have their fields');
  ok(st.season === 'autumn' && st.seasonKo === '늦가을' && near(st.phase, 0.6434, 2e-4), `the year starts from the real date (22 Oct -> ${st.phase} ${st.season} ${st.seasonKo})`);
  ok(S.ground.s.snowline > -2000 && S.ground.s.snowline < 2500 && st.wet === 0 && st.coverage === 0, `the ground starts bare and dry, snowline ${st.snowline} m`);
}

// ---- the first weather
{
  const S = boot();
  const w = S.state().weather;
  ok(w.cur === 'snow' && w.next === null && w.progress === 1 && presetOk(S, 'snow') && S.weather.s.ch.snowFrac === 1,
    `22 Oct (tSeason ${S.climate.s.tSeason.toFixed(2)} C): the first weather is snow at full strength (the Phase-1 opening)`);
  ok(boot('season=winter').weather.s.cur === 'snow' && boot('season=0.05').weather.s.cur === 'snow', 'winter and early spring open with snow');
  const firsts = {};
  for (let seed = 1; seed <= 60; seed++) { const c = boot(`season=summer&seed=${seed}`).weather.s.cur; firsts[c] = (firsts[c] || 0) + 1; }
  ok(!firsts.snow && !firsts.blizzard && Object.keys(firsts).length >= 3, `summer opens with a draw from the season row (60 seeds: ${JSON.stringify(firsts)})`);
}

// ---- determinism
for (const [seed, t] of [[1, 0], [7, 230], [3, 400], [11, 1000]]) {
  const q = `seed=${seed}&t=${t}&season=winter`;
  const a = boot(q), b = boot(q);
  ok(snap(a) === snap(b) && bundle(a) === bundle(b), `seed ${seed}, t ${t}: two fresh runs give the same snapshot and S.F`);
}
{
  const seq = seed => { const S = boot(`seed=${seed}&season=autumn`); const out = []; for (let i = 0; i < 90; i++) { S.advance(10); out.push(target(S) + S.weather.s.ch.cloudCov.toFixed(3)); } return out.join(','); };
  ok(seq(1) !== seq(2), 'different seeds give different weather sequences');
  ok(seq(5) === seq(5), 'the same seed gives the same weather sequence');
  const A = boot('seed=4&season=autumn'); A.advance(100); A.advance(150.5);
  const B = boot('seed=4&season=autumn'); B.advance(250.5);
  ok(snap(A) === snap(B) && bundle(A) === bundle(B), 'advance(100) + advance(150.5) equals advance(250.5)');
  const T = boot('seed=4&season=autumn&t=250.5');
  ok(snap(T) === snap(B), '?t=250.5 equals advance(250.5) from boot');
  const U = boot('seed=9&speed=8&t=600'), V = boot('seed=9&speed=8&t=600');
  ok(snap(U) === snap(V) && bundle(U) === bundle(V), '?speed=8&t=600 (13 climate-min across a season change) is deterministic');
}

// ---- debug hooks
{
  const S = boot('yp=0.3&t=50');
  ok(S.climate.s.phase === 0.3 && S.state().season === 'summer', `?yp pins the year phase (${S.climate.s.phase}, ${S.state().season})`);
  const W = boot('wx=overcast:.5,precip:.2,heavy:1,snowFrac:.5,tempOff:3,cumulus:.7,fog:.4,cirrus:.3,gale:.6,cloudCov:.8&t=20');
  const ch = W.weather.s.ch;
  ok(ch.overcast === 0.5 && ch.precip === 0.2 && ch.heavy === 1 && ch.snowFrac === 0.5 && ch.cumulus === 0.7 && ch.fog === 0.4 && ch.cirrus === 0.3 && ch.gale === 0.6 && ch.cloudCov === 0.8,
    '?wx overrides the weather channels');
  W.deriveF();
  const F = W.F;
  ok(F.uOvercast === 0.5 && F.uCloudCov === 0.8 && F.uCumulus === 0.7 && F.uFogDay === 0.4 && F.uCirrus === 0.3 && F.uGale === 0.6 && F.uHeavy === 1 && F.uSnowFrac === 0.5,
    '?wx reaches S.F (uOvercast, uCloudCov, uCumulus, uFogDay, uCirrus, uGale, uHeavy, uSnowFrac)');
  ok(Math.abs(F.uPrecipSnow - 0.1) < 1e-12 && Math.abs(F.uPrecipRain - 0.1) < 1e-12 && F.uSnowCurtain === 0.5, 'precip x snowFrac -> uPrecipSnow / uPrecipRain; heavy x snowFrac -> the curtain');
  ok(Math.abs(W.weather.s.temp - (W.climate.s.tSeason + 3)) < 1e-12 && F.uTemp === W.weather.s.temp, 'tempOff shifts the meadow temperature (uTemp)');
  const X = boot('wx=tempOff:-20&t=5');
  ok(X.weather.s.ch.snowFrac === 1 && boot('wx=tempOff:20&t=5').weather.s.ch.snowFrac === 0, 'without snowFrac in ?wx, snowFrac follows the overridden temperature');
  const G = boot('ground=cover:.3,wet:.8,snowline:2200&t=30');
  G.deriveF();
  ok(G.state().coverage === 0.3 && G.state().wet === 0.8 && G.F.uCover === 0.3 && G.F.uWet === 0.8 && G.F.uSnowline[0] === 2200, '?ground overrides cover / wet / snowline (state and S.F)');
  ok(boot('view=g3b').cfg.view === 5 && boot('view=cEff').F.uView === 7 && boot('view=nope').cfg.view === 0 && boot().F.uView === 0, '?view selects the debug channel (uView)');
  ok(boot('weather=fog').state().weather.cur === 'fog' && boot('weather=fog').state().weather.manual === 'fog' && presetOk(boot('weather=fog'), 'fog'), '?weather=fog: an instant, held pick');
}

// ---- legacy hooks and setters
{
  const S = boot('storm=1&t=10');
  ok(S.state().storm === 1 && S.state().sky === 1 && S.state().weather.cur === 'blizzard', '?storm=1: an instant full storm (held)');
  S.advance(400); ok(S.state().storm === 1, '?storm=1 holds');
  S.api.setStorm(null); S.advance(120);
  ok(S.weather.s.forced === null && S.state().weather.manual === null && S.weather.s.nextAt > 0, 'setStorm(null) returns to automatic weather');
  const Z = boot('storm=0&t=500');
  ok(Z.weather.s.auto === false && Z.state().weather.cur === 'clear' && presetOk(Z, 'clear') && Z.state().weather.nextAt === 0, '?storm=0: automatic weather off, clear sky (held)');
  const C = boot('cover=0.4&storm=0&t=60');
  ok(C.state().coverage === 0.4, '?cover=&storm=0 holds the cover');
  const L = boot('seed=3');
  L.api.setStorm(0.5); ok(L.state().storm > 0.4 && L.state().storm < 0.6, `setStorm(.5): a half storm at once (curtain ${L.state().storm})`);
  L.api.setStorm(null);
  L.api.triggerBlizzard(100); L.advance(65);
  ok(L.state().weather.cur === 'blizzard' && L.state().storm > 0.95 && L.state().weather.manual === null, 'triggerBlizzard(): a blizzard pick (60 s transition) ...');
  L.advance(60); ok(L.state().weather.next !== null || L.state().weather.cur !== 'blizzard', '... that the scheduler leaves after its duration, like a Phase-1 front');
  L.api.setCoverage(0.7); ok(L.state().coverage === 0.7, 'setCoverage');
  L.api.resetSnow(); L.advance(0.5); ok(L.state().coverage > 0 && L.state().coverage < 0.7, 'resetSnow eases ...'); L.advance(1.5); ok(L.state().coverage < 0.01, '... to bare in 1.5 s');
  L.api.setCoverage(0.5); L.api.reset(); ok(L.state().coverage === 0, 'reset() is immediate');
  L.api.amount = 0.3; ok(L.api.amount === 0.3 && near(L.amountMul(), 0.68), 'amount accessor and amountMul');
  L.api.auto = false; ok(L.state().auto === false && L.state().weather.nextAt === 0, 'auto = false holds the weather');
  L.api.auto = true; ok(L.state().weather.nextAt > L.climate.s.t, 'auto = true resumes the scheduler');
}

// ---- climate: year length, speed, season pin
{
  const S = boot('seed=2');
  const p0 = S.climate.s.phase;
  runC(S, 600); ok(near(S.climate.s.phase, (p0 + 0.5) % 1, 1e-9), 'speed 1: 600 climate-s is half a year');
  runC(S, 600); ok(near(S.climate.s.phase, p0, 1e-9), 'YEAR = 1200 climate-s (20 min at speed 1)');
  const t0 = S.climate.s.t;
  S.api.speed = 8; S.advance(150); ok(near(S.climate.s.t - t0, 1200, 1e-6) && near(S.climate.s.phase, p0, 1e-9), 'speed 8: a year in 150 real s');
  S.api.speed = 0.25; S.advance(100); ok(near(S.climate.s.phase, (p0 + 25 / 1200) % 1, 1e-9), 'speed 0.25: 100 real s = 25 climate-s');
  S.api.speed = 0; const ph = S.climate.s.phase, wt = S.weather.s.t; S.advance(50);
  ok(S.climate.s.phase === ph && S.weather.s.t === wt, 'speed 0 pauses the climate and the weather');
  S.api.speed = 20; ok(S.api.speed === 8, 'speed is clamped to 8'); S.api.speed = -1; ok(S.api.speed === 0, 'and to 0');
  S.api.speed = 4; const t1 = S.climate.s.t; S.api.advance(1);
  ok(Math.abs(S.climate.s.t - t1 - 4) < 1e-9 && Math.abs(S.weather.s.t - S.climate.s.t) < 1e-9, 'speed scales the climate / weather clock (advance(1) at 4x = 4 climate-s)');

  const P = boot('seed=2');                                   // 22 Oct, phase .643
  const r = P.api.setSeason('winter');
  ok(r.seasonPinned && near(P.climate.s.phase, 0.6434, 2e-4), 'setSeason(name) pins without a jump ...');
  const tr = [];
  for (let i = 0; i < 280; i++) { runC(P, 0.25); tr.push(P.climate.s.phase); }
  const steps = tr.slice(1).map((x, i) => x - tr[i]);
  ok(steps.every(d => d >= -1e-12) && Math.max(...steps) < 0.004, `... eases monotonically (largest step ${Math.max(...steps).toFixed(4)} per 0.25 s) ...`);
  ok(near(tr[239], 0.875, 1e-9) && near(tr[279], 0.875, 1e-12) && P.state().season === 'winter', '... reaches mid-winter after 60 climate-s and holds');
  P.api.setSeason('spring');                                  // .875 -> .125: the short way is forward through 0
  runC(P, 20); const mid = P.climate.s.phase;
  ok(mid > 0.875 || mid < 0.125, `setSeason takes the shortest arc (winter -> spring through 1 Mar: ${mid.toFixed(3)})`);
  runC(P, 40); ok(near(P.climate.s.phase, 0.125, 1e-9), 'and lands on mid-spring');
  P.api.setSeason(0.3); runC(P, 60); ok(near(P.climate.s.phase, 0.3, 1e-9), 'setSeason(0..1) pins that phase');
  P.api.setSeason(null); ok(!P.state().seasonPinned && near(P.climate.s.phase, 0.3, 1e-12), 'setSeason(null) releases the pin where it is ...');
  runC(P, 120); ok(near(P.climate.s.phase, 0.4, 1e-9), '... and the year flows on from there');
  ok(boot('season=summer').climate.s.phase === 0.375 && boot('season=summer').state().seasonPinned, '?season= pins at boot (no ease)');
}

// ---- season weights
{
  const S = boot();
  let worst = 0, maxJump = 0, prev = null;
  for (let i = 0; i <= 1000; i++) {
    S.climate.api.setSeason(i / 1000 % 1); S.climate.step(60);
    const w = S.climate.s.seasonW, sum = w[0] + w[1] + w[2] + w[3];
    worst = Math.max(worst, Math.abs(sum - 1));
    if (prev) maxJump = Math.max(maxJump, ...w.map((x, k) => Math.abs(x - prev[k])));
    prev = [...w];
  }
  ok(worst < 1e-12, `season weights sum to 1 (worst ${worst.toExponential(1)})`);
  ok(maxJump < 0.01, `season weights are continuous and cyclic (largest step per 0.001 of phase: ${maxJump.toFixed(4)})`);
  S.climate.api.setSeason(0.125); S.climate.step(60);
  ok(S.climate.s.seasonW.join() === '1,0,0,0', 'mid-spring is pure spring');
  const names = [];
  for (const p of [0.02, 0.125, 0.23, 0.3, 0.375, 0.48, 0.55, 0.625, 0.7, 0.8, 0.875, 0.97]) { S.climate.api.setSeason(p); S.climate.step(60); names.push(S.climate.snapshot().seasonKo); }
  ok(names.join() === '초봄,봄,늦봄,초여름,한여름,늦여름,초가을,가을,늦가을,초겨울,한겨울,늦겨울', 'seasonKo: ' + names.join(' '));
}

// ---- weather transitions: staging, manual hold, auto resume
{
  const S = boot('seed=5&season=autumn&weather=clear');
  ok(S.state().weather.manual === 'clear' && presetOk(S, 'clear'), 'start: a held clear sky');
  S.api.setWeather('rain');
  const rec = [];
  for (let i = 0; i <= 240; i++) { rec.push({ ...S.weather.s.ch, p: S.weather.s.progress }); runC(S, 0.25); }
  const at = k => rec.findIndex(r => r.cloudCov > 0.15 + 0.5 * (0.97 - 0.15) && k === 'cloud' || r.precip > 0.65 / 2 && k === 'precip' || r.gale > 0.05 + 0.5 * 0.35 && k === 'gale') / 4;
  const tc = at('cloud'), tg = at('gale'), tp = at('precip');
  ok(tc < tg && tg < tp, `clear -> rain is staged: clouds half-way at ${tc} s, gale ${tg} s, rain ${tp} s`);
  ok(S.state().weather.cur === 'rain' && S.state().weather.progress === 1 && presetOk(S, 'rain'), 'the pick completes in 60 climate-s');
  runC(S, 1500);
  ok(S.state().weather.cur === 'rain' && S.state().weather.manual === 'rain' && S.state().weather.nextAt === 0, 'a manual pick holds (1500 climate-s later, into winter: still rain)');
  ok(S.weather.s.ch.snowFrac === 0, `a manual rain stays rain in the cold (temp ${S.weather.s.temp.toFixed(1)} C: a thaw)`);
  S.api.setWeather('clear');
  const rec2 = [];
  for (let i = 0; i <= 240; i++) { rec2.push({ ...S.weather.s.ch }); runC(S, 0.25); }
  const tp2 = rec2.findIndex(r => r.precip < 0.65 / 2) / 4, tc2 = rec2.findIndex(r => r.cloudCov < 0.15 + 0.5 * (0.97 - 0.15)) / 4;
  ok(tp2 < tc2, `rain -> clear: the rain stops first (${tp2} s), the sky clears last (${tc2} s)`);
  S.api.setWeather('auto');
  ok(S.state().weather.manual === null && S.state().weather.nextAt > S.climate.s.t, 'setWeather(auto) resumes the scheduler from the current weather');
  const nx = S.state().weather.nextAt; runC(S, nx - S.climate.s.t + 1);
  ok(S.state().weather.next !== null && S.state().weather.cur === 'clear', `... with the next change at its nextAt (-> ${S.state().weather.next})`);
  const Y = boot('seed=5&season=summer&t=30');
  Y.api.setWeather('snow'); runC(Y, 60);
  ok(Y.weather.s.ch.snowFrac === 1 && Y.state().weather.cur === 'snow', `a manual snow in summer snows (temp ${Y.weather.s.temp.toFixed(1)} C: a cold snap)`);
  Y.api.setWeather('fog'); runC(Y, 30); Y.api.setWeather('cumulus'); runC(Y, 10);
  ok(Y.state().weather.next === 'cumulus', 'a pick during a transition retargets it');
}

// ---- no channel jumps under random UI actions (and across season changes, speed changes, picks)
{
  const S = boot('seed=13');
  const keys = [...KEYS, 'snowFrac'];
  const EPS = { tempOff: 0.35, temp: 0.35 };
  const worst = {};
  const read = () => {
    const w = S.weather.s, c = w.ch, g = S.ground.s;
    const o = {}; for (const k of keys) o[k] = c[k];
    Object.assign(o, { temp: w.temp, snowRate: c.precip * c.snowFrac, rainRate: c.precip * (1 - c.snowFrac), curtain: w.curtain, tail: w.tail,
      cover: g.cover, wet: g.wet, snowline: g.snowline, phase: S.climate.s.phase });
    return o;
  };
  let a = read(), actions = 0;
  const spd = [0.25, 0.5, 1, 2, 4, 8];
  for (let i = 0; i < 4 * 4000; i++) {
    const r = (Math.sin(i * 12.9898) * 43758.5453) % 1, u = Math.abs(r);
    if (i % 97 === 0) {
      actions++;
      const k = Math.floor(u * 7);
      if (k === 0) S.api.setWeather(STATES[Math.floor(u * 1000) % 7]);
      else if (k === 1) S.api.setWeather('auto');
      else if (k === 2) S.api.setSeason([...SEASONS, null, 0.33][Math.floor(u * 1000) % 6]);
      else if (k === 3) S.api.speed = spd[Math.floor(u * 1000) % 6];
      else if (k === 4) S.api.auto = !S.api.auto;
      else if (k === 5) S.api.amount = (u * 10) % 1;
      else S.api.triggerBlizzard();
    }
    S.simStep(0.25 / Math.max(S.climate.s.speed, 0.25), true);   // one 0.25 climate-s step (live substep size)
    const b = read();
    for (const k of Object.keys(b)) {
      let d = Math.abs(b[k] - a[k]);
      if (k === 'phase') d = Math.min(d, 1 - d);
      worst[k] = Math.max(worst[k] || 0, d);
    }
    a = b;
  }
  const lim = k => EPS[k] || (k === 'snowline' ? 150 : k === 'phase' ? 0.005 : k === 'snowFrac' ? 0.25 : 0.03);
  const bad = Object.keys(worst).filter(k => worst[k] > lim(k));
  log('   largest change per 0.25 climate-s: ' + Object.entries(worst).map(([k, v]) => `${k} ${v < 1 ? v.toFixed(4) : v.toFixed(1)}`).join(', '));
  ok(!bad.length, `no channel jumps over 4000 climate-s with ${actions} random UI actions` + (bad.length ? ': ' + bad.map(k => `${k} ${worst[k]}`).join(', ') : ''));
}

// ---- the Markov scheduler over many simulated years
{
  const freq = SEASONS.map(() => Object.fromEntries(ALL.map(s => [s, 0])));
  const events = [], dwellBy = Object.fromEntries(ALL.map(s => [s, []]));
  const moves = {};
  let illegal = [], badTemp = [], selfT = 0;
  const YEARS = 12, SEEDS = 6;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const S = boot(`seed=${seed * 17}&season=0`);
    S.api.setSeason(null); S.api.speed = 8;
    let prev = target(S), tPrev = S.climate.s.t, tempPrev = S.weather.s.temp;
    for (let i = 0; i < YEARS * 1200 / 2; i++) {
      S.advance(0.25);                                       // 2 climate-s (8 substeps)
      const cur = target(S), t = S.climate.s.t;
      freq[Math.floor(S.climate.s.phase * 4) % 4][cur] += 2;
      if (cur !== prev) {
        const k = prev + '>' + cur; moves[k] = (moves[k] || 0) + 1;
        if (cur === prev) selfT++;
        // (a thunderstorm is a Phase-2 rain or overcast event shown as a storm: rain may follow one drawn as overcast)
        if ((cur === 'rain' || cur === 'snow') && !['overcast', 'cumulus', 'fog', 'thunder'].includes(prev) && !(cur === 'snow' && prev === 'blizzard')) illegal.push(k);
        if (cur === 'thunder' && !['overcast', 'cumulus', 'rain'].includes(prev)) illegal.push(k);
        if (cur === 'blizzard' && !['snow', 'overcast'].includes(prev)) illegal.push(k);
        if (cur === 'blizzard' && tempPrev >= 0) badTemp.push(`blizzard at ${tempPrev.toFixed(1)} C`);
        const tS = S.climate.s.tSeason;
        if ((cur === 'rain' || cur === 'thunder') && tS + 1 < 0.9) badTemp.push(`${cur} at tSeason ${tS.toFixed(1)}`);
        if (cur === 'snow' && tS - 3 > 3.1) badTemp.push(`snow at tSeason ${tS.toFixed(1)}`);
        dwellBy[prev].push(t - tPrev); events.push(t - tPrev);
        prev = cur; tPrev = t;
      }
      tempPrev = S.weather.s.temp;
    }
  }
  const pct = (f, s) => { const tot = Object.values(f).reduce((a, b) => a + b, 0); return f[s] / tot; };
  log(`   weather time share by season (${SEEDS} seeds x ${YEARS} years, unpinned, speed 8):`);
  log('   ' + pad('', 8) + ALL.map(s => pad(s, 9)).join(''));
  SEASONS.forEach((n, i) => log('   ' + pad(n, 8) + ALL.map(s => pad((100 * pct(freq[i], s)).toFixed(1) + '%', 9)).join('')));
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  log('   mean time between changes (climate-s): ' + ALL.map(s => `${s} ${mean(dwellBy[s]).toFixed(0)} (n ${dwellBy[s].length})`).join(', '));
  log('   transitions: ' + Object.entries(moves).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  const [sp, su, au, wi] = freq;
  ok(!illegal.length && !selfT, 'structure: rain / snow begin only out of overcast / cumulus / fog (a blizzard may ease to snow), blizzard only out of snow / overcast, no self transitions' + (illegal.length ? ': ' + [...new Set(illegal)].join(' ') : ''));
  ok(!badTemp.length, 'temperature rules: no rain below 1 C, no snow above 3 C, blizzard only below 0 C' + (badTemp.length ? ': ' + badTemp.slice(0, 5).join(', ') : ''));
  ok(pct(wi, 'snow') + pct(wi, 'blizzard') > 0.35 && pct(wi, 'rain') < 0.03 && pct(wi, 'blizzard') > 0.03, `winter is snowy (snow ${(100 * pct(wi, 'snow')).toFixed(0)}%, blizzard ${(100 * pct(wi, 'blizzard')).toFixed(0)}%)`);
  ok(pct(su, 'clear') + pct(su, 'cumulus') > 0.55 && pct(su, 'rain') + pct(su, 'thunder') > 0.06 && pct(su, 'thunder') > 0.02 && pct(su, 'snow') === 0 && pct(su, 'blizzard') === 0 && pct(wi, 'thunder') === 0,
    `summer is sunny and cumulus with some rain and thunderstorms (clear+cumulus ${(100 * (pct(su, 'clear') + pct(su, 'cumulus'))).toFixed(0)}%, rain ${(100 * pct(su, 'rain')).toFixed(0)}%, thunder ${(100 * pct(su, 'thunder')).toFixed(0)}%)`);
  ok(pct(au, 'fog') > 0.12 && pct(au, 'rain') > 0.1, `autumn has fog and rain (fog ${(100 * pct(au, 'fog')).toFixed(0)}%, rain ${(100 * pct(au, 'rain')).toFixed(0)}%)`);
  ok(STATES.filter(s => pct(sp, s) > 0.04).length >= 6 && Math.max(...STATES.map(s => pct(sp, s))) < 0.3, 'spring is mixed (6+ states above 4%, none above 30%)');
  const md = mean(events);
  ok(events.every(d => d >= 69.5) && md > 100 && md < 150, `dwell between scheduled changes is 70-180 climate-s (mean ${md.toFixed(0)}, min ${Math.min(...events).toFixed(0)})`);
}

// ---- the counter-based RNG: speed and amount changes never alter the weather sequence
{
  const run = act => {
    const S = boot('seed=21&season=0'); S.api.setSeason(null);
    const out = [];
    let prev = target(S);
    for (let i = 0; i < 4800; i++) {
      act(S, i);
      S.simStep(0.25 / S.climate.s.speed, true);
      const cur = target(S);
      if (cur !== prev) { out.push(cur + '@' + Math.round(S.climate.s.t)); prev = cur; }
    }
    return out.join(' ');
  };
  const a = run(() => {}), b = run((S, i) => { if (i % 50 === 0) { S.api.speed = [1, 8, 0.25, 4][i / 50 % 4]; S.api.amount = (i % 7) / 7; } });
  log(`   sequence: ${a}`);
  ok(a === b && a.split(' ').length > 5, `speed / amount changes leave the weather sequence untouched (${a.split(' ').length} changes in 1200 climate-s)`);
}

// ---- the ground over simulated years
{
  const M = Array.from({ length: 12 }, () => ({ n: 0, cover: 0, wet: 0, line: 0, temp: 0, snow: 0, rain: 0 }));
  for (const seed of [3, 5, 8, 13]) {
  const S = boot(`seed=${seed}&season=0`); S.api.setSeason(null); S.api.speed = 8;
  runC(S, 1200);                                           // a year of spin-up
  for (let y = 0; y < 4; y++) for (let i = 0; i < 600; i++) {
    S.advance(0.25);
    const m = M[Math.floor(S.climate.s.phase * 12) % 12], g = S.ground.s, c = S.weather.s.ch;
    m.n++; m.cover += g.cover; m.wet += g.wet; m.line += g.snowline; m.temp += S.weather.s.temp; m.snow += c.precip * c.snowFrac; m.rain += c.precip * (1 - c.snowFrac);
  }
  }
  const MON = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
  log('   ground, monthly means over 16 simulated years (4 seeds x 4 years, after a year of spin-up):');
  log('   ' + ['month', 'temp C', 'snow', 'rain', 'cover', 'wet', 'snowline m'].map(x => pad(x, 11)).join(''));
  const mm = M.map(m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / m.n])));
  mm.forEach((m, i) => log('   ' + [MON[i], m.temp.toFixed(1), m.snow.toFixed(3), m.rain.toFixed(3), m.cover.toFixed(3), m.wet.toFixed(3), m.line.toFixed(0)].map(x => pad(x, 11)).join('')));
  const avg = (ix, k) => ix.reduce((a, i) => a + mm[i][k], 0) / ix.length;
  ok(avg([10, 11, 0], 'cover') > 0.3 && mm[11].cover > mm[9].cover, `the snowpack builds through the winter and peaks late (Jan-Mar mean cover ${avg([10, 11, 0], 'cover').toFixed(2)}, Dec ${mm[9].cover.toFixed(2)} -> Feb ${mm[11].cover.toFixed(2)})`);
  ok(avg([3, 4, 5], 'cover') < 0.02, `summer (Jun-Aug) melts it (mean cover ${avg([3, 4, 5], 'cover').toFixed(3)})`);
  ok(avg([3, 4, 5], 'line') > 1900 && avg([9, 10, 11], 'line') < -300, `the snowline: summer ${avg([3, 4, 5], 'line').toFixed(0)} m, winter ${avg([9, 10, 11], 'line').toFixed(0)} m`);
  ok(avg([1, 2, 7, 8], 'wet') > avg([9, 10, 11], 'wet'), `the ground is wetter in spring / autumn (${avg([1, 2, 7, 8], 'wet').toFixed(3)}) than in winter (${avg([9, 10, 11], 'wet').toFixed(3)})`);

  // melt curves: a full cover under clear sky in mid-spring / summer / mid-autumn
  const meltT = ph => { const G = boot(`seed=3&season=${ph}&weather=clear`); G.api.setCoverage(1); let t = 0; while (G.ground.s.cover > 0 && t < 3000) { runC(G, 1); t++; } return t; };
  const mSp = meltT(0.125), mSu = meltT(0.375), mWi = meltT(0.875);
  log(`   melt of a full cover under a clear sky: mid-spring ${mSp} s, mid-summer ${mSu} s, mid-winter ${mWi >= 3000 ? 'never' : mWi + ' s'}`);
  // (stage 2b: in a spring thaw the snowline climbs off the meadow and the snow left above it melts at the air temperature
  // up there, so a full spring pack lingers on the slopes for several minutes)
  ok(mSu < 90 && mSu < mSp && mSp < 900 && mWi >= 3000, 'melt follows the temperature and the sun (summer fastest, a spring pack lingers on the slopes, never in mid-winter)');
  const W = boot('seed=3&season=summer&weather=clear'); W.api.setWeather('rain', { instant: true }); runC(W, 60);
  const wetRain = W.ground.s.wet; W.api.setWeather('clear', { instant: true }); runC(W, 240);
  ok(wetRain > 0.9 && W.ground.s.wet < 0.4 && W.ground.s.wet > 0.05, `rain wets fast (${wetRain.toFixed(2)} after 60 s), sun dries slowly (${W.ground.s.wet.toFixed(2)} 4 min later)`);
  const R = boot('seed=3&season=summer&weather=clear'); runC(R, 300); const l0 = R.ground.s.snowline;
  R.api.setWeather('rain'); runC(R, 120); const l1 = R.ground.s.snowline;
  R.api.setWeather('clear'); runC(R, 600); const l2 = R.ground.s.snowline;
  ok(l1 < l0 - 100 && l2 > l1 + 50, `a summer storm brings fresh snow down the peaks: snowline ${Math.round(l0)} -> ${Math.round(l1)} -> ${Math.round(l2)} m`);
}

// ---- wind: the natural wind, plain pointer motion, drag steer and release
{
  const mk = () => { const S = boot('seed=8&season=autumn'); S.mouse.inside = true; return S; };
  const stepW = (S, n, f) => { for (let i = 0; i < n; i++) { if (f) f(S, i); S.anim.time += 1 / 60; S.wind.step(1 / 60, false); } };
  const A = mk(), B = mk();
  stepW(A, 600);
  stepW(B, 600, (S, i) => { S.mouse.x = Math.sin(i * 0.1); S.mouse.y = Math.cos(i * 0.07); S.mouse.vxn = 3 * Math.sin(i * 0.3); S.mouse.vyn = 2 * Math.cos(i * 0.2); S.mouse.drag = false; });
  ok(JSON.stringify(A.wind.s) === JSON.stringify(B.wind.s) && B.wind.s.steer.every(v => v === 0), 'plain pointer motion (no button) changes nothing: wind and steer identical to no pointer');
  const C = mk();
  stepW(C, 30, S => { S.mouse.drag = true; S.mouse.vxn = 1; S.mouse.vyn = 0; });
  const st = C.wind.s.steer;
  ok(st[0] > 9 && Math.abs(st[2]) < 1e-9 && C.wind.s.bias > 9, `a rightward drag of 1 viewport/s steers ${st[0].toFixed(1)} m/s along camR within 0.5 s`);
  stepW(C, 30, S => { S.mouse.drag = true; S.mouse.vxn = 0; S.mouse.vyn = 0.8; });
  ok(C.wind.s.steer[2] > 2 && C.wind.s.gust > 2, `an upward drag steers away from the camera (camF ${C.wind.s.steer[2].toFixed(1)} m/s)`);
  stepW(C, 60, S => { S.mouse.drag = true; S.mouse.vxn = 5; S.mouse.vyn = 5; });
  ok(Math.hypot(C.wind.s.steer[0], C.wind.s.steer[2]) <= 14 + 1e-9, `the steer is capped at 14 m/s (${Math.hypot(C.wind.s.steer[0], C.wind.s.steer[2]).toFixed(2)})`);
  const m0 = Math.hypot(C.wind.s.steer[0], C.wind.s.steer[2]);
  stepW(C, 900, S => { S.mouse.drag = false; S.mouse.vxn = 4; });
  const m15 = Math.hypot(C.wind.s.steer[0], C.wind.s.steer[2]);
  ok(Math.abs(m15 / m0 - 0.5) < 0.01, `after release the steer halves in 15 s (${m0.toFixed(2)} -> ${m15.toFixed(2)})`);
  stepW(C, 6000, S => { S.mouse.drag = false; });
  ok(Math.hypot(C.wind.s.steer[0], C.wind.s.steer[2]) < 0.1, 'and fades back to the natural wind');
  const nat = C.wind.s.natural, tg = C.wind.s.target, sv = C.wind.s.steer;
  ok(nat.every((v, i) => near(tg[i], v + sv[i], 1e-12)), 's.target = s.natural + s.steer (clouds follow s.natural)');
  // the natural wind veers slowly, stays a breeze in fair weather and blows a gale in a blizzard
  const N = boot('seed=8&season=summer&weather=clear');
  let angs = [], spd = [];
  for (let i = 0; i < 600; i++) { N.anim.time += 1; N.wind.step(1, true); angs.push(Math.atan2(N.wind.s.natural[2], N.wind.s.natural[0])); spd.push(Math.hypot(N.wind.s.natural[0], N.wind.s.natural[2])); }
  const span = Math.max(...angs) - Math.min(...angs), maxStep = Math.max(...angs.slice(1).map((a, i) => Math.abs(a - angs[i])));
  ok(span > 0.5 && maxStep < 0.12, `the natural wind veers slowly (span ${(span * 57.3).toFixed(0)} deg over 10 min, at most ${(maxStep * 57.3).toFixed(1)} deg/s)`);
  ok(Math.max(...spd) < 3 && Math.min(...spd) > 0.05, `fair-weather breeze ${Math.min(...spd).toFixed(2)}..${Math.max(...spd).toFixed(2)} m/s`);
  const Bz = boot('seed=8&weather=blizzard&t=5');
  ok(Math.hypot(Bz.wind.s.natural[0], Bz.wind.s.natural[2]) > 6, `a blizzard blows a gale (${Math.hypot(Bz.wind.s.natural[0], Bz.wind.s.natural[2]).toFixed(1)} m/s)`);
  const Fw = boot('wind=2,0&seed=8&wx=gale:0');
  ok(near(Math.atan2(Fw.wind.s.natural[2], Fw.wind.s.natural[0]), 0, 1e-12), '?wind=X,Z sets a fixed (non-veering) base wind');
}

console.log(fails ? `${fails} sim check(s) FAILED` : 'sim tests passed');
process.exit(fails ? 1 : 0);
