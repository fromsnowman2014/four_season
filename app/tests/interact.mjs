// Interaction checks of the Phase-2 chrome and pointer contract (real GPU, headless Chrome, file://), live:
//   node app/tests/interact.mjs
// One live page (?seed=7&season=autumn&weather=snow) runs a script that drives the pop-over, window.snowSim and
// synthetic pointer events, and returns what it saw; a second page checks ?ui=0. Expected values, not a comparison
// with a reference build (Phase 2 replaced the Phase-1 chrome and the hover wind by design).
//  - the API surface, the hint lifecycle, the corner glyph (season), idle dimming
//  - open / close: icon click, Escape, outside press, Enter (focus on the checked season), 6 s auto-close
//  - the status line reads the real sim: season label = state().seasonKo, weather '눈', '눈 → 비' with the progress
//    hairline during a transition, '비' after it
//  - weather chips (a pick -> weather.manual, 자동 -> scheduler), season chips (pin, thumb, the glyph after the 60 s
//    ease, 자동 unpins), arrow keys in the radiogroup, the speed slider and its caption (8x: '1년 = 2분 30초'),
//    the amount slider, API -> chrome sync
//  - pointer: a buttonless sweep leaves the steer, the drag velocity and the wake at exactly 0 on every event; a press
//    that only closes the pop-over starts no drag; a right press starts nothing; a left drag (PointerEvents with
//    buttons 1) steers the wind, lays wake segments and shows the grabbing cursor; release ends it and the steer decays
// Exit 1 on any failed expectation or console error / warning.
import { capture } from './cdp.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../index.html');

const SCRIPT = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id), S = SNOW, m = S.mouse, out = {};
  const icon = $('icon'), pop = $('pop'), st = () => snowSim.state(), c = $('c');
  const chk = (grp, v) => document.querySelector('#' + grp + ' [data-v=' + v + ']').getAttribute('aria-checked') === 'true';
  const pe = (type, x, y, buttons, extra) => c.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: y }, extra || {})));
  const sync = () => wait(250);          // updateUI re-syncs the open pop-over every 6 frames
  const API = ['state', 'advance', 'setSeason', 'speed', 'setWeather', 'setStorm', 'triggerBlizzard', 'amount', 'auto', 'setCoverage', 'reset', 'resetSnow'];
  out.api = API.filter(k => !(k in snowSim)).join(',') || 'complete';
  for (let i = 0; i < 200 && !st().ready; i++) await wait(50);
  await wait(700);
  out.hintShown = $('hint') !== null && $('hint').classList.contains('on');
  out.glyphAutumn = icon.querySelector('.glyph[data-s="2"]').classList.contains('on') && icon.querySelectorAll('.glyph.on').length === 1;

  // ---- open, status line
  icon.click(); await sync();
  out.open = pop.classList.contains('open') && icon.getAttribute('aria-expanded') === 'true';
  out.statusSeason = $('stSeason').textContent === st().seasonKo && st().seasonKo === '가을';
  out.statusWx = $('stWx').textContent;
  out.chipsBoot = chk('weathers', 'snow') && chk('seasons', 'autumn');
  // ---- weather pick: a 60 s transition shown in the status line, then held
  document.querySelector('#weathers [data-v=rain]').click(); await sync();
  out.pickRain = st().weather.manual === 'rain' && st().weather.next === 'rain' && chk('weathers', 'rain');
  snowSim.advance(30); await sync();
  out.midStatus = $('stWx').textContent;
  const p = +getComputedStyle($('stProg')).getPropertyValue('--p');
  out.hairline = $('stProg').classList.contains('on') && p > 0.4 && p < 0.6;
  snowSim.advance(31); await sync();
  out.endStatus = $('stWx').textContent + ' ' + $('stProg').classList.contains('on') + ' ' + st().weather.cur + ' ' + st().weather.next;
  document.querySelector('#weathers [data-v=auto]').click(); await sync();
  out.autoChip = st().weather.manual === null && snowSim.auto === true && chk('weathers', 'auto') && st().weather.nextAt > 0;
  // ---- season pick: eases over 60 s; the label and the corner glyph follow the phase
  document.querySelector('#seasons [data-v=summer]').click(); await sync();
  out.pinSummer = st().seasonPinned && chk('seasons', 'summer') && $('seasons').querySelector('.thumb').style.getPropertyValue('--i') === '2' && st().season === 'autumn';
  snowSim.advance(61); await sync();
  out.summerArrived = st().season === 'summer' && st().phase === 0.375 && $('stSeason').textContent === st().seasonKo
    && icon.querySelector('.glyph[data-s="1"]').classList.contains('on') && icon.querySelectorAll('.glyph.on').length === 1;
  document.querySelector('#seasons [data-v=auto]').click(); await sync();
  out.seasonAuto = !st().seasonPinned && chk('seasons', 'auto');
  // ---- speed slider + caption
  const sp = $('speed');
  sp.value = 5; sp.dispatchEvent(new Event('input', { bubbles: true })); await sync();
  out.speed8 = snowSim.speed + ' ' + $('speedv').textContent + ' | ' + sp.getAttribute('aria-valuetext');
  sp.value = 4; sp.dispatchEvent(new Event('input', { bubbles: true })); await sync();
  out.speed4 = snowSim.speed + ' ' + $('speedv').textContent;
  snowSim.speed = 0.25; await sync();
  out.speedApi = sp.value + ' ' + $('speedv').textContent;
  snowSim.speed = 1; await sync();
  // ---- amount slider + API sync
  const amt = $('amount'); amt.value = 0.8; amt.dispatchEvent(new Event('input', { bubbles: true }));
  out.amount = st().amount + ' ' + $('amountv').textContent;
  snowSim.amount = 0.3; out.amountApi = $('amountv').textContent + ' ' + amt.value;
  snowSim.setWeather('fog'); await sync();
  out.wxApi = chk('weathers', 'fog') && $('stWx').textContent.endsWith('안개');
  snowSim.setWeather('auto'); await sync();
  // ---- keyboard
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); out.escCloses = !pop.classList.contains('open');
  icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await sync();
  const a = document.activeElement;
  out.enterFocus = pop.classList.contains('open') && a && a.closest('#seasons') !== null && a.getAttribute('aria-checked') === 'true';
  a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sync();
  out.arrowPicks = st().seasonPinned && chk('seasons', 'spring') && document.activeElement.dataset.v === 'spring';
  snowSim.setSeason(null);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sync();
  out.escFocusIcon = !pop.classList.contains('open') && document.activeElement === icon;
  // ---- a press on the canvas that only closes the open pop-over starts no drag; a right press starts nothing
  icon.click(); await sync();
  pe('pointerdown', 700, 450, 1); out.closeNoDrag = !pop.classList.contains('open') && !m.drag; pe('pointerup', 700, 450, 0);
  pe('pointerdown', 700, 450, 2, { button: 2 }); out.rightNoDrag = !m.drag; pe('pointerup', 700, 450, 0, { button: 2 });
  // ---- buttonless sweep: nothing moves (checked on every event)
  await wait(300);
  let hover = true;
  for (let i = 0; i <= 40; i++) {
    pe('pointermove', 200 + i * 28, 420 + (i % 5) * 9, 0); await wait(16);
    const w = S.wind.s;
    hover = hover && !m.drag && m.vxn === 0 && m.vyn === 0 && m.segs.length === 0 && w.steer[0] === 0 && w.steer[2] === 0 && st().wind.steer === 0;
  }
  out.hoverNothing = hover;
  // ---- left drag
  pe('pointerdown', 300, 520, 1); out.dragOn = m.drag && c.classList.contains('drag') && getComputedStyle(c).cursor === 'grabbing';
  let maxSteer = 0;
  for (let i = 1; i <= 40; i++) { pe('pointermove', 300 + i * 25, 520 - i * 4, 1); await wait(16); maxSteer = Math.max(maxSteer, st().wind.steer); }
  out.dragSteers = maxSteer > 2 && m.segs.length > 5 && m.vyn > 0;
  pe('pointerup', 1300, 360, 0);
  const s0 = st().wind.steer;
  out.release = !m.drag && !c.classList.contains('drag') && getComputedStyle(c).cursor === 'default';
  await wait(2000); out.decays = st().wind.steer < s0 && st().wind.steer > 0;
  // ---- idle dimming (4 s without pointer movement), then the 6 s auto-close of an untouched pop-over
  await wait(4300); out.idle = icon.classList.contains('idle');
  icon.click(); await wait(3000); out.autoCloseNotYet = pop.classList.contains('open');
  await wait(3700); out.autoClosed = !pop.classList.contains('open');
  out.hintGone = $('hint') === null;
  return JSON.stringify(out);
})()`;

const EXPECT = {
  api: 'complete', hintShown: true, glyphAutumn: true, open: true, statusSeason: true, statusWx: '눈', chipsBoot: true,
  pickRain: true, midStatus: '눈 → 비', hairline: true, endStatus: '비 false rain null', autoChip: true,
  pinSummer: true, summerArrived: true, seasonAuto: true,
  speed8: '8 1년 = 2분 30초 | 8배, 1년 = 2분 30초', speed4: '4 1년 = 5분', speedApi: '0 1년 = 1시간 20분',
  amount: '0.8 80%', amountApi: '30% 0.3', wxApi: true,
  escCloses: true, enterFocus: true, arrowPicks: true, escFocusIcon: true,
  closeNoDrag: true, rightNoDrag: true, hoverNothing: true, dragOn: true, dragSteers: true, release: true, decays: true,
  idle: true, autoCloseNotYet: true, autoClosed: true, hintGone: true,
};

let fails = 0;
const r = await capture({ html: APP, q: 'seed=7&season=autumn&weather=snow', w: 1600, h: 900, wait: 300, eval: SCRIPT });
const out = JSON.parse(r.value || '{}');
for (const k of Object.keys(EXPECT)) {
  const same = JSON.stringify(out[k]) === JSON.stringify(EXPECT[k]);
  if (!same) fails++;
  console.log(`${same ? 'ok  ' : 'FAIL'} ${k.padEnd(16)} ${JSON.stringify(out[k])}${same ? '' : '   expected ' + JSON.stringify(EXPECT[k])}`);
}
for (const e of r.errors) { console.log('     ' + e); fails++; }
// ?ui=0: no chrome at all (the icon, the pop-over, the hint and the sprite are removed), the API still works
const r0 = await capture({ html: APP, q: 'seed=7&ui=0', wait: 1500,
  eval: "JSON.stringify([['icon', 'pop', 'hint'].filter(id => document.getElementById(id)).length, document.querySelectorAll('.sprite').length, typeof snowSim.setWeather])" });
const ok0 = r0.value === '[0,0,"function"]' && !r0.errors.length;
if (!ok0) fails++;
console.log(`${ok0 ? 'ok  ' : 'FAIL'} ?ui=0 removes the chrome  ${r0.value}`);
for (const e of r0.errors) console.log('     ' + e);
console.log(fails ? `${fails} interaction check(s) FAILED` : 'interaction checks passed');
process.exit(fails ? 1 : 0);
