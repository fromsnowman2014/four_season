// =====================================================================================
//  GLSL: SURFACE chunk (stage-1 owner: lane D). The per-frame ground: the snow cover model (effectiveCover and
//  snowCover: the ONE place the cover level and the altitude snowline become a per-pixel snow fraction), the
//  seasons of the season-neutral bake (grass, wildflowers, larch, spruce), thaw and wet snow, wet ground and
//  puddles, the wind-packed snow relief, and shadeSurface, the lit surface colour of a G-buffer hit that the shading
//  pass calls. Also surfaceDebug for the ?view= channels. Needs COMMON + ENV + ATMOS (cloudShadow) + GBUF. Included
//  by the shading pass only: the composite sparkle and the flake colour-over-snow read the snow fraction that
//  FS_SHADE writes to the scene alpha (snow x sun visibility), so they never recompute cover.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  // The snowline offset model, shared by the GLSL effectiveCover below and its JS twin S.snowlineOffset (used by
  // derive/surface.js for visCover / coverAt and through it by derive/atmos.js for the exposure): both are built from
  // these constants, so the CPU estimate of the visible snow cannot drift from what the shader draws. The JS twin
  // omits only the per-pixel aspect / noise shift of the altitude.
  //   offset(a) = K (1 - smooth(line - w, line + w, a)) + K2 (1 - smooth(line - LO, line - HI, a))
  const SL = { K: 0.9, K2: 1.3, LO: 1600, HI: 500 };
  const f = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  S.snowlineOffset = (a, line, w) => SL.K * (1 - S.smooth(line - w, line + w, a)) + SL.K2 * (1 - S.smooth(line - SL.LO, line - SL.HI, a));
  S.SNOWLINE = SL;            // Phase 3: the house's cover model (glsl/house/surface-house.js, loaded after this file) uses the same constants
  C.SURFACE = `
uniform vec3 uGrassDisp;     // integrated (slow) wind displacement -> rolling grass waves, wrapped by its noise period on the CPU
uniform float uYearPhase;    // year phase 0..1 (0 = 1 March): the vegetation clock
uniform float uMelt;         // 0..1: 1 while no snow is falling (then thaw order and wet snow follow the local air temperature)

// ---- snow cover model
// The per-frame altitude snowline: below uSnowline.x (+- uSnowline.y) the cover level drops by SNOWLINE_K, so the lower
// slopes go bare while the high ground (the lowest snowT: summit flats, ledges, couloirs) keeps its snow; a further
// SNOWLINE_K2 0.5-1.6 km below the line clears even those. The altitude is shifted by the sun exposure (the line sits up
// to ~300 m higher on sunny slopes than on shaded ones) and a ~1.5 km undulation, so it follows the relief and the
// threshold patches instead of a contour. The neutral default (a snowline far below the scene) gives an offset of
// exactly 0: the Phase-1 cover. snowT itself stays the baked, season-neutral order.
const float SNOWLINE_K = ${f(SL.K)}, SNOWLINE_K2 = ${f(SL.K2)};   // = SL in JS (S.snowlineOffset)
const float LAPSE = 0.0065;  // deg C per m; uTemp is the meadow's (at ~0 m)
float effectiveCover(float alt, float sunExp, vec2 xz) {
  float a = alt - 320.0 * (sunExp - 0.45) + 260.0 * (tnoise(xz * 0.0006 + 3.7) - 0.5);
  return uCover - SNOWLINE_K * (1.0 - smoothstep(uSnowline.x - uSnowline.y, uSnowline.x + uSnowline.y, a))
                - SNOWLINE_K2 * (1.0 - smoothstep(uSnowline.x - ${f(SL.LO)}, uSnowline.x - ${f(SL.HI)}, a));
}
// snow fraction of a pixel with threshold snowT at distance t for the effective cover cEff. The ramp is tight
// (+-0.025) on the resolved meadow so margins break at the tuft scale of the threshold field, wide (+-0.07) only
// where the far canopy / summit thresholds are unresolved means
float snowCover(float snowT, float cEff, float t) {
  float cw = mix(0.025, 0.07, smoothstep(1200.0, 2600.0, t));
  return smoothstep(snowT - cw, snowT + cw, cEff);
}

// wind-packed snow surface: dunes elongated along the prevailing (+x) wind, big drifts on the far slopes
// and sastrugi ripples near the camera. Its xz gradient tilts the shading normal so full cover shows form
// instead of a flat white fill; each scale fades out before it would alias
float driftH(vec2 p, float t) {
  // dune axis ~30 deg off the sun azimuth (which is also the wind line), so the flanks catch the low sun
  vec2 d = vec2(p.x * 0.866 - p.y * 0.5, p.x * 0.5 + p.y * 0.866);
  vec2 q = vec2(d.x * 0.06, d.y * 0.15);                                                        // dunes ~17 x 7 m
  float h = (tnoise(q + 3.0) + 0.5 * tnoise(q * 2.2 + 9.0)) * 6.0 * smoothstep(7000.0, 400.0, t);
  h += tnoise(vec2(p.x * 0.012, p.y * 0.02) + 1.0) * 16.0 * smoothstep(16000.0, 1500.0, t);       // drifts ~80 x 50 m
  h += tnoise(vec2(d.x * 0.45, d.y * 1.2) + 5.0) * 0.45 * smoothstep(1400.0, 120.0, t);          // sastrugi ~2 m
  return h;
}

// ---- seasons. pS / pA: the year phase as the vegetation at this altitude lives it, for the spring and the autumn
// events (spring arrives later and autumn earlier with height). Every recolour keeps the bake's texture (mottle, tufts,
// crowns, shading): the larch is a ratio to its baked summer reference, the grass keeps the baked luminance.
// Grass through the year, from the baked summer pasture b (G1) and its moisture m (G3.a: 0 dry rib .. 1 lush hollow).
// The baked luminance relative to the mean pasture (0.097) carries the texture; the season sets the colour of a mean
// pixel: dormant straw / grey-brown -> spring flush (light fresh green; moist ground first, where the snow lay longest,
// i.e. low snowT, later) -> high-summer deep green -> late summer: the baked (Phase-1) pasture, olive with pale ribs, the dry
// ribs turning gold -> autumn tawny / amber / ochre (olive-russet in the hollows, ~250 m drifts of hue) -> dormant
// again. hv: the hue-drift noise 0..1
vec3 grassSeason(vec3 b, float m, float pS, float pA, float hv) {
  float L = dot(b, vec3(0.3, 0.6, 0.1)) / 0.097;
  float dry = 1.0 - m;
  vec3 dorm = mix(vec3(0.074, 0.062, 0.042), vec3(0.13, 0.102, 0.06), dry);
  // the natural alpine palette (stage 2b, after the reference photo): yellow-olive, never lime. Spring is a light,
  // fresh yellow-green (moist ground a touch greener); summer is deeper: lush, darker olive-green hollows against
  // sun-bleached yellow-olive ribs; hv drifts the hue over ~250 m (greener / yellower swathes)
  vec3 spM = vec3(0.086, 0.11, 0.032), spD = vec3(0.124, 0.134, 0.042);
  vec3 suM = vec3(0.047, 0.071, 0.018), suD = vec3(0.134, 0.128, 0.027);
  vec3 drift = mix(vec3(0.95, 1.0, 1.05), vec3(1.07, 1.0, 0.9), hv);
  // the flush is quick at each spot (moist ground first): patches of new green among last year's straw, not a muddy blend
  vec3 c = mix(dorm, mix(spM, spD, dry) * drift, smoothstep(0.07, 0.15, pS + 0.06 * (m - 0.5)));
  c = mix(c, mix(suM, suD, smoothstep(0.1, 0.9, dry)) * drift, smoothstep(0.23, 0.35, pS));
  c = mix(c, b / max(L, 0.05), smoothstep(0.38, 0.47, pA));
  c = mix(c, vec3(0.17, 0.128, 0.042), smoothstep(0.4, 0.52, pA) * smoothstep(0.25, 0.75, dry));
  vec3 tawny = mix(vec3(0.16, 0.1, 0.034), vec3(0.17, 0.084, 0.032), hv);     // ochre-tawny .. rust-amber drifts
  c = mix(c, mix(vec3(0.075, 0.072, 0.032), tawny, smoothstep(0.2, 0.7, dry)), smoothstep(0.48, 0.6, pA));
  c = mix(c, dorm, smoothstep(0.64, 0.8, pA));
  return c * L;
}
// larch through the year (absolute albedo; LARCH_REF is the baked summer crown, = gbuf-materials): bare grey-brown
// twigs -> bright lime flush -> soft summer green -> autumn gold deepening to orange -> needles drop
const vec3 LARCH_REF = vec3(0.075, 0.10, 0.034);
vec3 larchSeason(float pS, float pA) {
  vec3 bare = vec3(0.09, 0.08, 0.062);
  vec3 c = mix(bare, vec3(0.13, 0.2, 0.033), smoothstep(0.07, 0.16, pS));
  c = mix(c, LARCH_REF, smoothstep(0.17, 0.3, pS));
  c = mix(c, vec3(0.36, 0.17, 0.018), smoothstep(0.52, 0.6, pA));
  c = mix(c, vec3(0.34, 0.11, 0.014), 0.6 * smoothstep(0.61, 0.69, pA));
  return mix(c, bare, smoothstep(0.69, 0.77, pA));
}
float larchLeaf(float pS, float pA) { return smoothstep(0.07, 0.16, pS) * (1.0 - smoothstep(0.69, 0.77, pA)); }
// two independent value noises from one fetch of uNoise (G = A(x, y), R = A(x + 37, y + 17); COMMON's tnoise reads G)
vec2 tnoise2(vec2 x) { vec2 p = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return textureLod(uNoise, (p + f + 0.5) / 256.0, 0.0).gr; }
// wildflowers on the grass: crocus at the fresh melt margin in early spring, then the meadow bloom of late spring /
// early summer (buttercup yellow, daisy / umbellifer white, salvia purple, bellflower / gentian blue) in drifts.
// Every noise is >= 3 m (the half-float position error is <= 0.25 m on the meadow), and beyond ~1.2 km the 3 m tufts
// average into a colour wash: a tint of the pasture, never confetti
vec3 flowers(vec3 alb, vec2 q, float t, float pS, float m, float flat_, float margin) {
  float crocus = smoothstep(0.0, 0.05, pS) * (1.0 - smoothstep(0.12, 0.19, pS)) * (0.25 + 0.75 * margin);
  float bloom = smoothstep(0.12, 0.2, pS) * (1.0 - smoothstep(0.33, 0.43, pS));
  float b = max(crocus, bloom), bf = b * flat_;
  if (bf < 0.004) return alb;
  vec2 dr = tnoise2(q * 0.017 + 3.0);                                                    // ~60 m drifts: x species, y density
  float sp = dr.x, patchN = tnoise(q * 0.06 + 13.0) * 0.6 + dr.y * 0.4;                  // ~17 m tufts in the drifts
  float speck = t < 1500.0 ? mix(0.5, tnoise(q * 0.33 + 7.0), smoothstep(1500.0, 900.0, t)) : 0.5;   // 3 m clumps (mean far away)
  float vio = smoothstep(0.56, 0.64, sp), wht = smoothstep(0.38, 0.5, sp) * (1.0 - vio);
  vec3 fc = mix(vec3(0.6, 0.44, 0.03), vec3(0.5, 0.48, 0.4), wht);
  fc = mix(fc, mix(vec3(0.24, 0.06, 0.36), vec3(0.13, 0.08, 0.42), smoothstep(0.68, 0.8, sp)), vio);   // salvia .. bellflower
  float cw = crocus / b;
  fc = mix(fc, mix(vec3(0.36, 0.22, 0.56), vec3(0.55, 0.52, 0.56), smoothstep(0.4, 0.6, sp)), cw);   // violet / white crocus
  // a soft stipple, not paint: the clumps modulate the drift's cover instead of cutting it out (violets: looser)
  float f = bf * smoothstep(0.38, 0.8, patchN) * mix(0.25, 1.0, smoothstep(mix(0.2, 0.4, vio), mix(0.8, 0.9, vio), speck)) * (0.55 + 0.45 * m);
  return mix(alb, fc, 0.3 * f * mix(1.0 - 0.3 * wht, 1.0, cw));
}

// The lit surface of a G-buffer hit (before aerial perspective): seasons, snow coverage, cloud shadows, grass sheen and
// the matted turf at the melt margin, wet ground, snow relief, sun / sky / bounce lighting, the snow's shade glow and
// sheen, and the wet gloss / puddles. uv is the (sway-remapped) G-buffer coordinate, g0 its G0, rd the view ray, t the
// hit distance. snowMask: the snow fraction x the sun visibility (baked shadow x cloud shadow), 0 on wet / thawing
// snow; written to the scene alpha for the composite sparkle and the flake tint
vec3 shadeSurface(vec2 uv, vec4 g0, vec3 rd, float t, out float snowMask) {
  vec4 g1 = G1(uv), g2 = G2(uv);
  vec4 g3 = floor(G3(uv) * 255.0 + 0.5) / 255.0;    // the 8-bit values, so the RGBA16F fallback shades identically
  vec3 pos = uCamPos + rd * t;
  vec3 nD = octDec(g2.xy), nS = octDec(g2.zw);
  float mat = floor(g0.y + 0.001);
  float grass = mat == 1.0 ? fract(g0.y + 0.001) / 0.9 : 0.0;
  vec3 alb = g1.rgb;
  float snowT = g1.w;
  float ao = g0.w;
  float cs = cloudShadow(pos);
  float sh = g0.z * cs;
  // the vegetation clock here: ~0.1 yr (5 weeks) per km of height above the meadow
  float dly = 1e-4 * pos.y, pS = uYearPhase - dly, pA = uYearPhase + dly;
  float leaf = 1.0;                                // larch foliage (0 = bare twigs)
  if (mat == 2.0) {
    if (g3.b > 0.5) {
      alb *= larchSeason(pS, pA) / LARCH_REF;
      leaf = larchLeaf(pS, pA);
      snowT += 0.12 * (1.0 - leaf);                // bare twigs hold less snow
    } else alb *= 1.0 - 0.15 * uSeasonW.w;         // spruce / fir: a shade darker in winter
  } else if (mat == 1.0) {
    float hv = tnoise(pos.xz * 0.004 + 1.3);
    alb = mix(alb, grassSeason(alb, g3.a, pS - 0.1 * (0.55 - clamp(snowT, -0.5, 1.2)), pA, hv), grass);
    if (g3.b > 0.004) alb *= 1.0 + g3.b * (larchSeason(pS, pA) / LARCH_REF - 1.0);   // the larch share of the far canopy
  }
  // snow: the sun exposure lifts the snowline on sunny slopes (trees: their crown aspect only weakly); while it thaws
  // (no snowfall, air above 0 deg C at this altitude) sunny patches melt out first and shaded ones linger, and the
  // dark roofs and the trees shed theirs early. The exposure is the slope's aspect with the cast shadow only in part: the sun
  // moves over the day, so a tree's crisp afternoon shadow must not print a snow strip of its own shape
  float sunExp = max(dot(nS, uSunDir), 0.0) * (0.8 + 0.2 * g0.z);
  float cEff = effectiveCover(pos.y, mat == 2.0 ? mix(0.45, sunExp, 0.3) : sunExp, pos.xz);
  float thaw = uMelt * smoothstep(0.0, 3.0, uTemp - LAPSE * pos.y);
  snowT += thaw * (mat == 4.0 ? 0.35 : mat == 2.0 ? 0.4 : 0.22 * (sunExp - 0.45));
  float snow = snowCover(snowT, cEff, t);
  float wetSnow = max(thaw, uWet);
  // wind waves rolling over the grass (brightness sheen travelling with the wind); short dormant turf barely moves
  vec2 gq = (pos.xz - uGrassDisp.xz * 1.0) * 0.045;
  float wave = tnoise(gq) * 0.65 + tnoise(gq * 2.7 + 5.0) * 0.35;
  float tall = mix(0.4, 1.0, smoothstep(0.1, 0.25, pS) * (1.0 - smoothstep(0.66, 0.8, pA)));
  alb *= 1.0 + grass * (1.0 - snow) * (wave - 0.5) * (0.22 + 0.25 * uGale) * tall * smoothstep(3000.0, 300.0, t);   // stronger in a gale
  // the melt margin: as the snow edge closes in on a patch (or has just left it) the turf is matted, flattened
  // straw-olive; further out the season's colour (green-up) takes over. Crocus bloom right along it
  // (stage 2b: a narrower margin, so the first snowfall on a tawny meadow leaves the meadow tawny between the patches
  // instead of greying all of it long before the snow arrives)
  float kill = smoothstep(snowT - 0.3, snowT, cEff);
  alb = mix(alb, vec3(dot(alb, vec3(0.3, 0.5, 0.2))) * vec3(1.08, 0.97, 0.72) * 0.8, grass * 0.7 * kill);
  if (mat == 1.0) alb = flowers(alb, pos.xz, t, pS, g3.a, grass * smoothstep(0.85, 0.97, nS.y), kill * (1.0 - snow));
  // wet ground darkens by porosity: path / bare soil most, rock, then turf; trees and walls a little, roofs more
  float por = mat == 1.0 ? min(0.62 * g3.g + 0.3 * g3.r + 0.18 * grass, 0.62) : mat == 4.0 ? 0.4 : 0.1;
  alb *= 1.0 - uWet * por;
  // wet turf is deeper and richer (water fills the gaps between the blades: less grey scatter)
  alb = mix(vec3(dot(alb, vec3(0.3, 0.6, 0.1))), alb, 1.0 + 0.4 * uWet * grass);
  vec3 n = normalize(mix(nD, nS, snow * 0.3));
  if (mat == 1.0 && snow > 0.001) {
    float e = max(0.4, t * 0.0015);
    float h0 = driftH(pos.xz, t);
    vec2 gr = vec2(driftH(pos.xz + vec2(e, 0.0), t) - h0, driftH(pos.xz + vec2(0.0, e), t) - h0) / e;
    n = normalize(n + vec3(-gr.x, 0.0, -gr.y) * snow);
  }
  // snow albedo: wet / thawing snow is greyer (melt water fills the pores) and smoother, its thinning rim slushy grey
  float slush = thaw * smoothstep(0.22, 0.0, cEff - snowT);
  vec3 snowAlb = vec3(0.84, 0.88, 0.94) * (mat == 2.0 ? 0.9 : 1.0) * mix(vec3(1.0), vec3(0.8, 0.82, 0.83), wetSnow) * (1.0 - 0.22 * slush);
  vec2 rq = pos.xz * vec2(0.09, 0.3);
  snowAlb *= 0.93 + 0.07 * tnoise(rq + vec2(rq.y * 0.4, 0.0)) * smoothstep(1500.0, 200.0, t) * (1.0 - 0.6 * wetSnow);  // wind-packed ripples
  vec3 a = mix(alb, snowAlb, snow);
  float ndl = dot(n, uSunDir);
  float wrap = 0.18 * snow;
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 skyL = uSkyAmb * (0.62 + 0.38 * n.y);
  vec3 bounce = vec3(0.2, 0.22, 0.12) * dot(uSunCol, vec3(0.1)) * (0.5 - 0.5 * n.y) * mix(1.0, 3.0, sat(cEff));
  // needle canopy translucency; thin golden / lime larch needles glow on their shaded side
  if (mat == 2.0) diff = diff * 0.75 + (0.1 + 0.4 * g3.b * leaf * (1.0 - snow)) * clamp(-ndl, 0.0, 1.0);
  vec3 col = a * (uSunCol * diff * sh + (skyL + bounce) * ao);
  // snow: blue-tinted subsurface glow in shade, soft sheen (the sparkles are added in the composite, after FXAA)
  col += snow * a * uSkyAmb * vec3(0.12, 0.26, 0.58) * (1.0 - sh) * ao * (1.0 - 0.5 * wetSnow);   // blue sky-lit shade (dry snow)
  vec3 hv = normalize(uSunDir - rd);
  float nh = max(dot(n, hv), 0.0);
  col += snow * uSunCol * sh * (0.05 * pow(nh, 18.0) + 0.04 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0) + 0.12 * wetSnow * pow(nh, 60.0));
  // wet gloss: a water film on the path, rock and roofs reflects the sky (Fresnel, a cheap sky gradient; rays that
  // leave low see the dark slopes instead). Puddles collect in the flat stretches of the path: flat mirrors that
  // spread as the ground gets wetter, and dry back as uWet falls
  // (from wetness .03, faded in to .08: a barely damp meadow pays nothing for the gloss)
  if (uWet > 0.03) {
    float gloss = mat == 1.0 ? 0.95 * g3.g + 0.5 * g3.r + 0.05 * grass : mat == 4.0 ? 0.6 : 0.04;
    float pud = 0.0;
    if (g3.g > 0.02) {
      // ~2.2 m pools in ~7 m ruts, gathered on ~20 m wet stretches of the track
      vec2 pq = pos.xz;
      float pn = tnoise(pq * 0.45 + 2.0) * 0.45 + tnoise(pq * 0.15 + 9.0) * 0.3 + tnoise(pq * 0.05 + 4.0) * 0.25;
      pud = g3.g * smoothstep(0.955, 0.985, nS.y) * smoothstep(0.0, 0.06, pn - 1.0 + 0.5 * uWet);
    }
    vec3 nw = normalize(mix(nD, nS, 0.5 + 0.5 * pud));
    vec3 r = reflect(rd, nw);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(nw, -rd), 0.0), 5.0);
    // (the sky seen in the water: the luminous deck is brighter than its zenith colour suggests, so the wet path,
    // the rocks, the roofs and the puddles glisten)
    vec3 skyR = mix(uSkyHor, uSkyZen, sqrt(sat(r.y))) * mix(0.35, 1.35, smoothstep(0.0, 0.25, r.y));
    // (a puddle is a mirror of the bright deck even at this grazing view: at least ~35% of the sky, so it reads light
    // against the dark wet ground)
    float k = uWet * smoothstep(0.03, 0.08, uWet) * (1.0 - snow) * max(gloss * F, pud * (0.35 + 0.65 * F));
    col = mix(col * (1.0 - 0.5 * pud * uWet), skyR, k);       // a puddle hides the mud under dark water
  }
  // sun visibility for the sparkle: the baked sun shadow and the drifting cloud shadows; wet snow does not glint
  snowMask = snow * g0.z * smoothstep(0.5, 0.95, cs) * (1.0 - wetSnow);
  return col;
}

// ?view= debug channels (uView, S.VIEWS): display-ready colour (the composite passes it through ungraded). Scalars
// are grey; snowT and cEff show 0..1 as grey, below 0 red (snowy at no cover), above 1 blue (bare at full cover)
vec3 dbgSigned(float v) { return v < 0.0 ? vec3(1.0, 0.25, 0.2) * min(-v, 1.0) + vec3(0.15) : v > 1.0 ? vec3(0.2, 0.35, 1.0) * min(v - 1.0, 1.0) + vec3(0.3) : vec3(v); }
vec3 surfaceDebug(int view, vec2 uv, vec4 g0, vec3 rd, float t) {
  vec4 g1 = G1(uv), g3 = G3(uv);
  if (view == 1) return pow(clamp(g1.rgb, 0.0, 1.0), vec3(1.0 / 2.2));
  if (view == 2) return dbgSigned(g1.w);
  if (view == 3) return vec3(g3.r);
  if (view == 4) return vec3(g3.g);
  if (view == 5) return vec3(g3.b);
  if (view == 6) return vec3(g3.a);
  vec3 pos = uCamPos + rd * t;
  if (view == 7) return dbgSigned(effectiveCover(pos.y, max(dot(octDec(G2(uv).zw), uSunDir), 0.0) * (0.8 + 0.2 * g0.z), pos.xz));
  return vec3(sat(uWet)) * (0.4 + 0.6 * min(0.75 * g3.g + 0.4 * g3.r, 1.0));   // wetness x gloss potential
}
`;
})(window.SNOW);
