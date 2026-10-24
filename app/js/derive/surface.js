// =====================================================================================
//  derive/surface.js (stage-1 owner: lane D) — the ground surface: the sim state -> S.F for the SURFACE chunk.
//  Pure JS (no GL, no DOM). Climate: the year phase (vegetation clock) and the season weights; weather: the meadow
//  temperature and whether snow is falling (thaw gate); ground: cover, wetness and the snowline (scene metres; a
//  snowline far below the scene, e.g. the core default -10000 or winter's -1600, leaves effectiveCover() the Phase-1
//  cover).
//
//  S.derive.surface = { init(), step(dt, ff), frame(F), visCover, coverAt(alt) }   frame runs first of the three
//    frame(F)     uCover uWet uSnowline uSeasonW uTemp uGrassDisp uYearPhase uMelt
//    coverAt(alt) the cover level left at altitude alt (m) after this frame's snowline: SURFACE's effectiveCover through
//                 its JS twin S.snowlineOffset (glsl/surface.js, the same constants), without the per-pixel aspect /
//                 noise shift; 0..1. derive/atmos.js keys the exposure to it (it runs after this frame)
//    visCover     coverAt(scene.surface.meadowAlt; the valley's chalet meadow, -50 m): the snow the meadow shows
// =====================================================================================
(function (S) {
  'use strict';
  const GRASS_PERIOD = 2560000 / 45;        // m: 10 periods of the 0.045 grass-wave octave = 27 of the 0.1215 one (SURFACE)
  const snowline = new Float32Array(2), grassDisp = new Float32Array(3);
  const { clamp } = S;

  // the scene's surface profile (S.scene.surface, js/scenes/*.js): snowlineW, the half-width of the snowline transition
  // (uSnowline.y; valley 300 m), and meadowAlt, the altitude of the ground the camera mostly sees (visCover; valley: the
  // chalet meadow, -50 m)
  let cover = 0, line = -10000, width = 300;   // this frame's cover level, snowline and its half-width (coverAt)
  // (stage 2b) A milder ground for a scene whose surface profile has `mild` (the house: a California valley floor rarely
  // holds snow): the scene keeps its own snowline. While snow falls it follows the shared one down (the same patches
  // coming in, the same cover); once the snowfall stops it climbs back to mild.line over ~mild.tau climate-s (faster in
  // sun and in warmth, mild.dT C warmer than the alpine meadow), so the snow melts out of the yard, the sunny lawn
  // first, the shaded roof last, a few minutes after the snow stopped (at 1x). The shared ground and the valley are
  // untouched; a pinned ground (?cover with ?storm=0, ?ground) shows as pinned. Stepped whatever the scene (every
  // derive clock runs), so a switch shows the yard as it is now.
  const mild = {};                             // scene id -> its own snowline (m)
  const pinned = () => S.ground.s.hold || !!S.cfg.ground;
  const snowing = () => S.weather.s.ch.precip * S.weather.s.ch.snowFrac > 0.02;
  function mildInit() {
    for (const id in S.scenes) { const M = S.scenes[id].surface.mild; if (M) mild[id] = snowing() ? S.ground.s.snowline : Math.max(S.ground.s.snowline, M.line); }
  }
  function mildStep(dt) {
    const g = S.ground.s, wx = S.weather.s, dtc = dt * S.climate.s.speed;
    for (const id in mild) {
      const M = S.scenes[id].surface.mild;
      let L = mild[id];
      if (snowing()) { if (g.snowline < L) L += (g.snowline - L) * (1 - Math.exp(-dtc / 8)); }
      else {
        const warm = clamp((wx.temp + M.dT) / 6, 0.3, 2), sun = 1 - wx.ch.overcast;
        L += (M.line - L) * (1 - Math.exp(-dtc * (0.4 + 0.6 * sun) * warm / M.tau));
      }
      mild[id] = L;
    }
  }
  // the snowline the active scene shows (m)
  const sceneLine = () => (mild[S.sceneId] !== undefined && !pinned()) ? Math.max(mild[S.sceneId], S.ground.s.snowline) : S.ground.s.snowline;
  S.derive.surface = {
    visCover: 0,
    coverAt: alt => clamp(cover - S.snowlineOffset(alt, line, width), 0, 1),
    init() { mildInit(); },
    step(dt) { mildStep(dt); },
    frame(F) {
      const g = S.ground.s, w = S.weather.s, P = S.scene.surface;
      F.uCover = g.cover;
      F.uWet = g.wet;
      const sl = sceneLine();
      snowline[0] = sl; snowline[1] = P.snowlineW; F.uSnowline = snowline;
      F.uSeasonW = S.climate.s.seasonW;
      F.uYearPhase = S.climate.s.phase;
      F.uTemp = w.temp;
      // thaw gate: fresh snow keeps falling on top -> no melt look and no melt order while it snows
      F.uMelt = 1 - clamp(3 * w.ch.precip * w.ch.snowFrac, 0, 1);
      // the snow the meadow shows after the snowline (the shared offset model, see coverAt)
      cover = g.cover; line = sl; width = P.snowlineW;
      S.derive.surface.visCover = S.derive.surface.coverAt(P.meadowAlt);
      // grass-wave displacement, wrapped at the common period of its two noise octaves (0.045 and 0.1215 = 2.7 x 0.045
      // per metre on a 256-periodic texture: 10 and 27 periods respectively), so the sheen never jumps
      for (let i = 0; i < 3; i++) grassDisp[i] = S.anim.dispA[i] % GRASS_PERIOD;
      F.uGrassDisp = grassDisp;
    },
  };
})(window.SNOW);
