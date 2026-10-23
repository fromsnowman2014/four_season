// =====================================================================================
//  render.js — the frame uniform bundle S.F (S.deriveF: the static fields, then the derive modules) and its generic
//  upload, the G-buffer binding, and render(): the seven passes of one frame. The precipitation pass is
//  S.drawPrecip (precip.js). Registers only.
//  Texture units (WebGL2 guarantees 16 per stage): 0, 1 pass inputs (uTex / uSrc / uPrev, uPrevD / uHdr, uBloom),
//  2 uScene (scene colour + snow alpha; flakes, rain, composite), 3, 4 uSky, uSkyD (shade), 5, 6 free, 7 uNoise (S.F),
//  8-11 uG0..uG3 (the shown G-buffer), 12-15 uN0..uN3 (the one being baked), bound by bindGB(u, 8) in every pass that
//  reads the G-buffer (sky, shade, precipitation, composite).
// =====================================================================================
(function (S) {
  'use strict';
  const { CAM, camR, camU, camF, SUN } = S;   // the camera arrays are mutated in place by S.frameCamera; S.TANH is read per use
  const R = S.R;

  // =====================================================================================
  //                                   frame uniform bundle
  // =====================================================================================
  // S.deriveF fills S.F (the contract is in core.js / ARCHITECTURE.md) once per frame, after the sim step: the static
  // camera / sun / clock / noise fields here, then the three derive modules in a fixed order (surface, precip, atmos).
  // S.uploadF(prog) uploads every S.F entry the program declares, with the setter cached for its getActiveUniform
  // type (gl.js).
  const NOISE = { unit: 7, tex: null };
  S.deriveF = function () {
    const F = S.F;
    F.uCamPos = CAM.pos; F.uCamR = camR; F.uCamU = camU; F.uCamF = camF;
    F.uTanH = S.TANH;
    F.uSunDir = SUN;
    // shading clock (stratus / mist drift): 512000 s is a common period of their noise scrolls (0.01, 0.004, 0.0015 x 256-periodic noise)
    F.uTime = S.anim.time % 512000;
    NOISE.tex = S.noiseTex; F.uNoise = NOISE;
    S.derive.surface.frame(F);
    S.derive.precip.frame(F);
    S.derive.atmos.frame(F);
  };
  S.uploadF = function (prog) {
    const F = S.F, list = prog.list;
    for (let i = 0; i < list.length; i++) { const e = list[i], v = F[e.name]; if (v !== undefined) e.set(e.loc, v); }
  };
  // bind a program and upload the bundle (pass-local uniforms follow explicitly)
  function use(prog) { S.gl.useProgram(prog.p); S.uploadF(prog); return prog.u; }
  function bindTex(unit, t, loc) { const gl = S.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }
  function drawFull() { S.gl.drawArrays(S.gl.TRIANGLES, 0, 3); }

  // =====================================================================================
  //                                   G-buffer binding
  // =====================================================================================
  // G-buffer bake budget: the state machine in FS_GBUF visits each phase at most this often (see its main())
  const GB_MARCH = 900, GB_BISECT = 6, GB_HEIGHT = 1, GB_NORMAL = 8, GB_SHADOW = 110, GB_AO = 5, GB_CANOPY = 1, GB_CURV = 8;
  const GB_ITER = GB_MARCH + GB_BISECT + GB_HEIGHT + GB_NORMAL + GB_SHADOW + GB_AO + GB_CANOPY + GB_CURV;

  // bind the G-buffer(s) for a per-frame pass (see GBUF): uG* = shown buffer at unit0 + i, uN* = the one being baked
  // at unit0 + 4 + i (only the samplers the program uses), uGb = how to mix them
  const NGB = S.GB_LAYOUT.length;
  function bindGB(u, unit0) {
    const cur = R.gbCur || R.gbNext, nxt = R.gbNext || R.gbCur;
    const frac = !R.gbNext ? 0 : R.gbDone < 0 ? R.gbRow / R.gbNext.h : 1 + 0.08 * Math.min(1, (S.anim.wall - R.gbDone) / 0.3);
    for (let i = 0; i < NGB; i++) {
      if (u['uG' + i]) bindTex(unit0 + i, cur.texs[i], u['uG' + i]);
      if (u['uN' + i]) bindTex(unit0 + NGB + i, nxt.texs[i], u['uN' + i]);
    }
    S.gl.uniform3f(u.uGb, R.gbAsp, frac, !R.gbNext ? 0 : R.gbCur ? 1 : 2);
  }
  // what the precipitation pass gets from the renderer (precip.js)
  const ctx = S.passCtx = { use, bindGB, bindTex };

  // =====================================================================================
  //                                   render
  // =====================================================================================
  S.render = function () {
    const gl = S.gl, P = S.P, anim = S.anim, perf = S.perf, FIXED = S.cfg.fixed;
    const W = R.W, H = R.H, Ws = R.Ws, Hs = R.Hs;
    if (!R.gbCur && !R.gbNext) return;
    // ---- 1. progressive G-buffer: one stripe per frame, sized by adaptStripe() so the frame keeps its budget. When the
    // last stripe lands the buffers are kept 0.3 s longer (the reveal edge clears the top), then swapped
    if (R.gbNext) {
      const g = R.gbNext;
      if (R.gbDone < 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
        gl.viewport(0, 0, g.w, g.h);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, R.gbRow, g.w, R.gbRows);
        const u = use(P.gbuf);
        gl.uniform2f(u.uRes, g.w, g.h);
        gl.uniform1f(u.uPixAng, 2 * S.TANH / g.h);
        gl.uniform1i(u.uIter, GB_ITER);
        drawFull();
        gl.disable(gl.SCISSOR_TEST);
        R.gbRow += R.gbRows; R.bakeFrame = true;
        if (R.gbRow >= g.h) R.gbDone = anim.wall;
      } else if (anim.wall - R.gbDone >= 0.3) {
        S.freeRT(R.gbCur); R.gbCur = g; R.gbNext = null; R.gbAsp = 1;
        R.buildMs = performance.now() - R.buildStart;  // wall time from allocate() to the swap: what the viewer waited
        perf.skip = 2;                                  // the next dt still carries the last stripe
        if (R.readyTime < 0) R.readyTime = anim.wall;
      }
    }

    // ---- 2. sky + clouds (half res, temporal accumulation)
    const sp = R.sky[R.skyI], sc = R.sky[1 - R.skyI];
    gl.bindFramebuffer(gl.FRAMEBUFFER, sc.fbo);
    gl.viewport(0, 0, sc.w, sc.h);
    {
      const u = use(P.sky);
      gl.uniform2f(u.uRes, sc.w, sc.h);
      bindTex(0, sp.texs[0], u.uPrev); bindTex(1, sp.texs[1], u.uPrevD);
      bindGB(u, 8);     // G0: the march stops at the terrain
      gl.uniform1f(u.uBlend, R.skyReset ? 1.0 : 0.3);
      gl.uniform1f(u.uFrame, (FIXED ? Math.round(anim.time * 60) : S.frameNo) % 64);
      gl.uniform1f(u.uSteps, perf.skySteps);
      drawFull();
    }
    R.skyReset = false; R.skyI = 1 - R.skyI;

    // ---- 3. scene shading (at the render scale; the G-buffer is sampled by normalised uv). Output alpha: snow fraction
    // x sun visibility (read by the flakes and the composite)
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.scene.fbo);
    gl.viewport(0, 0, Ws, Hs);
    {
      const u = use(P.shade);
      gl.uniform2f(u.uRes, Ws, Hs);
      bindGB(u, 8);
      bindTex(3, sc.texs[0], u.uSky); bindTex(4, sc.texs[1], u.uSkyD);
      const wA = S.wind.s.windA, wl = wA[0] * camR[0] + wA[2] * camR[2];
      gl.uniform3f(u.uSway, wl, anim.swayPh, Hs * 0.5 / S.TANH);
      drawFull();
    }

    // ---- 4. FXAA -> hdr
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.hdr.fbo);
    {
      const u = use(P.fxaa);
      bindTex(0, R.scene.texs[0], u.uTex);
      gl.uniform2f(u.uInv, 1 / Ws, 1 / Hs);
      drawFull();
    }

    // ---- 5. precipitation (precip.js) into hdr, premultiplied; not drawn over a ?view= debug channel
    if (!S.cfg.view) S.drawPrecip(ctx);
    else S.precipCount.snow = S.precipCount.rain = 0;

    // ---- 6. bloom
    {
      const u = use(P.down);
      let src = R.hdr;
      for (let i = 0; i < R.bloom.length; i++) {
        const d = R.bloom[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo); gl.viewport(0, 0, d.w, d.h);
        bindTex(0, src.texs[0], u.uSrc);
        gl.uniform2f(u.uSrcInv, 1 / src.w, 1 / src.h); gl.uniform2f(u.uDstRes, d.w, d.h);
        gl.uniform1f(u.uThresh, i === 0 ? 1.15 : 0.0);
        drawFull(); src = d;
      }
    }
    {
      const u = use(P.up);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = R.bloom.length - 1; i > 0; i--) {
        const s = R.bloom[i], d = R.bloom[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo); gl.viewport(0, 0, d.w, d.h);
        bindTex(0, s.texs[0], u.uSrc);
        gl.uniform2f(u.uSrcInv, 1 / s.w, 1 / s.h); gl.uniform2f(u.uDstRes, d.w, d.h);
        drawFull();
      }
      gl.disable(gl.BLEND);
    }

    // ---- 7. composite (canvas resolution; the hdr / bloom / scene textures are bilinearly upsampled). Exposure, bloom
    // strength, uOvercast and uSunCol come from S.F; the clocks and inputs here are pass-local
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    {
      const u = use(P.comp);
      bindTex(0, R.hdr.texs[0], u.uHdr); bindTex(1, R.bloom[0].texs[0], u.uBloom); bindTex(2, R.scene.texs[0], u.uScene);
      bindGB(u, 8);     // sparkle distance; reveal edge
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uTwinkleT, anim.time % 3600);
      // grain clock: the frame index modulo 1024 (fract(x * 0.618) loses its 1-px randomness once x reaches ~2e6)
      gl.uniform1f(u.uFrame, FIXED ? Math.round(anim.time * 60) % 1024 : S.frameNo % 1024);
      drawFull();
    }
  };
})(window.SNOW);
