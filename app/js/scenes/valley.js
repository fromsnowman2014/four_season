// =====================================================================================
//  scenes/valley.js — the alpine valley (Phase 1 / 2, the default scene; frozen). Everything valley-specific that
//  Phase 2 kept in core.js / render.js / the derive files: the camera and its per-aspect framing, the baked sun, the
//  G-buffer recipe and its bake budget, the atmosphere profile (cover keys of the exposure, the valley mist / fog sea,
//  the cloud cuts of the composition) and the surface profile (the meadow altitude, the snowline width). The values
//  are the Phase-2 constants verbatim: the valley renders pixel-identical to Phase 2 (tests/scenes.mjs).
//  Registers S.scenes.valley and, as the default scene, activates it at load (the camera and the sun must exist before
//  any sim step, node tests included). The scene contract is in ARCHITECTURE.md §14.
// =====================================================================================
(function (S) {
  'use strict';
  // high vantage over the meadow: ~230 m above the chalet basin, tilted 12 deg down (horizon sits at ~24% from the top)
  const POS = [0, 132, 0];
  const FOV0 = 44 * Math.PI / 180, TAN0 = Math.tan(FOV0 / 2);
  // G-buffer bake budget: the state machine in GBUF_MAIN visits each phase at most this often (see its main())
  const GB_MARCH = 900, GB_BISECT = 6, GB_HEIGHT = 1, GB_NORMAL = 8, GB_SHADOW = 110, GB_AO = 5, GB_CANOPY = 1, GB_CURV = 8;

  S.scenes.valley = {
    id: 'valley',
    name: '알프스 계곡',
    // Framing per aspect ratio (w / h). Landscape (>= 1.25) is the composed 44 deg view, bit for bit the Phase-1
    // constants. Toward portrait (phones) the vertical fov widens so the horizontal fov never drops below 34 deg, the
    // camera tilts down 4 deg more (more meadow under a taller frame) and turns 9 deg left so the snowy peak and the
    // hazy valley stay in frame beside the wall. (The Phase-1 hotfix blended the fov term by t as well, which let the
    // horizontal fov dip to 33.85 deg around aspect 0.7, a portrait tablet; max() keeps the 34 deg floor and is the
    // same value for every phone and every landscape.) Returns true when the camera moved (a baked G-buffer is stale).
    frameCamera(asp) {
      const t = S.smooth(1.25, 0.6, asp);
      const tanV = Math.max(TAN0, Math.tan(17 * Math.PI / 180) / asp);
      const yaw = t > 0 ? -9 * t * Math.PI / 180 : 0, pitch = (-12 - 4 * t) * Math.PI / 180;
      return S.setCamera(POS, yaw, pitch, tanV, t > 0 ? 2 * Math.atan(tanV) : FOV0);
    },
    // the fixed (baked) sun: low from the left, a little toward the camera
    sun: (() => { const s = [-0.70, 0.47, -0.17]; const l = Math.hypot(...s); return s.map(v => v / l); })(),
    // program name -> recipe name of the scene-dependent programs (the rest are shared by every scene; gl.js)
    progs: { gbuf: 'gbuf', shade: 'shade' },
    bakeIter: GB_MARCH + GB_BISECT + GB_HEIGHT + GB_NORMAL + GB_SHADOW + GB_AO + GB_CANOPY + GB_CURV,
    derive: null,                 // no scene derive module (S.derive[name].frame after atmos)
    // derive/surface.js: the chalet meadow's altitude (visCover) and the snowline transition half-width (m)
    // (mild: null = the alpine ground as it is; a scene's own milder snowline, derive/surface.js, stage 2b)
    surface: { meadowAlt: -50, snowlineW: 300, mild: null },
    // derive/atmos.js
    atmos: {
      // exposure: the snow the camera sees = coverMix . [visCover, coverAt(coverAlt[0]), coverAt(coverAlt[1])]
      // (the meadow, the slopes ~800 m, the summits ~2000 m)
      coverMix: [0.7, 0.2, 0.1], coverAlt: [800, 2000],
      // the mist layer (uMistP / uMistQ). level: reference depth (level = -x m) clear .. fog sea; scale (m), floor and
      // gain of the drifting banks: [fair, calm / even, fog sea]; swell: the fog-sea top swell (m); glow: its sun glow;
      // sea: the fog-sea weight (1: the valley's banks and sea texture, 0: a plain exponential layer); fogInv: the
      // fog-sea density is 1 / fogInv (1/m)
      mist: { level: [650, 72], scale: [260, 560, 12], floor: [0.3, 0.55, 0.8], gain: [1.3, 0.35, 0.45], swell: 20, glow: 0.22, sea: 1, fogInv: 180 },
      // the cloud slab's near cut (the composition: Phase 1 renders only the far field, left of centre from 19 km,
      // right from 13 km). cutL: [fair, cumulus, grey deck]; cutR / fade: [fair, cumulus or deck]; undul: base undulation
      // [fair, cumulus] (m p-p); split: sin(azimuth) of the left / right split [fair, cumulus or deck]
      cloud: { cutL: [19000, 18000, 9000], cutR: [13000, 3000], fade: [5000, 2500], undul: [700, 160], split: [0, -0.3], soft: 0 },
    },
  };
  // the default scene, active from load
  if (!S.scene) { S.useScene('valley'); S.frameCamera(16 / 9); }
})(window.SNOW);
