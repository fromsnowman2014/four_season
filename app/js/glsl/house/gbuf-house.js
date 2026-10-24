// =====================================================================================
//  GLSL: the house scene's G-buffer bake (Phase-3 owner: lane H): the single-story California ranch house of
//  house-sdf.js (HOUSE_SDF) at golden hour, ported from the feasibility spike (work/phase3/spike/house-glsl.js HG.BAKE).
//  Pure SDF, one scene query (sceneQ, compile-time single call site) driven by a phase state machine:
//    0 march (objects by sphere tracing, the ground heightfield stepped along the ray) -> 1 ground bisection (7) ->
//    2 normal (heightfield taps for the ground, tetrahedral for objects) -> 3 soft sun shadow (k 14, <= 110 steps,
//    stops above y = 24 m) -> 4 AO (5 taps at .04 x 3^j m) -> houseMaterials,
//  which writes the SAME G0..G3 layout as the valley with the house's material ids and G3 semantics (HOUSE_IDS in
//  house-sdf.js; the table in ARCHITECTURE.md §14). Season-neutral: seasons, snow, wetness, window light are per frame
//  (glsl/house/surface-house.js). The march runs in house space (hsp: the world mirrored in z); the normals are
//  flipped back to world space on output.
//  Two modes of the same program (so the house scene still builds exactly two programs of its own):
//   - bake (uDissolve.x = 0): uVariant 0 = leafy, 1 = the bare winter variant (deciduous and fruit crowns become
//     skeletons; the finest twigs are a per-pixel twig haze in G3.a; where that haze lies over the sky the pixel
//     becomes a haze surface at the crown, except one 'keeper' pixel per 2x2 block that stays sky so the half-res
//     cloud pass still draws the clouds behind it: SURFACE_HOUSE draws the haze over them);
//   - copy (uDissolve.x = 1): the variant dissolve (render.js): the freshly baked variant (uN0..uN3) is copied into the
//     shown buffer where a smooth screen noise lies in [uDissolve.y, uDissolve.z): leaves fall / come out in clusters.
//  Step 2 (the look) added: the perennials' G3 (r .8 .. 1, b their colour), a shallow dip in the sidewalk in front of
//  the windows (puddle potential: its puddle mirrors their light after rain), a snow lip on the fence's cap rail.
//   HOUSE_HEAD   bake uniforms, the MRT outputs
//   HOUSE_MAT    cedar(), interior(), houseMaterials(...) (called once, no scene query), cardMaterials(...)
//   HOUSE_MAIN   sceneQ (the ONE scene-query call site), the twig haze, the copy mode, the state machine
//  Program 'gbuf@house' = COMMON + HOUSE_HEAD + GBUF_NOISE + HOUSE_IDS + HOUSE_SDF + HOUSE_MAT + HOUSE_MAIN.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  C.HOUSE_HEAD = `
uniform float uPixAng;
uniform int uIter;                  // state-machine iteration cap (a uniform bound: the driver cannot unroll the loop)
uniform float uVariant;             // 0 leafy, 1 the bare winter variant (render.js: the variant of the buffer being baked)
uniform vec3 uDissolve;             // x > .5: copy mode (the variant dissolve); [y, z): the noise band copied this frame
uniform sampler2D uN0, uN1, uN2, uN3;   // copy mode: the freshly baked variant (render.js; unit 7 while baking)
layout(location = 0) out vec4 o0;   // t, material (+ sway weight), sun shadow, AO
layout(location = 1) out vec4 o1;   // albedo (reference; glass: the lit room as an emission colour), snow threshold
layout(location = 2) out vec4 o2;   // oct(detail normal), oct(smooth normal) (world space)
layout(location = 3) out vec4 o3;   // the house's G3: variation, water / leaf, object random / light mask, shelter + haze (RGBA8)
`;
  C.HOUSE_MAT = `
// stained cedar / redwood lap siding: 15.2 cm courses, random board lengths per course, a deep red-brown stain with a
// subtle per-board tone (a little redder or more honey, rarely a darker board), grain along the boards, the drip-edge
// shadow under each lap, fine butt joints; the boards tilt out at the bottom (detail normal). tone: the board's value
vec3 cedar(float s, float y, float fp, inout vec3 n, out float tone) {
  float bh = 0.152;
  float yy = (y - 0.14) / bh;
  float row = floor(yy), fy = yy - row;
  float r0 = hash2(vec2(row, 41.0));
  float L = 2.0 + 2.8 * r0;
  float sx = s + r0 * 7.3;
  float seg = floor(sx / L), fx = sx / L - seg;
  float h = hash2(vec2(row, seg) + 0.5), h2 = hash2(vec2(seg * 1.7 + 3.0, row)), h3 = hash2(vec2(seg + 5.0, row * 3.1 + 9.0));
  tone = h;
  // stained western red cedar, board by board (stage 2b: the reference's mixed boards instead of one orange stain):
  // honey, amber and russet boards, now and then a dark one, each a little lighter or darker
  vec3 honey = vec3(0.25, 0.14, 0.066), amber = vec3(0.2, 0.1, 0.047), russet = vec3(0.16, 0.07, 0.038), dark = vec3(0.1, 0.052, 0.032);
  vec3 c = h2 < 0.3 ? mix(honey, amber, h2 / 0.3) : h2 < 0.78 ? mix(amber, russet, (h2 - 0.3) / 0.48) : mix(russet, dark, (h2 - 0.78) / 0.22 * 0.7);
  c *= 0.84 + 0.32 * h;
  c *= 1.0 - 0.3 * step(0.94, h3);                                                    // a rare darker board
  float g = vn(vec2(sx * 1.5 + seg * 13.0, y * 90.0)) * 0.6 + vn(vec2(sx * 7.0, y * 260.0 + seg)) * 0.4;
  c *= 1.0 + 0.13 * g * smoothstep(0.03, 0.008, fp);                                  // grain, faded by footprint
  c *= mix(0.5, 1.0, smoothstep(0.0, 0.12, fy)) * (1.0 - 0.08 * smoothstep(0.75, 1.0, fy));   // drip-edge shadow line
  c *= 1.0 - 0.35 * smoothstep(0.006, 0.002, min(fx, 1.0 - fx) * L);                  // butt joints
  n = normalize(n + vec3(0.0, -0.09 * (0.5 + fy) - 0.25 * smoothstep(0.1, 0.0, fy), 0.0));
  return c;
}
// the room seen through a window, as an emission colour (SURFACE_HOUSE scales it by the cozy level): a warm table lamp,
// a darker ceiling, linen drapes at the sides
vec3 interior(vec2 uv, float seed) {
  float lamp = exp(-sq(uv.x - 0.3 + 0.5 * seed) * 2.5 - sq(uv.y + 0.15) * 2.2);
  vec3 room = vec3(1.0, 0.52, 0.22) * (0.08 + 0.92 * lamp) * mix(1.0, 0.4, smoothstep(0.0, 1.0, uv.y));
  float drape = smoothstep(0.58, 0.66, abs(uv.x));
  vec3 dc = vec3(0.9, 0.62, 0.36) * (0.4 + 0.6 * lamp) * (0.7 + 0.3 * sin(uv.x * 60.0 + seed * 9.0));
  room = mix(room, dc, drape);
  room *= 1.0 - 0.25 * smoothstep(0.75, 1.0, -uv.y);
  return room;
}
vec4 g3Pack(vec4 g3, float shelter, float haze) { g3.a = 0.5 * shelter + 0.5 * min(haze, 0.99); return floor(clamp(g3, 0.0, 1.0) * 255.0 + 0.5) / 255.0; }

// Materials (season-neutral: the lawn a fresh green, the trees in summer leaf). Called exactly once, from main(); no
// scene query. In (house space): the hit t, the detailed id and aux (vegetation: sway weight + 2 x plant index), pos,
// the geometric normal nG, the footprint fp, the soft sun shadow, the AO, the crown radial position rad, the twig haze.
// G0 = t, id + 0.9 sway, shadow, AO; G1 = albedo, snowT; G2 = oct(detail n), oct(smooth n) (world); G3 (RGBA8):
// r variation, g ground puddle potential / vegetation leaf (1) vs wood (0), b plant random / light mask, a = 0.5 x
// shelter (under the eaves: no snow, dry) + 0.5 x twig haze
void houseMaterials(float t, float id, float aux, vec3 pos, vec3 nG, float fp, float sh, float ao, float rad, float haze) {
  float mat = M_TRIM, sway = 0.0, snowT = 9.0, shelter = 0.0;
  vec3 alb = vec3(0.5), nD = nG, nS = nG;
  vec4 g3 = vec4(0.0);
  vec2 q = pos.xz;
  // under the roofs' overhang, below the eaves (main body, garage; the neighbour's)
  if (pos.y < YE - 0.05 && (rectSDF(q, MR) < 0.0 || rectSDF(q, GR) < 0.0 || rectSDF(q, vec4(-27.6, -12.4, -10.6, 1.4)) < 0.0)) shelter = 1.0;
  if (id == I_GROUND) {
    float x = pos.x, z = pos.z;
    float n1 = vn(q * 0.35), n2 = vn(q * 1.7 + 3.1), n3 = vn(q * 6.0 + 1.3);
    float k = 0.0;   // 0 lawn, 1 concrete, 1.5 walkway, 2 asphalt, 4 gravel, 5 mulch
    if (z > Z_CURB) k = z < Z_GUT ? 1.0 : 2.0;
    else if (z > Z_SW1) k = inDrive(x) > 0.5 ? 1.0 : 0.0;
    else if (z > Z_SW0) k = 1.0;
    else if (z < 0.8 && x > -0.45 && x < 11.0 && z > -0.1) k = 4.0;
    else if (frontLawn(x, z) > 0.5) k = 0.0;
    else if (x > DRV1 - 0.05 && x < 0.5 && z < 7.0 && z > -0.1) k = 1.5;
    else if (inDrive(x) > 0.5 && z > 2.3) k = 1.0;
    else if (x < DRV0 && x > -11.7 && z > 0.3 && z < 2.3) k = 1.0;                  // the bins' pad
    else if (z < -0.2 || x < DRV0 || x > 11.0) k = 0.0;
    else k = 1.0;
    for (int i = 0; i < 5; i++) if (length(q - FT[i].xy) < 0.42) k = 5.0;
    if (k == 0.0) {
      mat = M_LAWN;
      float stripe = smoothstep(0.3, 0.7, abs(fract(x / 1.6) - 0.5) * 2.0);           // faint mowing stripes
      alb = vec3(0.062, 0.1, 0.028) * (0.78 + 0.22 * n2 + 0.14 * n3 + 0.08 * stripe) * (1.0 + 0.25 * vn(q * 23.0) * smoothstep(0.03, 0.012, fp));
      g3.r = sat(0.5 + 0.5 * (0.7 * vn(q * 0.45 + 7.0) + 0.3 * n2));                 // dry-patch potential
      snowT = 0.24 + 0.3 * sat(0.5 + 0.7 * vn(q * 0.6 + 2.0)) + 0.06 * n3;
    } else if (k == 5.0) {
      mat = M_SOIL; alb = vec3(0.11, 0.07, 0.045) * (0.8 + 0.3 * n3); snowT = 0.3; g3.r = 0.5 + 0.5 * n3;
    } else if (k == 4.0) {
      mat = M_GRAVEL;
      float st = vn(q * 28.0) * 0.6 + vn(q * 61.0 + 3.0) * 0.4;
      alb = vec3(0.6, 0.59, 0.56) * mix(1.0, 0.72 + 0.4 * st, smoothstep(0.04, 0.012, fp));
      nD = normalize(nG + vec3(vn(q * 30.0 + 1.0), 0.0, vn(q * 30.0 + 5.0)) * 0.35 * smoothstep(0.04, 0.012, fp));
      snowT = 0.26; g3.r = 0.5 + 0.5 * st;
    } else if (k == 2.0) {
      mat = M_ASPHALT;
      alb = vec3(0.052, 0.052, 0.056) * (0.85 + 0.22 * n1 + 0.12 * n2) + 0.008 * smoothstep(0.2, 0.9, vn(q * 3.0));
      // tyre tracks keep the street dark longest; the gutter edge is where the water runs
      float lane = abs(fract((z - 14.8) / 5.4) - 0.5) * 5.4;
      float track = smoothstep(0.42, 0.06, abs(lane - 0.85));
      // (stage 2b) an older suburban street: weathered lighter grey, the wheel paths polished a little lighter, the
      // aggregate's speckle (faded below a few pixels), meandering crack-seal lines ('tar snakes') and a patch or two
      alb *= 1.45 * (1.0 + 0.1 * track);
      alb *= mix(1.0, 0.82 + 0.36 * (0.5 + 0.5 * vn(q * 41.0)), smoothstep(0.035, 0.012, fp));
      float snake = smoothstep(0.035, 0.012, abs(vn(q * vec2(0.22, 0.5) + 3.0))) * smoothstep(0.1, 0.45, vn(q * 0.11 + 7.0));
      float patchA = step(rectSDF(q - vec2(floor(x / 9.0) * 9.0 + 4.5 * hash2(vec2(floor(x / 9.0), 2.0)), 0.0), vec4(0.0, 1.6, 17.5, 18.6)), 0.0) * step(0.55, hash2(vec2(floor(x / 9.0), 5.0)));
      alb = mix(alb, vec3(0.045, 0.045, 0.048), max(snake * 0.9, patchA * 0.55));
      snowT = 0.62 + 0.1 * n1 + 0.22 * track; g3.r = 0.5 + 0.5 * n1;
      g3.g = sat(0.75 * smoothstep(15.5, 14.85, z) + 0.45 * smoothstep(0.45, 0.85, vn(q * 0.3 + 4.0)));
    } else {
      mat = M_CONCRETE;
      alb = vec3(0.40, 0.385, 0.36) * (0.9 + 0.1 * n1 + 0.06 * n2 + 0.04 * n3);
      g3.r = 0.5 + 0.5 * n2;
      if (z > Z_CURB) { alb *= 0.82; g3.g = 0.9; }                                       // gutter pan
      else if (z > Z_SW0 && z < Z_SW1) {
        float jx = abs(fract(x / 1.52) - 0.5) * 1.52;
        alb *= 1.0 - 0.45 * smoothstep(0.012, 0.004, 0.76 - jx);
        // (a shallow dip in front of the windows: after rain its puddle mirrors their warm light)
        g3.g = sat(0.35 * smoothstep(0.1, 0.6, vn(q * 0.5 + 2.0)) + 0.7 * exp(-sq((x - 4.0) / 2.6)) * smoothstep(11.0, 11.5, z));
      } else if (k == 1.5) {
        // the walkway: exposed-aggregate pads with running-bond brick bands across
        float bz = fract(z / 1.35);
        if (bz < 0.26) {
          mat = M_BRICK;
          float bq = z / 0.1, br = floor(bq), bx = x / 0.21 + 0.5 * mod(br, 2.0), bc = floor(bx);
          float mort = min(min(fract(bq), 1.0 - fract(bq)) * 0.1, min(fract(bx), 1.0 - fract(bx)) * 0.21);
          alb = vec3(0.33, 0.1, 0.065) * (0.75 + 0.45 * hash2(vec2(bc, br)));
          alb = mix(alb, vec3(0.42, 0.4, 0.37), smoothstep(0.008, 0.004, mort));
        } else alb *= 0.92 + 0.16 * vn(q * 40.0) * smoothstep(0.03, 0.01, fp);
        g3.g = 0.3 * smoothstep(0.0, 0.6, vn(q * 0.8 + 6.0));
      } else {
        // driveway: control joints (centre line + every 3 m), tyre-worn darker tracks, a low spot near the street
        float jx = abs(x + 6.2), jz = abs(fract(z / 3.0) - 0.5) * 3.0;
        alb *= 1.0 - 0.4 * smoothstep(0.012, 0.004, min(jx, 1.5 - jz));
        alb *= 1.0 - 0.07 * smoothstep(0.6, 0.2, abs(abs(x + 6.2) - 1.55));
        alb *= 1.0 - 0.06 * smoothstep(0.2, 0.7, vn(q * 0.6 + 8.0));                    // oil / water stains
        g3.g = sat(0.25 + 0.75 * smoothstep(0.15, 0.6, vn(q * 0.42 + 1.0)) * smoothstep(3.0, 6.0, z));
      }
      snowT = 0.45 + 0.1 * n1;
    }
  } else if (id == I_CURB) {
    mat = M_CONCRETE; alb = vec3(0.44, 0.43, 0.4) * (0.9 + 0.1 * vn(q * 2.0)); snowT = nG.y > 0.7 ? 0.3 : 9.0;
    // (stage 2b) the street curb's face (facing the street and the low sun): an aged, greyer concrete, grimy toward the
    // gutter, with the expansion joints; it read as one bright tan stripe across the bottom of the frame
    if (pos.z > Z_CURB - 0.3 && nG.y < 0.5) {
      alb = vec3(0.3, 0.295, 0.285) * (0.86 + 0.16 * vn(q * 3.0) + 0.06 * vn(vec2(pos.x * 9.0, pos.y * 40.0))) * mix(0.62, 1.0, smoothstep(-0.12, 0.06, pos.y));
      alb *= 1.0 - 0.5 * smoothstep(0.012, 0.004, abs(fract(pos.x / 3.0) - 0.5) * 3.0);
    }
    // the doormat on the stoop (coir, a darker border)
    vec2 dm = abs(q - vec2(DOOR.x, 0.33)) - vec2(0.4, 0.24);
    if (nG.y > 0.7 && pos.y > 0.09 && max(dm.x, dm.y) < 0.0) {
      mat = M_SOIL;
      alb = vec3(0.2, 0.12, 0.06) * (0.85 + 0.25 * vn(q * 60.0)) * mix(0.55, 1.0, smoothstep(-0.05, -0.035, max(dm.x, dm.y)));
    }
  } else if (id == I_WALL || id == I_NWALL || id == I_NWALL2) {
    mat = M_TRIM;
    bool front = nG.z > 0.7, side = abs(nG.x) > 0.7;
    float s = side ? pos.z : pos.x;
    if (id == I_WALL) {
      bool stucco;
      if (front && pos.z > 2.0) stucco = pos.y > 2.62;                    // garage front: gable stucco over cedar
      else if (front && pos.x < -0.45) stucco = true;                     // the entry
      else if (side && pos.x < -2.3 && pos.z > -0.1) stucco = true;       // the garage's right side wall
      else stucco = pos.y > 2.62;                                         // the gable triangles
      if (pos.y < 0.14) { mat = M_CONCRETE; alb = vec3(0.36, 0.35, 0.33) * (0.9 + 0.1 * vn(q * 3.0)); }
      else if (stucco) { alb = vec3(0.62, 0.58, 0.5) * (0.95 + 0.05 * vn(vec2(s, pos.y) * 3.0)) * (1.0 - 0.06 * smoothstep(0.5, 0.0, pos.y)); }
      else { float tone; alb = cedar(s, pos.y, fp, nD, tone); mat = M_SIDING; g3.r = tone; }
    } else {
      alb = id == I_NWALL ? vec3(0.42, 0.42, 0.37) : vec3(0.55, 0.54, 0.5);
      alb *= 0.95 + 0.05 * vn(vec2(s, pos.y) * 3.0);
    }
    snowT = nG.y > 0.6 ? 0.25 : 9.0;
  } else if (id == I_TRIM || id == I_DOOR) {
    mat = M_TRIM; alb = vec3(0.72, 0.72, 0.69);
    if (id == I_DOOR) {
      // white door with an oval leaded-glass light (the hall lit behind it)
      vec2 e = (pos.xy - vec2(DOOR.x, 1.32)) / vec2(0.19, 0.42);
      float r = length(e);
      if (r < 1.0) {
        mat = M_GLASS; g3.r = 0.75; g3.b = 1.0;
        float lead = smoothstep(0.03, 0.0, abs(r - 0.62)) + smoothstep(0.02, 0.0, abs(e.x * 0.19)) * step(0.62, r);
        alb = vec3(1.0, 0.7, 0.4) * (0.5 + 0.5 * (1.0 - r)) * (1.0 - 0.8 * sat(lead));
      } else {
        float bev = smoothstep(1.0, 1.08, r) * smoothstep(1.26, 1.12, r);
        nD = normalize(nG + vec3(e.x, e.y, 0.0) / r * 0.5 * bev);
        alb *= 1.0 - 0.15 * bev;
        vec2 kn = pos.xy - vec2(DOOR.x + 0.36, 0.98);
        if (length(kn) < 0.035) alb = vec3(0.35, 0.25, 0.1);
      }
    }
    snowT = nG.y > 0.6 ? 0.22 : 9.0;
  } else if (id == I_GDOOR) {
    mat = M_GARAGE;
    alb = vec3(0.69, 0.69, 0.66);
    float ly = pos.y / (2.0 * GDOORH.y) * 4.0, sec = floor(ly), fy = ly - sec;
    float lx = (pos.x - GDOOR.x + GDOORH.x) / (2.0 * GDOORH.x);
    alb *= 1.0 - 0.4 * smoothstep(0.035, 0.0, min(fy, 1.0 - fy));
    nD = normalize(nG + vec3(0.0, (smoothstep(0.05, 0.0, fy) - smoothstep(0.95, 1.0, fy)) * 0.6, 0.0));
    if (sec == 3.0) {
      // the row of eight small arched lights (light mask, G1 = their dim warm glow)
      float cx = fract(lx * 8.0) - 0.5, wy = (fy - 0.42) / 0.3;
      if (abs(cx) < 0.31 && wy > -0.62 && wy < 0.35 + 0.35 * (1.0 - sq(cx / 0.31))) {
        g3.b = 1.0;
        alb = vec3(1.0, 0.62, 0.3) * 0.22 * (0.6 + 0.4 * hash2(vec2(floor(lx * 8.0), 2.0)));
      }
    } else {
      float pnl = abs(fract(lx * 8.0) - 0.5);
      alb *= 1.0 - 0.12 * smoothstep(0.43, 0.47, pnl) * smoothstep(0.1, 0.2, fy) * smoothstep(0.9, 0.8, fy);
    }
  } else if (id == I_ROOF || id == I_NROOF) {
    mat = M_ROOF;
    if (nG.y > 0.5) {
      bool alongX = abs(nG.z) > abs(nG.x);
      float along = alongX ? pos.x : pos.z;
      float s = (pos.y - YE) / PSIN;
      float crs = floor(s / 0.142), fs = s / 0.142 - crs;
      float tw = 0.33 + 0.12 * hash2(vec2(crs, 7.0));
      float tab = floor((along + hash2(vec2(crs, 1.0)) * 3.0) / tw);
      float tone = hash2(vec2(crs, tab));
      alb = vec3(0.05, 0.051, 0.055) * (0.8 + 0.4 * tone) * mix(vec3(1.0), vec3(1.1, 1.0, 0.9), step(0.85, fract(tone * 9.0)));
      alb *= 0.9 + 0.2 * vn(pos.xz * 0.6 + 3.0);                                         // weathering streaks
      if (id == I_NROOF) alb *= vec3(1.3, 1.15, 1.0);
      alb *= mix(0.7, 1.0, smoothstep(0.0, 0.14, fs));
      vec3 upS = vec3(alongX ? 0.0 : -nG.x, 0.0, alongX ? -nG.z : 0.0);                  // up-slope horizontal dir
      upS *= inversesqrt(max(dot(upS, upS), 1e-12));                                       // (0 on a level patch, not NaN)
      nD = normalize(nG + upS * 0.35 * smoothstep(0.12, 0.0, fs));
      // a dusting whitens the roof softly (a smooth drift field, a little per course), never tab by tab
      snowT = 0.07 + 0.11 * sat(0.5 + 0.6 * vn(pos.xz * 0.7 + 4.0)) + 0.025 * hash2(vec2(crs, 3.0)); g3.r = tone;
    } else if (nG.y < -0.5) { alb = vec3(0.7, 0.69, 0.66); mat = M_TRIM; }               // soffit
    else { alb = vec3(0.8, 0.8, 0.77); mat = M_TRIM; }                                   // fascia / rake
  } else if (id == I_GLASS) {
    mat = M_GLASS; g3.b = 1.0;
    if (pos.x < -10.0) { alb = interior((pos.xy - vec2(-14.8, 1.55)) / vec2(0.75, 0.55), 0.6) * 0.8; g3.r = 0.35; }
    else {
      vec2 c = pos.x < 5.2 ? WIN0 : WIN1;
      alb = interior((pos.xy - c) / WINH, pos.x < 5.2 ? 0.0 : 0.35); g3.r = 1.0;
    }
  } else if (id == I_VENT || id == I_BIN) {
    mat = M_METAL; snowT = nG.y > 0.6 ? 0.2 : 9.0;
    alb = vec3(0.12, 0.12, 0.12);
    if (id == I_BIN) {
      // charcoal bodies; a muted green and a slate-blue lid
      alb = vec3(0.045, 0.047, 0.05) * (0.9 + 0.15 * vn(pos.xy * 4.0));
      if (pos.y > 0.97) alb = pos.x < -10.6 ? vec3(0.05, 0.11, 0.06) : vec3(0.05, 0.08, 0.13);
      g3.r = pos.x < -10.6 ? 0.2 : 0.7;
    }
  } else if (id == I_POST) {
    mat = M_LAMP; alb = vec3(0.035, 0.03, 0.026); snowT = nG.y > 0.6 ? 0.2 : 9.0;
  } else if (id == I_LANTERN || id == I_LAMPG) {
    mat = M_LAMP; alb = vec3(1.0, 0.72, 0.42); g3.b = 1.0; g3.r = id == I_LANTERN ? 0.4 : 1.0;
  } else if (id == I_FENCE || id == I_BENCH) {
    mat = M_FENCE;
    if (id == I_FENCE) {
      float bx = (pos.x - 11.0) / 0.145, b = floor(bx), fx = bx - b;
      float h = hash2(vec2(b, 5.0));
      alb = mix(vec3(0.2, 0.16, 0.12), vec3(0.27, 0.25, 0.22), h) * (0.9 + 0.12 * vn(vec2(pos.x * 4.0, pos.y * 25.0 + b)));
      alb *= 1.0 - 0.55 * smoothstep(0.07, 0.0, min(fx, 1.0 - fx));
      alb *= mix(0.7, 1.0, smoothstep(0.0, 0.35, pos.y));
      g3.r = h;
    } else {
      // the bench: oiled teak slats with gaps
      float sl = nG.y > 0.6 ? fract(pos.z / 0.095) : fract(pos.y / 0.075);
      alb = vec3(0.24, 0.13, 0.065) * (0.85 + 0.25 * vn(vec2(pos.x * 30.0, pos.z * 4.0 + pos.y * 4.0)));
      alb *= 1.0 - 0.6 * smoothstep(0.12, 0.0, min(sl, 1.0 - sl));
      g3.r = 0.6;
    }
    snowT = nG.y > 0.6 ? 0.22 : 9.0;
    // the fence's cap rail is above the eye: the snow on it shows as a white lip over its edge (the top few cm)
    if (id == I_FENCE && nG.y <= 0.6) snowT = mix(9.0, 0.3, smoothstep(1.82, 1.85, pos.y + 0.015 * vn(vec2(pos.x * 9.0, 2.0))));
  } else if (id == I_POT) {
    mat = M_BRICK; g3.r = 0.7;
    alb = vec3(0.36, 0.13, 0.062) * (0.88 + 0.2 * vn(pos.xy * 9.0)) * mix(0.75, 1.0, smoothstep(0.12, 0.3, pos.y));
    if (pos.y > 0.45 && length(pos.xz - vec2(pos.x < -1.5 ? -2.26 : -0.76, 0.36)) < 0.18) { mat = M_SOIL; alb = vec3(0.06, 0.04, 0.03); }
    snowT = nG.y > 0.6 ? 0.3 : 9.0;
  } else if (id == I_FRUIT || id == I_SHRUB || id == I_CYP || id == I_DECI || id == I_OAK || id == I_FROND || id == I_SKIRT || id == I_BALL || id == I_FLOWER) {
    float pi = floor(aux * 0.5 + 0.001);
    sway = aux - 2.0 * pi; g3.g = 1.0;
    g3.b = fract(pi * 0.618 + id * 0.137 + 0.13);                       // the plant's random (phenology offset)
    if (id == I_DECI || id == I_FRUIT || id == I_OAK) ao *= mix(0.6, 1.0, smoothstep(0.5, 0.95, rad));   // (stage 2b: .4 -> .6, the clumps carry the depth)
    // deep in a crown no sun gets through even where one shadow ray escaped (no sparkle of lit pixels in the shade),
    // and some sky light always scatters through the leaves
    sh = min(sh, sat(ao * 2.5)); ao = max(ao, 0.16);
    float ln = vn3(pos * 9.0) * 0.5 + 0.5;
    if (id == I_FRUIT) { mat = M_FRUIT; alb = vec3(0.055, 0.1, 0.03) * (0.7 + 0.6 * ln); g3.r = hash2(vec2(pi, 3.0)); }
    else if (id == I_SHRUB) { mat = M_CYPRESS; alb = vec3(0.045, 0.085, 0.03) * (0.7 + 0.6 * ln); g3.r = 0.7 * hash2(vec2(pi, 8.0)); }
    else if (id == I_FLOWER) { mat = M_CYPRESS; alb = vec3(0.05, 0.09, 0.032) * (0.7 + 0.6 * ln); g3.r = 0.8 + 0.2 * hash2(vec2(pi, 4.0)); g3.b = hash2(vec2(pi, 11.0)); }
    else if (id == I_BALL) { mat = M_CYPRESS; alb = vec3(0.04, 0.08, 0.028) * (0.75 + 0.5 * ln); g3.r = 0.0; }
    else if (id == I_CYP) { mat = M_CYPRESS; alb = vec3(0.028, 0.055, 0.026) * (0.7 + 0.6 * ln); }
    else if (id == I_OAK) { mat = M_CYPRESS; alb = vec3(0.032, 0.05, 0.026) * (0.65 + 0.7 * ln); }
    else if (id == I_FROND) {
      mat = M_PALM; alb = vec3(0.075, 0.115, 0.04) * (0.8 + 0.4 * ln);
      // (stage 2b) the older, lower fronds paler and yellower (sun-bleached), the young upright ones a fresh deep green:
      // the head reads as layers of fans instead of one dark green disc stack
      vec3 top = palmAxis(PALM[int(pi)], PALM[int(pi)].z) + vec3(0.0, 0.25, 0.0);
      float lo = smoothstep(0.3, -0.7, pos.y - top.y);
      alb = mix(alb * vec3(0.9, 1.05, 1.0), alb * vec3(1.45, 1.25, 0.8), lo) * (0.85 + 0.3 * vn3(pos * 2.1 + 9.0));
    }
    else if (id == I_SKIRT) { mat = M_PALM; alb = vec3(0.25, 0.18, 0.11) * (0.75 + 0.5 * ln); g3.r = 1.0; }
    else { mat = M_TREE; alb = vec3(0.055, 0.09, 0.03) * (0.65 + 0.7 * ln); g3.r = hash2(vec2(pi, 5.0)); }
    // (stage 2b) the broadleaf crowns: clusters of leaves vary in hue across the crown (~1.5 m: sunlit yellow-green
    // young growth, older blue-green leaves), so the leaf clumps read as foliage rather than as one moulded green
    if (id == I_OAK || id == I_DECI) alb *= mix(vec3(0.88, 0.97, 1.12), vec3(1.14, 1.04, 0.82), sat(0.5 + 0.9 * vn3(pos * 0.7 + 5.3)));
    snowT = 0.32 + 0.95 * (1.0 - sat(nG.y)) + 0.1 * ln + (id == I_CYP ? 0.2 : id == I_FROND || id == I_SKIRT ? 0.45 : 0.0);
    // leaf-clump relief in the shading normal (~15-30 cm clumps): the crowns read as foliage, not clay
    float sc = id == I_DECI || id == I_OAK ? 4.0 : id == I_CYP ? 6.0 : 7.0;
    float e = 0.25 / sc, f0 = leafN(pos * sc);
    vec3 g = vec3(leafN((pos + vec3(e, 0.0, 0.0)) * sc) - f0, leafN((pos + vec3(0.0, e, 0.0)) * sc) - f0, leafN((pos + vec3(0.0, 0.0, e)) * sc) - f0) / e;
    // leaf speckle (~6 cm): lit leaves and dark gaps, faded out where a pixel covers many leaves
    float fine = smoothstep(0.06, 0.015, fp);
    float e2 = 0.02, s0 = vn3(pos * 16.0);
    vec3 g2 = vec3(vn3((pos + vec3(e2, 0.0, 0.0)) * 16.0) - s0, vn3((pos + vec3(0.0, e2, 0.0)) * 16.0) - s0, vn3((pos + vec3(0.0, 0.0, e2)) * 16.0) - s0) / e2;
    g = g * ((id == I_DECI || id == I_OAK ? 0.14 : 0.3) / sc) + g2 * 0.03 * fine;
    g -= dot(g, nG) * nG;
    nD = normalize(nG - g);
    // (stage 2b) the broadleaf / fruit crowns' smooth normal leans toward the crown's own dome (from its centre, a
    // little flattened): the shading lights the leaf masses as one soft crown (a lit top and sunward side, a darker
    // underside) instead of every bump on its own (the 'broccoli')
    // (the crown centre from the plant index: no extra state carried through the bake loop; a larger live state there
    // tripped a miscompile on Apple GPUs: NaN normals in whole tile rows for some stripe sequences)
    if (id == I_DECI || id == I_OAK || id == I_FRUIT) {
      vec3 ctr = id == I_FRUIT ? fruitC(FT[int(pi)]) : vec3(BT[int(pi)].x, BT[int(pi)].z, BT[int(pi)].y);
      vec3 rv = (pos - ctr) * vec3(1.0, 1.3, 1.0);
      nS = normalize(mix(nG, rv * inversesqrt(max(dot(rv, rv), 1e-6)), 0.7));
    }
    alb *= (0.75 + 0.5 * sat(0.5 + 0.5 * f0)) * mix(1.0, 0.55 + 0.9 * sat(0.5 + 0.6 * s0), fine);
  } else if (id == I_TWIG || id == I_PTRUNK || id == I_DTRUNK) {
    float pi = floor(aux * 0.5 + 0.001);
    sway = aux - 2.0 * pi;
    mat = id == I_PTRUNK ? M_PALM : id == I_TWIG ? M_FRUIT : M_TREE;
    alb = bareV() ? vec3(0.1, 0.088, 0.078) : vec3(0.13, 0.1, 0.075);
    if (id == I_PTRUNK) {
      float ring = smoothstep(0.3, 0.0, abs(fract(pos.y / 0.16) - 0.5) - 0.2);
      alb = mix(vec3(0.17, 0.14, 0.115), vec3(0.11, 0.09, 0.07), ring) * (0.85 + 0.3 * vn(vec2(pos.y * 3.0, atan(pos.z, pos.x))));
    }
    snowT = nG.y > 0.6 ? 0.35 : 9.0;
  }
  if (shelter > 0.5) snowT = 9.0;
  o0 = vec4(t, mat + 0.9 * sat(sway), sh, ao);
  o1 = vec4(alb, snowT);
  // (a NaN guard: a non-finite normal falls back to the geometric one)
  if (!(abs(dot(nS, nS) - 1.0) < 0.01)) nS = nG;
  if (!(abs(dot(nD, nD) - 1.0) < 0.01)) nD = nS;
  o2 = vec4(octEnc(hsp(nD)), octEnc(hsp(nS)));
  g3.a = 0.5 * shelter + 0.5 * min(haze, 0.99);
  o3 = floor(clamp(g3, 0.0, 1.0) * 255.0 + 0.5) / 255.0;    // 8-bit steps, so the RGBA16F fallback stores (and shades) the same values
}

// the far backdrop cards: evergreen canopy (4), distant palms (3), neighbour roofs (6)
void cardMaterials(float t, float cid, vec3 pos, vec3 n, float cvar, float haze) {
  float mat = M_CYPRESS, snowT = 0.66 + 0.8 * (1.0 - n.y);
  // far canopy: per-crown greens (olive .. blue-green), leafy speckle, darker into the canopy below the crown tops
  float lf = vn(pos.xy * 6.0) * 0.6 + vn(pos.xy * 15.0 + 3.0) * 0.4;
  vec3 alb = mix(vec3(0.034, 0.06, 0.03), vec3(0.05, 0.068, 0.028), cvar) * (0.75 + 0.3 * (vn(pos.xy * 1.7) * 0.5 + 0.5)) * (0.8 + 0.35 * lf);
  alb *= mix(0.6, 1.0, smoothstep(0.0, 0.6, n.y));
  n = normalize(n + vec3(vn(pos.xy * 5.0 + 1.0), vn(pos.xy * 5.0 + 7.0), 0.0) * 0.35);
  vec4 g3 = vec4(0.0, 1.0, cvar, 0.0);          // r 0: never a flowering shrub
  if (cid == I_CARDROOF) { mat = M_ROOF; alb = vec3(0.1, 0.095, 0.09) * (0.8 + 0.3 * cvar); snowT = 0.12; g3.g = 0.0; }
  if (cid == I_CARDPALM) { mat = M_PALM; alb = vec3(0.07, 0.1, 0.045); g3.r = 0.0; snowT = 1.25; }
  float sh = 0.6 + 0.4 * smoothstep(-0.4, 0.6, vn(pos.xy * 0.35));
  o0 = vec4(t, mat + 0.9 * 0.3 * sat(pos.y / 14.0), sh, 0.72);
  o1 = vec4(alb, snowT);
  o2 = vec4(octEnc(hsp(n)), octEnc(hsp(n)));
  o3 = g3Pack(g3, 0.0, haze);
}
`;
  C.HOUSE_MAIN = `
// Every distance query of main() goes through this ONE call site (the phase state machine drives it), so the scene's
// SDFs are inlined exactly once (compile time). mode 0: the ground heightfield only (bisection, ground normals);
// 1: the full scene (march, object normals, the sun shadow, AO). Returns min(objects, ground); dObj = the objects alone
// (the march steps the ground along the ray instead), dG = height above the ground
float sceneQ(vec3 p, int mode, out float id, out float aux, out float dObj, out float dG) {
  dG = p.y - groundH(p.xz);
  id = I_GROUND; aux = 0.0; dObj = 1e5;
  if (mode == 0) return dG;
  float tid, ta, d;
  d = curbsSDF(p); if (d < dObj) { dObj = d; id = I_CURB; }
  d = houseSDF(p, tid); if (d < dObj) { dObj = d; id = tid; }
  d = propsSDF(p, tid); if (d < dObj) { dObj = d; id = tid; }
  d = neighSDF(p, tid); if (d < dObj) { dObj = d; id = tid; }
  d = fruitSDF(p, tid, ta); if (d < dObj) { dObj = d; id = tid; aux = ta; }
  d = palmsSDF(p, tid, ta); if (d < dObj) { dObj = d; id = tid; aux = ta; }
  d = cypressSDF(p, ta); if (d < dObj) { dObj = d; id = I_CYP; aux = ta; }
  d = broadSDF(p, tid, ta); if (d < dObj) { dObj = d; id = tid; aux = ta; }
  if (dG < dObj) id = I_GROUND;
  return min(dObj, dG);
}

// The bare variant's twig haze: the fine twigs of the bare crowns (the three deciduous trees, the five fruit trees) as
// a density, the ray's chord through each crown sphere in front of the hit (tEnd), weighted by rim^2 so no disc edge
// shows. Also the dominant crown (its id, the chord midpoint, its sway weight): where the haze lies over the sky the
// pixel becomes a haze surface there
float twigHaze(vec3 ro, vec3 rd, float tEnd, out float tMid, out float hid, out float hsw) {
  float haze = 0.0, best = 0.0; tMid = 0.0; hid = M_TREE; hsw = 0.0;
  vec3 hc = vec3(0.0); float hR = 1.0;
  for (int i = 0; i < 8; i++) {
    vec3 c; float Rh, wgt = 1.0, H;
    if (i < 3) { vec4 B = BT[i + 1]; c = vec3(B.x, B.z + 0.15 * B.w, B.y); Rh = B.w; H = B.z + B.w; }
    else { vec4 T = FT[i - 3]; c = fruitC(T) + vec3(0.0, 0.13, 0.0); Rh = T.z; wgt = 0.45; H = 2.6; }
    vec3 oc = ro - c; float b = dot(oc, rd), cc = dot(oc, oc) - Rh * Rh, disc = b * b - cc;
    if (disc > 0.0) {
      float sq_ = sqrt(disc); float t0 = max(-b - sq_, 0.0), t1 = min(-b + sq_, tEnd);
      float rim = sat(disc / (Rh * Rh));                  // 1 through the centre .. 0 at the rim
      if (t1 > t0) {
        float h = (t1 - t0) / Rh * wgt * rim * rim;
        haze += h;
        if (h > best) { best = h; tMid = 0.5 * (t0 + t1); hid = i < 3 ? M_TREE : M_FRUIT; hsw = SWAYK * 0.7 * sqrt(H / 18.0); hc = c; hR = Rh; }
      }
    }
  }
  if (best <= 0.0) return 0.0;
  // fibres: twigs radiate up and out from the fork of the dominant crown; seen across the ray they are fine radial
  // streaks (angle around the fork in the view plane, ~2-3 px apart at the rim) that break the haze into twig bundles
  vec3 fk = hc - vec3(0.0, 0.75 * hR, 0.0);
  vec3 v = ro + rd * dot(fk - ro, rd) - fk;
  vec3 sd = normalize(cross(rd, vec3(0.0, 1.0, 0.0)));
  float th = atan(dot(v, sd), v.y + 1e-4), rr = length(v) / hR;
  float th2 = th + 0.05 * vn(vec2(rr * 7.0, th * 5.0)) + 0.025 * vn(vec2(rr * 19.0, th * 13.0));   // wavy, crooked twigs
  float fib = 0.6 * vn(vec2(th2 * 70.0, rr * 2.2)) + 0.4 * vn(vec2(th2 * 170.0, rr * 6.0 + 7.0));
  fib -= 0.5 * smoothstep(0.1, 0.7, vn(vec2(th2 * 30.0 + 5.0, rr * 9.0)));                        // broken into short runs
  return sat(haze * 0.5 * (0.45 + 1.1 * smoothstep(-0.25, 0.45, fib)));
}

void main() {
  // ---- copy mode: the variant dissolve (render.js). A smooth screen noise orders the pixels (clusters of ~20 px with
  // a fine jitter); the band [y, z) of this frame is copied from the new variant into the shown buffer
  if (uDissolve.x > 0.5) {
    vec2 f = gl_FragCoord.xy;
    ivec2 ip = ivec2(f);
    float n = 0.62 * tnoise(f * 0.045 + 3.7) + 0.28 * tnoise(f * 0.17 + 11.0) + 0.1 * hash2(f);
    n = 1.0 / (1.0 + exp(-13.4 * (n - 0.5)));      // ~uniform (the sum is ~normal, sd ~.127): an even dissolve
    // (stage 2b) where the new variant shows a hard surface (a wall, the roof, the ground: what changes there is mostly
    // the crowns' shadow and AO), a per-pixel random order instead: the shadow fades out / in as a fine dither, not in
    // blotches across the garage door; the crowns and the sky behind them keep the leaf clusters
    float m = floor(texelFetch(uN0, ip, 0).y + 0.001);
    if (texelFetch(uN0, ip, 0).x < 60000.0 && (m < M_FRUIT || m > M_TREE)) n = hash2(f + 0.5);
    if (n < uDissolve.y || n >= uDissolve.z) discard;
    o0 = texelFetch(uN0, ip, 0); o1 = texelFetch(uN1, ip, 0); o2 = texelFetch(uN2, ip, 0); o3 = texelFetch(uN3, ip, 0);
    return;
  }
  // ---- the bake, in house space
  vec3 rd = hsp(camRay(gl_FragCoord.xy)), ro = hsp(uCamPos), sun = hsp(uSunDir);
  float tc, cid, cvar; vec3 cn;
  bool card = cardsHit(ro, rd, tc, cid, cn, cvar);
  float tMax = card ? tc : 420.0;
  float t = 0.5, tPrev = t, id = 0.0, aux = 0.0, bA = 0.0, bB = 0.0, hRad = 1.0;
  bool oBis = false;          // phase 1 bisects an object hit that landed inside (the leafy noise is not 1-Lipschitz)
  vec3 pos = vec3(0.0), nG = vec3(0.0, 1.0, 0.0), so = vec3(0.0);
  float fp = 0.0, sh = 1.0, ts = 0.0, ao = 1.0, occ = 0.0, wsum = 0.0;
  vec4 tet = vec4(0.0);
  bool hit = false, gHit = false;
  int phase = 0, j = 0, mi = 0;
  const vec2 k2 = vec2(1.0, -1.0);
  // phases: 0 march -> 1 bisection (the ground, or an object hit inside) -> 2 normal probes -> 3 soft sun shadow ->
  // 4 AO probes -> 5 done
  for (int it = 0; it < uIter; it++) {
    vec3 q; int mode;
    if (phase == 0) { q = ro + rd * t; mode = 1; gFp = t * uPixAng; }
    else if (phase == 1) { q = ro + rd * (0.5 * (bA + bB)); mode = oBis ? 1 : 0; }
    else if (phase == 2) {
      gFp = fp;
      if (gHit) { float e = max(0.004, fp * 0.5); vec2 o = j == 0 ? vec2(e, 0.0) : j == 1 ? vec2(-e, 0.0) : j == 2 ? vec2(0.0, e) : vec2(0.0, -e); q = vec3(pos.x + o.x, pos.y, pos.z + o.y); mode = 0; }
      else { float e = max(0.0015, fp * 0.35); vec3 kk = j == 0 ? k2.xyy : j == 1 ? k2.yyx : j == 2 ? k2.yxy : k2.xxx; q = pos + kk * e; mode = 1; }
    }
    else if (phase == 3) { q = so + sun * ts; mode = 1; }
    else if (phase == 4) { q = pos + nG * (0.04 * pow(3.0, float(j))); mode = 1; }
    else break;
    gMargin = phase == 3 ? max(0.35, ts * 0.12) : phase == 4 ? max(0.35, 0.04 * pow(3.0, float(j))) : 0.35;
    float m_, a_, dO, dG;
    float d = sceneQ(q, mode, m_, a_, dO, dG);
    if (phase == 0) {
      float qf = t * uPixAng, eps = max(0.35 * qf, 0.002);
      if (dG < eps) { hit = true; gHit = true; id = I_GROUND; bA = tPrev; bB = t; phase = 1; j = 0; }
      else if (dO < eps) {
        hit = true; id = m_; aux = a_; pos = q; fp = qf; hRad = gRad; phase = 2; j = 0;
        if (dO < -0.3 * eps) { oBis = true; bA = tPrev; bB = t; phase = 1; }
      }
      else if (t > tMax || ++mi >= 300) break;
      else {
        // ground stepped along the ray: the yard is nearly flat (slope <= ~0.1 outside short ramps under curbs); an
        // overshoot below the ground is caught above (dG < eps) and bisected
        float gs = rd.y < 0.1 ? dG / max(0.1 - rd.y, 0.02) : 1e5;
        tPrev = t; t += max(min(dO, max(gs, dG)), 0.3 * qf);
      }
    } else if (phase == 1) {
      float mt = 0.5 * (bA + bB), dd = oBis ? dO : d;
      if (dd < 0.0) bB = mt; else bA = mt;
      if (oBis && dd < 0.35 * mt * uPixAng) { id = m_; aux = a_; hRad = gRad; }
      if (++j >= 7) { t = oBis ? bA : bB; pos = ro + rd * t; fp = t * uPixAng; phase = 2; j = 0; }
    } else if (phase == 2) {
      tet[j] = gHit ? dG : dO;
      if (++j >= 4) {
        if (gHit) { float e = max(0.004, fp * 0.5); nG = normalize(vec3(tet.y - tet.x, 2.0 * e, tet.w - tet.z)); }
        else nG = normalize(k2.xyy * tet.x + k2.yyx * tet.y + k2.yxy * tet.z + k2.xxx * tet.w);
        // (a NaN guard: a zero or non-finite gradient, e.g. a flat early-out bound, falls back to facing the ray, so the
        // shadow and AO probes below start from a real point)
        if (!(abs(dot(nG, nG) - 1.0) < 0.01)) nG = gHit ? vec3(0.0, 1.0, 0.0) : -rd;
        if (dot(nG, sun) > -0.05) { so = pos + nG * max(0.012, fp * 1.5); ts = 0.02; phase = 3; j = 0; }
        else { sh = 0.0; phase = 4; j = 0; }
      }
    } else if (phase == 3) {
      sh = min(sh, 14.0 * d / ts);
      ts += clamp(d * 0.8, 0.012 + ts * 0.004, 2.5);
      if (sh < 0.003 || ++j >= 110 || ts > 160.0 || so.y + sun.y * ts > 24.0) { phase = 4; j = 0; }
    } else if (phase == 4) {
      float hh = 0.04 * pow(3.0, float(j));
      occ += clamp((hh - d) / hh, 0.0, 1.0) / float(j + 1); wsum += 1.0 / float(j + 1);
      if (++j >= 5) { ao = clamp(1.0 - 1.35 * occ / wsum, 0.0, 1.0); phase = 5; }
    }
  }
  // the bare variant's twig haze in front of the hit (or the card / the sky)
  float haze = 0.0, tMid, hid, hsw;
  if (bareV()) haze = twigHaze(ro, rd, hit ? t : card ? tc : 1e5, tMid, hid, hsw);
  if (!hit && card) { cardMaterials(tc, cid, ro + rd * tc, cn, cvar, haze); return; }
  if (!hit) {
    // haze over the sky: a twig-haze surface at the crown (G3.g .5 marks it), except one keeper pixel per 2x2 block
    // that stays sky (the half-res cloud pass then still sees the sky there and draws the clouds behind the haze)
    ivec2 ip = ivec2(gl_FragCoord.xy);
    int keep = int(hash2(vec2(ip / 2) + 0.5) * 4.0);
    if (haze > 0.03 && (ip.x & 1) + 2 * (ip.y & 1) != keep) {
      vec3 nw = normalize(-camRay(gl_FragCoord.xy) + vec3(0.0, 0.6, 0.0));
      o0 = vec4(tMid, hid + 0.9 * sat(hsw), 1.0, 1.0);
      o1 = vec4(0.1, 0.088, 0.078, 0.35);
      o2 = vec4(octEnc(nw), octEnc(nw));
      o3 = g3Pack(vec4(0.0, 0.5, 0.5, 0.0), 0.0, haze);
      return;
    }
    o0 = vec4(65000.0, 0.0, 1.0, 1.0); o1 = vec4(0.0); o2 = vec4(0.0); o3 = vec4(0.0); return;
  }
  if (!(sh > -1e30)) sh = 1.0;         // (NaN guards: a non-finite probe never reaches the G-buffer; sh < 0 is a
  if (!(ao >= 0.0)) ao = 1.0;          // valid full shadow, clamped below)
  sh = smoothstep(0.0, 1.0, clamp(sh, 0.0, 1.0));
  houseMaterials(t, id, aux, pos, nG, fp, sh, ao, hRad, haze);
}
`;
  S.glsl.progs['gbuf@house'] = { vs: ['VS_FULL'], fs: ['COMMON', 'HOUSE_HEAD', 'GBUF_NOISE', 'HOUSE_IDS', 'HOUSE_SDF', 'HOUSE_MAT', 'HOUSE_MAIN'] };
})(window.SNOW);
