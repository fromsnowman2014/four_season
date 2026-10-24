// =====================================================================================
//  GLSL: HAZARD chunk (Phase-3 owner: lane Z, hazards). The natural-hazard hooks the frozen glue calls, and their
//  uniforms (set by js/derive/events.js from js/sim/events.js; neutral defaults in core.js S.F / derive/events.js).
//  Every hook sits behind a uniform branch on its hazard's own uniforms and returns its input unchanged (bit for bit)
//  while that hazard is off: with no hazard running every pass draws exactly the Phase-2 image (tests/hazards.mjs,
//  tests/scenes.mjs). Included by the sky, shade and composite programs of every scene, right before their FS_* glue
//  (after COMMON, ENV, ATMOS, GBUF and, in the shade programs, the scene's surface chunk), so a hook may use the camera,
//  the light, the atmosphere and the G-buffer. Scene-dependent behaviour goes through uniforms (derive/events.js knows
//  S.sceneId): uCrackQ.w is the scene (0 valley, 1 house).
//    hazardSky(acc, T, rd, tHit)        the cloud pass, before its temporal blend: wildfire smoke tints the clouds (the
//                                       smoke changes over seconds: the EMA does not matter). Lightning is NOT here
//                                       (the cloud history blends 0.3 per frame): its cloud glow is in hazardLight
//    hazardLight(col, uv, g0, rd, t, cl) the shading pass, every pixel:
//                                       sky pixels (t > 60000; cl = the cloud pass, premultiplied radiance +
//                                       transmittance): the lightning's glow inside and under the clouds around the
//                                       channel (lumpy, per frame), a heat flash low on the horizon; the wildfire's
//                                       smoke-veiled red sun disc, the far fire's glow over the ridge / the trees and
//                                       its smoke columns;
//                                       surfaces (after shadeSurface + hazardSurface, before the aerial perspective):
//                                       the flash as a cool white light from the channel (its nearest point; baked
//                                       normals and AO; a rim on silhouettes when it strikes behind; a sheen on wet
//                                       ground). The ambient part of the flash comes through uSkyAmb (derive/events.js)
//    hazardSurface(col, uv, g0, rd, t)  surfaces right after shadeSurface: earthquake crack decals on hard ground
//                                       (valley: rock and the path; house: concrete, asphalt, brick)
//    hazardShake(uv) -> uv              the composite: where the frame is sampled for output uv (offset, roll and the
//                                       overscan zoom that keeps the edges out of view while shaking)
//    hazardComp(hdr, bloom, bloomStr, uv) -> rgb   the composite: hdr + bloom at the shaken uv, with a short
//                                       directional motion blur along the shake's motion over a 1/60 s shutter
//  Uniforms (S.F; derive/events.js):
//    uFlash     rgb flash irradiance at the camera's distance from the channel (linear), w envelope 0..1
//    uFlashPos  the channel's top (world m; cloud-to-ground) or one end (intra-cloud), w its length (m; 0 = none)
//    uFlashFoot the channel's foot (world m) or the other end, w kind (0 cloud-to-ground, 1 intra-cloud, 2 heat flash)
//    uQuake     xy shake offset (uv), z roll (rad), w intensity 0..1 (the house's window flicker reads it)
//    uQuakeZ    x overscan zoom (1 = none), yz the shake's motion over the shutter (uv: the blur), w unused
//    uSmoke     rgb smoke tint (linear), w amount 0..1
//    uSmokeSun  the smoke-veiled sun disc: direction (unit), w strength
//    uFire      the far fire: xy its direction (world xz, unit), z angular half-width (rad), w glow 0..1
//    uFireQ     x its base (sin of the elevation: just under the ridge / tree line), y lean (wind), z clock (s), w seed
//    uCrack     crack decals: xy centre (world xz, m), z radius (m), w strength 0..1
//    uCrackQ    xy the fault's direction (world xz, unit), z crack cell size (m), w scene (0 valley, 1 house)
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.HAZARD = `
uniform vec4 uFlash;         // lightning: rgb flash irradiance (linear), w envelope 0..1
uniform vec4 uFlashPos;      // lightning: the channel's top / one end (world m), w its length (m; 0 = none)
uniform vec4 uFlashFoot;     // lightning: the channel's foot / other end (world m), w kind (0 cg, 1 ic, 2 heat)
uniform vec4 uQuake;         // earthquake: xy screen offset (uv), z roll (rad), w intensity 0..1
uniform vec4 uQuakeZ;        // earthquake: x overscan zoom, yz motion over the shutter (uv), w unused
uniform vec4 uSmoke;         // wildfire: rgb smoke tint, w amount 0..1
uniform vec4 uSmokeSun;      // wildfire: the veiled sun disc direction (unit), w strength
uniform vec4 uFire;          // wildfire: the far fire's direction (xz, unit), z half-width (rad), w glow
uniform vec4 uFireQ;         // wildfire: x base elevation (sin), y lean, z clock (s), w seed
uniform vec4 uCrack;         // earthquake: crack decals, xz centre (world m), z radius (m), w strength 0..1
uniform vec4 uCrackQ;        // earthquake: xy fault direction (xz), z cell size (m), w scene (0 valley, 1 house)

// ---- the cloud pass (temporally smoothed): wildfire smoke tints the clouds a brown-orange (the smoke pall over the
// deck). A lightning flash raises uSkyAmb / uFogCol for the scene (derive/events.js: +0.346 / +0.154 x uFlash.rgb);
// in this smoothed pass that would lag and flatten the flash, so its share is taken back out here: the clouds' flash
// is hazardLight's, per frame and lumpy
vec3 hazardSky(vec3 acc, float T, vec3 rd, float tHit) {
  if (uFlash.w > 0.0 && uFlashFoot.w < 1.5 && T < 1.0) {
    // (the ambient share through the clouds' ambient factor, ~0.8; the haze in front of them barely changes it)
    acc = max(acc - (1.0 - T) * uFlash.rgb * 0.28, vec3(0.0));
  }
  if (uSmoke.w <= 0.0) return acc;
  float l = dot(acc, vec3(0.3, 0.59, 0.11));
  return mix(acc, l * uSmoke.rgb * 1.7, 0.6 * uSmoke.w);
}

// ---- lightning on the sky: the clouds light up from inside / below around the channel (strongest near its top,
// where it leaves the deck), lumpy with the cloud structure; a broad glow over the whole deck; the clear air only a
// little. A heat flash: a soft glow low on the horizon in its direction (and any clouds there)
vec3 flashSky(vec3 rd, vec4 cl) {
  float kind = uFlashFoot.w;
  float op = 1.0 - cl.a;
  vec3 top = uFlashPos.xyz, foot = uFlashFoot.xyz;
  // the glow centre: the channel's upper part (an intra-cloud crawler: its middle)
  vec3 ctr = kind > 0.5 ? 0.5 * (top + foot) : mix(foot, top, 0.85);
  float dist = length(ctr - uCamPos);
  vec3 dc = (ctr - uCamPos) / dist;
  float c = dot(rd, dc);
  float a2 = max(2.0 * (1.0 - c), 0.0);                       // ~ angle^2
  // angular spread of the lit cloud: ~1.2 km around the channel (a crawler ~2.5 km), at least ~4 deg
  // (stage 2b: a tighter, brighter core around the channel's top over the broad glow: the deck lights up where the
  // bolt leaves it, not as one flat sheet)
  float s1 = clamp((kind > 0.5 ? 2000.0 : 800.0) / dist, 0.06, 0.38);
  float s2 = min(3.5 * s1, 1.1);
  float nearG = exp(-a2 / (s1 * s1)), wide = exp(-a2 / (s2 * s2));
  // along the visible channel too (the deck right above a cloud-to-ground strike glows along it)
  if (kind < 0.5) {
    vec3 ab = top - foot;
    float h = clamp(dot(uCamPos + rd * dist - foot, ab) / dot(ab, ab), 0.0, 1.0);
    vec3 q = normalize(foot + ab * h - uCamPos);
    nearG = max(nearG, 0.6 * exp(-2.0 * (1.0 - dot(rd, q)) / (0.25 * s1 * s1)));
  }
  // the cloud's own lumps (the deck's dome projection, as its stratus): the flash shows the billows
  vec2 q = rd.xz / (max(rd.y, 0.0) + 0.12) * 3.0 + uCloudOff * 0.0004;
  float n = tnoise(q * 1.7 + 4.1) * 0.55 + tnoise(q * 4.3 + 1.7) * 0.3 + tnoise(q * 9.1 + 6.2) * 0.15;
  float lump = 0.15 + 1.7 * smoothstep(0.25, 0.8, n);
  // the deck's luminance from the cloud pass: denser, brighter cloud scatters more of the flash
  vec3 g = uFlash.rgb * (pow(op, 0.7) * (3.2 * nearG + 0.75 * wide) * lump + op * (0.1 + 0.25 * lump) * (0.4 + 0.6 * wide) + 0.04 * wide);
  // a heat flash: a soft pink-white glow low over the horizon in its direction (brighter where clouds catch it)
  if (kind > 1.5) g = uFlash.rgb * vec3(1.0, 0.9, 0.95) * (0.7 + 2.2 * op * lump) * exp(-a2 / 0.12) * smoothstep(0.36, -0.02, rd.y);
  return g;
}

// ---- lightning on a lit surface: the channel's light (its nearest point), relative to the camera's distance from
// the channel (uFlash is the light there), on the baked normals with a little AO; the surface's colour comes from
// the pixel itself over the light it already has (so snow, wetness, seasons, the albedo all carry over)
vec3 flashSurface(vec3 col, vec2 uv, vec4 g0, vec3 rd, float t) {
  if (uFlashFoot.w > 1.5) return vec3(0.0);                   // a heat flash is too far to light the ground
  vec3 p = uCamPos + rd * t;
  vec3 n = octDec(G2(uv).xy);
  vec3 top = uFlashPos.xyz, foot = uFlashFoot.xyz, ab = top - foot;
  float h = clamp(dot(p - foot, ab) / max(dot(ab, ab), 1.0), 0.0, 1.0);
  vec3 L = foot + ab * h - p;
  float d = length(L); L /= max(d, 1e-3);
  float hc = clamp(dot(uCamPos - foot, ab) / max(dot(ab, ab), 1.0), 0.0, 1.0);
  float dc = length(foot + ab * hc - uCamPos), D0 = max(0.6 * dc, 60.0);
  float k = min((1.0 + sq(dc / D0)) / (1.0 + sq(d / D0)), 4.0);
  float ao = g0.w;
  vec3 E = uSkyAmb * (0.62 + 0.38 * n.y) * ao + uSunCol * g0.z * max(dot(n, uSunDir), 0.0) + vec3(0.015);
  vec3 alb = min(col / E, vec3(1.0));
  float ndl = max(dot(n, L), 0.0);
  float nv = max(dot(n, -rd), 0.0);
  float rim = pow(1.0 - nv, 3.0) * smoothstep(-0.2, 0.6, dot(n, L));     // a strike behind lights the silhouettes
  // (stage 2b) a strike behind the scene outlines what stands against it: a cool rim on the silhouettes (crowns,
  // fronds, the roofline), half of it a wet sheen that does not depend on the albedo (rain-wet leaves, shingles);
  // the light toward the camera from behind the silhouette, so mostly where the channel lies behind the pixel
  float back = smoothstep(0.0, 0.7, -dot(L, rd));
  float sheen = rim * back * smoothstep(0.2, 0.6, uWet + uPrecipRain);
  // (wet hard ground mirrors the flash through its own sky reflection: uSkyZen / uSkyHor carry the flash)
  return alb * uFlash.rgb * k * (ndl * (0.45 + 0.55 * ao) + 0.9 * rim + 1.6 * rim * back) + uFlash.rgb * k * sheen * 0.16;
}

// ---- wildfire on the sky: the veiled sun (a dim red disc in banded smoke), the far fire's glow hugging the ridge /
// the tree line, and its smoke columns rising, leaning with the wind, lit orange from below
vec3 smokeSky(vec3 col, vec3 rd, vec4 cl) {
  float sm = uSmoke.w;
  // (stage 2b) the pall overhead: the smoke spreading aloft darkens the high sky to a deep rust over the glowing orange
  // low sky (the haze alone left one flat ochre sheet)
  col *= mix(vec3(1.0), vec3(0.56, 0.36, 0.24), sm * smoothstep(0.03, 0.5, rd.y));
  float vis = cl.a;                                            // the deck / clouds in front hide the sun and the fire
  if (uSmokeSun.w * vis > 0.001) {                            // (behind a deck the disc and its halo cannot show)
    float a = sqrt(max(2.0 * (1.0 - dot(rd, uSmokeSun.xyz)), 0.0));
    float px = 2.0 * uTanH / uRes.y;                           // one pixel (rad)
    float R = 0.019;                                           // (stage 2b: a larger, deeper red disc)
    // drifting bands of thicker smoke across the disc
    float band = 0.78 + 0.22 * smoothstep(0.2, 0.8, tnoise(vec2(rd.y * 140.0 + uFireQ.z * 0.01, (rd.x - rd.z) * 18.0 + 3.0)));
    float disc = (1.0 - smoothstep(R - 1.5 * px, R + 1.5 * px, a)) * band;
    float limb = 1.0 - 0.3 * smoothstep(0.3 * R, R, a);        // limb darkening
    vec3 sunC = vec3(1.0, 0.085, 0.02) * 1.35 * limb;
    float halo = exp(-a / 0.035) * 0.22 + exp(-a / 0.16) * 0.08;
    col = mix(col, sunC, disc * uSmokeSun.w * vis) + vec3(1.0, 0.3, 0.07) * halo * uSmokeSun.w * vis * (0.5 + 0.5 * band);
  }
  if (uFire.w > 0.0) {
    vec2 fd = uFire.xy, hz = rd.xz / max(length(rd.xz), 1e-4);
    float az = atan(fd.x * hz.y - fd.y * hz.x, dot(fd, hz));   // signed azimuth from the fire's direction
    float W = uFire.z;
    if (abs(az) < 3.2 * W) {
      float e = rd.y - uFireQ.x, ee = max(e, 0.0);              // above the fire's base
      vec3 glowC = vec3(1.0, 0.3, 0.07);
      float win = exp(-sq(az / W));
      float flick = 0.8 + 0.2 * tnoise(vec2(az * 25.0, uFireQ.z * 0.8));
      col += glowC * uFire.w * win * flick * (1.3 * exp(-ee / 0.025) + 0.3 * exp(-ee / 0.1)) * (0.4 + 0.6 * vis);
      // (stage 2a) the columns mix in at most sm x vis x .88: behind a deck (a storm, overcast) they cannot show, so
      // their noise and billow loop are skipped (< 0.25% of the colour: below an 8-bit step; ~1.8 ms at 2400x1350 in a
      // house thunderstorm, whose sky is most of the frame)
      if (sm * vis < 0.0025) return col;
      // three columns of billows: each billow rises from behind the ridge / the trees, swells as it climbs, bends
      // downwind and dissolves into the pall up high (7 per column, cycling: one leaves the top as one rises from
      // the base); lit from above, glowing orange low down
      // (a warped, upward-scrolling noise breaks the billows' outlines into cauliflower edges)
      // (stage 2a) a conservative bound of each column at this pixel's elevation, so the noise and the billow loop run
      // only near a column (most of the window is pall or clear sky; the result is unchanged): billow j adds density
      // only where d + .7 (n - .5) < 1.05, i.e. d < 1.4 whatever the noise (n in [0, 1]): |e - ey| < 1.28 r and
      // |az - cx| < 1.65 r, with cx within .4 r of the curve ci + lean 2.4 ey^1.3 (monotonic in ey) and r at most
      // (.034 + .34 ey) sz 1.15 (growing with ey); the stem only where |x| < 1.3 wd below e = .2
      bool cnear[3];
      bool anyNear = false;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float ci = (fi - 1.0) * 0.7 * W + 0.15 * W * sin(uFireQ.w * 7.0 + fi * 2.3);
        float sz = 1.0 - 0.25 * abs(fi - 1.0), eyM = 0.32 * sz, rM = (0.034 + 0.34 * eyM) * sz * 1.15;
        float ey0 = clamp(e - 1.28 * rM, 0.0, eyM), ey1 = clamp(e + 1.28 * rM, 0.0, eyM);
        float L0 = uFireQ.y * pow(ey0, 1.3) * 2.4, L1 = uFireQ.y * pow(ey1, 1.3) * 2.4;
        float rr = 2.05 * (0.034 + 0.34 * ey1) * sz * 1.15 + 1e-3;
        bool nb = e > -1.28 * rM && e < eyM + 1.28 * rM && az > ci + min(L0, L1) - rr && az < ci + max(L0, L1) + rr;
        bool ns = ee < 0.2 && abs(az - ci - uFireQ.y * pow(ee, 1.3) * 2.4) < 1.3 * (0.022 + 0.25 * ee) * sz + 1e-3;
        cnear[i] = nb || ns;
        anyNear = anyNear || cnear[i];
      }
      float n = 0.0;
      if (anyNear) {
        vec2 nq = vec2(az, e - uFireQ.z * 0.0018) * 40.0;
        vec2 wq = vec2(tnoise(nq * 0.5 + 1.3), tnoise(nq * 0.5 + 7.1)) - 0.5;
        n = tnoise(nq + wq * 3.0) * 0.5 + tnoise(nq * 2.3 + wq * 5.0 + 3.0) * 0.3 + tnoise(nq * 5.1 + 9.0) * 0.2;
      }
      float dens = 0.0, shade = 0.0, lit = 0.0, wsum = 0.0;
      for (int i = 0; i < 3; i++) {
        if (!cnear[i]) continue;
        float fi = float(i);
        float ci = (fi - 1.0) * 0.7 * W + 0.15 * W * sin(uFireQ.w * 7.0 + fi * 2.3);
        float sz = 1.0 - 0.25 * abs(fi - 1.0);
        for (int j = 0; j < 8; j++) {
          float fj = float(j);
          float ph = fract((fj + uFireQ.z * 0.012 * (1.0 + 0.2 * fi) + 0.37 * fi) / 8.0);
          float ey = ph * 0.32 * sz;
          float r = (0.034 + 0.34 * ey) * sz * (0.85 + 0.3 * fract(sin(fj * 12.9 + fi * 78.2) * 43758.5));
          float cx = ci + uFireQ.y * pow(ey, 1.3) * 2.4 + 0.4 * r * sin(fj * 2.1 + fi * 1.7);
          vec2 dv = vec2(az - cx, e - ey);
          float d = length(dv * vec2(0.85, 1.1)) / r;
          float fade = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.55, 1.0, ph));
          float b = (1.0 - smoothstep(0.35, 1.05, d + 0.7 * (n - 0.5))) * fade;
          dens = 1.0 - (1.0 - dens) * (1.0 - b);              // a soft union: overlapping billows merge
          shade += b * clamp(dv.y / r, -1.0, 1.0); wsum += b;
          lit = max(lit, b * exp(-max(ey, 0.0) / 0.05));
        }
        // the stem joining the billows low down
        float x = az - ci - uFireQ.y * pow(ee, 1.3) * 2.4, wd = (0.022 + 0.25 * ee) * sz;
        dens = max(dens, 0.8 * (1.0 - smoothstep(0.35, 1.0, abs(x) / wd + 0.6 * (n - 0.5))) * (1.0 - smoothstep(0.06, 0.2, ee)));
      }
      shade = wsum > 1e-3 ? shade / wsum : 0.0;
      float pq = tnoise(vec2(az * 7.0 - uFireQ.z * 0.003, e * 26.0)) * 0.65 + tnoise(vec2(az * 17.0, e * 60.0 + 3.0)) * 0.35;
      float pall = smoothstep(0.1, 0.22, e) * (1.0 - smoothstep(0.28, 0.5, e)) * exp(-sq((az - uFireQ.y * 0.5 * W) / (2.4 * W)));
      dens = max(dens, 0.55 * pall * smoothstep(0.25, 0.75, pq));
      // dark brown-grey smoke, the billows' tops lighter (the hazy light from above), the low smoke lit by the fire
      float lum = dot(col, vec3(0.3, 0.59, 0.11));
      vec3 smokeC = vec3(0.2, 0.155, 0.125) * (0.5 + 0.8 * lum) * (0.75 + 0.55 * (0.5 + 0.5 * shade)) * (1.0 + 0.5 * (1.0 - smoothstep(0.2, 0.8, dens)));
      smokeC = mix(smokeC, glowC * 0.85, 0.8 * lit * uFire.w);
      col = mix(col, smokeC, clamp(dens * 0.88 * sm * vis, 0.0, 0.92));
    }
  }
  return col;
}

vec3 hazardLight(vec3 col, vec2 uv, vec4 g0, vec3 rd, float t, vec4 cl) {
  if (uFlash.w <= 0.0 && uSmoke.w <= 0.0) return col;
  if (t > 60000.0) {
    if (uFlash.w > 0.0) col += flashSky(rd, cl);
    if (uSmoke.w > 0.0) col = smokeSky(col, rd, cl);
    return col;
  }
  if (uFlash.w > 0.0) col += flashSurface(col, uv, g0, rd, t);
  return col;
}

// ---- earthquake cracks: a main fault across the hard ground (a noisy line through the centre along uCrackQ.xy) with
// a network of finer cracks close to it (cell edges of a jittered grid), dark gaps with chipped lighter lips; they open
// with the main shock and fade (uCrack.w)
vec2 crackCell(vec2 p) {                                       // (distance to the nearest cell edge, cell random)
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash2(i + g), hash2(i + g + 17.3)) * 0.8 + 0.1;
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = hash2(i + g + 5.1); } else if (d < d2) d2 = d;
  }
  return vec2(0.5 * (d2 - d1), id);
}
vec3 hazardSurface(vec3 col, vec2 uv, vec4 g0, vec3 rd, float t) {
  if (uCrack.w <= 0.0) return col;
  float mat = floor(g0.y + 0.001);
  bool hard;
  if (uCrackQ.w > 0.5) hard = mat >= 11.0 && mat <= 13.0;                       // house: concrete, asphalt, brick
  else { vec4 g3 = G3(uv); hard = mat == 1.0 && (g3.r > 0.45 || g3.g > 0.5); }  // valley: rock and the path
  if (!hard) return col;
  vec3 p = uCamPos + rd * t;
  vec2 q = p.xz - uCrack.xy;
  float reach = 1.0 - smoothstep(0.55, 1.0, length(q) / uCrack.z);
  if (reach <= 0.0) return col;
  float cell = uCrackQ.z;
  vec2 fd = uCrackQ.xy, fn = vec2(-fd.y, fd.x);
  float along = dot(q, fd), across = dot(q, fn);
  across += (tnoise(vec2(along / cell * 0.9, 3.1)) - 0.5) * cell * 1.6 + (tnoise(vec2(along / cell * 5.3, 7.7)) - 0.5) * cell * 0.3;
  // pixel footprint on the ground (m), for anti-aliasing (grazing views stretch it)
  vec3 n = octDec(G2(uv).zw);
  float fp = t * 2.0 * uTanH / uRes.y / max(abs(dot(n, rd)), 0.2);
  float wMain = cell * 0.035 * (0.55 + 0.9 * tnoise(vec2(along / cell * 3.0, 1.3)));
  float dMain = abs(across) - wMain;
  // the network: cell edges near the fault, thinning out with the distance from it
  vec2 vc = crackCell(vec2(along, across) / cell * vec2(0.8, 1.3));
  float near = exp(-abs(across) / (cell * 2.2)) * step(0.25, vc.y);
  float dNet = vc.x * cell - cell * 0.012 * (0.5 + vc.y);
  float gapM = 1.0 - smoothstep(-0.7 * fp, 0.7 * fp, dMain);
  float gapN = (1.0 - smoothstep(-0.7 * fp, 0.7 * fp, dNet)) * near;
  // the lips: chipped, a little lighter (fresh broken surface), on both sides of the main fault
  float lip = (1.0 - smoothstep(0.0, wMain * 1.4 + fp, abs(dMain))) * (1.0 - gapM) * (0.6 + 0.4 * tnoise(vec2(along / cell * 9.0, 2.0)));
  float k = uCrack.w * reach;
  // on snow (a bright pixel for its light) the cracks are only faint blue-grey shadow lines in the snow
  vec3 E = uSkyAmb * (0.62 + 0.38 * n.y) * g0.w + uSunCol * g0.z * max(dot(n, uSunDir), 0.0) + vec3(0.015);
  float snow = smoothstep(0.6, 0.8, dot(col / E, vec3(0.3, 0.59, 0.11)));
  col = mix(col, col * vec3(1.18, 1.14, 1.08) + 0.004, 0.55 * lip * k * (1.0 - snow));
  col = mix(col, col * mix(vec3(0.1), vec3(0.72, 0.78, 0.9), snow), max(gapM, 0.8 * gapN) * k * (1.0 - 0.5 * snow));
  return col;
}

// ---- earthquake shake (composite): rotate (roll) and zoom about the centre in square units, then offset; the zoom
// keeps every sample inside the frame. Identity (bit for bit) while no quake shakes the frame
vec2 hazardShake(vec2 uv) {
  if (uQuakeZ.x <= 1.0 && uQuake.w <= 0.0) return uv;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 c = (uv - 0.5) * asp / uQuakeZ.x;
  float cr = cos(uQuake.z), sr = sin(uQuake.z);
  c = vec2(cr * c.x - sr * c.y, sr * c.x + cr * c.y);
  return c / asp + 0.5 + uQuake.xy;
}
vec3 hazardComp(sampler2D hdr, sampler2D bloom, float bloomStr, vec2 uv) {
  if (dot(uQuakeZ.yz, uQuakeZ.yz) < 1e-12) return texture(hdr, uv).rgb + texture(bloom, uv).rgb * bloomStr;
  // a short directional blur: 7 taps along the shake's motion over the shutter (the bloom, already blurred over tens
  // of pixels, is fetched once: averaging it over a few pixels changes nothing; stage 2a)
  vec3 c = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    vec2 o = uQuakeZ.yz * ((float(i) + 0.5) / 7.0 - 0.5);
    c += texture(hdr, uv + o).rgb;
  }
  return c / 7.0 + texture(bloom, uv).rgb * bloomStr;
}
`;
})(window.SNOW);
