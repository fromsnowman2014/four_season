// =====================================================================================
//  ui.js — the chrome (stage-1 owner: lane B): one season glyph in the corner, a glass pop-over, a start hint.
//  Registers only; main.js calls S.bindUI and S.syncUI at boot, and S.updateUI every frame. It drives the sim only
//  through the module APIs (S.climate.api: setSeason, speed; S.weather.api: setWeather, amount, auto: the same calls
//  window.snowSim exposes) and reads the module state / snapshots for the status line and the checked controls.
// =====================================================================================
(function (S) {
  'use strict';
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const WX_KO = { clear: '맑음', cumulus: '구름', overcast: '흐림', fog: '안개', rain: '비', snow: '눈', blizzard: '폭설' };
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
  const YEAR_MIN = 20;   // one year at 1x, in real minutes (YEAR = 1200 climate-s)

  // open: pop-over shown; hover: the pointer rests on it; last: S.anim.wall of the last interaction (it closes after
  // 6 s idle unless hovered or keyboard-focused); hintDone: the pop-over was opened, the hint stays hidden; txt: last
  // written text per element (DOM writes only on change)
  const ui = S.ui = {
    icon: null, pop: null, hint: null, hintDone: false, el: {}, open: false, hover: false, last: 0, season: -1, txt: new Map(),
    touch() { ui.last = S.anim.wall; },
    show(kbd) {
      if (ui.hint) { ui.hintDone = true; ui.hint.classList.remove('on'); }   // the hint never sits under the open glass
      ui.open = true; ui.pop.classList.add('open'); ui.icon.classList.add('open'); ui.icon.setAttribute('aria-expanded', 'true');
      ui.touch(); syncUI();
      if (kbd) (ui.el.seasons.querySelector('[tabindex="0"]') || ui.pop.querySelector('button')).focus();
    },
    close() {
      ui.open = false; ui.pop.classList.remove('open'); ui.icon.classList.remove('open'); ui.icon.setAttribute('aria-expanded', 'false');
      const a = document.activeElement;   // never leave focus inside the hidden glass
      if (a && ui.pop.contains(a)) { if (a.matches(':focus-visible')) ui.icon.focus(); else a.blur(); }
    },
  };

  const seasonOf = phase => Math.floor(phase * 4) % 4;
  // 1년 = 20분 at 1x: 80분 -> '1시간 20분', 2.5분 -> '2분 30초'
  function yearText(speed) {
    if (!(speed > 0)) return '시간 멈춤';
    const sec = Math.round(YEAR_MIN * 60 / speed), h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return '1년 = ' + [h ? h + '시간' : '', m ? m + '분' : '', s ? s + '초' : ''].filter(Boolean).join(' ');
  }
  const speedText = v => (v === 0.25 ? '0.25' : v === 0.5 ? '0.5' : String(+v.toFixed(2))) + '배';
  const nearestStop = v => { let k = 0; for (let i = 1; i < SPEEDS.length; i++) if (Math.abs(Math.log2(SPEEDS[i] / v)) < Math.abs(Math.log2(SPEEDS[k] / v))) k = i; return k; };
  function setText(el, t) { if (ui.txt.get(el) !== t) { ui.txt.set(el, t); el.textContent = t; } }
  function setProp(el, k, v) { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); }

  // a radiogroup of buttons: roving tabindex, arrows move and pick (rows of `cols` for the grid), Home / End
  function radios(group, cols, pick) {
    const btns = [...group.querySelectorAll('[role=radio]')];
    group.addEventListener('click', e => { const b = e.target.closest('[role=radio]'); if (b) { pick(b.dataset.v); syncUI(); } });
    group.addEventListener('keydown', e => {
      const i = btns.indexOf(document.activeElement), n = btns.length;
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      let j = step !== undefined ? (i + step + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      btns[j].focus(); btns[j].click();
    });
    return btns;
  }
  function check(btns, v) {
    let idx = 0;
    btns.forEach((b, i) => {
      const on = b.dataset.v === v;
      if (on) idx = i;
      if (b.getAttribute('aria-checked') !== String(on)) { b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    });
    return idx;
  }

  S.bindUI = function () {
    const $ = id => document.getElementById(id);
    if (!S.cfg.ui) { for (const id of ['icon', 'pop', 'hint']) $(id).remove(); document.querySelector('.sprite').remove(); return; }
    const clim = S.climate.api, wx = S.weather.api;
    ui.icon = $('icon'); ui.pop = $('pop'); ui.hint = $('hint');
    // touch screens have no hover and no mouse button: the wind comes from a finger sweeping across the scene
    if (matchMedia('(hover: none) and (pointer: coarse)').matches) ui.hint.textContent = '화면을 쓸어 바람을 일으켜 보세요';
    const el = ui.el = { glyphs: [...ui.icon.querySelectorAll('.glyph')], season: $('stSeason'), wx: $('stWx'), prog: $('stProg'), year: ui.pop.querySelector('.yr'),
      seasons: $('seasons'), thumb: ui.pop.querySelector('.seg .thumb'), speed: $('speed'), speedV: $('speedv'), ticks: [...ui.pop.querySelectorAll('.ticks b')],
      amount: $('amount'), amountV: $('amountv') };
    el.seasonBtns = radios(el.seasons, 1, v => clim.setSeason(v === 'auto' ? null : v));
    el.wxBtns = radios($('weathers'), 4, v => { wx.setWeather(v); if (v === 'auto') wx.auto = true; });
    el.speed.addEventListener('input', () => { clim.speed = SPEEDS[+el.speed.value]; syncUI(); });
    el.amount.addEventListener('input', () => { wx.amount = +el.amount.value; });   // the setter re-syncs the chrome
    ui.season = seasonOf(S.climate.s.phase);                                          // the boot glyph shows without a fade
    el.glyphs[ui.season].classList.add('on');

    ui.icon.addEventListener('click', () => { if (ui.open) ui.close(); else ui.show(false); });
    ui.icon.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (ui.open) ui.close(); else ui.show(true); } });
    for (const ev of ['pointermove', 'pointerdown', 'input', 'click', 'keydown']) ui.pop.addEventListener(ev, ui.touch, { passive: true });
    ui.pop.addEventListener('pointerenter', () => { ui.hover = true; });
    ui.pop.addEventListener('pointerleave', () => { ui.hover = false; ui.touch(); });
    // outside press closes (bubble phase: input.js's canvas listener has already seen the pop-over open and so
    // started no drag)
    document.addEventListener('pointerdown', e => { if (ui.open && !ui.pop.contains(e.target) && !ui.icon.contains(e.target)) ui.close(); });
    addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !ui.open) return;
      const inside = ui.pop.contains(document.activeElement);
      ui.close();
      if (inside) ui.icon.focus();
    });
  };

  // the controls follow the sim state (they also change through window.snowSim); cheap: writes only on change
  function syncUI() {
    if (!ui.pop) return;
    const el = ui.el, c = S.climate.s, w = S.weather.s;
    const sv = c.pinned === null ? 'auto' : SEASONS[seasonOf(c.pinned)];
    setProp(el.thumb, '--i', String(check(el.seasonBtns, sv)));
    check(el.wxBtns, w.manual || (w.auto ? 'auto' : w.cur));
    const k = nearestStop(c.speed || 0.25);
    if (+el.speed.value !== k) el.speed.value = k;
    setProp(el.speed, '--p', (k * 20) + '%');
    el.ticks.forEach((b, i) => b.classList.toggle('on', i === k));
    setText(el.speedV, yearText(c.speed));
    const vt = speedText(c.speed) + ', ' + yearText(c.speed);
    if (el.speed.getAttribute('aria-valuetext') !== vt) el.speed.setAttribute('aria-valuetext', vt);
    if (+el.amount.value !== w.amount) el.amount.value = w.amount;
    setProp(el.amount, '--p', (w.amount * 100).toFixed(1) + '%');
    setText(el.amountV, Math.round(w.amount * 100) + '%');
    status();
  }
  S.syncUI = syncUI;

  // status line: '늦가을 · 눈', or '늦가을 · 눈 → 맑음' with the hairline filling while a transition runs (the season
  // label is the sim's: 초봄 / 봄 / 늦봄 ... 늦겨울, see sim/climate.js); the dot
  // under the season segments shows how far the year (from 1 March) has come
  function status() {
    const el = ui.el, c = S.climate.s, w = S.weather.s;
    setText(el.season, S.climate.seasonKo(c.phase));      // the same label as snowSim.state().seasonKo
    const moving = !!w.next && w.next !== w.cur && w.progress < 1;
    setText(el.wx, moving ? WX_KO[w.cur] + ' → ' + WX_KO[w.next] : (WX_KO[w.cur] || ''));
    el.prog.classList.toggle('on', moving);
    setProp(el.prog, '--p', moving ? w.progress.toFixed(3) : '0');
    setProp(el.year, '--y', c.phase.toFixed(4));
  }

  S.updateUI = function () {
    if (!ui.icon || S.frameNo % 6) return;
    const wall = S.anim.wall, readyTime = S.R.readyTime;
    if (ui.open && !ui.hover && !ui.pop.querySelector(':focus-visible') && wall - ui.last > 6) ui.close();
    if (ui.open) syncUI();
    ui.icon.classList.toggle('idle', !ui.open && wall - S.mouse.lastMove > 4);
    const si = seasonOf(S.climate.s.phase);   // the glyph cross-fades on a season change
    if (si !== ui.season) { ui.season = si; ui.el.glyphs.forEach((g, i) => g.classList.toggle('on', i === si)); }
    // the hint fades in once the scene is ready, out after ~5 s, then leaves the DOM; as it goes, the icon lifts
    // for two seconds (the one moment the corner glyph announces itself)
    if (readyTime >= 0) {
      const since = wall - readyTime;
      if (ui.hint) {
        if (since > 0.5 && since < 5.5 && !ui.hintDone) ui.hint.classList.add('on');
        else if (since >= 5.5) { ui.hint.classList.remove('on'); if (since > 7.2) { ui.hint.remove(); ui.hint = null; } }
      }
      ui.icon.classList.toggle('lift', since >= 5.5 && since < 7.5);
    }
  };
})(window.SNOW);
