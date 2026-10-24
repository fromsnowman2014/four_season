// =====================================================================================
//  Snow over an alpine meadow — raw WebGL2, split into classic scripts under one namespace (see ARCHITECTURE.md).
//  Pipeline (static camera):
//   1. G-buffer: a one-time, progressive (striped) iq-style raymarch of the heightfield
//      terrain + SDF conifers + chalets. Stores distance, material, sun shadow, AO,
//      albedo, snow-threshold, two normals and season-neutral material parameters (G3). Because the camera never
//      moves this is the ultimate temporal reuse: geometry is marched once, shading runs every frame.
//   2. Cloud pass (half res, temporally accumulated volumetric cumulus slab). Stores premultiplied
//      cloud light + transmittance and an opacity-weighted cloud distance; the analytic sky is
//      evaluated in the shading pass so clouds can be composited over the sky or the far peaks.
//   3. Scene shading: snow coverage, storm lighting, cloud shadows, fog, veil.
//   4. FXAA on the scene, 5. instanced stateless snowflakes (4 depth layers, soft
//      occlusion against the G-buffer distance), 6. bloom, 7. ACES composite + grade.
//   Steps 2-6 run at an adaptive render scale (frame-time controller, down to 0.6 and back up); the G-buffer
//   stays at canvas size (DPR capped at 1.25, ~8.4 Mpx) and the composite upsamples.
//   A resize bakes a second G-buffer in time-budgeted stripes while the old one is still shown (aspect-corrected),
//   and the new rows wipe in from the bottom; the first load uses the same wipe as its progress reveal.
//
//  core.js loads first and creates window.SNOW (the only global). It holds S.cfg (every URL hook, parsed once),
//  the math helpers, the camera / sun state and the scene registry (the scenes themselves: js/scenes/*.js), the GLSL
//  registry and the frame uniform bundle S.F with its neutral defaults.
//  No load-time side effects beyond creating the namespace (it also loads in Node: pass { window: {}, URLSearchParams }).
//
//  S.F — the frame uniform bundle (frozen contract; full table with units in ARCHITECTURE.md). Keyed by exact GLSL
//  uniform name; numbers for float / int / uint, arrays or Float32Arrays for vectors, { unit, tex } for a sampler.
//  Uploaded generically by S.uploadF(prog) to every program that declares the name (the setter comes from the
//  getActiveUniform type, cached per program in gl.js). Filled once per frame by S.deriveF() (render.js): the static
//  camera / sun / clock / noise fields there, then js/derive/surface.js, precip.js and atmos.js in that order, then the
//  active scene's derive (if any) and events.js (a later one may read what an earlier one set). Pass-local uniforms
//  stay explicit in render.js / precip.js and are NOT here.
//    render.js:   uCamPos, uCamR, uCamU, uCamF (vec3), uTanH, uSunDir (fixed: baked into the G-buffer), uTime, uNoise
//    surface.js:  uCover, uSeasonW, uTemp, uSnowline, uWet, uGrassDisp, uYearPhase, uMelt
//    precip.js:   uSnowCurtain, uPrecipSnow, uPrecipRain, uSnowFrac, uGale, uHeavy, uWetSnow, the snow veil (uVeilDir,
//                 uVeilAmt, uVeilT), the rain veil / curtains (uRainDir, uRainVeil, uRainT, uRainShaft), the flake and rain
//                 clocks / shutters (uFallV, uExpo, uTumT, uRainV, uExpoRain, uRainGust, uWindA, uWindB, uFlakeT)
//    atmos.js:    uSunCol, uSkyAmb, uSkyZen, uSkyHor, uFogCol, uFogP, uCloudOff, uCloudCov, uOvercast, uCumulus,
//                 uFogDay, uMistP, uCirrus, uShadowAmp, uExposure, uBloomStr, uHorBand, uCloudP, uCloudQ, uMistQ,
//                 uSkyResp, uGrade, uGradeP
//    the scene's derive (Phase 3, only while that scene is active; house.js: uCozy + its look over the atmosphere), then
//    events.js:   uFlash, uFlashPos, uQuake, uSmoke, uCrack, and the hazard particle rates uAshRate, uEmberRate, uDustRate
//  The initial object below holds the neutral defaults of the Phase-2 environment uniforms (the ENV chunk): with
//  these values every shader reproduces the Phase-1 look. uView is the ?view= debug channel.
// =====================================================================================
(function (S) {
  'use strict';
  const Q = new URLSearchParams((window.location && window.location.search) || '');
  const qNum = (k, d) => { const v = Q.get(k); if (v === null || v === '') return d; const n = parseFloat(v); return isFinite(n) ? n : d; };
  // 'a:1,b:.5' -> { a: 1, b: 0.5 } (entries without a finite number are ignored); null when the hook is absent
  const qKV = k => {
    const v = Q.get(k);
    if (!v) return null;
    const o = {};
    for (const p of v.split(',')) { const i = p.indexOf(':'), n = parseFloat(p.slice(i + 1)); if (i > 0 && isFinite(n)) o[p.slice(0, i).trim()] = n; }
    return o;
  };
  // ?view= debug channels, in uView order (1..8): baked albedo, snow threshold, the four G3 channels, effective cover, wetness
  const VIEWS = S.VIEWS = ['alb', 'snowT', 'g3r', 'g3g', 'g3b', 'g3a', 'cEff', 'wet'];
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  S.clamp = clamp; S.lerp = lerp; S.smooth = smooth; S.mulberry32 = mulberry32;
  // counter-based randomness for the sim (no consumed stream, so UI actions never perturb a seeded sequence):
  // hash32 is the GLSL hu(); rand(seed, i, k) is uniform in [0,1); vn1(seed, x) is smooth 1D value noise in [-1,1]
  function hash32(x) { x |= 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; }
  const rand = (seed, i, k) => hash32(hash32(hash32(seed) ^ (i | 0)) + Math.imul(k | 0, 0x9e3779b9)) / 4294967296;
  function vn1(seed, x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = rand(seed, i, 0); return 2 * (a + (rand(seed, i + 1, 0) - a) * u) - 1; }
  // debug-hook helper (?wx ?ground): copy the entries of kv onto the numeric keys obj already has (others are ignored)
  const override = (obj, kv) => { if (kv) for (const k of Object.keys(kv)) if (typeof obj[k] === 'number') obj[k] = kv[k]; return obj; };
  S.hash32 = hash32; S.rand = rand; S.vn1 = vn1; S.override = override;

  // ---- URL hooks, parsed once: ?seed ?t ?cover ?storm ?wind ?ui ?fixed (Phase 1), ?season ?weather ?speed (Phase 2),
  // the debug hooks ?yp ?wx ?ground ?view, and the test-only ?frames ?gb16
  S.cfg = {
    seed: Math.floor(qNum('seed', 1)) >>> 0,
    t0: Math.max(0, qNum('t', 0)),
    cover: Q.has('cover') ? clamp(qNum('cover', 0), 0, 1) : null,
    storm: Q.get('storm'),                                   // raw: '1' forced blizzard, '0' auto blizzards off
    wind: (Q.get('wind') || '').split(',').map(Number),      // ?wind=X,Z base wind (m/s)
    ui: Q.get('ui') !== '0',
    // ?fixed=1: a fixed 1/60 s simulation step (and a grain clock derived from it) instead of the wall clock, so
    // ?t&seed captures are reproducible frame for frame; the quality controller is off in this mode
    fixed: Q.get('fixed') === '1',
    // test-only (parity capture): ?frames=N renders exactly N frames with a fixed 1/60 s step, then stops the loop
    // and sets window.__done
    frames: Math.max(0, Math.floor(qNum('frames', 0))),
    // ---- Phase-2 hooks, read by js/sim/* in init(cfg)
    season: Q.get('season'),                                  // raw: spring|summer|autumn|winter or 0..1 (pins the season)
    weather: Q.get('weather'),                                // raw: clear|cumulus|overcast|fog|rain|snow|blizzard|auto
    speed: Q.has('speed') ? clamp(qNum('speed', 1), 0, 8) : 1,   // climate seconds per real second
    date: new Date(),                                         // the real date: initial year phase without ?season / ?yp
    // ---- debug hooks for the parallel lanes: they override the sim after its step (see ARCHITECTURE.md)
    yp: Q.has('yp') ? (v => v - Math.floor(v))(qNum('yp', 0)) : null,   // year phase in [0, 1), pinned
    wx: qKV('wx'),                                            // weather channels, e.g. overcast:.5,precip:.2
    ground: qKV('ground'),                                    // ground state, e.g. cover:.3,wet:.8
    view: VIEWS.indexOf(Q.get('view')) + 1,                   // debug view index (0 = off), names in S.VIEWS
    gb16: Q.get('gb16') === '1',                              // test-only: force the all-RGBA16F G-buffer fallback
    // ---- Phase-3 hooks
    scene: Q.get('scene') || 'valley',                        // raw: valley | house (unknown ids boot the valley)
    event: Q.get('event'),                                    // raw: quake | wildfire | strike (triggered at boot, after ?t)
  };

  // ---- camera & sun: the state every pass and module reads. The active scene (S.scene, js/scenes/*.js) frames them:
  // scene.frameCamera(asp) -> S.setCamera(...), scene.sun -> S.SUN. CAM.pos, camF / camR / camU and SUN are only ever
  // mutated in place: other files alias the arrays. S.TANH (tan of half the vertical fov) changes with the framing
  // too: read it at call time, never cache it.
  const CAM = { pos: [0, 0, 0], yaw: 0, pitch: 0, fovY: 1 };
  const camF = [0, 0, 1], camR = [1, 0, 0], camU = [0, 1, 0], SUN = [0, 1, 0];
  S.CAM = CAM; S.camF = camF; S.camR = camR; S.camU = camU; S.SUN = SUN;
  S.TANH = 1;
  // the camera from a position, yaw, pitch (rad), tan(fovY / 2) and fovY. Returns true when it moved (a baked G-buffer
  // is stale). camR is horizontal (no roll); camU = camF x camR
  S.setCamera = function (pos, yaw, pitch, tanV, fovY) {
    const changed = tanV !== S.TANH || yaw !== CAM.yaw || pitch !== CAM.pitch || pos[0] !== CAM.pos[0] || pos[1] !== CAM.pos[1] || pos[2] !== CAM.pos[2];
    CAM.pos[0] = pos[0]; CAM.pos[1] = pos[1]; CAM.pos[2] = pos[2];
    CAM.yaw = yaw; CAM.pitch = pitch; CAM.fovY = fovY; S.TANH = tanV;
    camF[0] = Math.sin(yaw) * Math.cos(pitch); camF[1] = Math.sin(pitch); camF[2] = Math.cos(yaw) * Math.cos(pitch);
    const l = Math.hypot(camF[2], -camF[0]);
    camR[0] = camF[2] / l; camR[1] = 0; camR[2] = -camF[0] / l;
    camU[0] = camF[1] * camR[2] - camF[2] * camR[1]; camU[1] = camF[2] * camR[0] - camF[0] * camR[2]; camU[2] = camF[0] * camR[1] - camF[1] * camR[0];  // F x R = up
    return changed;
  };
  // framing per aspect ratio (w / h): the active scene's (valley: the Phase-1 camera in landscape, see js/scenes/valley.js).
  // It also keeps S.worldR / S.worldF (polish), the world's reference basis for this aspect: the valley's camera (the
  // Phase-2 one) whichever scene is shown. The sim's camera-relative state (the natural gale line, sim/wind.js; the
  // veil / rain-gust scroll integrals, derive/precip.js; the tree-sway phase, main.js) follows it instead of the live
  // camera, so the world never depends on the place: a trip to another scene and back returns the valley's world
  // exactly (in the valley it is the live camera itself, bit for bit the Phase-2 numbers; elsewhere one dry run of the
  // valley's framing, the live camera restored). The per-frame screen-space values (the drag steer, the veil and rain
  // directions, the sway lean) keep the live camera.
  const worldR = S.worldR = [1, 0, 0], worldF = S.worldF = [0, 0, 1];
  S.frameCamera = asp => {
    const moved = S.scene.frameCamera(asp), ref = S.scenes.valley;
    if (ref && ref !== S.scene) {
      const keep = { pos: CAM.pos.slice(), yaw: CAM.yaw, pitch: CAM.pitch, fovY: CAM.fovY, tanH: S.TANH };
      ref.frameCamera(asp);
      for (let i = 0; i < 3; i++) { worldR[i] = camR[i]; worldF[i] = camF[i]; }
      S.setCamera(keep.pos, keep.yaw, keep.pitch, keep.tanH, keep.fovY);
    } else for (let i = 0; i < 3; i++) { worldR[i] = camR[i]; worldF[i] = camF[i]; }
    return moved;
  };

  // ---- scenes (Phase 3). js/scenes/*.js register S.scenes[id] = { id, name, frameCamera(asp), sun, progs, bakeIter,
  // atmos, surface, derive } (ARCHITECTURE.md §14). S.useScene(id) makes one active (the sun is copied in place; the
  // caller re-frames the camera and, with GL up, rebakes: S.setScene in main.js). scenes/valley.js activates the
  // valley at load, so the camera and the sun exist before any sim step (node tests included).
  S.scenes = {}; S.scene = null; S.sceneId = null;
  S.useScene = function (id) {
    const sc = S.scenes[id];
    if (!sc) return false;
    S.scene = sc; S.sceneId = id;
    SUN[0] = sc.sun[0]; SUN[1] = sc.sun[1]; SUN[2] = sc.sun[2];
    return true;
  };

  // ---- GLSL registry: js/glsl/*.js register named chunks and program recipes; gl.js assembles them lazily
  S.glsl = { chunks: {}, progs: {} };
  // ---- the derive modules (js/derive/*.js register S.derive.surface / precip / atmos = { init, step, frame })
  S.derive = {};
  // ---- the frame uniform bundle (see the header). Neutral defaults of the Phase-2 environment uniforms (ENV chunk):
  S.F = {
    uSeasonW: [0, 0, 0, 1],          // season weights (spring, summer, autumn, winter), sum 1
    uTemp: -5,                       // meadow air temperature, deg C
    uSnowline: [-10000, 150],        // snowline altitude (m) and transition half-width (m); far below the scene = no effect
    uWet: 0,                         // ground wetness 0..1
    uCumulus: 0,                     // near cumulus / drifting cloud shadows 0..1
    uFogDay: 0,                      // fog weather 0..1
    uMistP: [650, 260, 0.3, 1.3],    // valley mist: reference depth (level -x m), scale height (m), bank floor, bank gain
    uPrecipSnow: 1,                  // snowfall rate 0..1 (1 = the Phase-1 constant snowfall)
    uPrecipRain: 0,                  // rainfall rate 0..1
    uSnowFrac: 1,                    // snow share of the precipitation 0..1
    uGale: 0,                        // gale 0..1
    uHeavy: 0,                       // heavy snowfall / blizzard intensity 0..1
    uCirrus: 1,                      // cirrus amount (1 = the Phase-1 veil)
    uShadowAmp: 0.65,                // cloud-shadow strength (the Phase-1 constant)
    uView: S.cfg.view,               // ?view= debug channel (0 = off)
    // ---- Phase 3 (neutral: with these values every pass draws exactly the Phase-2 image)
    uCloudSoft: 0,                   // the scene's cumulus clean-up (FS_SKY; derive/atmos.js from scene.atmos.cloud.soft; stage 2b)
    uCozy: 0,                        // house scene: window / porch light strength 0..1 (derive/house.js; SURFACE_HOUSE)
    uFlash: [0, 0, 0, 0],            // hazards: lightning flash rgb radiance (linear), w envelope 0..1 (derive/events.js; HAZARD)
    uFlashPos: [0, 1500, 4000, 0],   // hazards: strike position (world m), w: channel length (m), 0 = none
    uQuake: [0, 0, 0, 0],            // hazards: screen shake offset xy (uv), roll (rad), intensity 0..1 (overscan, blur)
    uSmoke: [0, 0, 0, 0],            // hazards: wildfire smoke tint rgb, w amount 0..1
    uCrack: [0, 0, 0, 0],            // hazards: crack decals: centre xz (world m), radius (m), strength 0..1
    uAshRate: 0, uEmberRate: 0, uDustRate: 0,   // hazards: rates of the ash / ember / dust particle kinds (precip.js counts; not uniforms)
  };
})(window.SNOW = {});
