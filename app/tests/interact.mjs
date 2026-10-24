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
//  - Phase 3: the place cards (labels from S.scenes, a pick switches through setScene, the glass stays open with the
//    checked card busy until state().ready, the status line names the place), the 뇌우 chip, the weather grid's ↑ / ↓,
//    the hazard buttons (trigger, a glow while the event runs) and the 가끔 자동으로 switch (snowSim.hazardsAuto, both
//    ways), the ← / → place keys (only with the glass closed, never from a text / radio / slider control, not with a
//    modifier or a repeat; the radiogroup's own arrows switch once; a toast names the place)
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
  const API = ['state', 'advance', 'setSeason', 'speed', 'setWeather', 'setStorm', 'triggerBlizzard', 'amount', 'auto', 'setCoverage', 'reset', 'resetSnow',
    'setScene', 'scene', 'trigger', 'hazardsAuto'];
  const key = (el, k, o) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
  const waitReady = async () => { for (let i = 0; i < 1200 && !st().ready; i++) await wait(25); return st().ready; };   // a valley rebake on a loaded GPU can take seconds
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
  // ---- Phase 3: places (the glass stays open through a switch; the checked card is busy until ready)
  const pl = v => document.querySelector('#places [data-v=' + v + ']');
  out.placeCards = [...document.querySelectorAll('#places [role=radio]')].map(b => b.dataset.v + ':' + b.textContent.trim()).join(',') + ' ' + chk('places', 'valley')
    + ' ' + $('stPlace').textContent;
  pl('house').click();
  out.placeBusy = snowSim.scene === 'house' && chk('places', 'house') && !st().ready && pl('house').classList.contains('busy')
    && $('places').getAttribute('aria-busy') === 'true' && getComputedStyle(pl('house'), '::after').animationName === 'sheen';
  const t0 = performance.now(); await waitReady(); await sync();
  out.placeReady = st().ready && !pl('house').classList.contains('busy') && pop.classList.contains('open') && $('stPlace').textContent === '우리 집';
  // ---- thunder chip; the weather grid's up / down (자동 is one tall cell, the states two rows of four)
  document.querySelector('#weathers [data-v=thunder]').click(); await sync();
  out.thunder = st().weather.manual === 'thunder' && chk('weathers', 'thunder') && $('stWx').textContent.endsWith('뇌우');
  const wb = v => document.querySelector('#weathers [data-v=' + v + ']');
  wb('thunder').focus(); key(wb('thunder'), 'ArrowUp'); const up = document.activeElement.dataset.v;
  key(document.activeElement, 'ArrowDown'); const down = document.activeElement.dataset.v;
  wb('auto').focus(); key(wb('auto'), 'ArrowDown'); out.wxVert = up + ' ' + down + ' ' + document.activeElement.dataset.v;
  snowSim.setWeather('auto'); await sync();
  // ---- hazards: momentary buttons that glow while their event runs; the switch
  const hb = k => document.querySelector('#hazards [data-k=' + k + ']');
  hb('quake').click();
  out.quake = hb('quake').classList.contains('on') && !hb('wildfire').classList.contains('on') && SNOW.events.s.quakeT >= 0;
  snowSim.advance(5); await sync(); const qPeak = st().hazards.quake;
  snowSim.advance(11); await sync();
  out.quakeEnds = qPeak > 0.3 && st().hazards.quake === 0 && !hb('quake').classList.contains('on');
  hb('wildfire').click(); snowSim.advance(30); await sync();
  out.fire = hb('wildfire').classList.contains('on') && st().hazards.smoke > 0.9;
  snowSim.advance(151); await sync(); out.fireEnds = st().hazards.smoke === 0 && !hb('wildfire').classList.contains('on');
  const sw = $('hzAuto'); out.autoOff = snowSim.hazardsAuto === false && sw.getAttribute('aria-checked') === 'false';
  sw.click(); out.autoOn = snowSim.hazardsAuto === true && st().hazards.auto === true && sw.getAttribute('aria-checked') === 'true';
  snowSim.hazardsAuto = false; out.autoApi = sw.getAttribute('aria-checked') === 'false';
  // ---- the ← / → place keys: nothing while the glass is open (the radiogroup's own arrows switch exactly once)
  key(window, 'ArrowRight'); out.keyOpenNothing = snowSim.scene === 'house';
  pl('house').focus(); key(pl('house'), 'ArrowRight'); out.radioArrowOnce = snowSim.scene === 'valley' && document.activeElement === pl('valley') && chk('places', 'valley');
  await waitReady();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sync();
  // closed, focus on the icon or the page: → / ← switch (wrapping) and the toast names the place
  icon.focus(); key(icon, 'ArrowRight');
  const toast = $('toast');
  out.keySwitch = snowSim.scene === 'house' && !pop.classList.contains('open') && toast.classList.contains('on') && toast.textContent === '우리 집';
  await waitReady(); key(document.body, 'ArrowLeft'); out.keyBack = snowSim.scene === 'valley' && toast.textContent === '알프스 계곡';
  await waitReady();
  // not from a text / radio / slider control, nor with a modifier, nor a held key
  const probe = (html, role) => { const e = document.createElement(html); if (role) e.setAttribute('role', role); e.tabIndex = 0; document.body.appendChild(e); e.focus(); key(e, 'ArrowRight'); e.remove(); return snowSim.scene; };
  out.keyGuards = [probe('input'), probe('textarea'), probe('div', 'radio'), probe('div', 'slider'), (key(document.body, 'ArrowRight', { shiftKey: true }), snowSim.scene),
    (key(document.body, 'ArrowRight', { metaKey: true }), snowSim.scene), (key(document.body, 'ArrowRight', { repeat: true }), snowSim.scene)].join(',');
  await wait(1900); out.toastGone = !toast.classList.contains('on');
  icon.click(); await sync();
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
  await waitReady();   // (a still-baking place keeps the glass open by design)
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
  placeCards: 'valley:알프스 계곡,house:우리 집 true 알프스 계곡', placeBusy: true, placeReady: true, thunder: true, wxVert: 'cumulus thunder auto',
  quake: true, quakeEnds: true, fire: true, fireEnds: true, autoOff: true, autoOn: true, autoApi: true,
  keyOpenNothing: true, radioArrowOnce: true, keySwitch: true, keyBack: true,
  keyGuards: 'valley,valley,valley,valley,valley,valley,valley', toastGone: true,
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
// ?ui=0: no chrome at all (the icon, the pop-over, the hint, the toast and the sprite are removed), no place keys, the
// API still works
const r0 = await capture({ html: APP, q: 'seed=7&ui=0', wait: 1500,
  eval: "(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })), JSON.stringify([['icon', 'pop', 'hint', 'toast'].filter(id => document.getElementById(id)).length, document.querySelectorAll('.sprite').length, typeof snowSim.setWeather, typeof snowSim.setScene, snowSim.scene]))" });
const ok0 = r0.value === '[0,0,"function","function","valley"]' && !r0.errors.length;
if (!ok0) fails++;
console.log(`${ok0 ? 'ok  ' : 'FAIL'} ?ui=0 removes the chrome  ${r0.value}`);
for (const e of r0.errors) console.log('     ' + e);
console.log(fails ? `${fails} interaction check(s) FAILED` : 'interaction checks passed');
process.exit(fails ? 1 : 0);
