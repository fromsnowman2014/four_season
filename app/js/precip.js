// =====================================================================================
//  precip.js (stage-1 owner: lane E) — the precipitation layers and their draw: the layer descriptors, the
//  per-layer lattice wrap of the wind / fall integrals, and S.drawPrecip(ctx), which render.js calls between FXAA and
//  bloom (premultiplied alpha into R.hdr). Registers only.
//
//  Layer descriptor: { id, kind: 'snow' | 'rain', prog, z0, z1, fade, base, max, heavy, vlo, vhi, fallKey, rateKey,
//                      wet (snow) | push (rain) }
//    id        uLayer inside its program (VS_FLAKE: 0 near bokeh, 1 crystals, 2 mid, 3 far, 4 hero; VS_RAIN: 5 near
//              defocused drops, 6 near streaks, 7 mid, 8 far fine streaks). Distinct ids = independent hashes.
//    prog      the S.P program that draws it ('flake' | 'rain')
//    z0 z1 fade   camera-space depth slice (m) and its edge fade length
//    base max     instance count at density x1 / hard cap; heavy: count multiplier at full uHeavy
//    vlo vhi      fall-speed range (m/s at fall factor 1) of its 40 speed bins (uFallLH)
//    fallKey      the S.anim fall integral its bins wrap ('fallI' | 'rainI')
//    rateKey      the S.F rate its count scales with ('uPrecipSnow' | 'uPrecipRain')
//    wet          snow: count multiplier at full wet snow (x (1 + (wet - 1) x uWetSnow): fewer, bigger clumps)
//    push         rain: drag-wake weight (uPushK; VS_FLAKE keeps Phase 1's 1)
//  count = min(max x flakeMul, base x amountMul x flakeMul x F[rateKey] x (1 + (heavy - 1) x F.uHeavy) x the wet
//  multiplier); a layer with count 0 is skipped (no program switch, no cost). Layers draw far to near (sorted by z1),
//  switching program only when the kind changes, so rain and snow slices interleave by depth. Sleet is both
//  populations at once, their counts cross-fading with snowFrac (instances enable in id order and the last one
//  fades: no pops); a particle never changes kind, bin or speed range.
//  Budget at amount 0.5: calm snow ~60k, blizzard ~183k; rain .65 ~15k; heavy rain at the caps (precip 1, heavy 1,
//  amount 1) ~54k instances, about half the blizzard's GPU cost.
// =====================================================================================
(function (S) {
  'use strict';
  const { camR, camU, camF } = S;   // mutated in place by S.frameCamera; S.TANH is read per use
  const R = S.R;
  const NB = 40;                                   // fall-speed bins (must match PRECIP_VS)
  const SNOW = { kind: 'snow', prog: 'flake', vlo: 0.4675, vhi: 1.5525, fallKey: 'fallI', rateKey: 'uPrecipSnow' };
  // rain bins: the drop speeds of VS_RAIN (1.6-4.4 mm drops: 5.7-8.9 m/s)
  const RAIN = { kind: 'rain', prog: 'rain', vlo: 5.5, vhi: 9.0, fallKey: 'rainI', rateKey: 'uPrecipRain' };
  const LAYERS = S.LAYERS = [
    // heavy: per-layer density multiplier at full blizzard (total flake count ends up > x6)
    // wet: count multiplier for wet snow (fewer, bigger clumps: the near tiers gain, the far fine field thins)
    { ...SNOW, id: 3, z0: 26, z1: 240, fade: 22, base: 46000, max: 125000, heavy: 6.5, wet: 0.75 },
    { ...SNOW, id: 2, z0: 8, z1: 30, fade: 4, base: 12000, max: 50000, heavy: 4.5, wet: 0.9 },
    { ...SNOW, id: 1, z0: 2.3, z1: 9.0, fade: 0.9, base: 2500, max: 14000, heavy: 3.2, wet: 1.35 },
    { ...SNOW, id: 4, z0: 0.9, z1: 2.4, fade: 0.3, base: 36, max: 220, heavy: 1.7, wet: 1.5 },     // hero crystals (sparse, in focus)
    { ...SNOW, id: 0, z0: 0.25, z1: 0.8, fade: 0.15, base: 20, max: 140, heavy: 2.0, wet: 1.0 },   // near bokeh discs (~3 on screen)
    // rain: far fine streaks, mid streaks, near sharp streaks, a few big defocused drops at the lens
    { ...RAIN, id: 8, z0: 14, z1: 70, fade: 8, base: 14000, max: 34000, heavy: 2.5, push: 0.45 },
    { ...RAIN, id: 7, z0: 4.5, z1: 18, fade: 2, base: 8000, max: 17000, heavy: 2.2, push: 0.6 },
    { ...RAIN, id: 6, z0: 1.3, z1: 5.5, fade: 0.6, base: 1100, max: 2600, heavy: 2.0, push: 0.8 },
    { ...RAIN, id: 5, z0: 0.3, z1: 1.5, fade: 0.2, base: 30, max: 100, heavy: 1.6, push: 1.0 },
  ].sort((a, b) => b.z1 - a.z1);
  for (const L of LAYERS) { L.hx = 0; L.hy = 0; L.dA = new Float32Array(3); L.dB = new Float32Array(3); L.fall = new Float32Array(3 * NB); }
  S.layoutLayers = function () {
    const asp = R.W / R.H;
    const tanH = S.TANH;
    for (const L of LAYERS) { L.hx = L.z1 * tanH * asp * 1.1 + 0.3; L.hy = L.z1 * tanH * 1.1 + 0.3; }
  };
  const count = S.precipCount = { snow: 0, rain: 0 };   // instances drawn last frame, per kind

  // Lattice wrap of the per-layer displacement integrals (all CPU-side, in double precision). The shader folds
  // positions into the camera-aligned slice box with a mod, so shifting a displacement by any lattice vector of
  // that box is invisible: that keeps the uploaded floats small (no precision loss) with no discontinuity.
  const AXES = [camR, camU, camF];
  const boxS = [0, 0, 0], shift = [0, 0, 0], cq = [0, 0, 0];
  function latticeShift(cx, cy, cz) {   // camera-space coords -> the lattice vector to subtract (world space, in shift[])
    shift[0] = shift[1] = shift[2] = 0;
    cq[0] = cx; cq[1] = cy; cq[2] = cz;
    for (let j = 0; j < 3; j++) { const ax = AXES[j], n = Math.floor(cq[j] / boxS[j]) * boxS[j]; shift[0] += ax[0] * n; shift[1] += ax[1] * n; shift[2] += ax[2] * n; }
  }
  function wrapLayer(L) {
    const anim = S.anim;
    boxS[0] = 2 * L.hx; boxS[1] = 2 * L.hy; boxS[2] = L.z1 - L.z0;
    // wind: both integrals shifted by the same vector (the shader mixes them affinely)
    const a = anim.dispA, b = anim.dispB;
    latticeShift(a[0] * camR[0] + a[1] * camR[1] + a[2] * camR[2], a[0] * camU[0] + a[1] * camU[1] + a[2] * camU[2], a[0] * camF[0] + a[1] * camF[1] + a[2] * camF[2]);
    for (let i = 0; i < 3; i++) { L.dA[i] = a[i] - shift[i]; L.dB[i] = b[i] - shift[i]; }
    // fall: one reduced vector per speed bin, (0, -k*I, 0) with I the layer's fall integral
    const fallI = anim[L.fallKey];
    for (let j = 0; j < NB; j++) {
      const vy = -(L.vlo + (j + 0.5) / NB * (L.vhi - L.vlo)) * fallI;
      latticeShift(vy * camR[1], vy * camU[1], vy * camF[1]);
      L.fall[3 * j] = -shift[0]; L.fall[3 * j + 1] = vy - shift[1]; L.fall[3 * j + 2] = -shift[2];
    }
  }

  // per-program setup, once per frame when a program is first needed (S.F is uploaded by ctx.use); uniform values
  // persist per program and the texture units are shared, so a later switch back only rebinds the program
  const msArr = new Float32Array(32 * 4), maArr = new Float32Array(32);
  const ready = {};                                // this frame's uniform locations of each program once set up
  let nSeg = 0;
  function setup(u, ctx) {
    const gl = S.gl, Ws = R.Ws, Hs = R.Hs;
    gl.uniform2f(u.uRes, Ws, Hs);
    ctx.bindGB(u, 8);
    ctx.bindTex(2, R.scene.texs[0], u.uScene);       // scene alpha: snow fraction x sun visibility
    gl.uniform1f(u.uAspect, Ws / Hs);
    gl.uniform1f(u.uFocalPx, Hs * 0.5 / S.TANH);
    // focus at 1.3 m with a gentle circle of confusion: the hero tier (0.9-2.4 m) is sharp, only the near discs
    // (and the nearest raindrops) defocus
    gl.uniform1f(u.uCocK, 12 * Hs / 1080);
    gl.uniform1f(u.uFocus, 1.3);
    gl.uniform1ui(u.uSeed, S.cfg.seed);
    gl.uniform4fv(u.uMs, msArr); gl.uniform1fv(u.uMa, maArr); gl.uniform1i(u.uMn, nSeg);
  }

  // ctx (render.js): { use(prog) -> uniform locations (binds the program and uploads S.F), bindGB(u, unit0),
  // bindTex(unit, tex, loc) }. The target (R.hdr) is bound and the viewport set by the caller.
  S.drawPrecip = function (ctx) {
    const gl = S.gl, P = S.P, F = S.F, perf = S.perf, mouse = S.mouse;
    count.snow = count.rain = 0;
    nSeg = mouse.segs.length;
    for (let i = 0; i < nSeg; i++) { const m = mouse.segs[i]; msArr[i * 4] = m.x; msArr[i * 4 + 1] = m.y; msArr[i * 4 + 2] = m.dx; msArr[i * 4 + 3] = m.dy; maArr[i] = S.anim.wall - m.t; }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const dens = S.amountMul() * perf.flakeMul;
    let cur = null, u = null;
    for (const k in ready) ready[k] = null;
    for (const L of LAYERS) {
      const wetK = L.wet ? 1 + (L.wet - 1) * F.uWetSnow : 1;
      const cnt = Math.min(L.max * perf.flakeMul, L.base * dens * F[L.rateKey] * (1 + (L.heavy - 1) * F.uHeavy) * wetK);   // the cap thins too, or the rung is a no-op in a blizzard
      const ni = Math.ceil(cnt);
      if (ni <= 0) continue;
      if (L.prog !== cur) {
        cur = L.prog;
        if (ready[cur]) { u = ready[cur]; gl.useProgram(P[cur].p); }
        else { u = ready[cur] = ctx.use(P[cur]); setup(u, ctx); }
      }
      wrapLayer(L);
      gl.uniform3fv(u.uDispA, L.dA); gl.uniform3fv(u.uDispB, L.dB); gl.uniform3fv(u.uFallQ, L.fall);
      gl.uniform2f(u.uFallLH, L.vlo, L.vhi);
      gl.uniform1i(u.uLayer, L.id);
      gl.uniform3f(u.uSlice, L.z0, L.z1, L.fade);
      gl.uniform2f(u.uHalfXY, L.hx, L.hy);
      gl.uniform1f(u.uCount, cnt);
      if (L.kind === 'rain') gl.uniform1f(u.uPushK, L.push);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, ni);
      count[L.kind] += ni;
    }
    gl.disable(gl.BLEND);
  };
})(window.SNOW);
