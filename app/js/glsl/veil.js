// =====================================================================================
//  GLSL: VEIL chunk (stage-1 owner: lane E). What the particles cannot show, seen from afar:
//   - the distant falling-snow veil: two screen-space streak sheets along the apparent fall direction plus a slow
//     'big' sheet (Phase 1), scaled by the snowfall rate;
//   - the rain veil: the rain beyond the particle slices (~70 m - 1 km), a faint haze with a fine falling grain;
//   - the rain curtains: grey shafts hanging from the cloud base over the far valley (patchy showers under broken
//     cloud, wide sheets under a deck), slanted by the wind, with fibrous striations, drifting with the clouds
//     (uCloudOff).
//  applyVeil is the entry point the shading pass calls last on every pixel (sky and terrain). Each part sits behind
//  a uniform branch, so dry weather costs nothing. Needs COMMON + ENV + ATMOS (the cloud base uCloudQ.x, so the
//  curtains hang from the clouds lane C draws). Its uniforms come from S.F (js/derive/precip.js).
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.VEIL = `
uniform vec2 uVeilDir;       // apparent screen-space fall direction of distant snow
uniform float uVeilAmt;      // snow veil amount (0 = off)
uniform vec4 uVeilT;         // integrated scroll of the veil noise sheets (xy: the two streak layers, zw: the slow
                             // 'big' sheet), wrapped by the noise period (256) on the CPU so storms/wind never jump it
uniform vec2 uRainDir;       // apparent screen-space fall direction of distant rain
uniform float uRainVeil;     // rain veil amount (0 = off)
uniform vec4 uRainT;         // rain veil scroll (xy: the two grain sheets, zw: the slow density), wrapped by 256
uniform vec4 uRainShaft;     // x: rain-curtain optical depth per km (0 = off), y: sunlit share (broken cloud),
                             // zw: the fall slant (world x / z metres across per metre down: the wind over the drop speed)

// distant falling snow seen as a translucent, streaky veil (two parallax layers)
float veil(vec2 frag) {
  vec2 uv = frag / uRes.y;
  vec2 d = normalize(uVeilDir);
  mat2 R = mat2(d.y, d.x, -d.x, d.y);
  vec2 q = R * uv;
  float s1 = tnoise(vec2(q.x * 210.0, q.y * 9.0 + uVeilT.x));
  float s2 = tnoise(vec2(q.x * 120.0 + 31.0, q.y * 5.0 + uVeilT.y));
  float big = tnoise(uv * 3.0 + uVeilT.zw);
  return (smoothstep(0.5, 1.0, s1) * 0.6 + smoothstep(0.45, 1.0, s2) * 0.6) * (0.55 + 0.9 * big);
}
// rain beyond the particle slices (~70 m - 1 km): no single drop resolves there, so it is a faint haze carrying a
// fine, short, fast-falling grain (two parallax sheets) in drifting denser and lighter patches. Low contrast on
// purpose: long thresholded lines would read as a scratched pane in front of the scene
float rainVeil(vec2 frag) {
  vec2 uv = frag / uRes.y;
  vec2 d = normalize(uRainDir);
  mat2 R = mat2(d.y, d.x, -d.x, d.y);
  vec2 q = R * uv;
  float s1 = tnoise(vec2(q.x * 520.0, q.y * 11.0 + uRainT.x));
  float s2 = tnoise(vec2(q.x * 300.0 + 31.0, q.y * 7.0 + uRainT.y));
  float big = tnoise(uv * 2.2 + uRainT.zw);
  float grain = smoothstep(0.55, 0.95, s1) * 0.5 + smoothstep(0.5, 0.95, s2) * 0.4;
  return (0.35 + grain) * (0.4 + 0.9 * big);
}
// optical depth of the far rain curtains along the view ray: 3 samples at fixed distances (4, 9, 16 km, each
// standing for its segment), so the pattern never follows the terrain's depth contours; a sample behind the hit
// fades out over its segment. The rain hangs below the cloud base; following each sample up the fall line to the
// cloud that drops it (q), a function of q is constant along the fall: the cells give the shafts, a finer noise the
// striations, and a noise that also moves with the height ('wisp') breaks the striations into fibres
float rainCurtains(vec3 rd, float t) {
  if (t <= 2000.0) return 0.0;
  float od = 0.0;
  for (int i = 0; i < 3; i++) {
    float s = i == 0 ? 4000.0 : (i == 1 ? 9000.0 : 16000.0);
    float ds = i == 0 ? 4000.0 : (i == 1 ? 6000.0 : 8000.0);
    vec3 p = uCamPos + rd * s;
    float below = uCloudQ.x - p.y;                 // the curtains hang from the cloud slab's base (ATMOS: ~1500 m, lower under a rain deck)
    if (below <= 0.0) break;                       // the ray only climbs from here: above the base, no rain
    vec2 q = p.xz - uRainShaft.zw * below + uCloudOff;  // a drop drifts downwind as it falls
    float cell = tnoise(q * 0.00026 + vec2(5.3, 1.9));
    float stri = tnoise(q * 0.0062 + 3.0) * 0.6 + tnoise(q * 0.017 + 9.0) * 0.4;
    float wisp = tnoise(q * 0.0011 + vec2(0.0, below * 0.0021) + 7.0);
    // shafts: rain cells (patchy showers under broken cloud, wide sheets under a full deck), soft fibres inside
    float lo = mix(0.66, 0.5, uCloudCov);
    // (stage 2b: soft fibres, not striations: a strongly striped shaft over a dark cliff reads as a sunbeam)
    float dens = 0.02 + smoothstep(lo, lo + 0.22, cell) * (0.7 + 0.45 * smoothstep(0.3, 0.9, stri)) * (0.55 + 0.7 * wisp);
    // the curtain emerges from under the base; only the part of the segment in front of the hit counts
    od += dens * smoothstep(0.0, 300.0, below) * ds * sat((t - s) / ds + 0.5);
  }
  return od * 0.001 * uRainShaft.x;
}
// the distant precipitation over a pixel at distance t (the sky's t = 65000 gives the full amount)
vec3 applyVeil(vec3 col, float t, vec2 frag) {
  if (uRainShaft.x > 0.0) {
    // rain curtains: overcast light scattered by the rain, a little darker and greyer than the haze
    float od = rainCurtains(camRay(frag), t);
    vec3 cc = mix(uFogCol, vec3(dot(uFogCol, vec3(0.333))), 0.35) * 0.78 + uSunCol * (0.01 + 0.025 * uRainShaft.y);
    col = mix(col, cc, 1.0 - exp(-od));
  }
  if (uRainVeil > 0.0) {
    float ramt = uRainVeil * (1.0 - exp(-t / 160.0));
    col = mix(col, uFogCol * 1.15 + uSkyZen * 0.1, sat(ramt * rainVeil(frag)));
  }
  if (uVeilAmt > 0.0) {
    // the distant snow veil (strong in blizzards)
    float vamt = uVeilAmt * (1.0 - exp(-t / 900.0));
    col = mix(col, uFogCol * 1.35 + uSunCol * 0.05, sat(vamt * veil(frag)));
  }
  return col;
}
`;
})(window.SNOW);
