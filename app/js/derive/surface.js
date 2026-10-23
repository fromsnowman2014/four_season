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
//    visCover     coverAt(the chalet meadow, -50 m): the snow the meadow shows
// =====================================================================================
(function (S) {
  'use strict';
  const SNOWLINE_W = 300;                   // m: half-width of the snowline transition (uSnowline.y)
  const MEADOW_ALT = -50;                   // m: the chalet meadow's altitude (visCover)
  const GRASS_PERIOD = 2560000 / 45;        // m: 10 periods of the 0.045 grass-wave octave = 27 of the 0.1215 one (SURFACE)
  const snowline = new Float32Array(2), grassDisp = new Float32Array(3);
  const { clamp } = S;

  let cover = 0, line = -10000;            // this frame's cover level and snowline (coverAt)
  S.derive.surface = {
    visCover: 0,
    coverAt: alt => clamp(cover - S.snowlineOffset(alt, line, SNOWLINE_W), 0, 1),
    init() {},
    step() {},
    frame(F) {
      const g = S.ground.s, w = S.weather.s;
      F.uCover = g.cover;
      F.uWet = g.wet;
      snowline[0] = g.snowline; snowline[1] = SNOWLINE_W; F.uSnowline = snowline;
      F.uSeasonW = S.climate.s.seasonW;
      F.uYearPhase = S.climate.s.phase;
      F.uTemp = w.temp;
      // thaw gate: fresh snow keeps falling on top -> no melt look and no melt order while it snows
      F.uMelt = 1 - clamp(3 * w.ch.precip * w.ch.snowFrac, 0, 1);
      // the snow the meadow shows after the snowline (the shared offset model, see coverAt)
      cover = g.cover; line = g.snowline;
      S.derive.surface.visCover = S.derive.surface.coverAt(MEADOW_ALT);
      // grass-wave displacement, wrapped at the common period of its two noise octaves (0.045 and 0.1215 = 2.7 x 0.045
      // per metre on a 256-periodic texture: 10 and 27 periods respectively), so the sheen never jumps
      for (let i = 0; i < 3; i++) grassDisp[i] = S.anim.dispA[i] % GRASS_PERIOD;
      F.uGrassDisp = grassDisp;
    },
  };
})(window.SNOW);
