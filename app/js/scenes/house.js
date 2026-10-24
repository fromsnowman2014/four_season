// =====================================================================================
//  scenes/house.js (Phase-3 owner: lane H) — "우리 집": a cozy single-story California ranch house at golden hour, a
//  3D interpretation of the style of the user's home (never the photo itself, no street-sign text, no house number;
//  docs/PHASE3_PLAN.md). The camera stands on the street in front of the house, the low golden sun comes from the
//  front-left (the cedar facade lit warm and slanting, long tree shadows across the lawn and the siding), the bake
//  recipe (glsl/house/gbuf-house.js) and its budget, the shade recipe (glsl/house/surface-house.js), the scene derive
//  (derive/house.js: uCozy, the golden-hour look, the leafy / bare bake variant), and the atmosphere / surface profiles
//  read by derive/atmos.js and derive/surface.js. The scene contract is in ARCHITECTURE.md §14.
//  World: metres, y up, the lawn / sidewalk at y ~ 0, the street at ~-0.15 (world z -25.65 .. -14.3), the house's front
//  wall at z = 0 facing -z (main body x -2.5 .. 11, garage x -9.4 .. -2.5 protruding to z = -2.4), the camera on the
//  street looking +z. (The geometry is modelled in 'house space', the world mirrored in z: glsl/house/house-sdf.js.)
//  Step 2 (the look): the framing below (eye 1.65 m; portrait / tablet aspect-aware), the atmosphere profile (a
//  street-scale tule fog, the clouds overhead), and progs.comp = 'comp@house' (the per-scene composite step, post.js
//  FS_COMP_SCENE + SURFACE_HOUSE's COMP_HOUSE: lamp halos in the air, fog wisps, golden highlights).
// =====================================================================================
(function (S) {
  'use strict';
  const D = Math.PI / 180;
  const POS = [1.2, 1.65, -22.5];
  const TAN_L = Math.tan(20 * D);          // landscape: a 40 deg vertical fov (16:9: 66 deg across)
  const TANH_P = Math.tan(29 * D) * 390 / 844;   // a 390 x 844 phone: 29 deg across (58 deg vertical)
  const TANH_L = TAN_L * 1.25;             // the landscape fov at the portrait / landscape boundary (aspect 1.25)
  // bake budget (HOUSE_MAIN's state machine): march, ground bisection, normal, soft shadow, AO (+ slack)
  const GB_MARCH = 300, GB_BISECT = 7, GB_NORMAL = 4, GB_SHADOW = 110, GB_AO = 5;

  S.scenes.house = {
    id: 'house',
    name: '우리 집',
    // (Phase 3 lane H, step 2: the house look) Landscape (>= 1.25): eye 1.65 m (a person on the far sidewalk's edge of
    // the street), 22.5 m from the front wall, tilted 5 deg up, a 40 deg vertical fov: the house across ~80% of the
    // width, the palms and the evening sky above (~45% of the frame), the street lamp at the right edge, the street
    // ~6% of the frame (the parkway, sidewalk and lawn lead in). Toward portrait the horizontal fov narrows from the
    // landscape one at aspect 1.25 to 29 deg on a 390 x 844 phone (tablets in between: 820 x 1180 ~33 deg across, 47
    // deg vertical), the camera moves 2.2 m right (centred on the entry and the two windows) and 0.5 m back, and the
    // tilt keeps the frame's bottom edge 15 (landscape) .. 16.5 (phone; stage 2b: was 18) deg below the horizon, so the street stays a thin
    // foreground band and the sky with the palms fills the rest. Every framing looks at the backdrop cards square-on.
    // Returns true when the camera moved
    frameCamera(asp) {
      const t = S.smooth(1.25, 0.6, asp);
      const tanV = Math.max(TAN_L, S.lerp(TANH_P, TANH_L, S.smooth(0.46, 1.25, asp)) / asp);
      const fovY = 2 * Math.atan(tanV);
      POS[0] = S.lerp(1.2, 3.4, t); POS[1] = 1.65; POS[2] = S.lerp(-22.5, -23, t);
      return S.setCamera(POS, 0, 0.5 * fovY - S.lerp(15, 16.5, t) * D, tanV, fovY);
    },
    // golden hour: the sun ~12 deg up from the front-left (behind the camera's left shoulder): the facade lit from the
    // side with modelling, the garage throws its shadow toward the entry, the visible sky faces away from the sun
    sun: (() => { const s = [-0.8, 0.21, -0.56]; const l = Math.hypot(...s); return s.map(v => v / l); })(),
    // (stage 2b: sky -> 'sky@house', the cloud pass with the cumulus clean-up, atmos.cloud.soft)
    progs: { gbuf: 'gbuf@house', shade: 'shade@house', comp: 'comp@house', sky: 'sky@house' },
    bakeIter: GB_MARCH + GB_BISECT + GB_NORMAL + GB_SHADOW + GB_AO + 5,
    // bake variants (gl.js / render.js): 0 leafy, 1 bare winter crowns; derive/house.js picks one by the season and
    // the engine rebakes behind the live scene, then dissolves it in
    variants: true,
    derive: 'house',
    // the lawn at y ~ 0 (the shared ground model's snowline is in the valley's metres; the house sits at the valley
    // meadow's level, so the same cover applies). mild (stage 2b, derive/surface.js): a California yard rarely holds
    // snow: while it snows the yard whitens with the valley; once the snowfall stops its own snowline climbs back to
    // 2100 m (every threshold bare, the roofs last) over ~120 climate-s, the air 10 C milder than the alpine meadow's
    surface: { meadowAlt: 0, snowlineW: 300, mild: { line: 2100, tau: 120, dT: 10 } },
    atmos: {
      coverMix: [1, 0, 0], coverAlt: [800, 2000],
      // a ground-level mist: an even haze on fair days; on fog days a street-scale (tule) fog ~45 m deep, 1/38 per m
      // at the ground (~40% of the facade's light gets through at 25 m, the palms behind the house are silhouettes,
      // the backdrop dissolves); no fog-sea banks. derive/house.js darkens it into a blue dusk, COMP_HOUSE adds wisps
      mist: { level: [0, -4], scale: [220, 300, 45], floor: [0.5, 0.6, 0.85], gain: [0.6, 0.3, 0.3], swell: 2.5, glow: 0, sea: 0, fogInv: 38 },
      // clouds over the whole sky down to ~0.5 km (the camera looks up past the palms: the evening clouds overhead)
      // soft (stage 2b): the cumulus clean-up of FS_SKY (x uCumulus): low, near clouds shed the specks of their thin fringes
      cloud: { cutL: [500, 500, 400], cutR: [500, 400], fade: [1500, 1200], undul: [700, 160], split: [0, 0], soft: 0.12 },
    },
  };
})(window.SNOW);
