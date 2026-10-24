// =====================================================================================
//  GLSL: the house scene's geometry (Phase-3 owner: lane H), for its G-buffer bake (gbuf-house.js).
//   HOUSE_IDS    the house's material ids, the house-space mirror hsp() and the light positions (shared by the bake and
//                SURFACE_HOUSE; the table is ARCHITECTURE.md §14 and the comment below)
//   HOUSE_SDF    primitives, the lot (ground heightfield, curbs), the house, the neighbours / fence / street lamp, the
//                cozy props, the vegetation (fruit trees, shrubs, palms, cypresses, broadleaf trees; the bare winter
//                skeletons of the variant bake), the far backdrop cards. Queried only through sceneQ (HOUSE_MAIN).
//  A 3D interpretation of the style of the user's California ranch house (never the photo; no car, no street-sign
//  text, no house number), ported from the feasibility spike (work/phase3/spike/house-glsl.js) and improved: open,
//  irregular broadleaf crowns, a shaggy palm skirt with hanging dead fronds, frond tips that never get thinner than a
//  pixel, door planters, a bench and wheelie bins. Step 2 (the look) added a bed of flowering perennials along the
//  foundation (I_FLOWER: low clumps in the gravel strip between the shrubs; material 4 with G3.r >= .75, see HOUSE_IDS).
//
//  HOUSE SPACE (metres, y up): the street runs along x, the house faces +z, its front wall at z = 0, the camera stands
//  on the street (z ~ 22.5) looking toward -z with +x on the right. The engine's yaw-0 camera looks toward +z with +x on
//  the right, so WORLD = house space mirrored in z: hsp(p) maps either way (an involution). The bake marches in house
//  space and flips its normals back (houseMaterials); the shading works in world space and uses hsp() for the lights.
//  Main body x -2.5 .. 11, z -9 .. 0 (side gable, ridge 4.84 m along x), garage wing x -9.4 .. -2.5 protruding to z 2.4
//  (front gable, ridge along z), eaves 2.72 m; lawn to z 11, sidewalk 11 .. 12.5, parkway, curb 14.275, street to 25.65.
//
//  Rules: one query (sceneQ, HOUSE_MAIN); a group far from p returns its TRUE 3D bound only when that bound exceeds
//  gMargin (0.35 while marching, max(0.35, 0.12 ts) along a shadow ray, the probe length for AO taps): a bound is only
//  a lower bound of the distance, and the soft shadow reads d / ts as a penumbra (slab / 1D bounds printed contour
//  bands on the walls in the spike). gFp is the pixel footprint (m) of the current query: thin parts (frond blades,
//  their finger gaps, twigs) are widened to it, so they cover whole pixels instead of stippling.
// =====================================================================================
(function (S) {
  'use strict';
  const C = S.glsl.chunks;
  // Material ids (G0.y = id + 0.9 x the sway weight; vegetation 2..5 only). G3 (RGBA8): r variation, g water / leaf,
  // b object random / light mask, a = 0.5 x shelter + 0.5 x twig haze (bare variant). Full table: ARCHITECTURE.md §14.
  //   1 lawn, 2 fruit tree, 3 palm, 4 evergreen (cypress, live oak, shrubs, planter balls, the backdrop canopy; G3.r:
  //   < .45 plain, .45 .. .7 a lavender-flowering shrub, >= .75 a flowering perennial of the foundation bed, its colour by G3.b),
  //   5 deciduous tree, 6 roof shingles, 7 cedar siding, 8 painted trim / stucco, 9 window glass (G1 = the lit room as
  //   an emission colour), 10 garage door (b: its arched panes, G1 = their emission), 11 concrete, 12 asphalt,
  //   13 brick / terracotta, 14 gravel, 15 wood (fence, bench), 16 lamp (b: lantern glass), 17 soil / mulch / doormat,
  //   18 fixtures (roof vents, flue, wheelie bins: painted metal and plastic)
  C.HOUSE_IDS = `
const float M_LAWN = 1.0, M_FRUIT = 2.0, M_PALM = 3.0, M_CYPRESS = 4.0, M_TREE = 5.0, M_ROOF = 6.0, M_SIDING = 7.0,
            M_TRIM = 8.0, M_GLASS = 9.0, M_GARAGE = 10.0, M_CONCRETE = 11.0, M_ASPHALT = 12.0, M_BRICK = 13.0,
            M_GRAVEL = 14.0, M_FENCE = 15.0, M_LAMP = 16.0, M_SOIL = 17.0, M_METAL = 18.0;
// house space <-> world (the mirror in z; see the file header)
vec3 hsp(vec3 p) { return vec3(p.x, p.y, -p.z); }
// lights (house space): the porch lantern, the street lamp's lantern, the two front windows' spill
const vec3 L_PORCH = vec3(-0.78, 1.86, 0.10);
const vec3 L_POST = vec3(6.8, 3.86, 13.4);
const vec3 L_WIN0 = vec3(2.7, 1.45, 0.45), L_WIN1 = vec3(7.7, 1.45, 0.45);
`;
  C.HOUSE_SDF = `
// ---------------------------------------------------------------- SDF primitives
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdBox2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float sdSeg(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdSegT(vec3 p, vec3 a, vec3 b, float r0, float r1) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - mix(r0, r1, h); }
float rectSDF(vec2 p, vec4 r) { return sdBox2(p - 0.5 * vec2(r.x + r.y, r.z + r.w), 0.5 * vec2(r.y - r.x, r.w - r.z)); }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
// leafy clump noise: two octaves of 3D value noise, ~[-1, 1]
float leafN(vec3 p) { return 0.65 * vn3(p) + 0.35 * vn3(p * 2.3 + 7.1); }
// (stage 2b) leaf clumps: a broadleaf crown is its leaf masses (the envelope, d) rebuilt as clumps of leaves: rounded
// clumps (spheres jittered on a cs-metre lattice, radius .38-.5 cs; the 2 x 2 x 2 nearest cells are exact for these
// jitters and radii) filling a shell ~half a clump deep under the envelope, cut a little outside it, plus a fine leaf texture
// that fades below ~3 px (fp). Each clump catches the low sun on its own top and falls into shade underneath, and the
// silhouette breaks into clumps against the sky, instead of one smooth, wormy 'broccoli' skin
float leafClumps(float d, vec3 p, float cs, float fp) {
  if (d > 0.75 * cs) return d;
  float w = vn3(p * (0.56 / cs) + 4.1);
  vec3 q = p / cs + vec3(0.45, -0.3, 0.38) * w, b = floor(q - 0.5);      // (a warp: no lattice rows)
  float dc = 1e5;
  for (int k = 0; k < 8; k++) {
    vec3 c = b + vec3(float(k & 1), float((k >> 1) & 1), float(k >> 2));
    vec3 cc = c + 0.25 + 0.5 * vec3(hash3(c), hash3(c + 17.0), hash3(c + 31.0));
    dc = smin(dc, length(q - cc) - (0.3 + 0.2 * hash3(c + 53.0)), 0.22);
  }
  float f1 = smoothstep(1.5 * fp, 3.0 * fp, 0.18 * cs), f2 = smoothstep(1.5 * fp, 3.0 * fp, 0.08 * cs);
  dc = dc * cs + 0.075 * cs * f1 * vn3(p * (5.6 / cs) + 2.3) + 0.04 * cs * f2 * vn3(p * (12.0 / cs) + 8.1);
  return max(d - 0.15 * cs, min(dc, d + 0.5 * cs));
}

// ---------------------------------------------------------------- query state (out-of-band, set by main / the query)
float gRad = 1.0;       // crown radial position of the last foliage hit (0 core .. 1 rim): the materials darken the interior
float gMargin = 0.35;   // bounding-volume early-out margin (see the header)
float gFp = 0.01;       // pixel footprint (m) of the current query (see the header)
bool bareV() { return uVariant > 0.5; }
// the sway weight scale: FS_SHADE's reference sways an 18 m tree top ~2-3 m in a gale (fine for the valley's far
// forest); from 25-45 m away that tears thin trunks off their crowns, so the house's plants sway ~0.3 of it
const float SWAYK = 0.3;    // the bare winter variant bake (deciduous / fruit crowns -> skeletons + haze)

// ---------------------------------------------------------------- layout (house space, metres)
const float Z_SW0 = 11.0, Z_SW1 = 12.5, Z_CURB = 14.275, Z_GUT = 14.8;
const float DRV0 = -9.8, DRV1 = -2.6;                  // driveway x range (in front of the garage)
const float PITCH = 0.42, PCOS = 0.92164, PSIN = 0.38709, YE = 2.72, RT = 0.2;   // 5:12 roof, eave top, slab
const vec4 MB = vec4(-2.5, 11.0, -9.0, 0.0);            // main body walls x0 x1 z0 z1
const vec4 MR = vec4(-2.85, 11.35, -9.55, 0.55);        // main roof (side gable, ridge along x at z = -4.5)
const vec4 GB = vec4(-9.4, -2.5, -7.0, 2.4);            // garage wing walls (protrudes 2.4 m)
const vec4 GR = vec4(-9.85, -2.05, -7.2, 2.85);         // garage roof (front gable, ridge along z at x = -5.95)
const vec2 WIN0 = vec2(2.7, 1.62), WIN1 = vec2(7.7, 1.62), WINH = vec2(0.8, 0.675);
const vec3 DOOR = vec3(-1.52, 1.03, 0.0); const vec2 DOORH = vec2(0.47, 1.03);
const vec3 GDOOR = vec3(-5.95, 1.08, 2.4); const vec2 GDOORH = vec2(2.45, 1.08);

// detailed ids returned by the query (houseMaterials maps them to the M_* table)
const float I_GROUND = 10.0, I_CURB = 11.0, I_WALL = 20.0, I_TRIM = 21.0, I_ROOF = 22.0, I_GLASS = 23.0, I_DOOR = 24.0,
            I_GDOOR = 25.0, I_VENT = 27.0, I_LANTERN = 28.0, I_FRUIT = 30.0, I_TWIG = 31.0, I_PTRUNK = 32.0,
            I_FROND = 33.0, I_SKIRT = 34.0, I_CYP = 35.0, I_DECI = 36.0, I_DTRUNK = 37.0, I_SHRUB = 38.0, I_OAK = 39.0,
            I_FENCE = 40.0, I_NWALL = 41.0, I_NROOF = 42.0, I_NWALL2 = 43.0, I_POST = 44.0, I_LAMPG = 45.0,
            I_POT = 46.0, I_BENCH = 47.0, I_BIN = 48.0, I_BALL = 49.0,
            I_CARD = 50.0, I_CARDROOF = 51.0, I_CARDPALM = 52.0, I_FLOWER = 53.0;

float lawnEdge(float z) { return -0.45 - 2.15 * smoothstep(1.2, 6.8, z); }   // front lawn is x > lawnEdge(z)
float inDrive(float x) { return smoothstep(DRV0 - 0.15, DRV0 + 0.15, x) * smoothstep(DRV1 + 0.15, DRV1 - 0.15, x); }
float frontLawn(float x, float z) {
  return smoothstep(0.06, 0.2, x - lawnEdge(z)) * smoothstep(0.78, 0.92, z) * smoothstep(11.0, 10.85, z) * smoothstep(23.0, 22.8, x);
}

// ---------------------------------------------------------------- ground: a gentle heightfield (slope <= ~0.1 outside
// short ramps); every vertical face (street curb, the curved mow curb, the stoop) is an SDF object, so the march can
// step the ground along the ray (main): a grazing ray over the yard costs ~10 steps instead of ~100
float groundH(vec2 q) {
  float x = q.x, z = q.y;
  if (z > 14.3) return -0.15 + 0.07 * (1.0 - sq(clamp((z - 20.2) / 5.5, -1.0, 1.0)));   // crowned street
  float y = -0.12 * inDrive(x) * smoothstep(12.6, 14.25, z);                           // driveway apron
  float lawn = frontLawn(x, z);
  y += lawn * (0.05 + 0.1 * smoothstep(10.9, 4.0, z) * smoothstep(-1.0, 3.0, x) * smoothstep(21.0, 14.0, x));
  y += 0.04 * smoothstep(0.85, 0.7, z) * step(-0.45, x) * step(x, 11.0) * step(-0.1, z); // gravel strip
  return y;
}

float curbsSDF(vec3 p) {
  float top = -0.115 * inDrive(p.x);
  float d = sdBox2(vec2(p.z - Z_CURB, p.y - (top - 0.16)), vec2(0.062, 0.145)) - 0.014;
  // the curved mow curb between the lawn and the walkway / driveway
  float cb = sdBox(p - vec3(-1.55, 0.04, 5.89), vec3(1.4, 0.1, 5.12));
  if (cb > gMargin) d = min(d, cb);
  else {
    float e = lawnEdge(p.z), de = (lawnEdge(p.z + 0.05) - lawnEdge(p.z - 0.05)) * 10.0;
    float dx = (p.x - e) / sqrt(1.0 + de * de);
    float c = sdBox2(vec2(dx, p.y - 0.035), vec2(0.065, 0.075)) - 0.01;
    d = min(d, max(c, max(0.78 - p.z, p.z - 11.0)));
  }
  // the front stoop (concrete step at the door)
  d = min(d, sdBox(p - vec3(-1.47, 0.055, 0.62), vec3(1.0, 0.055, 0.62)) - 0.01);
  return d;
}

// ---------------------------------------------------------------- the house
float gableX(vec2 xz, vec4 r) { return YE + PITCH * min(xz.y - r.z, r.w - xz.y); }   // ridge along x (main)
float gableZ(vec2 xz, vec4 r) { return YE + PITCH * min(xz.x - r.x, r.y - xz.x); }   // ridge along z (garage)
// a roof is a slab RT thick under the slope planes, clipped to its footprint: shingles on top, fascia / rake boards
// on its edges, soffit underneath; the walls rise to its underside, so the gable triangles form by themselves
float roofSlab(vec3 p, float h, vec4 r) { return max((abs(p.y - h + 0.5 * RT) - 0.5 * RT) * PCOS, rectSDF(p.xz, r)); }

float windowFill(vec3 p, vec2 c, out float id) {
  vec3 q = p - vec3(c, 0.0);
  float g = sdBox(q - vec3(0.0, 0.0, -0.105), vec3(WINH, 0.008));
  float fr = max(sdBox(q - vec3(0.0, 0.0, -0.075), vec3(WINH, 0.026)), -sdBox(q - vec3(0.0, 0.0, -0.075), vec3(WINH - 0.055, 0.1)));
  fr = min(fr, sdBox(q - vec3(0.0, 0.0, -0.068), vec3(0.03, WINH.y, 0.03)));             // slider meeting rail
  float mun = min(abs(abs(q.x) - 0.4), abs(abs(q.y) - 0.225)) - 0.011;                    // 3 x 2 lites per sash
  mun = max(max(mun, abs(q.z + 0.088) - 0.011), sdBox2(q.xy, WINH));
  float cas = max(sdBox(q, vec3(WINH + 0.09, 0.028)), -sdBox(q, vec3(WINH, 0.5)));
  float sill = sdBox(q - vec3(0.0, -WINH.y - 0.06, 0.05), vec3(WINH.x + 0.13, 0.035, 0.06));
  float tr = min(min(fr, mun), min(cas, sill));
  id = tr < g ? I_TRIM : I_GLASS;
  return min(tr, g);
}

float houseSDF(vec3 p, out float id) {
  id = I_WALL;
  float bb = sdBox(p - vec3(0.75, 2.6, -3.35), vec3(11.0, 2.75, 6.7));
  if (bb > gMargin) return bb;
  vec2 xz = p.xz;
  float hM = gableX(xz, MR), hG = gableZ(xz, GR);
  float d = min(roofSlab(p, hM, MR), roofSlab(p, hG, GR)); id = I_ROOF;
  float wM = max(sdBox(p - vec3(4.25, 2.5, -4.5), vec3(6.75, 2.5, 4.5)), p.y - hM + RT);
  float wG = max(sdBox(p - vec3(-5.95, 2.5, -2.3), vec3(3.45, 2.5, 4.7)), p.y - hG + RT);
  float w = min(wM, wG);
  float op = min(min(sdBox(p - vec3(WIN0, 0.0), vec3(WINH, 0.12)), sdBox(p - vec3(WIN1, 0.0), vec3(WINH, 0.12))),
                 min(sdBox(p - DOOR, vec3(DOORH, 0.09)), sdBox(p - GDOOR, vec3(GDOORH, 0.13))));
  w = max(w, -op);
  if (w < d) { d = w; id = I_WALL; }
  float tid, dd;
  // front details (windows, door, garage door, trims, lantern, gutters, downspouts) behind one cheap region test
  if (p.z > -0.3 && p.y < 3.0) {
    if (abs(p.x - 5.2) < 3.4 && p.y > 0.7) {
      dd = windowFill(p, WIN0, tid); if (dd < d) { d = dd; id = tid; }
      dd = windowFill(p, WIN1, tid); if (dd < d) { d = dd; id = tid; }
    }
    vec3 q = p - DOOR;
    dd = sdBox(q - vec3(0.0, 0.0, -0.065), vec3(DOORH, 0.022)); if (dd < d) { d = dd; id = I_DOOR; }
    dd = max(sdBox(q - vec3(0.0, 0.03, 0.0), vec3(DOORH + vec2(0.1, 0.03), 0.026)), -sdBox(q, vec3(DOORH, 0.5)));
    if (dd < d) { d = dd; id = I_TRIM; }
    q = p - GDOOR;
    dd = sdBox(q - vec3(0.0, 0.0, -0.1), vec3(GDOORH, 0.02)); if (dd < d) { d = dd; id = I_GDOOR; }
    dd = max(sdBox(q - vec3(0.0, 0.04, 0.0), vec3(GDOORH + vec2(0.12, 0.04), 0.03)), -sdBox(q, vec3(GDOORH, 0.5)));
    dd = min(dd, sdBox(p - vec3(-5.95, 2.56, 2.43), vec3(3.47, 0.06, 0.035)));                // band under the gable
    dd = min(dd, sdBox(vec3(abs(p.x + 5.95) - 3.42, p.y - 1.28, p.z - 2.41), vec3(0.06, 1.28, 0.04)));   // corner boards
    dd = min(dd, sdBox(p - vec3(4.25, 2.565, 0.63), vec3(7.1, 0.065, 0.075)));                // main front gutter
    dd = min(dd, sdBox(vec3(abs(p.x + 5.95) - 3.98, p.y - 2.565, p.z + 2.175), vec3(0.065, 0.065, 5.025)));  // garage gutters
    dd = min(dd, sdBox(vec3(abs(p.x + 5.95) - 3.52, p.y - 1.3, p.z - 2.47), vec3(0.04, 1.3, 0.04)));       // downspouts
    dd = min(dd, sdBox(p - vec3(10.93, 1.3, 0.07), vec3(0.04, 1.3, 0.04)));
    if (dd < d) { d = dd; id = I_TRIM; }
    dd = sdBox(p - L_PORCH, vec3(0.07, 0.13, 0.07)); if (dd < d) { d = dd; id = I_LANTERN; }
    dd = min(sdBox(p - L_PORCH - vec3(0.0, 0.15, 0.0), vec3(0.1, 0.022, 0.1)), sdBox(p - L_PORCH - vec3(0.0, 0.0, -0.06), vec3(0.03, 0.03, 0.06)));
    if (dd < d) { d = dd; id = I_POST; }
  }
  // roof vents (on the front slope) and a flue on the garage roof
  if (p.y > 3.0) {
    vec3 q = vec3(p.x - (p.x < 3.0 ? 0.8 : p.x < 6.6 ? 4.6 : 8.4), p.y - 4.27, p.z + 3.0);
    dd = sdBox(q, vec3(0.24, 0.11, 0.22)) - 0.01;
    q = p - vec3(-3.3, 3.55, -1.0);
    dd = min(dd, max(length(q.xz) - 0.075, abs(q.y) - 0.45));
    dd = min(dd, max(length(q.xz) - 0.14, abs(q.y - 0.5) - 0.06));
    if (dd < d) { d = dd; id = I_VENT; }
  }
  return d;
}

// ---------------------------------------------------------------- the cozy props: terracotta planters with clipped
// boxwood balls flanking the door, a slatted bench under the right window, two wheelie bins beside the garage
float propsSDF(vec3 p, out float id) {
  id = I_POT;
  float d = 1e5;
  // planters on the stoop (top y 0.11)
  float bb = sdBox(p - vec3(-1.5, 0.6, 0.38), vec3(1.0, 0.5, 0.3));
  if (bb > gMargin) d = bb;
  else {
    vec3 q = vec3(abs(p.x + 1.51) - 0.75, p.y - 0.11, p.z - 0.36);
    float r = mix(0.15, 0.205, sat(q.y / 0.4));
    float pot = max(length(q.xz) - r, abs(q.y - 0.21) - 0.21) * 0.9;
    pot = min(pot, max(length(q.xz) - 0.225, abs(q.y - 0.395) - 0.03));               // the rolled rim
    pot = max(pot, -(max(length(q.xz) - 0.18, 0.36 - q.y)));                           // hollow above the soil
    d = pot;
    float ball = (length(q - vec3(0.0, 0.62, 0.0)) - 0.235 + 0.025 * leafN(p * 14.0)) * 0.7;
    if (ball < d) { d = ball; id = I_BALL; }
  }
  // the bench under the right window, between the shrubs (seat 0.44 m, back to 0.86 m)
  bb = sdBox(p - vec3(7.68, 0.45, 0.3), vec3(0.6, 0.47, 0.25));
  if (bb > gMargin) d = min(d, bb);
  else {
    vec3 q = p - vec3(7.68, 0.0, 0.3);
    float seat = sdBox(q - vec3(0.0, 0.43, 0.02), vec3(0.53, 0.022, 0.19)) - 0.006;
    float back = sdBox(q - vec3(0.0, 0.67, -0.17), vec3(0.53, 0.11, 0.016)) - 0.006;
    float legs = sdBox(vec3(abs(q.x) - 0.47, q.y - 0.22, q.z), vec3(0.025, 0.22, 0.19));
    float post = sdBox(vec3(abs(q.x) - 0.47, q.y - 0.44, q.z + 0.17), vec3(0.025, 0.44, 0.02));
    float arm = sdBox(vec3(abs(q.x) - 0.47, q.y - 0.62, q.z), vec3(0.028, 0.018, 0.2));
    float b = min(min(seat, back), min(min(legs, post), arm));
    if (b < d) { d = b; id = I_BENCH; }
  }
  // two wheelie bins in the side yard left of the garage
  bb = sdBox(p - vec3(-10.6, 0.55, 1.2), vec3(0.85, 0.6, 0.45));
  if (bb > gMargin) d = min(d, bb);
  else {
    vec3 q = p - vec3(p.x < -10.6 ? -10.98 : -10.22, 0.0, 1.2);
    float w = mix(0.255, 0.29, sat(q.y));
    float body = sdBox(q - vec3(0.0, 0.5, 0.0), vec3(w - 0.03, 0.47, w + 0.04)) - 0.03;
    float lid = sdBox(q - vec3(0.0, 1.0, 0.03), vec3(0.3, 0.025, 0.37)) - 0.01;
    float b = min(body, lid) * 0.95;
    if (b < d) { d = b; id = I_BIN; }
  }
  return d;
}

// ---------------------------------------------------------------- neighbours, fence, street lamp
float neighSDF(vec3 p, out float id) {
  id = I_NWALL;
  float d = 1e5;
  // left neighbour: a hip-roofed ranch house with one lit window
  float bb = sdBox(p - vec3(-20.0, 2.5, -4.6), vec3(8.0, 2.7, 6.4));
  if (bb < gMargin) {
    vec4 R = vec4(-27.6, -12.4, -10.6, 1.4);
    float h = 2.6 + 0.4 * min(min(p.x - R.x, R.y - p.x), min(p.z - R.z, R.w - p.z));
    float r = max((abs(p.y - h + 0.1) - 0.1) * 0.928, rectSDF(p.xz, R));
    float w = max(sdBox(p - vec3(-20.0, 2.0, -4.6), vec3(7.0, 2.0, 5.5)), p.y - h + 0.2);
    w = max(w, -sdBox(p - vec3(-14.8, 1.55, 0.9), vec3(0.75, 0.55, 0.1)));
    float g = sdBox(p - vec3(-14.8, 1.55, 0.84), vec3(0.75, 0.55, 0.01));
    float tr = max(sdBox(p - vec3(-14.8, 1.55, 0.9), vec3(0.84, 0.64, 0.025)), -sdBox(p - vec3(-14.8, 1.55, 0.9), vec3(0.75, 0.55, 0.5)));
    d = r; id = I_NROOF;
    if (w < d) { d = w; id = I_NWALL; }
    if (g < d) { d = g; id = I_GLASS; }
    if (tr < d) { d = tr; id = I_TRIM; }
  } else d = bb;
  // the right neighbour's little garage behind the fence (front gable)
  bb = sdBox(p - vec3(17.5, 2.1, -7.1), vec3(3.7, 2.3, 3.8));
  if (bb < gMargin) {
    vec4 R = vec4(14.2, 20.8, -10.6, -3.65);
    float h = 2.45 + 0.5 * min(p.x - R.x, R.y - p.x);
    float r = max((abs(p.y - h + 0.09) - 0.09) * 0.894, rectSDF(p.xz, R));
    float w = max(sdBox(p - vec3(17.5, 2.2, -7.1), vec3(3.0, 2.2, 3.1)), p.y - h + 0.18);
    if (r < d) { d = r; id = I_NROOF; }
    if (w < d) { d = w; id = I_NWALL2; }
  } else d = min(d, bb);
  // wooden fence from the house's right corner, posts behind every 2.4 m, a cap rail
  bb = sdBox(p - vec3(17.0, 1.0, -0.75), vec3(6.1, 1.05, 0.2));
  if (bb < gMargin) {
    float f = sdBox(p - vec3(17.0, 0.93, -0.72), vec3(6.0, 0.93, 0.02));
    float px = mod(p.x - 11.0, 2.4) - 1.2;
    f = min(f, max(sdBox(vec3(px, p.y - 0.97, p.z + 0.8), vec3(0.045, 0.97, 0.045)), abs(p.x - 17.0) - 6.0));
    f = min(f, sdBox(p - vec3(17.0, 1.875, -0.73), vec3(6.0, 0.022, 0.065)));
    if (f < d) { d = f; id = I_FENCE; }
  } else d = min(d, bb);
  // the street lamp where the sign pole stood (no text anywhere)
  vec3 q = p - vec3(L_POST.x, 0.0, L_POST.z);
  bb = sdBox(q - vec3(0.0, 2.2, 0.0), vec3(0.32, 2.25, 0.32));
  if (bb < gMargin) {
    float pole = max(length(q.xz) - 0.055 - 0.08 * smoothstep(0.7, 0.0, q.y), abs(q.y - 1.85) - 1.85);
    pole = min(pole, sdBox(q - vec3(0.0, 3.6, 0.0), vec3(0.11, 0.035, 0.11)));
    pole = min(pole, max(sdBox(q - vec3(0.0, 4.14, 0.0), vec3(0.22, 0.06, 0.22)), q.y - 4.2 + (abs(q.x) + abs(q.z)) * 0.3));
    pole = min(pole, max(length(q.xz) - 0.025, abs(q.y - 4.3) - 0.1));
    vec2 cq = abs(q.xz) - 0.15;
    pole = min(pole, max(length(cq) - 0.016, abs(q.y - 3.86) - 0.25));                     // lantern corner posts
    float gl = sdBox(q - vec3(0.0, 3.86, 0.0), vec3(0.14, 0.23, 0.14));
    if (pole < d) { d = pole; id = I_POST; }
    if (gl < d) { d = gl; id = I_LAMPG; }
  } else d = min(d, bb);
  return d;
}

// ---------------------------------------------------------------- vegetation
// young fruit trees (x, z, crown radius, seed): one by the driveway, three in the bed along the facade, one in the lawn
const vec4 FT[5] = vec4[5](vec4(-3.2, 3.55, 0.52, 0.11), vec4(0.85, 1.3, 0.6, 0.37), vec4(5.2, 1.35, 0.64, 0.59), vec4(10.15, 1.4, 0.58, 0.83), vec4(13.2, 5.6, 0.72, 0.21));
// low shrubs along the foundation (x, z, radius, seed)
const vec4 SH[7] = vec4[7](vec4(1.85, 0.42, 0.36, 0.2), vec4(3.6, 0.45, 0.34, 0.5), vec4(6.75, 0.42, 0.37, 0.7), vec4(8.6, 0.45, 0.35, 0.9), vec4(-0.2, 0.42, 0.3, 0.4), vec4(11.6, 0.2, 0.5, 0.6), vec4(-12.7, 2.3, 0.85, 0.3));
vec3 fruitC(vec4 T) { return vec3(T.x + 0.1 * (T.w - 0.5), 1.62 + 0.25 * T.w, T.y); }
// A crown as leaf masses: n clumps on a flattened shell, each a flattened sphere, smooth-unioned over a core. open (0..1)
// breaks the regularity that reads as 'broccoli': the core shrinks so gaps open between the masses, clump sizes and
// positions scatter, some clumps are missing (see-through holes), the blend gets tighter. rad: 0 core .. 1 rim
float clumpCrown(vec3 q, float R, float seed, int n, float open, out float rad) {
  float d = length(q * vec3(1.0, 1.35, 1.0)) - (0.55 - 0.27 * open) * R;
  float fn = float(n);
  for (int k = 0; k < 20; k++) {
    if (k >= n) break;
    float fk = float(k) + 0.5;
    float h1 = fract(seed * 13.7 + fk * 0.618), h2 = fract(seed * 7.1 + fk * 0.382), h3 = fract(seed * 3.3 + fk * 0.7548);
    if (h3 < 0.2 * open) continue;                       // a missing mass: a gap / a hole through the crown
    float y = 1.0 - 1.6 * fk / fn + 0.25 * open * (h3 - 0.5);
    float r = sqrt(max(1.0 - y * y, 0.0));
    float ph = fk * 2.39996 + seed * 6.283 + 0.9 * open * (h1 - 0.5);
    vec3 c = vec3(r * cos(ph), y * 0.7, r * sin(ph)) * (R * (0.56 + (0.18 + 0.22 * open) * h2));
    float cr = R * (0.26 + (0.17 + 0.12 * open) * h1 - 0.06 * open);
    vec3 e = q - c; e.y *= 1.0 + 0.25 * open;           // leaf masses are wider than tall
    d = smin(d, length(e) / (1.0 + 0.25 * open) - cr, (0.1 - 0.045 * open) * R);
  }
  rad = sat(length(q * vec3(1.0, 1.25, 1.0)) / R);
  return d;
}
// bare winter skeleton: limbs from the fork, three branches on each, a pair of twigs on each branch (tapered segments,
// never thinner than ~0.4 px: gFp); the finest twigs are the per-pixel twig haze of the bare bake (G3.a), not geometry
float skeleton(vec3 p, vec3 c, float R, float seed, int nl) {
  vec3 f = c - vec3(0.0, 0.5 * R, 0.0);
  float d = 1e5, w = 0.4 * gFp;
  for (int k = 0; k < 6; k++) {
    if (k >= nl) break;
    float fk = float(k);
    float ph = fk * 2.39996 + seed * 6.283;
    float el = 0.5 + 0.45 * fract(seed * 3.7 + fk * 0.618);
    vec3 dir = vec3(cos(ph) * cos(el), sin(el), sin(ph) * cos(el));
    vec3 e = f + dir * 0.8 * R;
    if (sdSegT(p, f, e, 0.0, 0.0) > 0.55 * R) continue;
    d = min(d, sdSegT(p, f, e, max(0.036 * R, w), max(0.012 * R, w)));
    for (int m = 0; m < 3; m++) {
      float fm = float(m);
      vec3 s0 = mix(f, e, 0.4 + 0.25 * fm);
      float a2 = ph + (fm - 1.0) * 1.1;
      vec3 d2 = normalize(vec3(cos(a2), 1.0 + 0.4 * fm, sin(a2)));
      vec3 e2 = s0 + d2 * (0.5 - 0.08 * fm) * R;
      d = min(d, sdSegT(p, s0, e2, max(0.011 * R, w), max(0.004 * R, w)));
      vec3 m2 = mix(s0, e2, 0.6);
      d = min(d, sdSegT(p, m2, m2 + normalize(d2 + vec3(0.6 * cos(a2 + 1.5), 0.2, 0.6 * sin(a2 + 1.5))) * 0.22 * R, max(0.006 * R, w), max(0.003 * R, w)));
      d = min(d, sdSegT(p, m2, m2 + normalize(d2 + vec3(0.6 * cos(a2 - 1.5), 0.3, 0.6 * sin(a2 - 1.5))) * 0.2 * R, max(0.006 * R, w), max(0.003 * R, w)));
      d = min(d, sdSegT(p, e2, e2 + normalize(d2 + vec3(0.3 * cos(a2 + 0.4), 0.6, 0.3 * sin(a2 + 0.4))) * 0.16 * R, max(0.004 * R, w), max(0.0025 * R, w)));   // the leader twig
    }
  }
  return d;
}
// fruit trees + foundation shrubs. aux (every plant): its sway weight (height fraction x sqrt(plant height / 18 m),
// FS_SHADE's reference; the shrubs rigid) + 2 x its index (houseMaterials: the per-plant random)
float fruitSDF(vec3 p, out float id, out float aux) {
  float best = 1e5; id = I_FRUIT; aux = 0.0;
  for (int i = 0; i < 5; i++) {
    vec4 T = FT[i];
    float r = T.z;
    float bnd = max(length(p.xz - T.xy) - r - 0.4, p.y - 2.75);
    if (bnd > gMargin) { best = min(best, bnd); continue; }
    vec3 c = fruitC(T);
    vec3 q = p - c;
    float rad;
    float dc = 1e5;
    if (!bareV()) {
      dc = clumpCrown(q, r, T.w, 8, 0.35, rad);
      if (dc < 0.3) dc = leafClumps(dc + 0.03 * leafN(p * 9.0 + T.w * 31.0), p + T.w * 7.0, 0.22, gFp) * 0.72;
    }
    float tr = sdSeg(p, vec3(T.x, -0.1, T.y), c - vec3(0.0, 0.3, 0.0), 0.045);
    vec3 b0 = c - vec3(0.0, 0.42, 0.0);
    float wb = max(0.022, 0.4 * gFp);
    tr = min(tr, sdSeg(p, b0, c + vec3(0.32, 0.1, 0.05), wb));
    tr = min(tr, sdSeg(p, b0, c + vec3(-0.25, 0.15, 0.2), wb));
    tr = min(tr, sdSeg(p, b0, c + vec3(0.0, 0.12, -0.3), wb));
    if (bareV()) tr = min(tr, skeleton(p, c + vec3(0.0, 0.1, 0.0), r * 1.1, T.w, 4));
    float sw = SWAYK * 0.38 * sat(p.y / (c.y + r));
    if (dc < best) { best = dc; id = I_FRUIT; aux = sw + 2.0 * float(i); gRad = rad; }
    if (tr < best) { best = tr; id = I_TWIG; aux = sw + 2.0 * float(i); }
  }
  // a bed of flowering perennials along the foundation, in the gravel strip between the shrubs (low mounds every
  // ~0.62 m, the two nearest evaluated; none at the fruit trunks and the bench)
  {
    float bb = sdBox(p - vec3(5.3, 0.25, 0.45), vec3(5.8, 0.35, 0.42));
    if (bb > gMargin) best = min(best, bb);
    else {
      float c0 = floor((p.x + 0.1) / 0.62 - 0.5);
      for (int k = 0; k < 2; k++) {
        float c = c0 + float(k), h = hash2(vec2(c, 17.0)), h2 = hash2(vec2(c, 29.0));
        float cx = (c + 0.5) * 0.62 - 0.1 + 0.16 * (h - 0.5);
        if (cx < -0.25 || cx > 10.95 || abs(cx - 0.85) < 0.3 || abs(cx - 5.2) < 0.3 || abs(cx - 10.15) < 0.3 || abs(cx - 7.68) < 0.75) continue;
        float r = 0.21 + 0.08 * h2;
        vec3 q = p - vec3(cx, 0.08 + 0.45 * r, 0.42 + 0.12 * (h2 - 0.5)); q.y *= 1.3;
        float dc = length(q) - r;
        if (dc * 0.66 > gMargin) { best = min(best, dc * 0.66); continue; }
        dc = (dc + 0.05 * leafN(p * 11.0 + c * 7.0)) * 0.6;
        if (dc < best) { best = dc; id = I_FLOWER; aux = 2.0 * (12.0 + c); }
      }
    }
  }
  for (int i = 0; i < 7; i++) {
    vec4 T = SH[i];
    vec3 q = p - vec3(T.x, T.z * 0.55, T.y); q.y *= 1.5;
    float dc = length(q) - T.z;
    if (dc * 0.66 > gMargin) { best = min(best, dc * 0.66); continue; }
    dc = (dc + 0.09 * leafN(p * 7.0 + T.w * 13.0)) * 0.6;
    if (dc < best) { best = dc; id = I_SHRUB; aux = 2.0 * float(i); }
  }
  return best;
}

// ---- palms (Mexican fan palm): a curved slender ringed trunk, a ball of fan leaves on petioles, a shaggy skirt of
// dead fronds and a few hanging dead fronds
const vec4 PALM[2] = vec4[2](vec4(2.4, -23.5, 18.0, 0.31), vec4(12.6, -29.5, 15.6, 0.72));   // x, z, height, seed
vec3 palmAxis(vec4 P, float y) { float s = clamp(y / P.z, 0.0, 1.0); return vec3(P.x + (P.w - 0.5) * 2.2 * s * s, y, P.y + 0.5 * s * s); }
// one fan leaf: a petiole along u from the crown centre, then a pleated, segmented fan (half-angle 'open', ~1.3 rad)
// that droops toward its tip. The blade, its outline and the finger gaps are widened to the pixel footprint (gFp):
// beyond a few pixels per finger the fan reads as one solid fan instead of a stipple of sub-pixel strips
float palmLeaf(vec3 q, float az, float el, float len, float R, float open, float droop, float tw) {
  float ce = cos(el);
  vec3 u = vec3(ce * cos(az), sin(el), ce * sin(az));
  vec3 w = vec3(-sin(az), 0.0, cos(az));
  w = cos(tw) * w + sin(tw) * cross(u, w);      // (stage 2b) the fan twisted about its petiole: fans at every angle, not stacked discs
  vec3 v = cross(u, w);
  float s0 = dot(q, u);
  vec3 qq = q + vec3(0.0, droop * sq(max(s0 - 0.3, 0.0)), 0.0);   // gravity: the leaf bends down toward its tip
  float s = dot(qq, u);
  float pet = length(qq - u * clamp(s, 0.0, len)) - max(0.03, 0.4 * gFp);
  float lx = s - len, ly = dot(qq, w), lz = dot(qq, v);
  float rho = length(vec2(lx, ly)), phi = atan(ly, lx + 1e-4);
  float seg = abs(fract(phi * 6.5 + 0.5) - 0.5);               // ~19 segments over the fan
  // the fingers never get narrower than ~0.75 px (their half-width fl in segment units grows with the footprint), the
  // gaps between them fade out below ~1 px; dead fronds are folded (no fingers)
  float fl = max(0.12, 4.9 * gFp / max(rho, 0.05));
  float fing = smoothstep(0.6, 1.4, max(0.5 - fl, 0.0) * 0.31 * rho / max(gFp, 1e-4)) * step(0.5, open);
  float split = smoothstep(fl, min(fl + 0.25, 0.5), seg) * smoothstep(0.3 * R, 0.85 * R, rho) * fing;
  float Rk = R * (1.0 - 0.16 * phi * phi) * (1.0 - 0.5 * split);
  lz -= 0.06 * (seg - 0.25) * min(rho, 0.7) * fing;          // pleats
  float pw = 0.5 * gFp;
  float d2 = max(rho - Rk - pw, (abs(phi) - open) * rho - pw);
  float blade = max(d2, abs(lz) - max(0.016, pw));
  return min(pet, blade);
}
float palmCrownSDF(vec3 q, float seed, out float id) {
  id = I_FROND;
  float best = 1e5;
  float a0 = atan(q.z, q.x);
  for (int k = 0; k < 3; k++) {
    float el = k == 0 ? 1.32 : k == 1 ? 0.62 : -0.15;           // young upright fronds, the spreading ones, the drooping ones (stage 2b: .42 / -.25 -> .62 / -.15, a rounder head)
    float n = k == 0 ? 5.0 : k == 1 ? 11.0 : 12.0;
    float len = k == 0 ? 0.42 : k == 1 ? 0.95 : 1.15;
    float sec = 6.2831853 / n, off = seed * 6.28 + float(k) * 0.9;
    float a = a0 - off;
    float i0 = floor(a / sec + 0.5);
    float i1 = i0 + (a / sec > i0 ? 1.0 : -1.0);
    float lr = k == 0 ? 0.62 : 0.82, op = k == 0 ? 0.62 : 1.3;
    // (stage 2b) each leaf its own elevation (+-.32 rad) and twist (+-.3 rad): a rounded head, not stacked tiers
    // (the leaf's randoms by its index mod n: the same leaf on both sides of the azimuth seam)
    float tk = k == 0 ? 0.3 : 1.0, m0 = mod(i0, n), m1 = mod(i1, n);
    best = min(best, palmLeaf(q, i0 * sec + off, el + 0.32 * tk * sin(m0 * 2.3 + seed * 9.0), len, lr, op, 0.3, 0.3 * tk * sin(m0 * 4.1 + seed * 5.0)));
    best = min(best, palmLeaf(q, i1 * sec + off, el + 0.32 * tk * sin(m1 * 2.3 + seed * 9.0), len, lr, op, 0.3, 0.3 * tk * sin(m1 * 4.1 + seed * 5.0)));
  }
  best *= 0.6;
  // hanging dead fronds: a few closed brown fans pointing down from under the crown (only some sectors have one)
  {
    float sec = 6.2831853 / 7.0, off = seed * 4.1 + 0.4;
    float a = a0 - off;
    float i0 = floor(a / sec + 0.5);
    float i1 = i0 + (a / sec > i0 ? 1.0 : -1.0);
    float dd = 1e5;
    float sd = 11.0 + floor(seed * 50.0);
    if (hash2(vec2(mod(i0, 7.0), sd)) > 0.45) dd = palmLeaf(q - vec3(0.0, -0.3, 0.0), i0 * sec + off, -1.0 - 0.25 * hash2(vec2(mod(i0, 7.0), sd + 3.0)), 0.5, 0.8, 0.4, 0.05, 0.0);
    if (hash2(vec2(mod(i1, 7.0), sd)) > 0.45) dd = min(dd, palmLeaf(q - vec3(0.0, -0.3, 0.0), i1 * sec + off, -1.0 - 0.25 * hash2(vec2(mod(i1, 7.0), sd + 3.0)), 0.5, 0.8, 0.4, 0.05, 0.0));
    dd *= 0.6;
    if (dd < best) { best = dd; id = I_SKIRT; }
  }
  // the skirt (petticoat) of old dead fronds hugging the trunk under the crown: vertical shaggy strands, a ragged hem
  float r2 = length(q.xz);
  float sb = length(max(vec2(r2 - 0.63, abs(q.y + 1.25) - 1.15), 0.0));   // a true bound of the skirt (r <= .62, y -2.4 .. -.1)
  if (sb > gMargin) best = min(best, sb);
  else {
    float yy = -q.y;
    float strands = vn(vec2(a0 * 7.0 + seed * 3.0, yy * 1.4 + seed * 9.0)) * 0.6 + vn(vec2(a0 * 17.0, yy * 3.1)) * 0.4;
    float hem = 1.6 + 0.35 * vn(vec2(a0 * 2.5 + seed * 5.0, 1.7)) + 0.12 * vn(vec2(a0 * 7.0 + seed * 3.0, 4.1));
    float rS = mix(0.5, 0.37, sat(yy / 1.9)) + 0.075 * strands + 0.035 * sin(a0 * 23.0 + yy * 5.0);
    float sk = max(r2 - rS, max(q.y + 0.12, yy - hem)) * 0.5;
    if (sk < best) { best = sk; id = I_SKIRT; }
  }
  return best;
}
float palmsSDF(vec3 p, out float id, out float aux) {
  float best = 1e5; id = I_PTRUNK; aux = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 P = PALM[i];
    vec3 top = palmAxis(P, P.z);
    float bnd = min(max(length(p.xz - top.xz) - 3.8, -4.0 - (p.y - P.z)), max(length(p.xz - P.xy) - 1.6, p.y - P.z));
    bnd = min(bnd, length(p - top - vec3(0.0, 0.2, 0.0)) - 3.6);
    if (bnd > gMargin) { best = min(best, bnd); continue; }
    vec3 a = palmAxis(P, p.y);
    float y = clamp(p.y / P.z, 0.0, 1.0);
    float r = mix(0.3, 0.17, y) + 0.22 * exp(-p.y * 1.8);
    float tr = max((length(p.xz - a.xz) - r) * 0.85, max(-p.y - 0.2, p.y - P.z + 0.3));
    float sw = SWAYK * sqrt(P.z / 18.0);
    if (tr < best) { best = tr; id = I_PTRUNK; aux = y * sw + 2.0 * float(i); }
    float cid;
    float cr = palmCrownSDF(p - top - vec3(0.0, 0.25, 0.0), P.w, cid);
    if (cr < best) { best = cr; id = cid; aux = sw + 2.0 * float(i); }
  }
  return best;
}
// Italian cypresses (x, z, height, radius)
const vec4 CYP[5] = vec4[5](vec4(3.9, -19.0, 11.5, 0.95), vec4(16.6, -14.2, 10.2, 0.85), vec4(17.8, -15.0, 12.6, 0.95), vec4(-14.8, -17.0, 9.6, 0.85), vec4(23.5, -21.0, 11.2, 0.9));
float cypressSDF(vec3 p, out float aux) {
  float best = 1e5; aux = 0.0;
  for (int i = 0; i < 5; i++) {
    vec4 C = CYP[i];
    vec2 dxz = p.xz - C.xy;
    float bnd = max(length(dxz) - C.w - 0.5, max(-p.y, p.y - C.z - 0.5));
    if (bnd > gMargin) { best = min(best, bnd); continue; }
    float y = sat(p.y / C.z);
    float r = C.w * sqrt(max(1.0 - y, 0.0)) * (0.62 + 0.38 * smoothstep(0.0, 0.3, y));
    float d = length(dxz) - r;
    if (d < 0.5) d += 0.13 * leafN(vec3(p.x * 2.6, p.y * 0.9, p.z * 2.6) + C.x);
    d = max(d * 0.62, max(-p.y - 0.1, p.y - C.z));
    if (d < best) { best = d; aux = SWAYK * y * sqrt(C.z / 18.0) + 2.0 * float(i); }
  }
  return best;
}
// A broadleaf crown as leaf masses at the ends of its limbs (the bare skeleton's limbs, plus a leader): each mass a
// few overlapping lobes, with gaps between the masses where the sky and the limbs show through (no 'broccoli'), over a
// small core that keeps the middle dense. rad: 0 core .. 1 rim
float leafMasses(vec3 q, float R, float seed, float core, out float rad) {
  float d = length(q * vec3(1.0, 1.3, 1.0)) - core * R;
  vec3 f = vec3(0.0, -0.58 * R, 0.0);
  for (int k = 0; k < 7; k++) {
    float fk = float(k);
    float h = fract(seed * 5.3 + fk * 0.7548), h2 = fract(seed * 2.9 + fk * 0.5698);
    float ph = fk * 2.39996 + seed * 6.283;
    float el = 0.3 + 0.7 * fract(seed * 3.7 + fk * 0.618);
    vec3 dir = k == 6 ? normalize(vec3(0.15 * cos(seed * 9.0), 1.0, 0.15 * sin(seed * 9.0))) : vec3(cos(ph) * cos(el), sin(el), sin(ph) * cos(el));
    vec3 m = f + dir * R * (k == 6 ? 1.05 : 0.62 + 0.33 * h) + vec3(0.0, 0.08 * R, 0.0);
    float mr = R * (k == 6 ? 0.44 : 0.33 + 0.16 * h2);
    if ((length(q - m) - 0.55 * mr) / 1.3 - 0.82 * mr > d + 0.07 * R) continue;   // beyond its lobes and their blend (a true bound)
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      float a = ph + fj * 2.1 + h * 3.0, b = 0.6 * (fract(h2 * 7.3 + fj * 0.37) - 0.3);
      vec3 o = vec3(cos(a) * cos(b), sin(b), sin(a) * cos(b)) * mr * 0.55;
      vec3 e = q - m - o; e.y *= 1.3;                              // lobes wider than tall
      d = smin(d, length(e) / 1.3 - mr * (0.6 + 0.22 * fract(h * 11.0 + fj * 0.61)), 0.07 * R);
    }
  }
  rad = sat(length(q * vec3(1.0, 1.25, 1.0)) / R);
  return d;
}
// broadleaf trees: (x, z, crown centre height, crown radius). 0: a big evergreen (live) oak behind the house; 1: a
// deciduous tree behind the fence; 2: one behind the garage; 3: the framing tree at the near left. Open, irregular leaf
// masses with gaps (clumpCrown open), leafy relief noise; the bare variant swaps the deciduous crowns for skeletons
const float OAKSEED = 0.27;
const vec4 BT[4] = vec4[4](vec4(8.6, -20.0, 7.2, 4.3), vec4(14.6, -3.4, 5.0, 2.9), vec4(-7.4, -17.0, 6.6, 3.3), vec4(-12.4, 5.2, 4.3, 2.7));
float broadSDF(vec3 p, out float id, out float aux) {
  float best = 1e5; id = I_DECI; aux = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 B = BT[i];
    vec3 c = vec3(B.x, B.z, B.y);
    vec3 q = p - c;
    float R = B.w;
    float bnd = min(length(q) - R * 1.45, max(length(p.xz - B.xy) - 0.8, p.y - B.z));
    if (bnd > gMargin) { best = min(best, bnd); continue; }
    float rad = 1.0;
    float seed = i == 0 ? OAKSEED : float(i) * 0.37 + 0.1;
    bool bare = bareV() && i > 0;
    float d = 1e5;
    if (!bare) {
      d = leafMasses(q, R, seed, i == 0 ? 0.55 : 0.44, rad);
      if (d < 0.08 * R + 0.5) d = leafClumps(d + 0.05 * R * leafN(p * (3.4 / R) + float(i) * 7.0), p + float(i) * 3.1, i == 0 ? 0.8 : 0.66, gFp);
      d *= 0.72;
    }
    float tr = sdSeg(p, vec3(B.x, -0.2, B.y), c - vec3(0.0, 0.3 * R, 0.0), 0.08 + 0.035 * R);
    tr = min(tr, sdSeg(p, c - vec3(0.0, 0.5 * R, 0.0), c + vec3(0.45, 0.1, 0.2) * R, 0.04 * R));
    tr = min(tr, sdSeg(p, c - vec3(0.0, 0.45 * R, 0.0), c + vec3(-0.4, 0.15, -0.1) * R, 0.04 * R));
    if (bare) tr = min(tr, skeleton(p, c, R, seed, 6) * 0.9);
    float sw = SWAYK * sat(0.5 + q.y / (2.0 * R)) * sqrt((B.z + R) / 18.0);
    if (d < best) { best = d; id = i == 0 ? I_OAK : I_DECI; aux = sw + 2.0 * float(i); gRad = rad; }
    if (tr < best) { best = tr; id = I_DTRUNK; aux = sw * 0.5 + 2.0 * float(i); }
  }
  return best;
}

// ---------------------------------------------------------------- far backdrop: analytic cards (static camera)
// Three vertical cards facing the camera at z = -42 / -66 / -105; each has a 1D silhouette: rounded tree crowns, a few
// neighbour roofs (near card), slim distant palms and cypress spires. Their flatness never shows: every framing (the
// landscape and portrait cameras and their blend) looks at them square-on from x ~1-3 m, z ~22.5-23 m
float cardTrees(float x, float k) {
  float s = k * 17.3;
  float h = 5.5 + 2.5 * k + 2.0 * vn(vec2(x * 0.06 + s, 0.5)) + 0.8 * vn(vec2(x * 0.17 + s, 1.5));
  float cx = x / (3.0 + 0.8 * k), ci = floor(cx), cf = cx - ci - 0.5;
  h += (2.2 + 0.8 * k) * sqrt(max(0.0, 0.25 - cf * cf)) * 2.0 * (0.4 + 0.6 * hash2(vec2(ci, k)));   // rounded crowns
  h += 0.35 * vn(vec2(x * 2.1 + s, 2.5));
  return h;
}
bool cardsHit(vec3 ro, vec3 rd, out float tc, out float cid, out vec3 cn, out float cvar) {
  tc = 1e9; cid = I_CARD; cn = vec3(0.0, 0.0, 1.0); cvar = 0.0;
  if (rd.z > -1e-3) return false;
  for (int k = 0; k < 3; k++) {
    float zc = k == 0 ? -42.0 : k == 1 ? -66.0 : -105.0;
    float t = (zc - ro.z) / rd.z;
    vec3 p = ro + rd * t;
    if (p.y < -0.3) continue;
    float fk = float(k);
    float h = cardTrees(p.x, fk);
    float id = I_CARD;
    // neighbour roofs between the trees on the near card (hip roofs, 4-4.6 m)
    if (k == 0) {
      float cell = floor((p.x + 9.0) / 18.0), fx = (p.x + 9.0) - cell * 18.0 - 9.0;
      float rh = 2.6 + 1.9 - 0.42 * max(abs(fx) - 2.0, 0.0);
      if (rh > 2.4 && abs(fx) < 7.5 && hash2(vec2(cell, 3.0)) > 0.25) {
        float hTree = h - 3.5 * smoothstep(6.0, 3.0, abs(fx));
        if (p.y < rh && p.y > hTree) { h = rh; id = I_CARDROOF; }
        else h = max(hTree, rh * step(p.y, rh));
      }
    }
    // slim distant palms and cypress spires on the middle / far cards
    if (k > 0) {
      float cell = floor(p.x / 13.0), fx = p.x - cell * 13.0 - 6.5 + (hash2(vec2(cell, fk)) - 0.5) * 6.0;
      float r = hash2(vec2(cell, fk + 5.0));
      if (r > 0.55) {
        float H = 13.0 + 7.0 * hash2(vec2(cell, fk + 9.0));
        float trunk = abs(fx) - 0.16;
        vec2 cq = vec2(fx, p.y - H);
        float crown = length(cq) - 0.35;
        if (length(cq) < 2.6) for (int f = 0; f < 9; f++) {
          float a = 0.25 + 3.14159 * (float(f) + 0.5) / 9.0 * 1.2 - 0.3 + 0.2 * sin(float(f) * 3.1 + cell);
          vec2 dir = vec2(cos(a), sin(a)), m = dir * 1.0, e2 = dir * 1.9 + vec2(0.0, -0.75 - 0.4 * abs(dir.x));
          vec2 pa = cq, ba = m; float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          float s1 = length(pa - ba * hh) - 0.12;
          pa = cq - m; ba = e2 - m; hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          float s2 = length(pa - ba * hh) - 0.12 * (1.0 - 0.7 * hh);
          crown = min(crown, min(s1, s2));
        }
        if ((trunk < 0.0 && p.y < H) || crown < 0.0) { h = max(h, p.y + 0.01); id = I_CARDPALM; }
      } else if (r < 0.2) {
        float H = 9.0 + 5.0 * hash2(vec2(cell, fk + 2.0));
        float w = 0.85 * sqrt(sat(1.0 - p.y / H)) * smoothstep(0.0, 2.0, p.y);
        if (abs(fx) < w && p.y < H) { h = max(h, p.y + 0.01); id = I_CARD; }
      }
    }
    if (p.y < h && t < tc) {
      tc = t; cid = id; cvar = hash2(vec2(floor(p.x * 0.25), fk));
      // fake normal: tree crowns bulge toward the camera and up near their silhouette
      float e = 0.25;
      float dh = (cardTrees(p.x + e, fk) - cardTrees(p.x - e, fk)) / (2.0 * e);
      float top = smoothstep(2.0, 0.0, h - p.y);
      vec2 bump = vec2(vn(p.xy * 1.3 + fk), vn(p.xy * 1.3 + 9.0 + fk));
      cn = normalize(vec3(-0.6 * dh * top + 0.35 * bump.x, 0.2 + 0.8 * top + 0.3 * bump.y, 1.0));
      if (id == I_CARDROOF) cn = normalize(vec3(0.0, 0.92, 0.39));
      return true;     // cards are sorted near to far
    }
  }
  return false;
}
`;
})(window.SNOW);
