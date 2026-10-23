// =====================================================================================
//  input.js — pointer input (stage-1 owner: lane B). Wind comes ONLY from a left-button drag on the canvas: the drag
//  velocity feeds the wind (sim/wind.js reads S.mouse) and the wake segments the flake VS pushes flakes with
//  (precip.js uploads them). Plain pointer movement changes nothing but `lastMove` (the chrome's idle timer).
//  Touch / pen: a one-finger drag is that drag. A primary touch or pen contact arrives as pointerdown with button 0 and
//  buttons 1, so it passes the same test; a lifted finger ends it (pointerup / pointercancel / lostpointercapture);
//  further fingers (isPrimary false) are ignored. The canvas has touch-action: none (no page pan / zoom over it).
//  Positions and velocities are taken against the canvas box (S.cssSize), the same box the canvas is sized from.
//  Registers only; main.js calls S.bindInput at boot and S.stepInput(dt) first in every live sim step.
//  S.mouse, the input -> wind contract (wind.js reads only these):
//    drag     the left button is held on the canvas (pointer captured)
//    inside   true only while dragging (Phase 2: hovering is not presence for the wind)
//    x, y     the drag position in ndc (-1..1); held at the last drag position after release
//    vxn      horizontal drag velocity in viewport widths per second (decayed by stepInput, ~0.09 s)
//    vyn      vertical drag velocity, viewport heights per second, up positive (same decay)
//    segs     wake segments { x, y, dx, dy (ndc), t (S.anim.wall) }, at most 32, pushed only while dragging
//    lastMove S.anim.wall of the last pointer movement of any kind (UI idle logic only)
// =====================================================================================
(function (S) {
  'use strict';
  const { lerp } = S;
  const mouse = S.mouse = { inside: false, x: 0, y: 0, lx: null, ly: null, lt: 0, vx: 0, vy: 0, vxn: 0, vyn: 0, drag: false, pid: -1,
                            accX: 0, accY: 0, segT: 0, segs: [], lastMove: 0 };
  let canvas = null;

  function endDrag() {
    if (!mouse.drag) return;
    mouse.drag = false; mouse.inside = false; mouse.lx = null;
    if (canvas) {
      canvas.classList.remove('drag');
      try { if (canvas.hasPointerCapture(mouse.pid)) canvas.releasePointerCapture(mouse.pid); } catch (e) { /* pointer already gone */ }
    }
    mouse.pid = -1;
  }
  // one drag sample: velocity (fast attack; stepInput releases it) and the accumulated wake segment
  function dragMove(e) {
    const now = performance.now() / 1000, [W, H] = S.cssSize();
    mouse.x = e.clientX / W * 2 - 1; mouse.y = 1 - e.clientY / H * 2;
    if (mouse.lx !== null) {
      const dx = e.clientX - mouse.lx, dy = e.clientY - mouse.ly, dtE = Math.max(now - mouse.lt, 0.004);
      mouse.vx = lerp(mouse.vx, dx / dtE, 0.35);
      mouse.vy = lerp(mouse.vy, -dy / dtE, 0.35);
      mouse.accX += dx / W * 2; mouse.accY += -dy / H * 2;
      if (now - mouse.segT > 0.035) {
        if (Math.hypot(mouse.accX, mouse.accY) > 1e-4) {
          mouse.segs.push({ x: mouse.x, y: mouse.y, dx: mouse.accX, dy: mouse.accY, t: S.anim.wall });
          if (mouse.segs.length > 32) mouse.segs.shift();
        }
        mouse.accX = 0; mouse.accY = 0; mouse.segT = now;
      }
    }
    mouse.lx = e.clientX; mouse.ly = e.clientY; mouse.lt = now;
  }

  S.bindInput = function () {
    canvas = document.getElementById('c');
    // any movement counts as activity for the chrome's idle dimming, and nothing else
    addEventListener('pointermove', () => { mouse.lastMove = S.anim.wall; }, { passive: true });
    canvas.addEventListener('pointerdown', e => {
      // the canvas listener runs before ui.js's document listener, so a click that only closes the open pop-over
      // still sees it open here and never starts a drag
      if (e.button !== 0 || !e.isPrimary || mouse.drag || (S.ui && S.ui.open)) return;
      e.preventDefault();                                   // no text selection / focus change from a drag
      mouse.drag = true; mouse.inside = true; mouse.pid = e.pointerId;
      mouse.lx = null; mouse.accX = 0; mouse.accY = 0; mouse.segT = performance.now() / 1000;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer: capture unavailable */ }
      canvas.classList.add('drag');
      dragMove(e);
    });
    canvas.addEventListener('pointermove', e => {
      if (!mouse.drag || e.pointerId !== mouse.pid) return;
      if (!(e.buttons & 1)) { endDrag(); return; }          // the button came up outside the window
      dragMove(e);
    }, { passive: true });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(ev, e => { if (e.pointerId === mouse.pid) endDrag(); });
    addEventListener('blur', endDrag);
  };
  // one live input step (before the wind): the drag velocity decays (fast attack in dragMove, ~0.09 s release, also
  // after the button is released) and the wake segments older than their envelope are dropped
  S.stepInput = function (dt) {
    const k = Math.exp(-dt / 0.09);
    mouse.vx *= k; mouse.vy *= k;
    const [W, H] = S.cssSize();
    mouse.vxn = mouse.vx / W; mouse.vyn = mouse.vy / H;
    S.pruneSegs();
  };
  S.pruneSegs = function () {   // drop wake segments older than their envelope, in place
    const wall = S.anim.wall;
    let k = 0;
    for (let i = 0; i < mouse.segs.length; i++) if (wall - mouse.segs[i].t < 3.6) mouse.segs[k++] = mouse.segs[i];
    mouse.segs.length = k;
  };
})(window.SNOW);
