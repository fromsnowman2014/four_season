// =====================================================================================
//  GLSL: SURFACE_HOUSE chunk (Phase-3 owner: lane H). The house scene's per-frame shading: the same entry points as
//  the valley's SURFACE (shadeSurface, surfaceDebug, called by the frozen FS_SHADE glue) over the house's material ids
//  and G3 semantics (HOUSE_IDS in house-sdf.js; the table in ARCHITECTURE.md §14), and the sway weight of its G-buffer
//  (treeH, SCENE_SWAY). Ported from the feasibility spike (work/phase3/spike/house-glsl.js HG.SHADE / HG.COMP):
//   - seasons per material by the year phase (California): the lawn lush in spring, green in winter, golden dry
//     patches in summer and autumn; fruit trees blossom white / pink (on bare twigs in late February, then on the new
//     crowns), leaf out, colour and drop; the deciduous trees leaf out fresh, colour gold .. red, brown and drop (the
//     bare winter crowns are the variant bake: skeletons + the twig haze of G3.a); palms, cypresses, the live oak and
//     the shrubs evergreen (the flowering shrubs lavender in early summer);
//   - snow: the shared cover model (uCover and the snowline through the valley's constants, S.SNOWLINE), the baked
//     per-material thresholds (G1.w; the street slushy with tyre tracks), none under the eaves (G3.a shelter), thaw;
//   - wet: darkening by porosity, puddles in the baked low spots (G3.g) with the normal flattened, a mirror of the
//     scene by screen-space reflection of the previous frame (uPrevHdr) with the sky / the clouds behind it as the
//     fallback (on wet paving, the wet roof, the glass);
//   - light: the baked golden-hour sun x the cloud shadow, sky ambient with a warm sunward side, ground bounce; glass =
//     Fresnel reflection over the lit room (G1 = its emission colour) glowing with uCozy; the porch lantern, the street
//     lamp and the windows as short-range warm point lights (uCozy); lantern glass emits;
//   - the bare variant's twig haze over surfaces and, on the haze pixels the bake put in front of the sky (G3.g .5),
//     over the sky with its clouds (uSkyH: the cloud pass).
//  Step 2 (the look, lane H): the California lawn goes golden in late summer (dry patches first); the fruit blossom is
//  fine petal clusters lasting into the leaf-out; a bed of flowering perennials along the foundation (G3.r >= .75:
//  in flower April .. August, each clump its own colour, browning in autumn); snow relief (drifts catching the low sun,
//  blue shade) and ragged melt edges on the lawn; wet ground: a dull damp state vs a soaked gloss, puddles with a wet
//  rim, water depth and rain rings (hRipple), a jitter-free SSR whose blur streaks vertically; gutter drips catching
//  the window light; stronger warm light pools (porch, street lamp, windows) and a frosted lantern glass. The
//  composite step of the house (COMP_HOUSE, program 'comp@house') is at the end of this file.
//  Needs COMMON + ENV + ATMOS + GBUF + HOUSE_IDS. Program 'shade@house' = COMMON + ENV + ATMOS + GBUF + HOUSE_IDS +
//  SURFACE_HOUSE + VEIL + HAZARD + FS_SHADE (registered here; scenes/house.js progs.shade).
//  uPrevHdr / uSkyH are S.F samplers set by render.js deriveF (R.hdr: last frame's scene before the composite; the
//  cloud pass of this frame on unit 3, the texture FS_SHADE reads as uSky).
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  const SL = S.SNOWLINE;                 // the valley's snowline model constants (glsl/surface.js): one cover model
  const f = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  C.SURFACE_HOUSE = `
#define SCENE_SWAY 1
uniform vec3 uGrassDisp;     // integrated wind displacement (m; derive/surface.js): the lawn's sheen waves
uniform float uYearPhase;    // year phase 0..1 (0 = 1 March): the vegetation clock
uniform float uMelt;         // 0..1: 1 while no snow is falling (thaw)
uniform float uCozy;         // 0..1 window / porch / lamp light (derive/house.js)
uniform sampler2D uPrevHdr;  // the previous frame's scene (render.js R.hdr): screen-space reflections in wet ground
uniform sampler2D uSkyH;     // the cloud pass (= FS_SHADE's uSky): the clouds behind the twig haze and in puddles
uniform vec4 uHouseSky;      // the golden-hour sky (derive/house.js): x weight (0 = ATMOS's sky exactly), y zenith rate,
                             // z horizon glow, w sunward glow

// ---- the house's sky (stage 2b; FS_SHADE calls sceneSky for its sky pixels: SCENE_SKY). ATMOS's analytic sky mixes
// its horizon colour into the whole visible band (pow(y, .5): ~35% of it even 25 deg up), which washed the evening sky
// to a pale lilac. At golden hour the house's sky is a zenith-weighted gradient (deep blue from ~20 deg up) over a
// warm peach glow hugging the treeline (uHorBand), wider and brighter toward the low sun (the left of the frame), plus
// a faint sunward glow. Added as a difference to skyPixel's analytic sky (under its haze and clouds), so the cirrus,
// the haze, the clouds, the deck structure and the hazards stay ATMOS's; uHouseSky.x = 0 is skyPixel exactly
#define SCENE_SKY 1
vec3 houseSkyDelta(vec3 rd) {
  float y = clamp(rd.y, 0.0, 1.0);
  vec3 base = mix(uSkyHor, uSkyZen, pow(y + 0.015, 0.5));
  base = mix(base, mix(uSkyHor, uHorBand, 0.5), exp(-max(rd.y, 0.0) * 30.0) * 0.5);
  float sx = dot(normalize(rd.xz + vec2(1e-5)), normalize(uSunDir.xz));      // -1 anti-solar .. 1 toward the sun
  float sw = smoothstep(-0.95, 0.25, sx);
  vec3 g = mix(uSkyHor, uSkyZen, 1.0 - exp(-uHouseSky.y * (y + 0.012)));
  g = mix(g, uHorBand, sat(exp(-y / mix(0.075, 0.14, sw)) * uHouseSky.z * (0.6 + 0.4 * sw)));
  g += uSunCol * uHouseSky.w * sw * sw * exp(-3.5 * y);
  return g - base;
}
vec3 sceneSky(vec3 rd, vec4 cl) {
  vec3 col = skyPixel(rd, cl);
  if (uHouseSky.x > 0.0) {
    vec4 fs = fogAtM(30000.0, rd, 0.6);                        // (skyPixel's haze over the analytic sky)
    // the clear evening air is clean aloft: the warm haze stays low over the treeline (its glow is the horizon band), so
    // most of its inscatter is taken back out higher up (it greyed the blue into lilac)
    vec3 d = houseSkyDelta(rd) * fs.a - fs.rgb * 0.7 * smoothstep(0.08, 0.3, rd.y);
    col = max(col + uHouseSky.x * d * cl.a * (1.0 + stratus(rd) * uOvercast * (1.0 + 0.9 * uPrecipRain)), 0.0);
  }
  return col;
}

// the sway weight of a G-buffer pixel for FS_SHADE: the bake stores it ready-scaled per plant (G0.y fraction) on the
// vegetation ids; everything else is rigid
float treeH(vec4 g) { float m = floor(g.y + 0.001); return (m >= M_FRUIT && m <= M_TREE) ? fract(g.y + 0.001) / 0.9 : 0.0; }

const float H_LAPSE = 0.0065;
// the shared cover model (= SURFACE's effectiveCover; the constants are S.SNOWLINE, the JS twin S.snowlineOffset)
float houseCover(float alt, float sunExp, vec2 xz) {
  float a = alt - 320.0 * (sunExp - 0.45) + 60.0 * (tnoise(xz * 0.05 + 3.7) - 0.5);
  return uCover - ${f(SL.K)} * (1.0 - smoothstep(uSnowline.x - uSnowline.y, uSnowline.x + uSnowline.y, a))
                - ${f(SL.K2)} * (1.0 - smoothstep(uSnowline.x - ${f(SL.LO)}, uSnowline.x - ${f(SL.HI)}, a));
}
// the decoded G3 alpha: shelter (under the eaves) and the bare variant's twig haze
float hShelter(float a) { return step(0.5, a); }
float hHaze(float a) { return sat(2.0 * a - step(0.5, a)); }
// a ray direction in pixels of a 1350-row frame (resolution-independent screen noise for the twig haze)
vec2 hScreen(vec3 rd) { return vec2(dot(rd, uCamR), dot(rd, uCamU)) / max(dot(rd, uCamF), 1e-3) * (675.0 / uTanH); }
vec2 hProj(vec3 p) {
  vec3 v = p - uCamPos; float z = max(dot(v, uCamF), 1e-3);
  return vec2(dot(v, uCamR) / (z * uTanH * uRes.x / uRes.y), dot(v, uCamU) / (z * uTanH)) * 0.5 + 0.5;
}
bool hOnScreen(vec2 s) { return s.x >= 0.0 && s.x <= 1.0 && s.y >= 0.0 && s.y <= 1.0; }
// the sky seen along r (a reflection): the analytic sky with its deck structure and haze (skyPixel), with the clouds of
// the cloud pass where r points at an on-screen sky pixel
vec3 hSkyR(vec3 r) {
  vec4 cl = vec4(0.0, 0.0, 0.0, 1.0);
  vec2 s = hProj(uCamPos + r * 5000.0);
  if (r.y > 0.0 && hOnScreen(s) && G0(s).x > 60000.0) cl = textureLod(uSkyH, s, 0.0);
  return sceneSky(normalize(vec3(r.x, max(r.y, 0.004), r.z)), cl);
}
// screen-space reflection of the previous frame along r from the wet point p: a G0 depth march in geometrically
// growing steps (no per-pixel jitter: no stipple), a hit where the ray passes behind the depth by less than about one
// step (thin objects are not walls), a 5-step refinement, a roughness blur growing with the travelled distance;
// w: the hit weight (0 = none: the caller uses the sky)
vec3 hSSR(vec3 p, vec3 r, float rough, out float w) {
  w = 0.0;
  float s = 0.15, sPrev = 0.0;
  for (int i = 0; i < 32; i++) {        // (reach 0.15 x 1.19^32 ~ 40 m)
    vec3 q = p + r * s;
    vec2 su = hProj(q);
    if (!hOnScreen(su)) break;
    float tS = G0(su).x, dS = length(q - uCamPos);
    if (dS > tS + 0.01 && dS < tS + 0.3 + 1.1 * (s - sPrev)) {
      float a = sPrev, b = s;
      for (int k = 0; k < 5; k++) { float m = 0.5 * (a + b); vec3 qm = p + r * m; if (length(qm - uCamPos) > G0(hProj(qm)).x + 0.01) b = m; else a = m; }
      su = hProj(p + r * b);
      // (wet ground smears a reflection into vertical streaks: the blur is ~3x taller than wide)
      vec2 bl = vec2(0.35 * uRes.y / uRes.x, 1.0) * rough * min(b, 12.0) * 0.0024;
      vec3 c = 0.25 * (textureLod(uPrevHdr, su + bl, 0.0).rgb + textureLod(uPrevHdr, su - bl, 0.0).rgb
                     + textureLod(uPrevHdr, su + vec2(bl.x, -bl.y) * 0.4, 0.0).rgb + textureLod(uPrevHdr, su - vec2(bl.x, -bl.y) * 0.4, 0.0).rgb);
      if (dot(c, c) <= 0.0) return c;                          // a fresh (cleared) buffer: no history yet
      w = smoothstep(0.0, 0.06, min(min(su.x, 1.0 - su.x), min(su.y, 1.0 - su.y))) * smoothstep(60.0, 30.0, b);
      return c;
    }
    sPrev = s; s *= 1.19;
  }
  return vec3(0.0);
}
// a short-range warm point light (unshadowed; house space)
vec3 hPointL(vec3 pos, vec3 n, vec3 lp, vec3 lc, float r) {
  vec3 L = lp - pos; float d2 = dot(L, L); vec3 l = L * inversesqrt(d2);
  return lc * (1.0 / (d2 + 0.3)) * sq(sat(1.0 - d2 / (r * r))) * max(dot(n, l), 0.0);
}

// rain rings on standing water: one ring per 0.32 m cell (the 2 x 2 nearest cells), born at a random point and time,
// spreading and fading over ~1 s; returns the slope (xz) of the water surface. fp: the pixel footprint (m): rings
// below a few pixels fade out
vec2 hRipple(vec2 p, float fp) {
  vec2 g = vec2(0.0);
  float fade = smoothstep(0.03, 0.012, fp);
  if (fade <= 0.0) return g;
  vec2 q = p / 0.32, b = floor(q - 0.5);
  for (int i = 0; i < 4; i++) {
    vec2 c = b + vec2(float(i & 1), float(i >> 1));
    float h = hash2(c * 1.37 + 0.5), h2 = hash2(c * 2.91 + 7.3);
    float ph = fract(uTime * (0.8 + 0.5 * h2) + h);
    vec2 d = q - c - vec2(h, h2) * 0.8 - 0.1;
    float r = length(d), rr = ph * 0.55;
    float w = (r - rr) * 22.0;
    g += d / max(r, 1e-3) * cos(clamp(w, -3.1416, 3.1416)) * (1.0 + cos(clamp(w, -3.1416, 3.1416))) * (1.0 - ph) * (1.0 - ph);
  }
  return g * 0.2 * fade;
}
// ---- seasons. ph: the year phase (0 = 1 March, .25 June, .5 September, .75 December)
// lawn (watered): lush in spring, green in winter; in summer and autumn its dry patches (G3.r) go golden / straw
vec3 lawnSeason(vec3 b, float dry, float ph) {
  float L = dot(b, vec3(0.3, 0.6, 0.1)) / 0.081;
  vec3 lush = vec3(0.06, 0.118, 0.03), green = vec3(0.07, 0.125, 0.03);     // (stage 2b: lush a touch less vivid)
  vec3 straw = mix(vec3(0.27, 0.2, 0.08), vec3(0.18, 0.16, 0.07), dry);
  float k = smoothstep(0.22 - 0.06 * dry, 0.36 - 0.05 * dry, ph) * (1.0 - smoothstep(0.68 + 0.04 * dry, 0.82 + 0.04 * dry, ph));
  float late = smoothstep(0.32, 0.46, ph) * (1.0 - smoothstep(0.6, 0.74, ph));     // late summer: the lawn goes golden
  vec3 c = mix(lush, green, smoothstep(0.08, 0.22, ph) * (1.0 - smoothstep(0.85, 0.98, ph)));
  c = mix(c, straw, k * mix(mix(0.12, 0.5, late), mix(0.8, 0.95, late), smoothstep(0.35 - 0.15 * late, 0.8 - 0.2 * late, dry)));
  float wint = smoothstep(0.75, 0.9, ph) * (1.0 - smoothstep(0.95, 1.0, ph));
  c = mix(c, c * vec3(0.92, 1.0, 0.86), wint * (1.0 - dry));
  // (stage 2b) a winter lawn is a softer, duller green (the short days, the frost nights), spring a fresh but not
  // vivid one: a little desaturated toward a muted olive
  c = mix(c, vec3(dot(c, vec3(0.3, 0.6, 0.1))) * vec3(1.05, 1.0, 0.72), 0.3 * wint + 0.2);
  return c * L;
}
// leafy deciduous / fruit crowns (the leafy variant: phase 0 .. ~.745): blossom (fruit) -> fresh leaf -> summer ->
// autumn colour (hue: gold .. red) -> browning toward the leaf drop. L: the baked leaf luminance (~1); off: the tree's
// phenology offset; pos: blossom clusters
vec3 leafSeason(vec3 b, float L, float ph, float off, float hue, bool fruit, vec3 pos) {
  float p = ph + 0.025 * (off - 0.5);
  float hv = tnoise(pos.xz * 0.9 + 3.0);
  vec3 c = b;
  c = mix(c, vec3(0.1, 0.16, 0.04) * L, smoothstep(0.0, 0.03, p) * (1.0 - smoothstep(0.1, 0.2, p)));      // fresh leaf
  vec3 aut = fruit ? mix(vec3(0.4, 0.1, 0.025), vec3(0.45, 0.27, 0.035), hv) : mix(vec3(0.5, 0.26, 0.03), vec3(0.42, 0.12, 0.03), max(hv, hue));
  c = mix(c, aut * L, smoothstep(0.55, 0.66, p));
  c = mix(c, vec3(0.16, 0.1, 0.05) * (0.7 + 0.3 * L), smoothstep(0.69, 0.745, p));                          // browning
  if (fruit) {
    // blossom: dense small clusters of petals (two fine scales), pink or white per tree, thinning as the leaves come
    float bn = 0.55 * tnoise3(pos * 16.0 + off * 9.0) + 0.45 * tnoise3(pos * 41.0 + off * 5.0);
    float th = smoothstep(0.05, 0.15, p);
    float bl = smoothstep(0.36 + 0.14 * th, 0.5 + 0.14 * th, bn);
    vec3 bloom = mix(vec3(0.9, 0.5, 0.62), vec3(0.92, 0.84, 0.84), step(0.5, hue)) * (0.75 + 0.25 * L) * (0.85 + 0.3 * tnoise3(pos * 70.0));
    c = mix(c, bloom, bl * 0.9 * (1.0 - smoothstep(0.1, 0.17, p)) * step(p, 0.3));
  }
  return c;
}

// The lit house-scene surface of a G-buffer hit (before aerial perspective). snowMask: snow x sun visibility (0 on wet /
// thawing snow), for the composite sparkle and the flake tint
vec3 shadeSurface(vec2 uv, vec4 g0, vec3 rd, float t, out float snowMask) {
  vec4 g1 = G1(uv), g2 = G2(uv);
  vec4 g3 = floor(G3(uv) * 255.0 + 0.5) / 255.0;    // the 8-bit values, so the RGBA16F fallback shades identically
  vec3 pos = uCamPos + rd * t;
  float mat = floor(g0.y + 0.001);
  bool veg = mat >= M_FRUIT && mat <= M_TREE;
  float shelter = hShelter(g3.a), haze = hHaze(g3.a);
  float ph = uYearPhase;
  snowMask = 0.0;
  // ---- the bare variant's twig haze: colour (bark, whitened by snow, white / pink blossom on the fruit twigs in late
  // February), opacity (density x a fibrous screen noise)
  float tw = 0.0; vec3 twC = vec3(0.0);
  if (haze > 0.004) {
    vec2 sp = hScreen(rd);
    float tn = tnoise(sp * vec2(0.45, 0.3)) * 0.6 + tnoise(sp * 1.3) * 0.4;
    tw = (1.0 - exp(-3.2 * haze)) * (0.7 + 0.45 * tn) * 0.86;          // (stage 2b: a little denser: .78 -> .86, 2.4 -> 3.2)
    float cs0 = cloudShadow(pos);
    twC = vec3(0.1, 0.082, 0.072) * (uSkyAmb * 1.1 + uSunCol * 0.2 * cs0) * (1.0 + 1.8 * sat(houseCover(pos.y, 0.45, pos.xz)));   // (the yard's own snow)
    if (mat == M_FRUIT) twC = mix(twC, vec3(0.8, 0.72, 0.72) * (uSkyAmb + uSunCol * 0.25 * cs0), 0.6 * smoothstep(0.955, 0.985, ph) * smoothstep(0.55, 0.75, tn));
  }
  // haze in front of the sky (the bake's haze surface): the sky with its clouds behind the twigs
  if (veg && g3.g > 0.25 && g3.g < 0.75) return mix(sceneSky(rd, textureLod(uSkyH, uv, 0.0)), twC, tw);
  vec3 nD = octDec(g2.xy), nS = octDec(g2.zw);
  vec3 alb = g1.rgb;
  float snowT = g1.w, ao = g0.w;
  float cs = cloudShadow(pos);
  float sh = g0.z * cs;
  float leafy = veg ? g3.g : 0.0;
  // ---- seasons
  if (mat == M_LAWN) alb = lawnSeason(alb, g3.r, ph);
  else if ((mat == M_FRUIT || mat == M_TREE) && leafy > 0.5) {
    float L = dot(alb, vec3(0.3, 0.6, 0.1)) / 0.075;
    alb = leafSeason(alb, L, ph, g3.b, g3.r, mat == M_FRUIT, pos);
  } else if (mat == M_CYPRESS && leafy > 0.5) {
    alb *= 1.0 - 0.12 * uSeasonW.w;
    // flowering shrubs (G3.r .45 .. .7): lavender in early summer
    float fl = smoothstep(0.6, 0.75, tnoise3(pos * 14.0)) * smoothstep(0.45, 0.5, g3.r) * (1.0 - step(0.75, g3.r)) * smoothstep(0.17, 0.24, ph) * (1.0 - smoothstep(0.34, 0.42, ph));
    alb = mix(alb, vec3(0.22, 0.14, 0.4), fl * 0.7);
    // the perennial bed (G3.r >= .75): fresh in March, in flower from April through the summer (each clump its own
    // colour by G3.b: rose, white, violet, gold, coral), browning in autumn, cut back in winter
    if (g3.r >= 0.75) {
      float bloomT = smoothstep(0.06, 0.13, ph) * (1.0 - smoothstep(0.44, 0.56, ph));
      float hb = g3.b * 5.0;
      vec3 fc = hb < 1.0 ? vec3(0.8, 0.22, 0.38) : hb < 2.0 ? vec3(0.82, 0.8, 0.74) : hb < 3.0 ? vec3(0.34, 0.16, 0.62) : hb < 4.0 ? vec3(0.86, 0.6, 0.08) : vec3(0.86, 0.3, 0.16);
      float cl = smoothstep(0.45, 0.62, tnoise3(pos * 18.0 + g3.b * 40.0)) * smoothstep(0.3, 0.7, nS.y + 0.4);
      alb = mix(alb, fc * (0.8 + 0.4 * tnoise3(pos * 40.0)), cl * bloomT * 0.9);
      alb = mix(alb, vec3(0.1, 0.075, 0.04), smoothstep(0.58, 0.7, ph) * (1.0 - smoothstep(0.93, 1.0, ph)) * 0.75);
    }
  } else if (mat == M_PALM && leafy > 0.5 && g3.r < 0.5) alb *= 1.0 - 0.1 * uSeasonW.w;
  // ---- snow: the shared cover, the per-material threshold, none under the eaves; it thaws like the valley's (sunny
  // patches, the dark roof and the trees first)
  float sunExp = max(dot(nS, uSunDir), 0.0) * (0.8 + 0.2 * g0.z);
  float cEff = houseCover(pos.y, veg ? mix(0.45, sunExp, 0.3) : sunExp, pos.xz);
  float thaw = uMelt * smoothstep(0.0, 3.0, uTemp - H_LAPSE * pos.y);
  snowT += thaw * (mat == M_ROOF ? 0.35 : veg ? 0.4 : (mat == M_ASPHALT || mat == M_CONCRETE) ? 0.3 : 0.22 * (sunExp - 0.45));
  if (mat == M_LAWN) snowT += 0.1 * (tnoise(pos.xz * 2.3 + 1.7) - 0.5) + 0.05 * (tnoise(pos.xz * 7.1) - 0.5);   // ragged melt edges
  float sw2 = mat == M_ASPHALT ? 0.16 : mat == M_ROOF ? 0.07 : 0.05;   // the street: slushy, soft-edged tyre tracks
  float snow = smoothstep(snowT - sw2, snowT + sw2, cEff) * (1.0 - shelter);
  float wetSnow = max(thaw, uWet);
  // ---- wind sheen over the lawn
  if (mat == M_LAWN) {
    vec2 gq = (pos.xz - uGrassDisp.xz) * 0.35;
    alb *= 1.0 + (1.0 - snow) * (tnoise(gq) - 0.5) * (0.12 + 0.2 * uGale) * smoothstep(60.0, 8.0, t);
  }
  // ---- wet: darkening by porosity (sheltered ground stays dry), puddles in the low spots of the hard ground: a darker
  // wet rim, standing water (the ground under it darker still, the surface a flat mirror), rain rings while it rains
  float wet = uWet * (1.0 - shelter);
  bool hard = mat >= M_CONCRETE && mat <= M_GRAVEL;
  float por = mat == M_LAWN ? 0.2 : (mat == M_CONCRETE || mat == M_BRICK || mat == M_SOIL) ? 0.45 : mat == M_ASPHALT ? 0.35
            : mat == M_GRAVEL ? 0.3 : mat == M_ROOF ? 0.4 : (mat == M_SIDING || mat == M_FENCE) ? 0.3 : veg ? 0.15 : 0.1;
  alb *= 1.0 - wet * por * (1.0 - snow);
  // (foliage: lit half on the crown's smooth normal, nS; stage 2b: soft leaf masses, not a lit bump each)
  vec3 n = normalize(mix(nD, nS, max(snow, veg && leafy > 0.5 ? 0.5 : 0.0)));
  // snow on the ground and the roofs is never flat: soft drifts and bumps (~0.5-2 m) catch the low sun on their sunward
  // flanks (warm) and fall into blue shade on the others
  if (snow > 0.01 && nS.y > 0.55) {
    vec2 sq0 = pos.xz * 0.8, sq1 = pos.xz * 2.7 + 5.0;
    float e = 0.12;
    float a0 = tnoise(sq0), a1 = tnoise(sq1);
    vec2 gs = vec2(tnoise(sq0 + vec2(e, 0.0)) - a0, tnoise(sq0 + vec2(0.0, e)) - a0) * 0.8 / e
            + vec2(tnoise(sq1 + vec2(e, 0.0)) - a1, tnoise(sq1 + vec2(0.0, e)) - a1) * 2.7 / e * 0.25 * smoothstep(0.05, 0.015, t * 2.0 * uTanH / uRes.y);
    n = normalize(n - vec3(gs.x, 0.0, gs.y) * 0.16 * snow);
  }
  float puddle = 0.0;
  float fpx = t * 2.0 * uTanH / uRes.y;
  if (hard && mat != M_GRAVEL && g3.g > 0.01 && wet > 0.03) {
    float pn = tnoise(pos.xz * 0.55 + 2.0) * 0.55 + tnoise(pos.xz * 1.7 + 9.0) * 0.3 + tnoise(pos.xz * 5.0) * 0.15;
    float pv = pn + 0.55 * g3.g + 0.45 * wet - 1.27;
    puddle = smoothstep(0.0, 0.05, pv) * (1.0 - snow);
    alb *= 1.0 - 0.3 * smoothstep(-0.1, 0.0, pv) * wet * (1.0 - snow) - 0.25 * puddle;      // wet rim, water depth
    vec2 rg = hRipple(pos.xz, fpx) * smoothstep(0.0, 0.15, uPrecipRain) * (0.3 + 0.7 * puddle);
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0), puddle) + vec3(rg.x, 0.0, rg.y));
  }
  // snow albedo (wet / thawing greyer)
  vec3 snowAlb = vec3(0.86, 0.89, 0.95) * mix(vec3(1.0), vec3(0.8, 0.82, 0.83), wetSnow) * (0.94 + 0.06 * tnoise(pos.xz * 3.0));
  vec3 a = mix(alb, snowAlb, snow);
  // ---- light
  float ndl = dot(n, uSunDir);
  float diff = max(ndl, 0.0);
  if (veg && leafy > 0.5) diff = mix(diff, sat(ndl * 0.6 + 0.4), 0.3);       // foliage: a little wrap
  diff = mix(diff, sat((ndl + 0.18) / 1.18), snow);
  vec3 skyL = uSkyAmb * (0.6 + 0.4 * n.y);
  vec2 sa = normalize(uSunDir.xz);
  skyL += uSunCol * 0.05 * sat(dot(normalize(n.xz + 1e-4), sa)) * (1.0 - abs(n.y)) * (1.0 - uOvercast);   // warm sunward sky
  vec3 bounce = vec3(0.32, 0.26, 0.18) * dot(uSunCol, vec3(0.06)) * sat(0.5 - 0.5 * n.y) * mix(1.0, 2.5, sat(cEff));
  vec3 col = a * (uSunCol * diff * sh + (skyL + bounce) * ao);
  // leaves are translucent: sun through a frond / a leaf mass (its underside or far side glows a little)
  if (veg && leafy > 0.5) col += a * uSunCol * 0.14 * sat(-ndl) * cs * ao * (1.0 - snow);
  col += snow * a * uSkyAmb * vec3(0.1, 0.22, 0.5) * (1.0 - sh) * ao * (1.0 - 0.5 * wetSnow);
  // cozy lights: the porch lantern, the street lamp, the warm spill of the two windows (short range, unshadowed)
  float cz = 0.35 + 1.65 * uCozy;
  vec3 lampC = vec3(1.0, 0.62, 0.3);
  vec3 hp = hsp(pos), hn = hsp(n);
  vec3 pl = hPointL(hp, hn, L_PORCH + vec3(0.0, 0.0, 0.18), lampC * 1.5 * cz, 5.5);
  pl += hPointL(hp, hn, L_POST + vec3(0.0, -0.1, 0.0), lampC * 6.5 * cz, 11.0) * smoothstep(-0.2, 0.3, L_POST.y - 0.1 - hp.y);   // (the cap: no light above the lantern)
  pl += (hPointL(hp, hn, L_WIN0, lampC * 1.0 * cz, 5.0) + hPointL(hp, hn, L_WIN1, lampC * 1.0 * cz, 5.0)) * smoothstep(0.0, 0.6, hp.z - 0.05);
  col += a * pl * ao;
  // ---- glass, lamps, wet reflections
  vec3 hv = normalize(uSunDir - rd);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  bool pane = mat == M_GLASS || (mat == M_GARAGE && g3.b > 0.5);
  if (pane) {
    // Fresnel reflection of the sky over the lit room (G1 = its emission colour): the windows (G3.r 1), the door's oval
    // light (.75), the neighbour's window (.35), the garage door's arched lights
    float glow = mat == M_GARAGE ? 0.25 + 0.6 * uCozy : (0.45 + 2.6 * uCozy) * mix(0.42, 1.0, g3.r);
    col = hSkyR(reflect(rd, n)) * (0.22 + 0.78 * F) * ao + alb * glow * (1.0 - F);
  } else if (mat == M_LAMP && g3.b > 0.5) {
    // frosted lantern glass: brightest in front of the bulb, dimmer toward its frame
    vec3 lc0 = g3.r > 0.7 ? L_POST : L_PORCH;
    vec3 dq = hsp(pos) - lc0;
    float bulb = exp(-(dq.x * dq.x + dq.z * dq.z) / 0.006 - sq(dq.y + 0.03) / 0.02);
    col = alb * (1.2 + 3.6 * uCozy) * mix(0.55, 1.0, g3.r) * (0.45 + 1.1 * bulb);
  } else {
    float gloss = mat == M_LAWN ? 0.05 : mat == M_CONCRETE || mat == M_BRICK ? 0.5 : mat == M_ASPHALT ? 0.7 : mat == M_GRAVEL ? 0.2
                : mat == M_SOIL ? 0.15 : mat == M_ROOF ? 0.55 : mat == M_SIDING ? 0.15 : mat == M_TRIM || mat == M_GARAGE ? 0.3
                : mat == M_FENCE ? 0.12 : mat == M_METAL || mat == M_LAMP ? 0.5 : 0.1;
    // specular: a sun glint, stronger on wet ground (the composite's bloom lifts it)
    float spec = pow(max(dot(n, hv), 0.0), 60.0) * (0.04 + gloss * wet * 0.5) * sh;
    col += uSunCol * spec * (1.0 - snow);
    // wet gloss and puddles mirror the scene (screen-space reflection of the previous frame) or the sky behind it
    float Fs = 0.04 + 0.96 * pow(1.0 - max(dot(nS, -rd), 0.0), 5.0);
    // (damp ground after the rain, or melt water, is dull: the full gloss needs a soaked surface or falling rain)
    float soak = max(smoothstep(0.3, 0.75, uWet), smoothstep(0.0, 0.2, uPrecipRain));
    float k = wet * smoothstep(0.03, 0.12, uWet) * (1.0 - snow) * max(gloss * Fs * 0.9 * soak, puddle * (0.55 + 0.45 * Fs));
    if (k > 0.004) {
      vec3 r = reflect(rd, normalize(mix(nS, n, puddle)));
      float w = 0.0;
      vec3 refl = vec3(0.0);
      if (gloss >= 0.3 || puddle > 0.01) refl = hSSR(pos + nS * 0.03, r, mix(mat == M_ASPHALT ? 2.6 : 1.8, 0.2, puddle) * (mat == M_ROOF ? 1.5 : 1.0), w);   // (the march only on glossy ground and puddles)
      refl = mix(hSkyR(r) * 0.85, refl, w);
      col = mix(col * (1.0 - 0.5 * puddle), refl, k);
    }
  }
  // ---- drips from the front gutter while it rains: thin falling drops in front of the facade (house space z .66),
  // catching the warm light of the windows and the porch lantern
  if (uPrecipRain > 0.02 && houseCover(0.0, 0.45, pos.xz) < 0.5) {
    vec3 ro = hsp(uCamPos), rh = hsp(rd);
    float td = (0.66 - ro.z) / rh.z;
    vec3 pd = ro + rh * td;
    if (td > 0.0 && td < t && pd.x > -2.8 && pd.x < 11.3 && pd.y > 0.05 && pd.y < 2.5) {
      float cx = floor(pd.x / 0.21), hx = hash2(vec2(cx, 3.1));
      if (hx > 0.45) {
        float fall = fract(uTime * (0.55 + 0.4 * hash2(vec2(cx, 7.7))) + hx * 5.0);
        float y = 2.5 - 9.0 * fall * fall;                                         // free fall from the gutter
        float dx = abs(pd.x - (cx + 0.2 + 0.6 * hash2(vec2(cx, 1.9))) * 0.21);
        float wd = max(0.004, 0.6 * fpx);
        float dr = smoothstep(wd, 0.0, dx) * smoothstep(0.0, 0.03, pd.y - y) * smoothstep(0.24, 0.0, pd.y - y) * (1.0 - smoothstep(0.85, 1.0, fall));
        vec3 dl = uSkyAmb * 0.5 + vec3(1.0, 0.62, 0.3) * cz * (0.35 + 0.8 * exp(-0.5 * min(sq(pd.x - L_WIN0.x), sq(pd.x - L_WIN1.x))) + 0.6 * exp(-2.0 * sq(pd.x - L_PORCH.x)));
        col = mix(col, dl, dr * 0.75 * smoothstep(0.02, 0.2, uPrecipRain));
      }
    }
  }
  // ---- the bare variant's twig haze in front of this surface
  col = mix(col, twC, tw);
  snowMask = snow * g0.z * smoothstep(0.5, 0.95, cs) * (1.0 - wetSnow) * (1.0 - tw);
  return col;
}

// ?view= debug channels (uView, S.VIEWS), as SURFACE's: albedo, snowT (grey 0..1, red < 0, blue > 1), the four G3
// channels, the effective cover, wetness
vec3 dbgSignedH(float v) { return v < 0.0 ? vec3(1.0, 0.25, 0.2) * min(-v, 1.0) + vec3(0.15) : v > 1.0 ? vec3(0.2, 0.35, 1.0) * min(v - 1.0, 1.0) + vec3(0.3) : vec3(v); }
vec3 surfaceDebug(int view, vec2 uv, vec4 g0, vec3 rd, float t) {
  vec4 g1 = G1(uv), g3 = G3(uv);
  if (view == 1) return pow(clamp(g1.rgb, 0.0, 1.0), vec3(1.0 / 2.2));
  if (view == 2) return dbgSignedH(g1.w);
  if (view == 3) return vec3(g3.r);
  if (view == 4) return vec3(g3.g);
  if (view == 5) return vec3(g3.b);
  if (view == 6) return vec3(g3.a);
  vec3 pos = uCamPos + rd * t;
  if (view == 7) return dbgSignedH(houseCover(pos.y, max(dot(octDec(G2(uv).zw), uSunDir), 0.0) * (0.8 + 0.2 * g0.z), pos.xz));
  return vec3(sat(uWet)) * (1.0 - hShelter(g3.a));
}
`;
  S.glsl.progs['shade@house'] = { vs: ['VS_FULL'], fs: ['COMMON', 'ENV', 'ATMOS', 'GBUF', 'HOUSE_IDS', 'SURFACE_HOUSE', 'VEIL', 'HAZARD', 'FS_SHADE'] };

  // ---- COMP_HOUSE: the house's composite step (post.js FS_COMP_SCENE declares sceneComp and calls it on the linear HDR
  // frame, after the sparkle, before the exposure; this chunk follows it, so it reads FS_COMP's uExposure / uGrade;
  // program 'comp@house', scenes/house.js progs.comp):
  //  - light in the evening air: the street lamp, the porch lantern and the two windows scatter in the mist, rain or
  //    falling snow around them (an analytic single-scattering integral of each light along the view ray up to the
  //    G-buffer depth: a lamp never glows through a wall; over the sky too, which the shading pass cannot reach);
  //  - golden highlights: the brightest pixels (sunlit clouds, sunlit snow and trim) keep their warm hue through the
  //    ACES shoulder instead of washing out to white (a chroma lift that grows with the exposed luminance).
  //  uHouseComp (derive/house.js): x the air's scattering density (1/m), y the golden highlights 0..1, z the halo gain,
  //  w unused. uCozy as SURFACE_HOUSE's (the lights' strength).
  C.COMP_HOUSE = `
uniform float uCozy;         // 0..1 window / porch / lamp light (derive/house.js)
uniform vec3 uGrassDisp;     // the integrated wind displacement (m; derive/surface.js): the mist wisps drift with it
uniform vec4 uHouseComp;     // x air scattering (1/m), y golden highlights 0..1, z halo gain, w unused
uniform vec4 uHouseSky;      // the golden-hour sky (derive/house.js; as SURFACE_HOUSE's): the reveal backdrop's gradient
float hAces(float x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hAcesInv(float y) { y = clamp(y, 0.0, 0.985); float a = 2.51 - 2.43 * y, b = 0.03 - 0.59 * y; return (-b + sqrt(b * b + 0.56 * a * y)) / (2.0 * a); }
// the light of a point light (world position lp, intensity li) scattered toward the camera by the air along the view
// ray o + rd s, s in [0, T] (single scattering). Away from the light (more than ~20 deg off it) the closed-form
// integral of 1 / r^2 with a mean phase; near it (fwd) the forward-peaked phase of droplets matters (the glow hugs the
// lamp): sampled in the angle u seen from the light (s = b + h tan u: the 1/r^2 falloff cancels, 6 samples cover the
// ray evenly), with the extinction on both legs
vec3 hHalo(vec3 o, vec3 rd, float T, vec3 lp, vec3 li, float sig, bool fwd) {
  vec3 v = lp - o; float dl = length(v), b = dot(v, rd); float h = sqrt(max(dl * dl - b * b, 0.0144));
  float u0 = -atan(b / h), u1 = atan((T - b) / h);
  float iso = 0.17 * (u1 - u0) / h * exp(-sig * (max(b, 0.0) + h));
  float near = fwd ? smoothstep(0.9, 0.95, b / dl) : 0.0;
  if (near <= 0.0) return li * sig * iso;
  float du = (u1 - u0) / 6.0, acc = 0.0;
  for (int i = 0; i < 6; i++) {
    float u = u0 + (float(i) + 0.5) * du, cu = cos(u);
    float s = b + h * sin(u) / cu, r = h / cu;
    float ct = -dot(o + rd * s - lp, rd) / r;                  // cos of the scattering angle (1: straight on)
    float x = 1.5625 - 1.5 * ct;
    acc += (0.045 + 0.2406 / (x * sqrt(x))) * exp(-sig * (s + r));   // isotropic + HG g .75 (x 4 pi)
  }
  return li * sig * mix(iso, acc * du / h, near);
}
// (stage 2b) the reveal backdrop (post.js FS_COMP_SCENE): a scene switch / first load shows the house's own evening sky
// (its golden gradient, or ATMOS's sky under a deck) with a soft mist low down, graded like the frame, instead of a flat
// pale screen; the scene then rises into it behind the bake's progress edge
vec3 sceneReveal(vec2 frag) {
  vec3 rd = camRay(frag);
  float y = clamp(rd.y, 0.0, 1.0);
  vec3 s = skyColor(normalize(vec3(rd.x, max(rd.y, 0.0), rd.z)));
  if (uHouseSky.x > 0.0) {
    float sw = smoothstep(-0.95, 0.25, dot(normalize(rd.xz + vec2(1e-5)), normalize(uSunDir.xz)));
    vec3 g = mix(uSkyHor, uSkyZen, 1.0 - exp(-uHouseSky.y * (y + 0.012)));
    g = mix(g, uHorBand, sat(exp(-y / mix(0.075, 0.14, sw)) * uHouseSky.z * (0.6 + 0.4 * sw)));
    s = mix(s, g, uHouseSky.x);
  }
  s = mix(s, uFogCol, 0.5 * smoothstep(0.03, -0.1, rd.y));
  return pow(aces(s * uExposure * uGrade), vec3(1.0 / 2.2));
}
vec3 sceneComp(vec3 c, vec2 uv, vec2 frag) {
  vec3 rd = camRay(frag);
  float T = min(G0(uv).x, 400.0);
  float sig = uHouseComp.x, cz = uCozy;
  // fog days: drifting wisps of street mist (thicker and thinner patches of the ground fog, a few metres high,
  // creeping with the wind) in front of whatever the pixel shows
  if (uFogDay > 0.01) {
    float acc = 0.0;
    for (int i = 0; i < 5; i++) {
      float s = 4.0 * pow(1.8, float(i));
      if (s > T) break;
      vec3 p = uCamPos + rd * s;
      vec3 q = vec3(p.x * 0.09, p.y * 0.22, p.z * 0.09) + vec3(uGrassDisp.x, 0.0, uGrassDisp.z) * 0.03 + vec3(0.0, 0.0, uTime * 0.004);
      float w = smoothstep(0.42, 0.78, tnoise3(q) * 0.7 + tnoise3(q * 2.3 + 5.1) * 0.3) * exp(-max(p.y, 0.0) / 5.0);
      acc += w * min(s, T - s * 0.44) * 0.012;
    }
    float a = (1.0 - exp(-acc)) * smoothstep(0.0, 0.6, uFogDay);
    c = mix(c, mix(uFogCol, vec3(dot(uFogCol, vec3(0.33))), 0.35) * 1.02, a);
  }
  if (sig > 0.002 && uHouseComp.z > 0.0) {      // (clear evening air: no visible halo, no cost)
    vec3 lc = vec3(1.0, 0.6, 0.28) * uHouseComp.z / 12.566;
    vec3 hl = hHalo(uCamPos, rd, T, hsp(L_POST), lc * 2.2 * (0.25 + 0.75 * cz), sig, true);
    hl += hHalo(uCamPos, rd, T, hsp(L_PORCH + vec3(0.0, 0.0, 0.25)), lc * 0.6 * cz, sig, true);
    hl += (hHalo(uCamPos, rd, T, hsp(L_WIN0 + vec3(0.0, 0.0, 0.6)), lc, sig, false) + hHalo(uCamPos, rd, T, hsp(L_WIN1 + vec3(0.0, 0.0, 0.6)), lc, sig, false)) * 0.5 * cz;
    c += hl * smoothstep(0.002, 0.004, sig);
  }
  // golden highlights: the per-channel ACES of FS_COMP washes bright warm light (sunlit clouds, trim, snow, the lamps)
  // to white. Here the brightest pixels are mapped hue-preserving instead (their luminance through ACES, the colour
  // kept: where a channel would clip, mostly scaled down, partly whitened), pre-inverted through ACES so that FS_COMP's
  // exposure, white balance and ACES land on that colour; blended in by the exposed luminance (mid-tones untouched)
  float E = uExposure;
  vec3 ce = c * E * uGrade;
  float Y = dot(ce, vec3(0.2126, 0.7152, 0.0722));
  float k = uHouseComp.y * smoothstep(0.3, 1.2, Y);
  if (k > 0.001) {
    float Yt = hAces(Y);
    vec3 T = ce * (Yt / max(Y, 1e-4));
    float m = max(T.r, max(T.g, T.b));
    if (m > 0.97) T = mix(T * (0.97 / m), vec3(Yt) + (T - vec3(Yt)) * max((0.97 - Yt) / max(m - Yt, 1e-4), 0.0), 0.35);   // mostly keep the hue (a little dimmer), partly whiten
    vec3 ci = vec3(hAcesInv(T.r), hAcesInv(T.g), hAcesInv(T.b)) / (E * uGrade);
    c = mix(c, ci, k);
  }
  return c;
}
`;
  S.glsl.progs['comp@house'] = { vs: ['VS_FULL'], fs: ['COMMON', 'ENV', 'ATMOS', 'GBUF', 'HOUSE_IDS', 'HAZARD', 'FS_COMP_SCENE', 'COMP_HOUSE'] };
})(window.SNOW);
