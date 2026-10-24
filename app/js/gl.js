// =====================================================================================
//  gl.js — the WebGL2 context, errors, GLSL assembly + compile (errors mapped back to chunk:line), programs with
//  their cached generic-upload tables (per scene, cached per context: S.programsFor), textures / render targets, the
//  noise texture, the render-target state R, allocate / resize / DPR watch, the scene-switch rebake (S.switchSceneGL),
//  context loss and initGL. Registers only; main.js calls S.initContext, S.bindGLEvents and S.initGL at boot.
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
  // a recipe by name: a registered one, or (polish) the hook-free twin '<recipe>~idle' of one that includes HAZARD: the
  // same chunks with HAZARD replaced by HAZARD_IDLE (the hooks as the identities they are while no hazard is on,
  // glsl/shade.js), drawn while no hazard is on (render.js)
  const IDLE = '~idle';
  function recipe(name) {
    if (!name.endsWith(IDLE)) return S.glsl.progs[name];
    const r = S.glsl.progs[name.slice(0, -IDLE.length)], sw = c => (c === 'HAZARD' ? 'HAZARD_IDLE' : c);
    return r && r.fs.includes('HAZARD') ? { vs: r.vs.map(sw), fs: r.fs.map(sw) } : undefined;
  }
  S.glsl.recipe = recipe;
  S.glsl.assemble = function (name) {
    const r = recipe(name);
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
  // a shader is compiled in two halves: started (no status query, so with KHR_parallel_shader_compile the driver works
  // on it off the main thread) and checked (blocks until the driver is done; a failure names the chunk and line)
  function startShader(type, src) {
    const gl = S.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    return s;
  }
  function checkShader(s, part, name) {
    const gl = S.gl, src = part.src;
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
  // program from its recipe: { p, u: name -> location ([0] stripped), list: the active uniforms with their setters }.
  // startProgram issues the compile and link without waiting; finishProgram checks them (blocking until the driver is
  // done) and reads the uniform table. program() = both at once
  function startProgram(name) {
    const gl = S.gl, src = S.glsl.assemble(name);
    const p = gl.createProgram();
    const vs = startShader(gl.VERTEX_SHADER, src.vs.src), fs = startShader(gl.FRAGMENT_SHADER, src.fs.src);
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    return { name, src, p, vs, fs };
  }
  function program(name) { return finishProgram(startProgram(name)); }
  function finishProgram(job) {
    const gl = S.gl, { name, src, p } = job;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      checkShader(job.vs, src.vs, name + '.vs'); checkShader(job.fs, src.fs, name + '.fs');
      console.error(`[${name}] link error: ` + gl.getProgramInfoLog(p)); throw new Error('link failed: ' + name);
    }
    // linked: the shader objects (and the driver's copies of their large sources) are no longer needed
    gl.detachShader(p, job.vs); gl.detachShader(p, job.fs); gl.deleteShader(job.vs); gl.deleteShader(job.fs);
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

  // Programs, built after all scripts have loaded. S.P = the active scene's set { gbuf, sky, shade, fxaa, flake, down,
  // up, comp, ... }: every registered recipe that no scene claims (shared by all scenes, built once) plus the scene's
  // own (scene.progs: program name -> recipe name, e.g. house: gbuf -> 'gbuf@house'). Every program is built once per
  // context and cached by recipe name, so switching back to a scene is instant (no recompile, no new GL objects).
  // Recipes named 'name@scene' are scene variants and never shared.
  S.P = null; S.noiseTex = null; S.compileMs = 0; S.sceneCompileMs = 0;
  const built = {};
  function sharedNames() {
    const claimed = new Set();
    for (const id of Object.keys(S.scenes)) for (const [k, r] of Object.entries(S.scenes[id].progs)) { claimed.add(k); claimed.add(r); }
    return Object.keys(S.glsl.progs).filter(n => !claimed.has(n) && !n.includes('@'));
  }
  // the recipes of scene id's set: program name -> recipe name
  function recipesFor(id) {
    const M = {};
    for (const n of sharedNames()) M[n] = n;
    for (const [k, r] of Object.entries(S.scenes[id].progs)) M[k] = r;
    // (Phase 3, lane H) a program another scene replaces and this one does not (e.g. the house's comp -> 'comp@house'):
    // this scene keeps the shared recipe of that name (the valley's comp)
    for (const sc of Object.values(S.scenes)) for (const k of Object.keys(sc.progs)) if (!M[k] && S.glsl.progs[k]) M[k] = k;
    // (polish) the hook-free twins: program k + 'Idle' -> recipe M[k] + '~idle' for every program whose recipe includes
    // HAZARD (sky, shade, comp in both scenes); render.js draws them while no hazard is on. Only with
    // KHR_parallel_shader_compile, which lets the full programs wait (lazy, prewarmed) for the first hazard
    if (twinsOn()) for (const k of Object.keys(M)) if (S.glsl.progs[M[k]].fs.includes('HAZARD')) M[k + 'Idle'] = M[k] + IDLE;
    return M;
  }
  const twinsOn = () => !!(S.gl && S.gl.getExtension('KHR_parallel_shader_compile'));
  // every recipe some scene's set uses in this context (the registered ones the scenes use, and the twins)
  S.programRecipes = () => [...new Set(Object.keys(S.scenes).flatMap(id => Object.values(recipesFor(id))))];
  // a built program by recipe: cached, or a prewarm compile still in flight finished now (blocking), or built now
  const pending = {};
  function get(r) {
    if (built[r]) return built[r];
    const job = pending[r];
    delete pending[r];
    return (built[r] = job ? finishProgram(job) : program(r));
  }
  // the program set of scene id (building what this context has not built yet). Every missing program of the set is
  // started first and only then finished, so the driver can compile them side by side. A lazy program (a recipe
  // flagged lazy: the hazards' draws bolt, ash, ember, dust; or a program with a hook-free twin: the full sky, shade,
  // comp, drawn only while a hazard is on) is not built with the set: its entry is a getter that builds it on first use
  // and then stays a plain value, so a boot or a switch compiles only what the idle frame draws; the prewarm starts the
  // lazy ones in the background once the scene is shown. Only with KHR_parallel_shader_compile: without it a started
  // program can stay uncompiled until its first status query (Chrome without the extension: the first strike then froze
  // ~0.5 s finishing it behind every program the prewarm had queued), so there are no twins and every recipe is built
  // with the set, as before.
  S.programsFor = function (id) {
    const lazyOK = twinsOn();
    const P = {}, M = recipesFor(id), keys = Object.keys(M);
    const eager = keys.filter(k => !(lazyOK && !M[k].endsWith(IDLE) && (S.glsl.progs[M[k]].lazy || (k + 'Idle') in M)));
    for (const k of eager) if (!built[M[k]] && !pending[M[k]]) pending[M[k]] = startProgram(M[k]);
    for (const k of eager) P[k] = get(M[k]);
    for (const k of keys) if (!(k in P)) {
      Object.defineProperty(P, k, { configurable: true, enumerable: true,
        get() { const v = get(M[k]); Object.defineProperty(P, k, { value: v, enumerable: true }); return v; } });
    }
    return P;
  };
  // Prewarm (stage 2a): once the active scene is shown (ready, no bake running) for PREWARM_DELAY s, every other
  // scene's programs are compiled and linked in the background, so the first switch compiles nothing (a 40-60 ms stall
  // on an M4, several times that on a phone). Only the non-blocking half runs here (startProgram: no status query, no
  // round trip to the GPU process): with KHR_parallel_shader_compile all of them are started at once and the driver
  // compiles them off the main thread, polled every frame with COMPLETION_STATUS_KHR (non-blocking) to know when they
  // are done; without it, one per idle callback (requestIdleCallback, else a timeout), after the frame. The blocking
  // half (finishProgram: the link status and the uniform table, a sync round trip) waits for the switch that needs
  // the program (get above), when the scene change syncs with the GPU anyway; by then the compile is done. A context
  // restore starts over. S.prewarm: state 'idle' | 'running' | 'done' (every program started; with the extension, also
  // compiled), n programs started, ms (wall time to 'done'), ext (KHR_parallel_shader_compile used).
  const PREWARM_DELAY = 1.0;
  const COMPLETION_STATUS_KHR = 0x91B1;
  const PW = S.prewarm = { state: 'idle', n: 0, ms: 0, ext: false, t0: 0, gen: 0 };
  const missing = () => { const need = new Set(); for (const id of Object.keys(S.scenes)) for (const r of Object.values(recipesFor(id))) if (!built[r] && !pending[r]) need.add(r); return [...need]; };
  function prewarmDone() { PW.state = 'done'; PW.ms = performance.now() - PW.t0; }
  function prewarmIdle(gen) {
    const go = () => {
      if (gen !== PW.gen || PW.state !== 'running' || S.ctxLost) return;
      const r = missing()[0];
      if (!r) return prewarmDone();
      try { pending[r] = startProgram(r); PW.n++; } catch (e) { console.error('prewarm: ' + e.message); return prewarmDone(); }
      prewarmIdle(gen);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 100);
  }
  // main.js, every frame after render()
  S.prewarmTick = function () {
    if (PW.state === 'done' || !S.P || S.ctxLost) return;
    const gl = S.gl;
    if (PW.state === 'idle') {
      if (R.readyTime < 0 || R.gbNext || S.anim.wall - R.readyTime < PREWARM_DELAY) return;
      PW.state = 'running'; PW.t0 = performance.now(); PW.n = 0;
      const ext = gl.getExtension('KHR_parallel_shader_compile');
      PW.ext = !!ext;
      try { if (ext) for (const r of missing()) { pending[r] = startProgram(r); PW.n++; } else prewarmIdle(PW.gen); }
      catch (e) { console.error('prewarm: ' + e.message); prewarmDone(); }   // (an unassemblable recipe: its switch reports it)
      return;
    }
    if (PW.ext && Object.values(pending).every(j => j.done || (j.done = gl.getProgramParameter(j.p, COMPLETION_STATUS_KHR)))) prewarmDone();
  };
  // a new context (or a forced rebuild): forget every cached program (and the prewarm's), build the active scene's set
  S.buildPrograms = function () {
    const gl = S.gl, t0 = performance.now();
    for (const k of Object.keys(built)) delete built[k];
    for (const k of Object.keys(pending)) delete pending[k];
    PW.state = 'idle'; PW.gen++;
    S.P = S.programsFor(S.sceneId);
    S.compileMs = performance.now() - t0;
    gl.bindVertexArray(gl.createVertexArray());
  };
  S.builtPrograms = () => Object.keys(built);           // finished (in use or ready to use)
  S.prewarmedPrograms = () => Object.keys(pending);     // started by the prewarm, finished by the switch that needs them

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
  // Bake variants (Phase 3, lane H: a scene with variants, the house's leafy / bare winter crowns): gbVar / gbNextVar
  // the variant of gbCur / gbNext (the bake's uVariant), varWant the one the scene wants (S.setBakeVariant, from its
  // derive); varBake: gbNext is a variant rebake behind the live scene, dissolved into gbCur when done (render.js,
  // disP the noise band copied so far) instead of the reveal wipe; varMs: wall time of the last variant rebake.
  const R = S.R = { W: 0, H: 0, Ws: 0, Hs: 0, gbCur: null, gbNext: null, gbRow: 0, gbRows: 1, gbMiss: false, bakeFrame: false, gbDone: -1, gbAsp: 1,
                    scene: null, hdr: null, sky: [null, null], skyI: 0, skyReset: true, bloom: [],
                    readyTime: -1, buildStart: 0, buildMs: 0, g3Fmt: null,
                    gbVar: 0, gbNextVar: 0, varWant: 0, varBake: false, disP: 0, varMs: 0 };
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
  // start a striped bake of the next G-buffer (render.js draws its stripes, then swaps it in), in the variant the
  // scene wants (always 0 for a scene without variants)
  function startBake() {
    R.gbNext = gbRT(R.W, R.H); R.gbRow = 0; R.gbRows = Math.max(1, Math.round(R.H / 120)); R.gbMiss = false; R.gbDone = -1;
    R.buildStart = performance.now();
    R.varBake = false; R.gbNextVar = S.scene && S.scene.variants ? R.varWant : 0;
  }
  // Bake variants (Phase 3, lane H). S.setBakeVariant(v): the variant the active scene should show (the house's derive
  // calls it by the season, for every scene; only a scene with 'variants' acts on it). S.variantTick() (render.js, every
  // frame): when the shown buffer is complete and of another variant, bake the wanted one behind the live scene (the
  // frame keeps showing gbCur, ready stays true); render.js then dissolves it in over S.VARIANT_DISSOLVE s. Memory: both
  // buffers exist for the ~1-2 s of the rebake and the dissolve, as during a resize rebake
  S.VARIANT_DISSOLVE = 2.0;
  S.setBakeVariant = function (v) { R.varWant = v ? 1 : 0; };
  S.variantTick = function () {
    if (!S.scene || !S.scene.variants || !R.gbCur || R.gbNext || R.gbVar === R.varWant || !R.W) return;
    startBake();
    R.varBake = true; R.disP = 0;
  };
  function allocate() {
    const canvas = S.canvas;
    const [W, H] = targetSize();
    if (W === R.W && H === R.H) return;
    R.W = W; R.H = H; canvas.width = W; canvas.height = H;
    freeRT(R.gbNext);
    // a new aspect may re-frame the camera (portrait vs landscape, the scene's frameCamera): the old buffer then holds
    // other rays, so the new one is revealed like a first load instead of being blended with it
    const moved = S.frameCamera(W / H);
    if (R.gbCur && (moved || W * H > GB_SINGLE_PX)) { freeRT(R.gbCur); R.gbCur = null; }
    R.gbAsp = R.gbCur ? (W / H) / (R.gbCur.w / R.gbCur.h) : 1;
    startBake();
    S.layoutLayers();
    S.resetPerf();
    allocScaled();
    armDprWatch();
  }
  // Scene switch (S.setScene in main.js, after S.useScene): the scene's programs (built once per context, cached), its
  // camera for this canvas, the old G-buffer dropped (it holds another scene) and a fresh bake revealed like a first
  // load, the sky history restarted, the precipitation boxes re-laid for the new framing and the quality ladder
  // restarted (another scene, another GPU budget). Before initGL (boot) or during a context loss it only re-frames:
  // initGL / the restore builds everything for the active scene.
  S.switchSceneGL = function () {
    if (!S.gl || S.ctxLost || !S.P || !R.W) { const [w, h] = S.canvas ? targetSize() : [16, 9]; S.frameCamera(w / h); return; }
    const t0 = performance.now();
    S.P = S.programsFor(S.sceneId);
    S.sceneCompileMs = performance.now() - t0;
    S.frameCamera(R.W / R.H);
    freeRT(R.gbNext); R.gbNext = null;
    freeRT(R.gbCur); R.gbCur = null;
    R.gbAsp = 1;
    startBake();
    S.layoutLayers();
    S.resetPerf();
    allocScaled();             // also restarts the sky's temporal history (R.skyReset)
  };
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
  // S.ctxLost: true from the moment the context is lost until the restore has rebuilt everything. It also reads
  // gl.isContextLost(), which is true before the webglcontextlost event is dispatched: a scene switch, a resize or a
  // frame in that gap would otherwise run against the dead context (framebuffer-incomplete errors) instead of waiting
  // for the restore (which builds the active scene's set). The restore handler clears the flag.
  let lostFlag = false;
  Object.defineProperty(S, 'ctxLost', { configurable: true, enumerable: true,
    get() { return lostFlag || !!(S.gl && S.gl.isContextLost()); }, set(v) { lostFlag = !!v; } });
  S.initGL = function () {
    getExtensions();
    S.buildPrograms();
    S.noiseTex = makeNoiseTex();
    // every GL handle died with the old context: forget them (deleting would be a no-op) and rebuild, restarting the
    // striped bake; readyTime is cleared so the scene reveals itself again instead of hard-cutting in
    R.W = R.H = 0; R.gbCur = R.gbNext = R.scene = R.hdr = null; R.sky = [null, null]; R.bloom = []; R.skyI = 0;
    R.readyTime = -1; R.varBake = false; R.gbVar = 0;
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
      try { S.initGL(); } catch (e) { fatal('그래픽 장치 복구 실패: ' + e.message); }   // (fatal throws: the flag stays set)
      S.ctxLost = false; hideErr();
    });
  };
})(window.SNOW);
