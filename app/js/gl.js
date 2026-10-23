// =====================================================================================
//  gl.js — the WebGL2 context, errors, GLSL assembly + compile (errors mapped back to chunk:line), programs with
//  their cached generic-upload tables, textures / render targets, the noise texture, the render-target state R,
//  allocate / resize / DPR watch, context loss and initGL. Registers only; main.js calls S.initContext,
//  S.bindGLEvents and S.initGL at boot.
// =====================================================================================
(function (S) {
  'use strict';

  // ------------------------------------------------------------------ context & errors
  S.initContext = function () {
    S.canvas = document.getElementById('c');
    S.gl = S.canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    S.errEl = document.getElementById('err');
    if (!S.gl) fatal('WebGL2를 지원하지 않는 브라우저입니다.');
  };
  function showErr(msg) { S.errEl.style.display = 'flex'; S.errEl.firstElementChild.textContent = msg; }
  function hideErr() { S.errEl.style.display = 'none'; }
  function fatal(msg) { showErr(msg); throw new Error(msg); }
  S.showErr = showErr; S.hideErr = hideErr; S.fatal = fatal;
  // extension objects die with the context, so they are (re)requested in initGL()
  function getExtensions() {
    const gl = S.gl;
    if (!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) fatal('부동소수점 렌더 타깃(EXT_color_buffer_float)을 지원하지 않습니다.');
    gl.getExtension('OES_texture_float_linear');
  }

  // =====================================================================================
  //                                   GLSL assembly
  // =====================================================================================
  // A program recipe (S.glsl.progs[name] = { vs: [chunk names], fs: [chunk names] }) is concatenated here, lazily,
  // after every script has loaded, so the order of the js/glsl files does not matter. The map records the first
  // assembled line of each chunk, so a compile error can name the chunk and the line inside it.
  function assembleStage(names, prog) {
    let src = '#version 300 es\n', line = 2;
    const map = [];
    for (const n of names) {
      const c = S.glsl.chunks[n];
      if (typeof c !== 'string') throw new Error(`GLSL chunk '${n}' (program ${prog}) is not registered`);
      map.push({ name: n, line });
      src += c + '\n';
      line += c.split('\n').length;
    }
    return { src, map };
  }
  S.glsl.assemble = function (name) {
    const r = S.glsl.progs[name];
    if (!r) throw new Error(`GLSL program '${name}' is not registered`);
    return { vs: assembleStage(r.vs, name), fs: assembleStage(r.fs, name) };
  };
  // assembled line -> 'CHUNK:line' (line 1 is '#version 300 es')
  function chunkLine(map, ln) {
    if (ln < 2 || !map.length) return '#version:' + ln;
    let k = 0;
    while (k + 1 < map.length && map[k + 1].line <= ln) k++;
    return map[k].name + ':' + (ln - map[k].line + 1);
  }
  S.glsl.chunkLine = chunkLine;

  // =====================================================================================
  //                                   GL helpers
  // =====================================================================================
  function compile(type, part, name) {
    const gl = S.gl, src = part.src;
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n');
      const m = /ERROR: \d+:(\d+)/.exec(log);
      const ln = m ? +m[1] : 0;
      const where = m ? chunkLine(part.map, ln) : '?';
      const mapped = log.replace(/ERROR: (\d+):(\d+):/g, (all, f, l) => `ERROR: ${f}:${l} [${chunkLine(part.map, +l)}]:`);
      console.error(`[${name}] shader compile error at ${where}:\n${mapped}\n` + lines.slice(Math.max(0, ln - 4), ln + 3).map((l, i) => {
        const n = Math.max(0, ln - 4) + i + 1;
        return `${n} (${chunkLine(part.map, n)}): ${l}`;
      }).join('\n'));
      throw new Error('shader compile failed: ' + name + ' at ' + where);
    }
    return s;
  }
  // generic-upload setter for an active uniform, chosen once from its getActiveUniform type (see S.uploadF)
  function setterFor(gl, type) {
    switch (type) {
      case gl.FLOAT: return (l, v) => { if (typeof v === 'number') gl.uniform1f(l, v); else gl.uniform1fv(l, v); };
      case gl.FLOAT_VEC2: return (l, v) => gl.uniform2fv(l, v);
      case gl.FLOAT_VEC3: return (l, v) => gl.uniform3fv(l, v);
      case gl.FLOAT_VEC4: return (l, v) => gl.uniform4fv(l, v);
      case gl.INT: case gl.BOOL: return (l, v) => { if (typeof v === 'number') gl.uniform1i(l, v); else gl.uniform1iv(l, v); };
      case gl.UNSIGNED_INT: return (l, v) => { if (typeof v === 'number') gl.uniform1ui(l, v); else gl.uniform1uiv(l, v); };
      case gl.SAMPLER_2D: return (l, v) => { gl.activeTexture(gl.TEXTURE0 + v.unit); gl.bindTexture(gl.TEXTURE_2D, v.tex); gl.uniform1i(l, v.unit); };
      default: return null;
    }
  }
  // program from its recipe: { p, u: name -> location ([0] stripped), list: the active uniforms with their setters }
  function program(name) {
    const gl = S.gl, src = S.glsl.assemble(name);
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, src.vs, name + '.vs'));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, src.fs, name + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(`[${name}] link error: ` + gl.getProgramInfoLog(p)); throw new Error('link failed: ' + name); }
    const u = {}, list = [];
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i); const nm = info.name.replace(/\[0\]$/, ''); const loc = gl.getUniformLocation(p, info.name);
      u[nm] = loc;
      const set = setterFor(gl, info.type);
      if (set) list.push({ name: nm, loc, set });
    }
    return { p, u, list, name };
  }
  function tex(w, h, ifmt, fmt, type, filter, wrap) {
    const gl = S.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE);
    return t;
  }
  function rt(w, h, n, filter) {
    const gl = S.gl;
    const texs = [];
    for (let i = 0; i < n; i++) texs.push(tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, filter));
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.error('framebuffer incomplete', st);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, texs, w, h };
  }
  function freeRT(r) { if (!r) return; const gl = S.gl; r.texs.forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(r.fbo); }
  S.tex = tex; S.rt = rt; S.freeRT = freeRT;

  // G-buffer layout (frozen contract, ARCHITECTURE.md): four NEAREST attachments, written by the bake (o0..o3) and
  // read through the GBUF chunk's G0..G3(uv). G3 is RGBA8 when the driver accepts the mixed-format MRT
  // (checkFramebufferStatus), otherwise every attachment is RGBA16F (R.g3Fmt says which; ?gb16=1 forces the fallback).
  S.GB_LAYOUT = [
    { name: 'G0', fmt: 'RGBA16F', ch: ['t', 'mat+frac', 'sunShadow', 'ao'] },
    { name: 'G1', fmt: 'RGBA16F', ch: ['albedoR', 'albedoG', 'albedoB', 'snowT'] },
    { name: 'G2', fmt: 'RGBA16F', ch: ['octDetailNormal.x', 'octDetailNormal.y', 'octSmoothNormal.x', 'octSmoothNormal.y'] },
    { name: 'G3', fmt: 'RGBA8', ch: ['rock', 'soil', 'larch', 'moist'] },
  ];
  function gbRT(w, h) {
    const gl = S.gl;
    const build = all16 => {
      const texs = S.GB_LAYOUT.map(L => L.fmt === 'RGBA8' && !all16 ? tex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST)
                                                                     : tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST));
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
      gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { r: { fbo, texs, w, h }, ok };
    };
    if (R.g3Fmt !== 'RGBA16F' && !S.cfg.gb16) {
      const b = build(false);
      if (b.ok) { R.g3Fmt = 'RGBA8'; return b.r; }
      freeRT(b.r);
    }
    const b = build(true);
    if (!b.ok) console.error('G-buffer framebuffer incomplete');
    R.g3Fmt = 'RGBA16F';
    return b.r;
  }

  // every registered program recipe, built after all scripts have loaded (S.P = { gbuf, sky, shade, fxaa, flake, down, up, comp, ... })
  S.P = null; S.noiseTex = null; S.compileMs = 0;
  S.buildPrograms = function () {
    const gl = S.gl, t0 = performance.now(), P = {};
    for (const name of Object.keys(S.glsl.progs)) P[name] = program(name);
    S.P = P;
    S.compileMs = performance.now() - t0;
    gl.bindVertexArray(gl.createVertexArray());
  };

  // noise texture (RGBA8 256^2): G = A(x,y), R = A(x+37, y+17)  (3D-noise trick)
  function makeNoiseTex() {
    const gl = S.gl;
    const N = 256, A = new Uint8Array(N * N), rnd = S.mulberry32(0xC0FFEE);
    for (let i = 0; i < N * N; i++) A[i] = Math.floor(rnd() * 256);
    const D = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      D[i] = A[((y + 17) & 255) * N + ((x + 37) & 255)]; D[i + 1] = A[y * N + x]; D[i + 2] = A[((y * 7 + 3) & 255) * N + ((x * 3 + 11) & 255)]; D[i + 3] = 255;
    }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }

  // =====================================================================================
  //                                   render targets
  // =====================================================================================
  // W,H: canvas (= G-buffer) size. Ws,Hs: the per-frame render size (shade / FXAA / flakes / bloom), W*perf.rs;
  // the composite upsamples it to the canvas. The G-buffer bake never depends on the render scale.
  // gbCur: the G-buffer being shown; gbNext: the one being baked (gbRow rows done, gbRows rows per frame, adapted to the
  // frame budget, see adaptStripe; gbMiss: a stripe frame has overrun once; bakeFrame: this frame drew a stripe);
  // gbDone: time the last stripe landed (the swap follows 0.3 s later, once the reveal edge has left the top);
  // gbAsp: new/old aspect for sampling gbCur meanwhile.
  // readyTime: anim.wall when the first bake was swapped in (-1 before); buildStart / buildMs: wall time of a bake.
  // g3Fmt: 'RGBA8' (mixed-format MRT) or 'RGBA16F' (the fallback), set by the first G-buffer allocation.
  const R = S.R = { W: 0, H: 0, Ws: 0, Hs: 0, gbCur: null, gbNext: null, gbRow: 0, gbRows: 1, gbMiss: false, bakeFrame: false, gbDone: -1, gbAsp: 1,
                    scene: null, hdr: null, sky: [null, null], skyI: 0, skyReset: true, bloom: [],
                    readyTime: -1, buildStart: 0, buildMs: 0, g3Fmt: null };
  const GB_MAX_PX = 8.4e6;      // ~4K: the G-buffer is 28 B/px (32 with the RGBA16F fallback), and two exist during a rebake
  const GB_SINGLE_PX = 6e6;     // above this a rebake drops the old buffer first instead of holding both (~170 MB each)
  // CSS size of the canvas box: what is actually on screen. The canvas is 100% of its fixed box (css/ui.css), not
  // 100vw x 100vh: on phones innerWidth / innerHeight and vh can lag or disagree with the visible area while the
  // keyboard or the browser toolbars come and go. The pointer maps through the same box (input.js).
  S.cssSize = function () {
    const c = S.canvas, w = (c && c.clientWidth) || (typeof innerWidth === 'number' ? innerWidth : 1), h = (c && c.clientHeight) || (typeof innerHeight === 'number' ? innerHeight : 1);
    return [Math.max(1, w), Math.max(1, h)];
  };
  // canvas (= G-buffer) pixel size for the current box: DPR capped at 1.25, and the whole buffer at GB_MAX_PX
  function targetSize() {
    const [cw, ch] = S.cssSize();
    let dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const px = cw * ch * dpr * dpr;
    if (px > GB_MAX_PX) dpr *= Math.sqrt(GB_MAX_PX / px);
    return [Math.max(64, Math.round(cw * dpr)), Math.max(64, Math.round(ch * dpr))];
  }
  S.targetSize = targetSize;
  function allocate() {
    const canvas = S.canvas;
    const [W, H] = targetSize();
    if (W === R.W && H === R.H) return;
    R.W = W; R.H = H; canvas.width = W; canvas.height = H;
    freeRT(R.gbNext);
    // a new aspect may re-frame the camera (portrait vs landscape, core.js): the old buffer then holds other rays, so
    // the new one is revealed like a first load instead of being blended with it
    const moved = S.frameCamera(W / H);
    if (R.gbCur && (moved || W * H > GB_SINGLE_PX)) { freeRT(R.gbCur); R.gbCur = null; }
    R.gbAsp = R.gbCur ? (W / H) / (R.gbCur.w / R.gbCur.h) : 1;
    R.gbNext = gbRT(W, H); R.gbRow = 0; R.gbRows = Math.max(1, Math.round(H / 120)); R.gbMiss = false; R.gbDone = -1;
    R.buildStart = performance.now();
    S.layoutLayers();
    S.resetPerf();
    allocScaled();
    armDprWatch();
  }
  function allocScaled() {
    const gl = S.gl;
    const W = Math.max(64, Math.round(R.W * S.perf.rs)), H = Math.max(64, Math.round(R.H * S.perf.rs));
    R.Ws = W; R.Hs = H;
    freeRT(R.scene); freeRT(R.hdr);
    R.scene = rt(W, H, 1, gl.LINEAR); R.hdr = rt(W, H, 1, gl.LINEAR);
    freeRT(R.sky[0]); freeRT(R.sky[1]);
    const sw = Math.ceil(W / 2), sh = Math.ceil(H / 2);
    R.sky = [rt(sw, sh, 2, gl.LINEAR), rt(sw, sh, 2, gl.LINEAR)]; R.skyReset = true;
    R.bloom.forEach(freeRT); R.bloom = [];
    let bw = Math.ceil(W / 2), bh = Math.ceil(H / 2);
    for (let i = 0; i < 6 && bw >= 8 && bh >= 8; i++) { R.bloom.push(rt(bw, bh, 1, gl.LINEAR)); bw = Math.ceil(bw / 2); bh = Math.ceil(bh / 2); }
  }
  S.allocate = allocate; S.allocScaled = allocScaled;
  // every size source (window resize, the canvas box, the visual viewport, rotation, a DPR change) debounces into one
  // allocate 150 ms after the last event; resizeTimer is 0 while none is pending
  let resizeTimer = 0;
  function scheduleAllocate() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { resizeTimer = 0; if (!S.ctxLost && S.P) allocate(); }, 150); }
  // Twice a second (main.js calls it every frame): a missed or swallowed resize event (phones) cannot leave the canvas
  // at a stale size. It only schedules when no allocate is pending, so it can never keep pushing a pending one back.
  let lastCheck = 0;
  S.checkSize = function () {
    const now = performance.now();
    if (resizeTimer || S.ctxLost || now - lastCheck < 500) return;
    lastCheck = now;
    const [W, H] = targetSize();
    if (W !== R.W || H !== R.H) scheduleAllocate();
  };
  // a window dragged to a display with another pixel density fires no resize: watch the dppx media query instead
  let dprMQ = null;
  function armDprWatch() {
    if (dprMQ) dprMQ.removeEventListener('change', scheduleAllocate);
    dprMQ = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprMQ.addEventListener('change', scheduleAllocate);
  }

  // ------------------------------------------------------------------ context loss / restore
  S.ctxLost = false;
  S.initGL = function () {
    getExtensions();
    S.buildPrograms();
    S.noiseTex = makeNoiseTex();
    // every GL handle died with the old context: forget them (deleting would be a no-op) and rebuild, restarting the
    // striped bake; readyTime is cleared so the scene reveals itself again instead of hard-cutting in
    R.W = R.H = 0; R.gbCur = R.gbNext = R.scene = R.hdr = null; R.sky = [null, null]; R.bloom = []; R.skyI = 0;
    R.readyTime = -1;
    allocate();
  };
  // boot: every resize source, and the context loss / restore pair on the canvas
  S.bindGLEvents = function () {
    addEventListener('resize', scheduleAllocate);
    addEventListener('orientationchange', scheduleAllocate);
    if (window.visualViewport) visualViewport.addEventListener('resize', scheduleAllocate);
    if (window.ResizeObserver) new ResizeObserver(scheduleAllocate).observe(S.canvas);
    S.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); S.ctxLost = true; showErr('그래픽 장치 연결이 끊어졌습니다. 복구를 기다리는 중…'); });
    S.canvas.addEventListener('webglcontextrestored', () => {
      try { S.initGL(); } catch (e) { fatal('그래픽 장치 복구 실패: ' + e.message); }
      S.ctxLost = false; hideErr();
    });
  };
})(window.SNOW);
