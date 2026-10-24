# Architecture (Phase 3: two scenes and the natural hazards, integrated)

`app/` is the Phase-2 build (§1-§13: the Phase-1 single file split into classic scripts, the Phase-2 contracts, the
five Phase-2 lanes, the stage-2a integration, the stage-2b art direction, phones and tablets) with **Phase 3** on top
(§14): a scene registry (the alpine valley, unchanged and pixel-identical to Phase 2, and the "우리 집" California
ranch house at golden hour), per-scene programs (prewarmed in the background), runtime switching, the house's material
contract, its look and its leafy / bare bake variants, the natural hazards (thunderstorms with lightning, earthquakes,
wildfire smoke) in both scenes, and the place / weather / hazard chrome. Stage 0 froze the contracts, the stage-1
lanes (H house, Z hazards, U UI) built on them, stage 2a integrated them (§15), stage 2b art-directed the house, the
hazards and the transitions (§16). Open `app/index.html` by double-click
(file://): no modules, no fetch / XHR, no workers.

The Phase-2 lane names (A-E) below are history; the Phase-3 lanes and what they owned are in §1 and §14. The
contracts (the namespace rule, the module shapes, `S.F`, the program recipes, the G-buffer layout, the texture units,
the input contract, the scene contract) are what the code and the tests rely on. Change them deliberately and update
this file and the tests.

## 1. Files and load order

`index.html` holds the markup (the `#ui` block between its comments) and the `<script src>` list, in this order. The
last column is the **Phase-3 stage-1 owner** (H house, Z hazards, U UI; "frozen": no lane edited it; the Phase-2 lane
that wrote a file is in parentheses). Stage 2a (the integrator) touched gl.js, main.js, derive/events.js, glsl/hazard.js,
derive/house.js and the tests (§15). Stage 2b (the art direction, §16) touched the house's files (scenes/house.js,
glsl/house/*, derive/house.js), the hazards' (derive/events.js, glsl/hazard.js, glsl/hazard-bolt.js,
glsl/hazard-particles.js) and, behind scene hooks that leave the valley byte- and pixel-identical, glsl/shade.js (the
`SCENE_SKY` guard), glsl/sky.js (FS_SKY_SOFT, program `sky@house`), glsl/post.js (FS_COMP_SCENE's `sceneReveal`),
derive/surface.js (the per-scene milder snowline), derive/atmos.js (`uCloudSoft`), scenes/valley.js (the new profile
keys, neutral), core.js (a default) and three tests (check.mjs, house.mjs).

| # | File | Role | Phase-3 lane |
|---|---|---|---|
| 1 | `js/core.js` | `window.SNOW`. `S.cfg` holds every URL hook, parsed once. Math, `S.rand` / `S.vn1` / `S.hash32` (counter-based randomness), `S.override` (the debug-hook helper), the camera / sun state (`S.CAM`, `S.camF/R/U`, `S.SUN`, `S.TANH`, `S.setCamera`, `S.frameCamera(asp)` = the active scene's), the scene registry (`S.scenes`, `S.scene`, `S.sceneId`, `S.useScene`), the GLSL registry, `S.derive = {}`, and `S.F` with its neutral defaults. | frozen |
| 1a | `js/scenes/valley.js` | The valley scene (§14): camera framing (§13), sun, recipes, bake budget, atmosphere / surface profiles. Activates the valley at load. | frozen |
| 1b | `js/scenes/house.js` | The house scene (§14): camera framing (landscape / portrait by aspect), the golden-hour sun, recipes (`gbuf@house`, `shade@house`, `comp@house`), bake budget, `variants`, derive, atmosphere / surface profiles. | H |
| 2 | `js/glsl/common.js` | Chunks `COMMON`, `ENV`, `VS_FULL`, `GBUF` (G0..G3), `PRECISION_F`, `PRECISION_FI`. | frozen |
| 3 | `js/glsl/atmos.js` | `ATMOS`: sky colour + cirrus, stratus, the cloud weather map, the cumulus cells and `cloudCover`, `cloudShadow`, aerial perspective (haze, valley mist / fog sea and its banks `fogTopH` / `fogBanks`, storm extinction), mist banks. Entry points `skyPixel`, `applyAtmos`; `fogAtM` (with the fog-sea banks: the shading pass) vs `fogAt` (without: particles, cloud pass). | C |
| 4-6 | `js/glsl/gbuf-noise.js`, `gbuf-terrain.js`, `gbuf-objects.js` | Bake chunks: noise, terrain `terrainH`, trees and chalets. | frozen |
| 7 | `js/glsl/gbuf-materials.js` | `GBUF_MATERIALS`: `gbMaterials(...)` writes the albedo (summer reference), `snowT`, the normals and G3 (with `larchShare`, the larch stand field). | frozen (D) |
| 8 | `js/glsl/gbuf-main.js` | `GBUF_HEAD` (o0..o3), `GBUF_MAIN` (`sceneQ`, the state machine). Program `gbuf` (the valley's). | frozen |
| 9 | `js/glsl/surface.js` | `SURFACE`: `effectiveCover`, `snowCover`, `driftH`, the seasons (`grassSeason`, `larchSeason`, `flowers`), `shadeSurface`, `surfaceDebug`. Also the JS twin of the snowline offset, `S.snowlineOffset`, and its constants `S.SNOWLINE` (§5). | frozen (D) |
| 9a | `js/glsl/house/house-sdf.js` | `HOUSE_IDS` (the 18 material ids, the house-space mirror `hsp()`, the light positions), `HOUSE_SDF` (primitives, the lot, the house, neighbours / fence / street lamp, props, vegetation incl. the bare skeletons, the backdrop cards). | H |
| 9b | `js/glsl/house/gbuf-house.js` | `HOUSE_HEAD`, `HOUSE_MAT` (`houseMaterials`), `HOUSE_MAIN` (`sceneQ`, the twig haze, the dissolve's copy mode, the state machine). Program `gbuf@house` (two modes: bake, copy). | H |
| 9c | `js/glsl/house/surface-house.js` | `SURFACE_HOUSE`: the house's `shadeSurface` (seasons, snow, wet ground + screen-space reflections `hSSR`, the window / lamp light), `surfaceDebug`, `treeH` (`SCENE_SWAY`); program `shade@house`. `COMP_HOUSE` (`sceneComp`: lamp halos, fog wisps, golden highlights); program `comp@house`. Reads `S.SNOWLINE` (loads after surface.js). | H |
| 10 | `js/glsl/sky.js` | `FS_SKY`, program `sky` (half-res clouds, march clamped at the terrain; calls `hazardSky`). | frozen (C) |
| 11 | `js/glsl/veil.js` | `VEIL`: the distant snow veil, the rain veil, the far rain curtains, `applyVeil`. | frozen (E) |
| 11a | `js/glsl/hazard.js` | `HAZARD`: the hazard uniforms and hooks (`hazardSky`, `hazardLight`, `hazardSurface`, `hazardShake`, `hazardComp`; each returns its input bit for bit while its hazard is off). | Z |
| 11b | `js/glsl/hazard-bolt.js`, `js/glsl/hazard-particles.js` | Programs `bolt` (the lightning channel: instanced capsule quads, depth-tested against G0) and `ash`, `ember` (on the `PRECIP_VS` core), `dust` (the quake's plumes, anchored through the G-buffer). | Z |
| 12 | `js/glsl/shade.js` | `FS_SHADE`, program `shade` (the valley's). Glue only (§5, §14). | frozen |
| 13 | `js/glsl/flake.js` | `PRECIP_VS` (the shared precipitation VS core), `VS_FLAKE`, `FS_FLAKE`, program `flake`. | frozen (E) |
| 14 | `js/glsl/rain.js` | `VS_RAIN`, `FS_RAIN`, program `rain`. | frozen (E) |
| 15 | `js/glsl/post.js` | `FS_FXAA`, `FS_DOWN`, `FS_UP`, `FS_COMP` (the valley's, byte-identical to stage 0), `FS_COMP_SCENE` (FS_COMP + the per-scene hook `sceneComp`); programs `fxaa`, `down`, `up`, `comp` (calls `hazardShake`, `hazardComp`). | frozen (C; H added FS_COMP_SCENE) |
| 16 | `js/gl.js` | Context, GLSL assembly + compile (errors mapped to chunk:line; started / finished in two halves), the generic-upload tables, the per-scene program sets (`S.programsFor`, cached per context; a name another scene claims falls back to the shared recipe), the background prewarm of the other scenes' programs (`S.prewarmTick`, `S.prewarm`), render targets, `S.GB_LAYOUT` and the G-buffer allocation (G3 RGBA8, RGBA16F fallback), `S.R`, the bake variants (`S.setBakeVariant`, `S.variantTick`, `S.VARIANT_DISSOLVE`), the canvas box size (`S.cssSize`, `S.targetSize`), allocate (re-frames the camera) / resize sources / `S.checkSize` / DPR, the scene rebake (`S.switchSceneGL`), context loss, `initGL`. | frozen (H: variants; 2a: prewarm) |
| 17 | `js/perf.js` | Quality ladder `S.perf`, `controller` (judged step-ups, a ceiling, the steady-slow probe: §13), `adaptStripe`, `resetPerf`. | frozen |
| 18-21 | `js/sim/climate.js`, `weather.js`, `ground.js`, `wind.js` | The sim (§3). Pure JS, load in node. `weather.js` (the thunder state, its Markov edges) is Z's. | weather.js: Z; others frozen (A) |
| 21a | `js/sim/events.js` | The hazards' timelines (§14): strikes, quakes, wildfire smoke; `trigger`, `hazardsAuto`. | Z |
| 22 | `js/derive/surface.js` | Ground / season state to `S.F`; `visCover`, `coverAt(alt)` (the scene's surface profile). | frozen (D) |
| 23 | `js/derive/precip.js` | Precipitation to `S.F`, plus the fall / tumble / rain / veil clocks and the ash / ember fall integrals. | Z |
| 24 | `js/derive/atmos.js` | Light, atmosphere, clouds, exposure and grade to `S.F` (`S.lighting` holds the light colours; the scene's atmosphere profile), plus the cloud-drift clock. | frozen (C) |
| 24a | `js/derive/house.js` | The house's look to `S.F` (after atmos, house only): `uCozy`, the golden hour / the dusk, the storm dusk (`stormLook`), `uHouseComp`; the leafy / bare variant by the season (every scene). | H |
| 24b | `js/derive/events.js` | The hazards to `S.F` (last; §4 override order): the storm deck, the flash, the shake, the dust, the cracks, the smoke look, the bolt geometry, the hazard particle rates. | Z |
| 25 | `js/precip.js` | Layer descriptors (snow, rain, ash, ember), lattice wrap (+ the quake's parallax), `S.drawPrecip(ctx)`, `S.drawHazards(ctx)` (the bolt, the dust), `S.layoutLayers`, `S.precipCount`. | Z |
| 26 | `js/render.js` | `S.deriveF` (static fields, then the derives: surface, precip, atmos, the scene's, events), `S.uploadF`, `bindGB`, `S.passCtx`, `S.render` (7 passes + the hazard draws; the variant rebake's dissolve; the shade samplers `uPrevHdr` / `uSkyH`). | frozen (H: variants, samplers) |
| 27 | `js/input.js` | `S.mouse` (drag-only wind input), `S.bindInput`, `S.stepInput`, `S.pruneSegs`. | U |
| 28 | `js/ui.js` | `S.ui`, `S.bindUI`, `S.syncUI`, `S.updateUI`. | U |
| 29 | `js/main.js` | `S.anim`, `S.initSim`, `S.simStep`, `S.advance`, `S.state`, `S.makeApi`, `S.setScene`, the frame loop (+ `S.prewarmTick`), `boot()`. | frozen |

Also: `css/ui.css` and the `#ui` block of `index.html` (U: the icon, the pop-over `#pop` as two `.col` blocks — place +
time, weather + hazards; side by side on a landscape phone, stacked otherwise — the hint and the place `#toast`),
`tests/` (§10; `tests/house*.mjs` H, `tests/hazards*.mjs` Z,
`tests/interact.mjs` and the UI parts of `tests/mobile.mjs` U, everything else frozen), `tests/golden/` (the anchor
goldens), `tools/build.mjs` (frozen). **The `<script>` list of `index.html` is frozen: every file a lane owns already
exists** (stubs included); a lane that needs another file asks the integrator (stage 2). New GLSL goes into the lane's
existing chunk files (any number of chunks per file).

### Phase-3 stage-1 ownership (summary)

| Lane | Owns | Builds |
|---|---|---|
| **H** house chain (H1 shape + baked materials, then H2 look) | `js/scenes/house.js`, `js/glsl/house/*` (house-sdf.js, gbuf-house.js, surface-house.js), `js/derive/house.js`, `tests/house*.mjs` | the house, its bake, its per-frame seasons / weather / snow / wet / window light, its camera, sun and atmosphere profile, its golden-hour look; keeps the house rows of `tests/fps.mjs` green |
| **Z** hazards | `js/sim/weather.js`, `js/sim/events.js`, `js/derive/events.js`, `js/glsl/hazard*.js` (hazard.js, hazard-bolt.js, hazard-particles.js), `js/precip.js`, `js/derive/precip.js`, `tests/hazards*.mjs` | thunderstorm (the state's preset and Markov edges), lightning (bolt draw, flash), earthquake (shake, sway boost, dust, cracks, window flicker through `F.uCozy`), wildfire smoke (atmosphere override, ash, embers, glow) in both scenes |
| **U** UI | `css/ui.css`, `js/ui.js`, `js/input.js`, the `#ui` block of `index.html`, `tests/interact.mjs`, the UI parts of `tests/mobile.mjs` | the scene cards (`S.scenes[id].name`, `snowSim.setScene`), ← / → keys, the 뇌우 weather cell (5×2 grid), the 자연 현상 row (`snowSim.trigger`, `snowSim.hazardsAuto`), desktop and phone layouts |
| frozen | everything else: core, gl, render, main, perf, the valley (scenes/valley.js and every valley chunk), the glue (atmos / sky / post / surface / veil / flake / rain / shade), derive/atmos.js, derive/surface.js, climate / ground / wind, tools, the other tests | (stage 2 integrates; a needed change to a frozen file is raised, not made) |

Shared uniforms: no new ENV uniform. `uCozy` is declared by `SURFACE_HOUSE` and `COMP_HOUSE` (the house's shade and
composite programs: the windows, the light pools, the halos; H sets it, Z scales it afterwards for the quake flicker,
so every pass gets the same value); the hazard uniforms are declared by `HAZARD` (the passes with hooks; Z sets them).
A lane that needs a uniform in another lane's or a frozen chunk raises it.

## 2. Namespace rules

- Each file is exactly `(function (S) { 'use strict'; ... })(window.SNOW);`. In `core.js` the argument is
  `(window.SNOW = {})`. Nothing else sits at top level: classic scripts share one global lexical scope. `window.SNOW`
  and `window.snowSim` are the only globals.
- Only `main.js` has a load-time side effect: `boot()`, and only when a `document` exists. (scenes/valley.js activates
  the default scene at load: namespace state only, no DOM / GL.) Every file loads in a bare
  node VM (`tests/check.mjs` enforces it; `tests/sim.mjs` relies on it).
- Cross-file references resolve at call time through `S`. A file may alias at load only what earlier files
  registered. The `js/glsl` files register chunks and recipes; `glsl/surface.js` also registers `S.snowlineOffset`,
  the JS twin of its GLSL snowline (both built from one constant table, so they cannot drift).

## 3. The simulation

### Data flow and clocks

One live step `S.simStep(dt, false)` (main.js), `dt` in real seconds (clamped to 0.1 s per frame):

1. `anim.wall += dt; anim.time += dt; S.stepInput(dt)`
2. `dtc = dt × S.climate.s.speed`, in substeps of at most 0.25 climate-s: `climate.step(h)`, `weather.step(h)`,
   `ground.step(h)`.
3. `S.wind.step(dt)` (physical time), then `S.events.step(dt)` (Phase 3: the hazards' timelines, physical time).
4. `anim.dispA += windA·dt`, `anim.dispB += windB·dt`.
5. `S.derive.surface.step(dt)`, `precip.step(dt)`, `atmos.step(dt)`, `house.step(dt)`, `events.step(dt)`: the derive
   modules' own clocks (every derive module steps whatever the scene).
6. The tree-sway phase.

Then once per frame `S.deriveF()` builds `S.F` and `S.render()` draws.

- **Physical time**: particle motion, flutter, sway, the twinkle / grain clocks, the natural wind, the steer decay,
  wake ages, UI timers, cloud drift.
- **Climate time** (`dt × speed`): climate, weather, ground only.
- **Fast-forward** `S.advance(T)` runs `simStep(min(0.25, T − t), true)` until `T` (`?t=T` at boot,
  `snowSim.advance(T)`): no input, no wall clock, the steer only decays, the periodic phases (sway, veil scrolls)
  hold. Climate, weather and ground run exactly the live steps.
- **Determinism**: the same `?seed` and `?t` give the same `state()` and `S.F` bit for bit (and with `?frames=` the
  same image). The start phase comes from the calendar day (not the time of day), so this holds within a day; add
  `?season=` or `?yp=` for a date-independent state.

`S.anim` (main.js; the derive modules add their integrals in `init()` and advance them in `step()`):

| Field | Owner | Meaning |
|---|---|---|
| `time`, `wall`, `fps` | main.js | Animation clock, wall clock (never fast-forwarded), smoothed frame rate. |
| `dispA`, `dispB` | main.js | Integrals of the wind (m): the only wind the particles see. |
| `swayPh` | main.js | Tree-sway phase. |
| `cloud` | derive/atmos.js | Cloud drift (m), never wrapped. Follows `S.wind.s.natural` only. |
| `fallI`, `tumI`, `rainI` | derive/precip.js | Snow fall, tumble and rain fall factors integrated over time. |
| `ashI`, `emberI` | derive/precip.js | Phase 3: the wildfire ash and ember fall integrals (lattice-wrapped like `fallI`). |
| `veilI[4]`, `veilR[4]`, `gustR[2]` | derive/precip.js | Snow veil, rain veil and rain gust-band scrolls, mod 256; they hold during fast-forward. |

A quake kicks `swayPh` (derive/events.js `step`, live steps only): a zero-mean offset that follows the shaking and is
removed as the quake ends, so every tree and palm sways hard through the unchanged sway path.

### Module shape

`S.<mod> = { s, init(cfg), step(dt, ff), snapshot(), api }` for `climate`, `weather`, `ground`, `wind` and (Phase 3)
`events` (stepped in physical seconds right after the wind, in fast-forward too). `s` is plain
state that other modules read and never write; `snapshot()` merges into `snowSim.state()` (keys never override
earlier ones); `api` merges into `window.snowSim` with its accessors. Each module applies its debug hook at the end
of its own step: climate `?yp`, weather `?wx`, ground `?ground`.

### Climate (`sim/climate.js`)

| Field | Meaning |
|---|---|
| `t` | Climate seconds since boot. |
| `phase` | [0,1): 0 = 1 March (spring), .25 summer, .5 autumn, .75 winter. Starts from the calendar day unless `?season` / `?yp`. |
| `pinned` | `null` (the year runs) or the phase a season pick holds. |
| `speed` | 0..8 climate-s per real s (UI: 0.25, 0.5, 1, 2, 4, 8; 0 pauses, API only). |
| `seasonW` | [spring, summer, autumn, winter], smoothstep partition of unity peaking mid-season. |
| `tSeason` | Meadow °C without weather: `4 + 10·sin(2π(phase − .125))`. |

- YEAR = 1200 climate-s at 1× (a season every 5 min). 22 Oct starts at phase 0.643 (늦가을).
- `setSeason(name | 0..1 | null)`: a pick eases along the shortest arc over 60 climate-s, then holds; `null` / 'auto'
  lets the year run on from wherever it is. A boot `?season=` pins at once.
- `S.climate.seasonKo(phase)`: the one Korean season label (초봄 / 봄 / 늦봄, 초여름 / 한여름 / 늦여름, 초가을 / 가을 /
  늦가을, 초겨울 / 한겨울 / 늦겨울: first 30% of a season early, last 45% late). `state().seasonKo` and the pop-over's
  status line both use it.

### Weather (`sim/weather.js`)

`s`: `t`, `cur` (the state shown; during a transition the one being left), `next` (target, `null` when settled),
`progress` 0..1, `manual` (the held pick, `null` = automatic), `nextAt` (climate time of the next scheduled change,
0 when manual or auto off), `auto` (the scheduler runs), `amount` 0..1 (`S.amountMul() = 0.2 + 1.6·amount`), `ch` (the
channels), `temp` (°C, `tSeason + ch.tempOff`), `curtain` (`heavy × snowFrac`, Phase 1 `storm`), `white` (curtain × a
gust beat on physical time), `tail` (follows the curtain up in ~4 s, down in ~25 s), `heading` (gale direction offset,
rad, eased per event).

Presets (channel order `cloudCov cumulus overcast cirrus fog precip gale heavy tempOff lightning`; the canonical
values the look is tuned against):

| State | cloudCov | cumulus | overcast | cirrus | fog | precip | gale | heavy | tempOff | lightning |
|---|---|---|---|---|---|---|---|---|---|---|
| clear | .15 | 0 | 0 | .35 | 0 | 0 | .05 | 0 | +1 | 0 |
| cumulus | .55 | 1 | .1 | .2 | 0 | 0 | .2 | 0 | 0 | 0 |
| overcast | .95 | .2 | .75 | 0 | .1 | 0 | .3 | 0 | −1 | 0 |
| fog | .75 | 0 | .5 | 0 | 1 | 0 | 0 | 0 | −1 | 0 |
| rain | .97 | 0 | .85 | 0 | .2 | .65 | .4 | 0 | +1 | 0 |
| snow | .75 | .2 | .35 | .4 | .05 | .75 | .15 | 0 | −3 | 0 |
| blizzard | .98 | 0 | 1 | 0 | .2 | 1 | 1 | 1 | −6 | 0 |
| thunder (Phase 3) | .99 | 0 | 1 | 0 | .15 | .85 | .65 | .35 | +1 | 1 |

`thunder` (뇌우, Phase 3) is rain made heavier (precip .85 and heavy .35: the rain layers' heavy multipliers), gusty
(gale .65), under a full low deck, with the `lightning` strike-rate channel at 1 (0 in every other preset; it uses the
heavy-snow window: lags in, leads out). Its tempOff target and feasibility follow rain's (`T ≥ 1 °C`; a manual pick
thaws to `max(1, 3.5 − tS)`). **The variant chain**: the scheduler still draws exactly the Phase-2 states at the
Phase-2 times (thunder's ROW / LINK / DWELL_BIAS columns are 0); an event drawn as rain out of cumulus (odds .8) or
overcast (.55), or as overcast out of rain (.35), becomes thunder with those odds × a season gate (phase ~.12-.46: late
spring to summer, peaking mid-summer; its own counter `S.rand(seed, eventIdx, 4)`; never twice in a row, never where
rain could not fall). The drawn state is the event's base (`tr.base`): `target()`, the dwell and the early end use it,
so the chain goes on exactly as in Phase 2 (`setStorm` sets `tr.base` too). Over 72 simulated years: 0 mismatching
events against the Phase-2 copy; thunder holds ~9-13% of summer, ~3% of late spring, 0.2% of autumn, 0 of winter.

- **Transitions**: every change is D = 60 climate-s from the *current* channel values (a pick mid-transition never
  jumps). Per-channel windows (fractions of D, up / down): clouds `[0,.6]` / `[.4,1]`, cirrus `[0,.5]` / `[.25,.85]`,
  fog `[.15,.8]` / `[0,.6]`, precip `[.4,1]` / `[0,.55]`, heavy `[.5,1]` / `[0,.45]`, gale `[.25,.8]` / `[.15,.75]`,
  tempOff into precipitation `[0,.45]`, out of it `[.5,1]`, else `[.1,.9]`. Clouds lead, precipitation lags in and
  leads out, the sky clears last; the rain / snow type is set before anything falls.
- **snowFrac** follows `1 − smooth(1, 3, temp)` at most 1/15 per climate-s (sleet crossfade); `?wx` snaps it.
- **Scheduler**: `P(i→j) ∝ ROW[season][j]·LINK[i][j]·feasible(j)`, rows blended by `seasonW`, no self transitions;
  rain / snow only out of overcast, cumulus or fog (blizzard back to snow); blizzard only from snow / overcast and when
  `temp < 0`. Rain drawn below 1 °C or snow above 3 °C is dropped. Dwell 70-180 climate-s with a per-season bias. The
  first weather is snow whenever `tSeason − 3 < 1` (late October opens with snow), else a draw from the season row.
  **The opening snowfall is a cold snap** (stage 2b): until the first transition its tempOff target is
  `min(−3, −FIRST_COLD − tSeason)`, FIRST_COLD = 2.5 °C, so late October (tSeason ≈ 2.4 °C) opens at −2.5 °C: dry
  Phase-1 crystals that settle at once (`tr.first`, cleared by `begin()`).
  Randomness is `S.rand(seed, eventIdx, k)`: UI actions, speed and amount never shift the seeded sequence.
- **Manual picks** (`setWeather(name)`): transition, then hold until `'auto'`. A manual rain / snow / blizzard pick
  pushes its tempOff target so it shows in any season (snow `min(−3, −0.5 − tS)`, blizzard `min(−6, −2 − tS)`, rain
  `max(1, 3.5 − tS)`): a cold snap in summer, a thaw in winter. `setWeather(name, {instant: true})` settles at once
  (boot `?weather=` and tests only).
- **Legacy**: `setStorm(v)` forces an instant held snow..blizzard mix (`?storm=1` = 1), `setStorm(null)` eases back
  to automatic; `?storm=0` = clear sky with the scheduler off (with `?cover` the cover is held); `triggerBlizzard(dur)`.

### Ground (`sim/ground.js`)

Per climate-s, with `sun = 1 − overcast`, `rain = precip(1 − snowFrac)`:

- `cover` += `(1/ACC)(1 + 4·heavy)·amountMul·precip·snowFrac` − (while there is cover)
  `max(Tm,0)/900·(1 + 1.5·sun)·(0.3 + 0.7·cover) + rain/120`. ACC = 200 s (stage 2b; Phase 1's 1/300 was at precip 1,
  the snow preset falls at .75): roofs white within a minute, the meadow patchy in two. `Tm = T − 0.0065·clamp(snowline
  + 300, 0, 600)`: the snow left lies near / above the snowline and melts at the air temperature there; the
  `(0.3 + 0.7·cover)` factor makes the last patches hold out (a spring meadow melts over minutes, not seconds).
- `wet` → `min(1, 1.6·rain)` with τ 20 s when rising; dries with τ `120 s / ((0.35 + 0.65·sun)(1 + 0.1·wind))`; melt
  water adds `0.6 × melted × (1 − wet)`.
- `snowline` (scene metres: meadow −100..40, valley floor ~−1000, camera 132, wall face to ~1500, left-massif summit
  ~2900): a seasonal curve (phase: m — 0: 1100, .25: 2100, .40: 2300, .50: 2150, .70: 1500, .78 − .95: −1600) that
  falling precipitation pulls down toward the snow level `(T − 1.5)/0.0065` (τ 12 s / precip); it recovers upward with
  τ `100 s / ((0.25 + 0.75·sun)(1 + max(T,0)/5))`. While the meadow holds snow (`cover > 0.005`) it is drawn to
  `MEADOW_CAP = −550` m or below (τ 8 s, also while snow is falling), where SURFACE's snowline (300 m half-width plus
  its per-pixel shift) leaves the whole meadow to the cover alone. **Thaw** (stage 2b: no snow falling, meadow above
  1.5 °C): the cap rises to the 4 °C isotherm `(T − 4)/0.0065` (τ 20 s), so the meadow melts out from below, sunny
  ground first, while the slopes above stay white. Measured look (merged surface code): summer (2100-2300 m) leaves only the top couloirs of the
  left massif white; autumn (1700 → 1500 m, lower after a snowfall) dusts its peaks.
- **Climatological spin-up** (stage 2b). `CLIM` = [phase, cover, wetness, snowline] keypoints, cosine-eased (cyclic):
  mid-winter ~.97-.99 cover (white to the valley floor), early spring ~.9 with the snowline climbing through the meadow
  (−700 → 650 m), late spring melting out, summer bare with only the high couloirs (2100-2300 m), autumn 1550 m, late
  autumn's first dusting at the meadow (the wetness is the spring melt water; rain wets the ground through the weather).
  A boot `?season=` pin starts from it at once. A season picked through `setSeason` (the UI) blends the free-running
  ground (snowfall, melt, wetting, drying go on in a shadow copy) into the picked season's climatology over SPIN = 60
  climate-s (the snowline leads over the first 60%: snow comes in as spreading patches and melts out from below), then
  the ground runs on its own. `setSeason(null)` and `?yp` have none; `?cover` holds and `setCoverage` / `reset` /
  `resetSnow` end it; `?ground` still overrides after every step.
- API: `setCoverage(v)`, `reset()` (instant), `resetSnow()` (eased 1.5 s).

### Wind (`sim/wind.js`)

- `natural` (`[x,0,z]`): closed form in `anim.time` and the seed: a breeze veering ±50° about the prevailing line (two
  octaves of `S.vn1`, 90 s and 25 s; not under `?wind=X,Z`), seasonal speed × the Phase-1 gust beat × slow lulls,
  blended into the gale (`smooth(ch.gale)`) along the event heading + 40% of the veer. **Clouds follow this only.**
- `steer` (`[x,0,z]`, m/s): only while `S.mouse.drag`: `(vxn, vyn)` → 10 m/s per viewport/s along `camR` and the
  ground-projected `camF`, capped at 14 m/s, attack 0.12 s (1.5 s when the drag slows). After release it decays with a
  15 s half-life (physical time).
- `target = natural + steer`; `windA` / `windB` follow it with 1.1 s / 0.4 s lags. `bias` / `gust` = the steer along
  `camR` / ground `camF`. `state().wind.steer` = |steer|.

### Input contract (`input.js`, `S.mouse`)

**Wind comes only from a left-button drag on the canvas. Plain pointer movement changes nothing** (it only updates
`lastMove` for the icon's idle dimming). A one-finger (or pen) drag is that drag: a primary touch / pen contact is
`pointerdown` with `button 0` and `buttons 1`; further fingers (`isPrimary` false) are ignored. Positions and
velocities are taken against the canvas box (`S.cssSize`), not `innerWidth` / `innerHeight`.

| Field | Meaning |
|---|---|
| `drag` | Left button (or one finger / pen) held on `#c` (pointerdown with `button 0`, `isPrimary`, the pop-over closed; pointer captured). Ends on pointerup / cancel / lostpointercapture / blur (a lifted finger), or a move without `buttons & 1`. |
| `inside` | True only while dragging. |
| `x`, `y` | Drag position (ndc), held after release. |
| `vxn`, `vyn` | Drag velocity in viewport widths / heights per s (up positive); fast attack, ~0.09 s release in `stepInput`. |
| `segs` | Wake segments `{x, y, dx, dy, t: anim.wall}` (≤ 32, pushed only while dragging, pruned after 3.6 s). `precip.js` uploads them to both the flake and the rain program (`uMs uMa uMn`; rain weights them by the layer's `uPushK`). |
| `lastMove` | `anim.wall` of the last pointer movement of any kind. |
| `pid`, `vx`, `vy`, `lx`, `ly`, `lt`, `accX`, `accY`, `segT` | Internal. |

A press that only closes the open pop-over starts no drag (the canvas listener sees `S.ui.open` before ui.js's
document listener, which must stay in the bubble phase). The canvas has `touch-action: none` (no page pan / zoom over
the scene); `canvas.drag` shows the grabbing cursor.

### Chrome (`ui.js`)

One season glyph in the corner (blossom / sun / leaf / snowflake, cross-fading on `floor(phase·4)`; no place indicator:
the chrome capture stays pixel-identical), a glass pop-over, a start hint and a place toast. The pop-over: the status
line (place · `S.climate.seasonKo(phase)` · weather, e.g. `우리 집 · 가을 · 맑음`; during a transition `cur → next` with
the hairline filling by `progress`), then **장소** cards (알프스 계곡 / 우리 집: `S.scenes[id].name`; a pick =
`S.setScene`; while the switched scene bakes — `state().ready` false — the glass stays open, its auto-close paused,
and the checked card shows a slow sheen with `aria-busy` on the group), **계절** segments (자동 + four; checked =
`pinned`) + the year track + the **시간 흐름** speed slider (stops 0.25-8×, caption `1년 = …`: 8× reads `1년 = 2분 30초`),
**날씨** 5×2 (자동 a tall left cell, then 맑음 구름 흐림 안개 / 비 뇌우 눈 폭설; checked = `manual`, else 자동 when `auto`,
else `cur`; ↑ / ↓ move within a column) + **눈·비의 양**, a hairline, then **자연 현상**: 지진 / 산불 momentary buttons
(`S.events.api.trigger`) that glow while their event runs (`S.events.s.quakeT` / `fireT ≥ 0`), and a 가끔 자동으로
`role=switch` bound to `hazardsAuto` both ways. The hint reads `드래그하여 바람을 일으켜 보세요`, on a touch screen
(`(hover: none) and (pointer: coarse)`) `화면을 쓸어 바람을 일으켜 보세요`; it hides for good once the pop-over opens.
**Keys**: global ← / → switch places (wrapping) only with the glass closed, focus not in a text / radio / radiogroup /
slider / switch control, no modifier, no key repeat; a key switch shows `#toast` with the place name for 1.6 s. Opened
from the keyboard the pop-over focuses the checked season (not the place cards: a stray arrow cannot start a rebake);
Tab order starts at the place cards. It writes only through `S.setScene`, `S.climate.api` (`setSeason`, `speed`),
`S.weather.api` (`setWeather`, `amount`, `auto`) and `S.events.api` (`trigger`, `hazardsAuto`), and re-reads the sim
on open and every 6 frames while open. Closing: outside press, Escape, 6 s idle (paused while hovered, keyboard-
focused or busy). `?ui=0` removes it all (icon, pop-over, hint, toast) and disables the place keys.

### window.snowSim and state()

`snowSim` = `state()`, `advance(sec)` (returns the state), `setScene(id)` / `scene` (getter; Phase 3, §14), and the
module APIs: `setSeason`, `speed` (climate); `setWeather`, `setStorm`, `triggerBlizzard`, `amount`, `auto` (weather);
`setCoverage`, `reset`, `resetSnow` (ground); `trigger(kind)`, `hazardsAuto` (events, Phase 3).

`state()`: the Phase-1 fields `coverage storm sky tail windX windZ flakeCount fps ready amount auto quality perfLevel
frameMs buildMs compileMs res renderRes`, then `season seasonKo phase speed seasonPinned`, `weather{cur, next,
progress, manual, nextAt} temp snowFrac precip white`, `wet snowline`, `wind{x, z, steer}`, `hazards{quake, smoke,
flash, strikes, lightning, auto}` (Phase 3), then `rainCount`, `g3` and `scene` (Phase 3). **`ready`** =
`R.readyTime ≥ 0 && R.gbCur`: the active scene's G-buffer is complete and shown. It is false from boot, from a scene
switch, from a re-framing resize (the camera moved: the old buffer is dropped) and from a context restore, until that
bake's swap; it stays true through a rebake behind a live, unmoved scene (a resize that keeps the framing blends the old
buffer) and through the house's leafy / bare variant rebake and its dissolve. The background prewarm (§5) never
changes it. The chrome's busy state is `!ready` while the pop-over is open.

### URL hooks (`S.cfg`, core.js)

| Hook | Meaning |
|---|---|
| `?seed ?t ?cover ?wind ?ui ?fixed` | Phase 1, kept. `?cover` applies after the fast-forward. `?fixed=1`: fixed 1/60 s steps, quality controller off. |
| `?storm=1` / `?storm=0` | Instant held storm / clear sky with the scheduler off (see Weather). |
| `?season=` | `spring` / `summer` / `autumn` / `winter` (mid-season) or 0..1: pins at once. Junk is ignored. |
| `?weather=` | A state (settled at boot, held) or `auto`. Junk is ignored. |
| `?speed=` | 0..8. |
| `?yp=0..1` | Debug: pins the year phase after every step (the season chip stays 자동). |
| `?wx=k:v,...` | Debug: overrides weather channels after every step (`cloudCov cumulus overcast cirrus fog precip gale heavy tempOff snowFrac`). |
| `?ground=k:v,...` | Debug: overrides `cover`, `wet`, `snowline` after every step. |
| `?view=` | Debug view (§8). |
| `?frames=N` | Test: exactly N frames at 1/60 s, then `window.__done`. |
| `?gb16=1` | Test: the all-RGBA16F G-buffer fallback. |
| `?scene=` | Phase 3: `valley` (default) or `house`; an unknown id boots the valley. |
| `?event=` | Phase 3: `quake`, `wildfire` or `strike`, triggered at boot after `?t` / `?cover`. |
| `?wx=...,lightning:x` | Phase 3: the strike-rate channel (sim/events.js), like every other `?wx` channel. |

The Phase-1 anchor (the regression state of `tests/phase2.mjs`):
`?wx=cloudCov:.6,cumulus:0,overcast:0,cirrus:1,fog:0,precip:1,gale:0,heavy:0,tempOff:0,snowFrac:1&ground=cover:C,wet:0&yp=.875`
(winter `?yp` keeps the date out: dry snow, the winter palette, the snowline below the scene).

## 4. The frame bundle S.F

`S.F[uniformName] = value`: a number for float / int / uint, an array or Float32Array for vectors, `{unit, tex}` for
a sampler. `S.uploadF(prog)` uploads every entry to every program that declares the name (setter from the
`getActiveUniform` type). `S.deriveF()` sets the static fields, then `S.derive.surface.frame(F)`, `precip.frame(F)`,
`atmos.frame(F)`, then (Phase 3) the active scene's derive (`S.derive[S.scene.derive].frame(F)`: house.js, only in the
house) and `events.frame(F)` last; a later derive may read (and override) what an earlier one set (atmos reads
`F.uCover`, `F.uSnowCurtain`, `S.derive.surface.visCover / coverAt`). **An override assigns its own array** (e.g.
`F.uSunCol = mySun`), never mutates an earlier derive's (`S.lighting.*` are recomputed from scratch each frame and keyed
by the sky-history reset). Every derive module's `init` / `step` run whatever the scene. Values no derive sets keep
their `core.js` default ("–": always set).

**The override order** (Phase 3, stage 2a). Each layer owns one thing and composes over what is current:
1. `atmos` — the season × weather base palette, haze, clouds, exposure, grade (`S.lighting.*`).
2. the scene's derive — the scene's own look over it. The house (derive/house.js) assigns its own `uSunCol uSkyAmb
   uSkyZen uSkyHor uHorBand uFogCol uFogP uGrade uGradeP` and sets `uCloudCov uCirrus uShadowAmp uExposure uBloomStr
   uCozy uHouseComp`: the golden hour on fair evenings, the dusk under a deck / fog / precipitation, and **the
   thunderstorm palette** (keyed on `ch.lightning`; `stormLook: true` declares that it owns it).
3. `events` — the hazards, last, assigning its own arrays (`uSkyAmb uSkyZen uSkyHor uFogCol uHorBand uSunCol uFogP
   uCloudQ uGrade uGradeP`) **only while thunder or a hazard is active** (otherwise S.F is exactly what 1-2 made, the
   same objects): (a) the storm deck: the deck lowers ~20% (`uCloudQ.x`, the strikes start from it) in every scene,
   and the storm darkening of the sky / ambient / haze (28-38%) applies only when the scene's derive does not own its
   storm palette (the valley; the house keeps its own storm dusk); (b) the transient hazards compose over whatever
   palette is current: a flash adds its light (ambient, sky, haze), the wildfire smoke recolours the current palette
   toward the smoke (keyed on the current luminances, so it reads the same over the golden hour and the valley's day)
   and scales `F.uExposure` (×.86 at full smoke since stage 2b: a deep orange day, not a bright ochre one), the house quake scales `F.uCozy` (the lights flicker: windows,
   light pools and halos alike). After a hazard ends, S.F is bit-identical to a run that never had one.

| Uniform | Type | Set by | Meaning, units | Default | Declared in / read by |
|---|---|---|---|---|---|
| `uCamPos uCamR uCamU uCamF`, `uTanH`, `uSunDir`, `uTime`, `uNoise` | vec3, float, vec3, float, sampler | render | Camera, tan(fovY/2), the fixed (baked) sun, `anim.time mod 512000`, 256² noise on unit 7 | – | COMMON |
| `uView` | int | core | `?view=` channel, 0 off | 0 | ENV: shade, comp |
| `uCover` | float | surface | Cover level 0..1 | – | ENV: SURFACE |
| `uSeasonW` | vec4 | surface | Season weights | (0,0,0,1) | ENV: SURFACE (spruce in winter) |
| `uTemp` | float | surface | Meadow °C (`weather.s.temp`) | −5 | ENV: SURFACE (thaw, lapse 6.5 °C/km) |
| `uSnowline` | vec2 | surface | Snowline (scene m), half-width 300 m | (−10000, 150) | ENV: SURFACE |
| `uWet` | float | surface | Ground wetness 0..1 | 0 | ENV: SURFACE (darkening, gloss, puddles) |
| `uGrassDisp` | vec3 | surface | `dispA` mod the grass-wave period (m) | – | SURFACE |
| `uYearPhase` | float | surface | Year phase: the vegetation clock (altitude-shifted per pixel) | – | SURFACE |
| `uMelt` | float | surface | Thaw gate `1 − clamp(3·precip·snowFrac)`: 1 when no snow falls | – | SURFACE |
| `uSnowCurtain` | float | precip | Snow curtain `heavy·snowFrac` (Phase 1 `uStorm`) | – | ENV: flake |
| `uPrecipSnow`, `uPrecipRain` | float | precip | `precip·snowFrac`, `precip·(1 − snowFrac)` | 1, 0 | ENV: precip.js counts |
| `uSnowFrac`, `uHeavy` | float | precip | Snow share, blizzard intensity | 1, 0 | ENV: precip.js counts |
| `uGale` | float | precip | Gale 0..1 | 0 | ENV: rain (turbulence, gust bands), SURFACE (grass-wave strength) |
| `uWetSnow` | float | precip | Wet snow, only in the thaw band: `0.6·smooth(0.4, 1.5, T)·(1 − smooth(2.1, 2.6, T))` (stage 2b: dry below +0.4 °C; at most 60% of the crystals become clumps), eased 4 s (physical) | – | VS_FLAKE, FS_FLAKE |
| `uVeilDir uVeilAmt uVeilT` | vec2, float, vec4 | precip | Distant snow veil: direction, amount (snowfall floor + whiteout + tail gated by snowfall), scroll | – | VEIL |
| `uRainDir uRainVeil uRainT` | vec2, float, vec4 | precip | Rain veil: direction, amount, scroll | – | VEIL |
| `uRainShaft` | vec4 | precip | Far rain curtains: od/km, sunlit share, fall slant xz | – | VEIL |
| `uExpo uFallV uTumT uWindA uWindB uFlakeT` | float, float, float, vec3, vec3, float | precip | Flake shutter (s), fall factor (= d fallI/dt), tumble clock, wind (m/s), clock mod 120 | – | PRECIP_VS / VS_FLAKE |
| `uRainV uExpoRain uRainGust` | float, float, vec2 | precip | Rain fall factor (= d rainI/dt), shutter 1/45 s, gust-band scroll | – | VS_RAIN |
| `uSunCol uSkyAmb uSkyZen uSkyHor uFogCol` | vec3 | atmos | Linear radiance (season keys × weather) | – | COMMON |
| `uFogP` | vec4 | atmos | Haze density (1/m), haze scale height (m), extinction (storm + rain, 1/m), mist density (1/m) | – | COMMON: ATMOS |
| `uCloudOff`, `uCloudCov` | vec2, float | atmos | Cloud drift (m), weather-map coverage | – | COMMON: ATMOS, sky, VEIL |
| `uOvercast` | float | atmos | Overcast deck 0..1 (Phase 1 `uStormSky`) | – | ENV: ATMOS, sky, rain |
| `uCumulus`, `uFogDay`, `uCirrus` | float | atmos | Near cumulus, fog weather, cirrus (1 = Phase-1 veil) | 0, 0, 1 | ENV: ATMOS, sky |
| `uMistP` | vec4 | atmos | Mist: level depth (m), scale height (m), bank floor, bank gain; valley mist (650, 260, .3, 1.3) → fog sea (72, 12, .8, .45) | (650, 260, .3, 1.3) | ENV: ATMOS |
| `uShadowAmp` | float | atmos | Cloud-shadow strength, .65 → .85 under cumulus | .65 | ENV: ATMOS |
| `uHorBand` | vec3 | atmos | Pale horizon band (season; the sky colour under a deck) | – | ATMOS |
| `uCloudP` | vec4 | atmos | Cloud field: near cut left / right (m), cut fade (m), base undulation (m) | – | ATMOS, sky |
| `uCloudQ` | vec4 | atmos | Slab base / top (m; base ~1150 under a rain deck), grey-deck factor, side split | – | ATMOS, sky, VEIL (curtains hang from `x`) |
| `uMistQ` | vec4 | atmos | Fog sea: top swell (m), sun glow, sea weight | – | ATMOS |
| `uSkyResp` | float | atmos | 1 for one frame after a jump of the cloud / light inputs (restarts the sky EMA) | – | FS_SKY |
| `uCloudSoft` | float | atmos (stage 2b) | The scene's cumulus clean-up: `scene.atmos.cloud.soft × uCumulus` (valley 0; house .12): thin cells shed their small specks | 0 | FS_SKY_SOFT (sky@house) |
| `uExposure`, `uBloomStr` | float | atmos | Composite exposure (§ below), bloom strength | – | FS_COMP |
| `uGrade`, `uGradeP` | vec3 | atmos | White balance; desaturation, S-curve, sparkle gate (> 1 on crisp fair days: denser, brighter glints) | – | FS_COMP |
| `uCozy` | float | house (Phase 3) | Window / porch / street-lamp light 0..1: a golden-hour baseline .4, 1 under a deck, fog, precipitation, storms; events scales it after (the quake flicker, down to ~.3 in the main shock) | 0 | SURFACE_HOUSE, COMP_HOUSE |
| `uHouseSky` | vec4 | house (stage 2b) | The golden-hour sky: x weight (`g·(1 − precip)`: 0 = ATMOS's sky exactly), y zenith rate (7.5), z horizon glow (.9), w sunward glow (.035) | – (house) | SURFACE_HOUSE (`sceneSky`), COMP_HOUSE (`sceneReveal`) |
| `uHouseComp` | vec4 | house | The composite step: x the air's scattering (1/m: clear haze .0012, rain, falling snow, fog up to ~.023), y golden highlights 0..1, z halo gain, w unused | – (house) | COMP_HOUSE |
| `uVariant`, `uDissolve` | float, vec3 | render | The bake variant of the buffer being baked (0 leafy, 1 bare); the dissolve's copy mode (x > .5) and its noise band [y, z) — both set again per draw | 0; 0 | gbuf@house |
| `uPrevHdr`, `uSkyH` | sampler | render | The previous frame's scene (`R.hdr`, unit 5: wet-ground screen-space reflections, one frame late); this frame's cloud pass (unit 3, the texture FS_SHADE binds as `uSky`) | – | SURFACE_HOUSE |
| `uFlash`, `uFlashPos`, `uFlashFoot` | vec4 | events (Phase 3) | Lightning: flash rgb irradiance at the camera's distance (linear) + envelope; the channel's top / one end (world m) + length; its foot / other end + kind (0 cloud-to-ground, 1 intra-cloud, 2 heat flash) | 0; (0, 1500, 4000, 0); 0 | HAZARD |
| `uQuake`, `uQuakeZ` | vec4 | events | Earthquake: screen offset xy (uv), roll (rad), intensity; the overscan zoom (1 = none, ≤ ~1.03) and the shake's motion over a 1/60 s shutter (the blur) | 0; (1, 0, 0, 0) | HAZARD |
| `uSmoke`, `uSmokeSun` | vec4 | events | Wildfire smoke: tint rgb, amount; the veiled sun disc (direction, strength; world-fixed in the scene's landscape framing) | 0 | HAZARD |
| `uFire`, `uFireQ` | vec4 | events | The far fire: direction xz, half-width (rad), glow; base elevation (sin), lean (wind), clock (s), seed | 0 | HAZARD |
| `uCrack`, `uCrackQ` | vec4 | events | Crack decals: centre xz (m), radius (m), strength; the fault's direction xz, cell size (m), scene (0 valley, 1 house) | 0 | HAZARD |
| `uAshRate`, `uEmberRate`, `uDustRate` | float | events | Rates of the hazard particle kinds (precip.js counts; S.F entries, not uniforms) | 0 | precip.js |

**Exposure** (derive/atmos.js): `lerp(1, .54, cover^1.3) × lerp(1, 1.05, curtain) × lerp(comp, 1, keep) × (1 − .1·fog)`,
where `cover = .7·visCover + .2·coverAt(800) + .1·coverAt(2000)` (the snow the camera actually sees, through the shared
snowline model), `comp = min(1.55 − 0.3·rain, (E_ref/E)^.45)` a partial auto-exposure on the light level (a rain
day stays a little moodier), and
`keep = max(cover, curtain, falling snow)` keeps snow scenes on the Phase-1 exposure.

**Pass-local uniforms** (set by name, never in `S.F`): every pass `uRes`; gbuf `uPixAng uIter`; sky (and sky@house) `uPrev uPrevD
uBlend uFrame uSteps`; shade `uSky uSkyD uSway`; fxaa `uTex uInv`; flake / rain `uScene uAspect uFocalPx uCocK uFocus
uSeed uMs uMa uMn` and per layer `uDispA uDispB uFallQ uFallLH uLayer uSlice uHalfXY uCount` (+ rain `uPushK`; ash /
ember the same set); down / up `uSrc uSrcInv uDstRes uThresh`; comp (and comp@house) `uHdr uBloom uScene uTwinkleT
uFrame`; bolt `uBolt[160] uBoltN uBoltI uBoltC uBoltSky uBoltSkyD uRes uAspect uFocalPx` (160 vectors: well under the
256 vertex uniform vectors WebGL2 guarantees — do not raise it); dust `uDust uDustC uRes uAspect uFocalPx`; every
G-buffer reader `uG0..3 uN0..3 uGb` (`bindGB`).

### How to add a uniform

1. Declare it once per assembled stage, in the chunk that uses it (never twice: if two chunks of one program need it,
   it belongs in `ENV` or in the earlier chunk — e.g. VEIL reads ATMOS's `uCloudQ`). Its type must match what is set.
2. Set `S.F.<name>` in a derive `frame(F)`; per-draw values go in the pass code (render.js, precip.js).
3. A value that must never jump (a scroll, a phase) is an integral in `S.anim`, advanced in a derive `step(dt, ff)`
   and wrapped by its noise period.
4. `node app/tests/check.mjs` fails if a declared uniform is set nowhere or declared twice.

## 5. GLSL chunks and programs

A recipe is `S.glsl.progs.name = { vs: [chunks], fs: [chunks] }`; `S.buildPrograms()` assembles them after load and
on context restore. A compile error names the chunk and line (`shader compile failed: <prog>.<vs|fs> at CHUNK:line`).

| Program | VS | FS | Scene |
|---|---|---|---|
| `gbuf` | VS_FULL | COMMON, GBUF_HEAD, GBUF_NOISE, GBUF_TERRAIN, GBUF_OBJECTS, GBUF_MATERIALS, GBUF_MAIN | valley |
| `gbuf@house` | VS_FULL | COMMON, HOUSE_HEAD, GBUF_NOISE, HOUSE_IDS, HOUSE_SDF, HOUSE_MAT, HOUSE_MAIN (two modes: the bake; the variant dissolve's copy) | house |
| `sky` | VS_FULL | COMMON, ENV, ATMOS, GBUF, HAZARD, FS_SKY | valley |
| `sky@house` | VS_FULL | COMMON, ENV, ATMOS, GBUF, HAZARD, FS_SKY_SOFT (FS_SKY + the cumulus clean-up, `uCloudSoft`; stage 2b) | house |
| `shade` | VS_FULL | COMMON, ENV, ATMOS, GBUF, SURFACE, VEIL, HAZARD, FS_SHADE | valley |
| `shade@house` | VS_FULL | COMMON, ENV, ATMOS, GBUF, HOUSE_IDS, SURFACE_HOUSE, VEIL, HAZARD, FS_SHADE | house |
| `fxaa` | VS_FULL | FS_FXAA | shared |
| `flake` | COMMON, ENV, ATMOS, PRECIP_VS, VS_FLAKE | PRECISION_FI, ENV, GBUF, FS_FLAKE | shared |
| `rain` | COMMON, ENV, ATMOS, PRECIP_VS, VS_RAIN | PRECISION_FI, ENV, GBUF, FS_RAIN | shared |
| `down` / `up` | VS_FULL | FS_DOWN / FS_UP | shared |
| `comp` | VS_FULL | COMMON, ENV, ATMOS, GBUF, HAZARD, FS_COMP (the sparkle calls `camRay` + `cloudShadow`) | valley |
| `comp@house` | VS_FULL | COMMON, ENV, ATMOS, GBUF, HOUSE_IDS, HAZARD, FS_COMP_SCENE, COMP_HOUSE | house |
| `bolt` | COMMON, ENV, ATMOS, VS_BOLT | PRECISION_FI, ENV, GBUF, FS_BOLT | shared |
| `ash` / `ember` | COMMON, ENV, ATMOS, PRECIP_VS, VS_ASH / VS_EMBER | PRECISION_FI, ENV, GBUF, FS_ASH / FS_EMBER | shared |
| `dust` | COMMON, ENV, ATMOS, GBUF, VS_DUST | COMMON, ENV, GBUF, FS_DUST | shared |
| `<recipe>~idle` | as the recipe | as the recipe with HAZARD replaced by HAZARD_IDLE (sky, sky@house, shade, shade@house, comp, comp@house; polish) | the recipe's |

Per-scene program sets (Phase 3, gl.js): `S.P` is the active scene's set = every recipe no scene claims (built once,
shared) + the scene's own `scene.progs` (program name -> recipe: valley `gbuf -> gbuf`, `shade -> shade`; house
`gbuf -> gbuf@house`, `shade -> shade@house`, `comp -> comp@house`, `sky -> sky@house` since stage 2b). Recipes named
`name@scene` are never shared. A program name that another scene claims and this one does not (the house's `comp`,
`sky`) gets the shared recipe of that name (the valley's `comp`, `sky`). Each program is built once per context and cached by recipe (`S.programsFor(id)`), so switching
back is instant; a context restore forgets the cache and rebuilds the active scene's set. 17 recipes in all (shared:
fxaa, down, up, flake, rain, bolt, ash, ember, dust; valley: gbuf, shade, comp, sky; house: gbuf@house, shade@house,
comp@house, sky@house), plus (polish, with `KHR_parallel_shader_compile`) the six hook-free twins `'<recipe>~idle'`
(program names `skyIdle`, `shadeIdle`, `compIdle` in `S.P`; `S.glsl.recipe` / `S.glsl.assemble` derive them):
`S.programRecipes()` lists every recipe some scene's set uses in this context (23 with the extension).

**Boot cost** (polish, gl.js): `S.programsFor` starts every missing program of the set (compile + link, no status
query) before it finishes any, so the driver compiles them side by side; a lazy program — a recipe flagged `lazy:
true` (the hazards' draws `bolt`, `ash`, `ember`, `dust`: idle in almost every frame) or a full program with a
hook-free twin (sky, shade, comp: drawn only while a hazard is on) — is not built with the set: its `S.P` entry is a
getter that builds it on first use (then a plain value), and the prewarm starts it in the background once the scene
is shown, so a hazard that starts later finishes an already-compiled program. Lazy only with
`KHR_parallel_shader_compile`: without it Chrome compiles a started program only at its first status query, so the
first strike or fire froze ~0.5 s finishing it behind everything the prewarm had queued; without the extension every
recipe is built with the set, as before. After a successful link the shader objects are detached and deleted (the
driver's copies of the large sources; 34 were kept per context). Measured (M4, 1600×900, medians of 3-6 boots,
`state().compileMs`): valley boot 125-137 ms → 39-45 ms (Phase 2: 95-114 ms with 9 programs), house boot 148 → 58 ms,
valley boot without the extension 147 → 64 ms (the start-all-then-finish order alone); time to `ready` unchanged or a
little shorter (valley ~0.64-0.71 s, house 0.62 → 0.54 s); the first frame of a strike / fire / quake has no hitch with
or without the extension (max frame gap 3-8 ms). Without the extension the first switch after the idle-callback
prewarm still spends ~235 ms finishing the started programs (unchanged; with it 1-3 ms).

**Prewarm** (stage 2a, gl.js `S.prewarmTick`, called by main.js after every render): once the active scene is shown
(ready, no bake running) for 1 s, every other scene's programs are compiled and linked in the background, so the first
switch compiles nothing (measured on the M4 with the GPU queue drained: the first switch to the house took ~50 ms of
compile, the first to the valley ~40 ms; prewarmed, either takes 1-3 ms; a phone's compile is several times longer).
A program is built in two halves: `startProgram` issues the compile and link without any status query (no round trip
to the GPU process), `finishProgram` reads the link status and the uniform table (a sync round trip). The prewarm runs
only the first half — with `KHR_parallel_shader_compile` all programs at once (the driver compiles them off the main
thread; `COMPLETION_STATUS_KHR`, a non-blocking query, is polled each frame to report completion), without it one per
idle callback (`requestIdleCallback`, else a timeout) — and the switch that needs a program finishes it (the scene
change syncs with the GPU anyway, and the compile is done by then). `S.prewarm` = `{ state: 'idle' | 'running' |
'done', n, ms, ext }`, `S.prewarmedPrograms()` the started ones; a context restore starts over. No GL object is
created by a switch once the prewarm is done (tests/scenes.mjs).

The valley's assembled sources are the Phase-2 sources except the HAZARD chunk and its hook calls (sky, shade, comp;
each hook returns its input bit for bit while its hazard is off), the `SCENE_SWAY` guard around FS_SHADE's `treeH` and
(stage 2b) the `SCENE_SKY` guard around its `sceneSky` (= `skyPixel` in the valley):
gbuf, flake, rain, fxaa, down, up are byte-identical, FS_COMP is byte-identical to stage 0 (FS_COMP_SCENE is generated
from the same template with exactly two more lines: the `sceneComp` prototype after the uniforms and
`c = sceneComp(c, uvS, frag)` on the linear HDR frame after the sparkle, before the exposure; since stage 2b also the
`sceneReveal` prototype and its reveal line in place of FS_COMP's flat pale backdrop; FS_SKY is likewise generated
byte-identical, FS_SKY_SOFT adds the `uCloudSoft` declaration and one line), and every valley image
with no hazard running is pixel-identical (tests/scenes.mjs, tests/house.mjs, tests/hazards.mjs; max 0 since the
polish).

**The hook-free twins** (polish; gl.js, render.js, `HAZARD_IDLE` in glsl/shade.js). Inlining the hooks, idle as they
were, changed the Metal codegen of the sky expression: the valley differed from the live Phase-2 file by 1 LSB on a
pixel or two of some rain frames, deterministically (summer rain `seed=3&t=300` at 1600×900: (395, 2) and (202, 122);
autumn rain `seed=2&t=90` at 1280×720: (364, 66); removing the sky path's `hazardLight` call gave max 0, splitting the
expression into hazard-off / hazard-on arms or handing the hook its own ray did not), and the hazard code cost the
valley ~2% of its steady frame rate. Now every program whose recipe includes HAZARD (sky, shade, comp in both
scenes) has a twin `'<recipe>~idle'`, HAZARD replaced by `HAZARD_IDLE` (the five hooks as the identities they are while
their hazard is off), and the frame draws the twins while `hazardsIdle(S.F)` holds (render.js: no flash, smoke, crack,
shake, zoom or blur; it mirrors the hooks' early-outs, which tests/check.mjs pins). The idle frame is then Phase 2's code
(the twins differ from Phase 2's sources by the five stub lines and the glue's guards) and the valley is max 0 against
the live file in those frames too; the full programs are lazy (built on the first hazard or by the prewarm). Only with
`KHR_parallel_shader_compile` (see Boot cost): without it there are no twins and the full programs serve the idle frame,
as before (those 1-LSB pixels then stay). `R.drawn` names the sky / shade / comp programs of the last frame.

- **ENV** declares the shared environment uniforms. Every per-frame program includes it right after its precision
  header; the bake never does, so environment state cannot reach or recompile the bake.
- **FS_SHADE is glue**: tree-sway remap of the G-buffer lookup (`treeH(g0)`: the valley's mat-2 rule, or the scene
  surface chunk's own when it defines `SCENE_SWAY`), the cloud-pass fetch, then a sky pixel
  `applyVeil(hazardLight(sceneSky(rd, cl), ...), t, frag)` (`sceneSky` = `skyPixel` unless the scene's surface chunk
  defines `SCENE_SKY` and its own: the house's golden-hour gradient, stage 2b), a surface pixel `shadeSurface(uv, g0, rd, t, snowMask)` →
  `hazardSurface` → `hazardLight` → `applyAtmos(col, t, rd, cl, cT)` → `applyVeil`, or with `uView > 0`
  `surfaceDebug`. Keep these signatures: every scene's surface chunk implements `shadeSurface` and `surfaceDebug`.
- **The sky pass** marches the slab at half resolution with temporal accumulation (EMA 0.3, restarted by `uSkyResp`)
  and stops at the terrain: `terrainT` reads G0 through the GBUF chunk (render.js binds the G-buffer like every other
  pass; during a resize rebake the baked rows read the new buffer, the rest the old one aspect-remapped; on the first
  load unbaked rows read as sky behind the reveal). The second target `uSkyD` stores the mean cloud distance **in km**
  × opacity (`applyAtmos` multiplies by 1000).
- **PRECIP_VS** (flake.js) is the stateless core of both particle VS: uniforms, hashes, slice-box wrap, projection,
  slice fade, frustum test, the drag wake with a per-call weight.
- **The bake**: `sceneQ` is the only scene query; `gbMaterials(...)` is called once, never calls `terrainH` /
  `sceneQ`, reads `forestDensity` once; no ATMOS / SURFACE; everything it writes is season-neutral. The house bake
  follows the same rules (one `sceneQ`, one `houseMaterials`, no ENV / ATMOS / SURFACE / HAZARD; tests/check.mjs).
- **Shared JS twins**: `S.snowlineOffset(alt, line, halfW)` (glsl/surface.js) is built from the same constants as
  the GLSL `effectiveCover` (`K .9`, `K2 1.3` over `line − 1600 .. line − 500`); `derive/surface.js coverAt(alt)` /
  `visCover` and the exposure use it.

## 6. G-buffer layout (`S.GB_LAYOUT`, gl.js)

Four NEAREST, canvas-sized attachments, written by the striped bake (`o0..o3`), read through `G0(uv)..G3(uv)` (which
handle the rebake mix).

| | Format | x | y | z | w |
|---|---|---|---|---|---|
| G0 | RGBA16F | `t` hit distance (m; 65000 = sky) | `mat + 0.9·frac`: 1 terrain (+ grass), 2 tree (+ height), 3 wall, 4 roof | baked sun shadow | AO |
| G1 | RGBA16F | albedo r (summer reference, linear) | g | b | `snowT` |
| G2 | RGBA16F | oct(detail normal).x | .y | oct(smooth normal).x | .y |
| G3 | **RGBA8** (fallback RGBA16F) | `rock` | `soil` (path / bare soil, puddle potential) | `larch`: resolved crown is a larch when its random value falls under `larchShare` (~400 m stands, 4-80%, more toward the treeline); far canopy = canopy cover × share | `moist` (0 dry rib / sunny steep .. 1 moist hollow) |

This table is the valley's. The layout (formats, G0 x / z / w, G1, G2) is shared by every scene; the material ids in
G0.y, the meaning of its fraction and the four G3 channels are per scene: the house's are in §14.
- G3 is season-neutral, quantized to k/255 in the bake and on read, so the RGBA16F fallback shades identically.
- 28 B/px (32 with the fallback); `GB_MAX_PX` 8.4e6; above `GB_SINGLE_PX` (6e6) a rebake drops the old buffer first.
- **snowT**: the cover level at which a pixel whitens (season-neutral order including Phase 1's altitude preference).
  The per-frame snowline is applied on top by `effectiveCover(alt, sunExp, xz)` (SURFACE):
  `a = alt − 320(sunExp − .45) + 260(noise − .5)`,
  `cEff = uCover − .9(1 − smooth(sl − w, sl + w, a)) − 1.3(1 − smooth(sl − 1600, sl − 500, a))`. A snowline far below
  the scene gives exactly 0 (Phase 1). Thaw (`uMelt` × air above 0 °C at that altitude) melts sunny patches, roofs and
  trees first.

## 7. Texture units, scene alpha, precipitation

| Unit | Use |
|---|---|
| 0, 1 | Pass inputs: `uTex`, `uSrc`, `uPrev` / `uPrevD`, `uHdr` / `uBloom` |
| 2 | `uScene`: scene colour + snow alpha (flake, rain, comp) |
| 3, 4 | `uSky`, `uSkyD` (shade); unit 3 is also `uSkyH` (shade@house: the same cloud-pass texture, through S.F) |
| 5 | `uPrevHdr` (shade@house: the previous frame's `R.hdr`); `uBoltSky` (bolt: the cloud pass) |
| 6 | `uBoltSkyD` (bolt: the cloud distance) |
| 7 | `uNoise` |
| 8-11 | `uG0..uG3` (shown G-buffer) |
| 12-15 | `uN0..uN3` (the one being baked; during the house's variant dissolve: the new variant, read by gbuf@house's copy mode) |

`bindGB(u, 8)` binds the G-buffer in sky, shade, precipitation and comp. No program samples its own target (the shade
pass reads last frame's `R.hdr` while writing `R.scene`; the dissolve copies `gbNext` into `gbCur`).

**Scene alpha**: FS_SHADE writes `snow × G0.z × smoothstep(.5, .95, cloudShadow) × (1 − wetSnow)` (0 on the sky and
in a debug view). Consumers never recompute cover: the composite sparkle (density `0.016·a²`, also gated per glint by
`cloudShadow²` and by `uGradeP.z`) and the flake tint over snow. Read it from `R.scene`, never `R.hdr`.

**Precipitation** (precip.js). Layer descriptor:
`{ id, kind: 'snow'|'rain'|'ash'|'ember', prog, z0, z1, fade, base, max, heavy, vlo, vhi, fallKey, rateKey, wet (snow) | push (rain) }`.
Phase 3: wildfire ash (program `ash`, ids 9 far / 12 mid / 13 near: torn grey flakes, 0.2-0.9 m/s, `ashI`) and embers
(program `ember`, ids 10 / 14: additive HDR sparks rising and sinking, `emberI`), counted by `F.uAshRate` /
`uEmberRate` (~22k ash, ~400 embers at full smoke; rain halves the ash and quenches the embers); a layer whose count is
not positive is skipped before any GL call. While the frame shakes, every layer's wind integrals are offset by the same
~2 cm camera translation before the lattice wrap (the near particles jitter, the far ones barely move). After the
layers, render.js calls `S.drawHazards(ctx)`: the lightning bolt (≤ 159 instanced quads, additive into `R.hdr` so the
bloom picks it up) and the quake's dust (1440 instanced puffs anchored on the scene through G-buffer lookups; not a
LAYERS entry; `precipCount.dust` = the puffs drawn).

- Count: `min(max·flakeMul, base·amountMul·flakeMul·F[rateKey]·(1 + (heavy − 1)·uHeavy)·(1 + (wet − 1)·uWetSnow))`.
- Snow ids 0-4 (near bokeh, crystals, mid, far, hero); rain ids 5-8 (near defocused drops, near streaks, mid, far
  fine streaks: 14-70 m). Layers draw far to near (sorted by `z1`), switching program only when the kind changes, so
  rain and snow interleave by depth; sleet = both populations with counts crossfading by `snowFrac`. A particle never
  changes kind, bin or speed range; fall-speed changes go only through the integrals.
- Budget at amount .5: calm snow ~45-60k, blizzard ~183k, rain ~15k, thunder ~29k; heavy rain caps ~54k.
- render.js calls `S.drawPrecip(S.passCtx)` between FXAA and bloom into `R.hdr`, premultiplied
  (`ctx = { use, bindGB, bindTex }`).

## 8. Debug views (`?view=`)

`uView` 1..8: `alb` (baked albedo), `snowT` (grey 0..1, red < 0, blue > 1), `g3r` rock, `g3g` soil, `g3b` larch,
`g3a` moist, `cEff` (effective cover incl. the snowline's aspect / noise shift, like snowT), `wet` (wetness × gloss
potential). `surfaceDebug` draws it, the composite shows it ungraded, no precipitation.

## 9. Frame order

**Boot** (main.js): `initContext`, `bindGLEvents`, `useScene(?scene)`, `frameCamera` for the canvas box's aspect, `initSim(cfg)`, `bindInput`, `bindUI` (or remove the chrome),
`syncUI`, `window.snowSim = makeApi()`, `advance(?t)`, `?cover`, `?event`, `initGL` (extensions, `buildPrograms` (the
active scene's set), noise, `allocate` → striped bake), `requestAnimationFrame`.

**Per frame**: next rAF; real `dt` clamped to 0.1 s; `adaptStripe` after a stripe frame; fixed `dt` under `?fixed` /
`?frames`; `simStep(dt)`; `deriveF()`; `render()`: 1 G-buffer stripe or swap, 2 half-res clouds, 3 shade, 4 FXAA,
5 `drawPrecip` + `drawHazards`, 6 bloom, 7 composite; the quality controller; `prewarmTick` (§5); `updateUI`;
`checkSize` (twice a second, §13).

## 10. Tests

From the project root (headless Chrome on the real GPU, Python 3 + PIL). `sh app/tests/all.sh [phase2 args]` runs
them all; every browser test fails on any console error / warning. `cdp.mjs` is the harness (`capture()` one-shot,
`open()` a live session; a watchdog fails a page that stops answering instead of hanging). Polish: each Chrome runs on
a fresh profile with `--remote-debugging-port=0`, and the session reads its port and browser target from that
profile's `DevToolsActivePort` and checks `/json/version` against it, so parallel runs (other agents, other test files)
can never drive each other's page (the old random port 9300-9899 could land on a Chrome already listening there and
navigate its page); every Chrome a process started is killed when it exits (also on SIGINT / SIGTERM / SIGHUP); the
page may be a URL. `tests/ref.mjs` provides the Phase-2 reference for the parity checks: git commit `f311fc6` (the
live site's source) extracted once with `git archive` into the OS temp dir, so a fresh clone has it (the gitignored
`work/phase3/app-phase2` is only the fallback without git history); a missing reference fails, it is never skipped.

| Command | Checks |
|---|---|
| `node app/tests/check.mjs` | Syntax, the one-IIFE rule, no load-time side effects, the registry and chunk:line mapping, no uniform declared twice per stage, ENV placement, bake rules, glue calls, every declared uniform set, module shapes; fxaa / down / up unchanged since Phase 2 (git f311fc6, tests/ref.mjs; also stage 0a's) and the source delta per program against it. |
| `node app/tests/sim.mjs [--quiet]` | Node, no DOM / GL (lane A): shapes, year length, speed scaling, season ease, seasonKo, the first weather, picks / holds / auto, staging, Markov rules and per-season statistics, no channel jumps under 165 random UI actions, counter RNG, 16-year ground means, melt / wet / snowline, wind (plain pointer motion has zero effect, drag steer, cap, 15 s half-life, veer, gale), determinism incl. `?speed=8&t=600`. |
| `node app/tests/smoke.mjs` | Plain file:// load with zero console errors; a broken chunk reports `BROKEN:3`. |
| `node app/tests/hooks.mjs` | `?gb16=1` renders the RGBA8 image within the capture noise; every `?view` renders and they all differ; `?wx`, `?ground`, `?yp` reach the frame (the year phase now drives the season shading). |
| `node app/tests/interact.mjs` | The chrome and the pointer contract against expected values: API surface, hint, glyph, open / close / Escape / Enter / outside press / 6 s auto-close, status line from the real sim (`눈 → 비` + hairline), weather / season chips, arrow keys, speed caption, amount, API → chrome sync, buttonless sweep = nothing, drag steers with the grabbing cursor and decays, `?ui=0`. Phase 3: the place cards (labels from `S.scenes`, a pick switches, the glass stays open with the checked card busy until `state().ready`, the status line names the place), the 뇌우 chip, the grid's ↑ / ↓, the hazard buttons (trigger, glow while running, expiry) and the 가끔 자동으로 switch both ways, the ← / → place keys and their guards (glass open, text / radio / slider / switch focus, modifiers, repeats), the toast, `?ui=0` removing the toast and the keys. |
| `node app/tests/mobile.mjs [--out DIR]` | Phones and tablets with mobile emulation (touch, coarse pointer, iPhone UA; §13): canvas fills the screen and its buffer is `round(box × 1.25)` on 390×844 / 430×932 / 844×390 / 820×1180 / 1180×820; the per-aspect framing reaches the uniforms and the precipitation boxes (landscape = the desktop camera bit for bit); the keyboard-dismissed and rotation sequences re-size and re-frame with the first-load reveal; the stale-size check alone (no ResizeObserver) re-sizes at an uncapped frame rate; a one-finger drag steers along the re-framed camera, a second finger is ignored, lifting / cancel / lost capture end it, a buttonless sweep does nothing; the pop-over fits 390×844 and 844×390 without scrolling with finger-sized targets and hides the hint; the desktop pop-over geometry and the 1920×1080 camera are unchanged; the quality ladder (node, `js/perf.js` on a modelled 60 Hz display) settles. |
| `node app/tests/phase2.mjs [--only …] [--update-golden]` | Boot hooks; every weather pick a 60 s transition (0 / 30 / 60 / 75 s via `advance`, and at 8× real time with screenshots); season-pick ease; drag-only wind (deterministic: a hover sweep leaves the animation state bit-identical, a drag moves the particles' wind and uploads the wake to both programs while the cloud drift and natural wind stay bit-identical); 15 s steer half-life live; determinism at `t=300` / `t=900`; the Phase-1 anchor (cover 1, cover 0, `?storm=1`) against `tests/golden` (+ informational vs 0a); a one-year soak at 8× (`?seed=7`, chrome on): timeline, no NaN / Infinity in `S.F`, per-frame `uExposure` continuity, no stuck state, heap stable, `year-sheet.png`. |
| `node app/tests/fps.mjs` | Performance gate: uncapped fps ≥ 60 at 1920×1080 dpr 2 (render 2400×1350) for each weather in its season, blizzard over full cover, rain at amount 1, rain at the caps, blizzard at amount 1 (+ an informational heavy-sleet extreme); the house in every weather (+ rain amount 1, blizzard over cover 1); the hazards in both scenes (`hz ...`: thunder with a strike every 0.4 s, the quake's main shock, a quake in rain, a full wildfire, all at once; triggered once the scene is ready); quality rung must stay 0. A run whose measurement the harness lost (a non-string value under a loaded machine) is retried. Polish: each run waits for the frame rate to settle after `ready` (1 s windows, at least 4, until two in a row agree within 10%: the post-bake queue of the uncapped harness can stall and then burst for seconds) before the action and the measurement; two stress rows (the house in snow at amount 1 under full wildfire smoke; the valley blizzard at amount 1 over cover 1 with full smoke, a quake and strikes). Run on a quiet machine. |
| `node app/tests/parity.mjs` | Retired as a gate in stage 2a (Phase 2 changes the image by design); kept as a comparison tool against stage 0a. |
| `node app/tests/scenes.mjs [--only node,parity,hooks,house,switch,resize,bundle]` | Phase 3 (§14). Node: the sim equals the Phase-2 copy (git f311fc6 via tests/ref.mjs) on its keys (state and S.F after the same `?t`, 5 queries whose histories hold no thunderstorm); the event scheduler is deterministic and counter based (a triggered strike / quake never shifts the natural strikes), the quake / smoke / flash envelopes, a manual thunder pick strikes, the automatic weather reaches thunder in late spring / summer only, hazardsAuto, the API. Browser: the valley pixel-identical (max diff 0) to the Phase-2 copy in 7 states incl. a 390×844 dpr-3 phone, with the same state and S.F; `?event=quake / wildfire` and `?wx=...,lightning:1` show in the valley, a boot strike that has ended leaves it pixel-identical; `?scene` unknown -> valley; the house boots ready with zero errors at 1920×1080, 390×844 and 844×390 (phones) with content, every `?view` renders in the house; the prewarm compiles every scene's programs after the first ready (all 17 recipes since stage 2b, with and without `KHR_parallel_shader_compile`), after which 20 switches + 6 mid-bake switches create no texture / framebuffer / program; valley -> house -> valley returns the valley identical to an unswitched run in snow, a blizzard's gale and rain on a phone (the same state and S.F; ≤ 1 LSB on a few sky pixels: the restarted half-float cloud history); the house through a portrait resize and a context loss, and a switch between a loss and its event without an error; `tools/build.mjs` single file == multi-file pixels (valley and house). Polish: the pixel gates are max 0; a pair inside the capture-noise floor (max 1, mean < 0.001) is captured again up to twice (noise clears, a deterministic delta repeats). |
| `node app/tests/house.mjs [--only ids,bake,phone,variant,nan,cozy,comp,look]` | Lane H's: the house boots with zero errors; the baked G-buffers (read back) of the landscape and phone-portrait framings hold every material id 1..18 and none outside the table; the shade pass gets `uPrevHdr` / `uSkyH`; the bake (wall time to a 1-px readback, both variants) under 2 s at 2400×1350 and small at 488×1055, the bare variant has no leaf, more wood and the twig haze; the phone (390×844: pitch 12.5° since stage 2b) / landscape-phone framings; a live leaf drop rebakes the bare variant behind the live scene (ready throughout), dissolves it in, swaps, no leak, and back; (polish) the baked G0-G2 hold no NaN / Inf in both variants at 2400×1350 and 488×1055 and after the stage-2b stripe sequence; uCozy follows the weather and a quake's flicker reaches shade@house and comp@house alike; the composite hook (FS_COMP_SCENE = FS_COMP + exactly the two `sceneComp` lines and, since stage 2b, the `sceneReveal` prototype and its reveal line in place of the pale backdrop; the valley comp is Phase 2's recipe (git f311fc6) with HAZARD added and FS_COMP = Phase 2's + exactly the shake / hazardComp lines; the valley composite pixel-identical (max 0) to the Phase-2 copy; polish: was the gitignored stage-0 copy); the look per weather (golden vs dusk in node, every weather renders with zero errors). |
| `node app/tests/hazards.mjs [--only node,render,parity,det,leak,fps]` | Lane Z's: the variant chain matches Phase 2 (4 seeds × 10 years), storm seasonality, the thunder preset, strike / bolt / shake determinism and counter independence; the quake envelope, overscan (no frame edge ever shows, 16:9 and portrait), the house light flicker, cracks open and fade, strokes, heat lightning, smoke ramps, rain dampening; the override rule (nothing overridden while idle, S.F bit-identical after each hazard) and the override order under a thunderstorm (§4); hazardsAuto; every hazard renders in both scenes and shows; valley parity with no hazard (max 0 against the Phase-2 copy from git, capture noise retried); a strike / quake at fixed frames renders identically twice; no GL leak over hazard cycles and switches. `--only fps`: its own fps rows (all.sh runs them in fps.mjs). |

Stage-2a results (Apple M4): every check green. The year soak (1280×720) ran 340-410 fps with a max per-frame
exposure step of 0.0013-0.009 (gate 0.03; the larger value on a contended run with 0.44 s frame gaps), 9 transitions
over 5 weathers for seed 7 and a 4-5 MB heap. Performance gate at 1920×1080 dpr 2 on a quiet machine:

| State | fps | instances |
|---|---|---|
| clear / summer | 187 | 0 |
| cumulus / summer | 176 | 0 |
| overcast / autumn | 186 | 0 |
| fog / autumn | 179 | 0 |
| rain / summer | 170 | 15k drops |
| snow / winter | 163 | 45k flakes |
| blizzard / winter | 161 | 183k flakes |
| blizzard over cover 1 | 149 | 183k |
| rain, amount 1 | 165 | 27k |
| rain at the caps (precip 1, heavy 1, amount 1) | 151 | 54k |
| blizzard, amount 1, cover 1 | 130 | 189k |
| heavy sleet extreme (info) | 103 | 150k + 35k |

A later run of the gate while another agent shared the GPU (load average ~6, best of 3) gave 109-154 fps for the
gated states (heavy sleet 88); an A/B against the pre-stage-2a tree in the same conditions was equal within 2%, so
the stage-2a changes are performance-neutral. `fps.mjs` prints the current numbers and the load average.

## 11. Stage-2a integration record

Cross-lane items resolved in the merged tree:

- **Overcast is lighting only (C → D)**: the turf dulling by `uOvercast` was already gone in D's surface; the
  grass-wave strength is now keyed on `uGale` (`0.22 + 0.25·uGale`; in Phase-1 conditions gale = overcast).
- **Exposure keyed to the visible snow (D → C) and one snowline model (C mirrored D)**: `S.snowlineOffset` (built
  from the GLSL constants) → `derive/surface.js` `coverAt(alt)` / `visCover` → the exposure's
  `.7·visCover + .2·coverAt(800) + .1·coverAt(2000)`. C's copy (K = 2, one term) is gone.
- **Snowline units (A / D)**: scene metres. The merged surface was checked: summer leaves only the top couloirs of the
  left massif white, autumn dusts its peaks. `MEADOW_CAP` moved from −350 to −550 m: with D's 300 m half-width and
  per-pixel shift, −350 still bared ~1% of the meadow (`?view=cEff` measurement), −450 and below none. The cap now
  also applies while snow falls onto a meadow that holds snow (before, a −0.5 °C snowfall parked the line at −308 m,
  inside D's transition, and bared sunny meadow pixels under the falling snow).
- **Heavy rain thickens the air (E → C)**: the rain extinction and the rain share of the deck haze scale with
  `(rain·(0.6 + 0.4·amountMul)/0.65)^0.6` (1 at the canonical rain and default amount, ×1.18 at amount 1).
- **Veil tail gated by snowfall (C → E)**: `0.04·tail·smooth(0, .3, uPrecipSnow)`, like the atmosphere's tail.
- **Rain curtains hang from the drawn cloud base (E / C)**: VEIL reads `uCloudQ.x` instead of a 1500 m constant (the
  deck lowers to ~1150 m in rain).
- **Status line (A / B)**: one season label, `S.climate.seasonKo` (B's month-thirds label disagreed with
  `state().seasonKo`, e.g. 22 Oct read 가을 vs 늦가을). Chips, status, hairline and glyph verified on the real sim.
- **Sky pass**: reads G0 through GBUF + `bindGB` (C's optional cleanup); `uSkyG0` / `uSkyGb` and the derive-time
  buffer selection are gone, unit 5 is free again. Resize mid-rebake and context loss: no errors.
- **Determinism**: the start phase is taken from the calendar day, so `?seed&t` reproduce bit for bit within a day.
- Tests: hooks / interact rewritten to Phase-2 expectations, `phase2.mjs` and the fps gate added, parity retired.

Open for stage 2b (art direction, not changed here; see §12 for what stage 2b did with each): A's flag that the winter snowpack is modest under the contract
accumulation rate (Jan ~.26, Mar ~.48; `1/300` in ground.js); overcast / rain meadows after C's lift; the rain curtains
reading like light rays over the cliffs in strong wind; the valley-mist glow on clear spring / autumn days; under a
deck the massif summit sits in cloud; bare larches are opaque crowns; the far valley-flank larches are in terrain
shadow; the speed caption reads `1년 = 2분 30초` at 8× (= 2.5 min).

## 12. Stage-2b art-direction record

The 4 seasons x 7 weathers matrix (`?season=S&weather=W&t=90&frames=480`, 1600x900), the boot state and the Phase-1
anchor were shot after every round (17 rounds; `work/stage2/s2b/r00..r17`, the capture script
`work/stage2/s2b/matrix.mjs`, transition frames `trans.mjs`, GPU-timer A/B `gpu.mjs` / `gpu2.mjs`). Finals:
`work/stage2/final-matrix.png`, `final-<season>-<weather>.png`, `final-boot*.png`, `final-trans-*.png`,
`final-year-8x-sheet.png`.

- **The opening** (no hooks, late October). The first snowfall is a cold snap (FIRST_COLD, §3 Weather): −2.5 °C,
  dry Phase-1 crystals; wet snow (`uWetSnow`) now exists only in the thaw band (+0.4..2.6 °C) and at most 60% (crisp
  crystals keep falling between the clumps). Snow settles at ACC = 200 s: roofs white within a minute, the meadow
  patchy-white in two (cover .06 at 8 s, .26 at 60 s, .6 at 150 s). Falling snow pulls the palette at most 70% to
  the winter key (some golden low sun stays on the larches); the melt-margin matting is narrower (`snowT − .3`, 0.7),
  so the meadow stays tawny between the first patches.
- **Grass** (SURFACE `grassSeason`): the spring / summer targets moved from lime (hue ~88°) to the reference's
  yellow-olive (summer meadow hue 66-69°, sat ~.5, as the reference photo's 55-65°); summer keeps lush darker olive
  hollows against sun-bleached ribs, spring is lighter and fresher; a ~250 m hue drift (greener / yellower swathes).
  Wet turf is more saturated (water fills the gaps between the blades).
- **Fog sea** (ATMOS): beyond ~1 km the analytic sea hands over to banks, a height field `fogTopH` (swells ~2 km,
  billows ~430 m, far banks up to ~1.3 km against the mountains in ~6 km groups, no saturating plateau), drifting with
  a third of the cloud wind. `fogBanks` brackets the ray against it (4-8 geometric samples on a 3-fetch cheap height,
  3 bisections, full detail at the crossing), skips rays that cannot reach a bank (a per-distance upper bound), and
  returns the optical depth below the soft top (a few metres near, ~12 m far: crowns and ridges emerge) and the sun on
  the billow's flank (sunward flanks glow white, lees stay soft blue-grey). A fog-sea day is an inversion: the haze
  above the sea is 45% thinner.
- **Cumulus** (FS_SKY): the second billow octave is half a smooth bulge, the finest one fades beyond 5-14 km, the top
  of a cell is an iso-surface of the 3D billows heaped by an ~800 m noise (rounded domes, not plateaus over vertical
  walls), a soft outline around a dense core, more powder light; the sky EMA runs a little longer under cumulus
  (blend .18 vs .3, reset / jumps unchanged). Shadows unchanged (they sweep visibly within 1.5 s).
- **Winter / ground**: the climatological spin-up (§3 Ground) — winter is white to the valley floor, early spring
  patchy and melting from below, summer bare with high couloirs, late autumn dusted; a UI season pick eases there
  over 60 s. Free-running years (unpinned): Jan .37, Mar .60 cover (was .26 / .48).
- **Rain**: thinner rain haze and valley mist (the valley keeps its depth; the left massif dissolves layer by layer),
  stronger far curtains with soft fibres (no sunbeam striations), a luminous deck with more stratus structure, a
  partial exposure lift (moodier), rich wet colours (less desaturation), glossier path / rock / roofs and puddles
  that mirror the bright deck (at least 35% of the sky).
- **Clear / overcast**: deeper clear-day skies (summer haze 1/24000, autumn 1/36000; bluer horizon / fog colours);
  fair weather and calm overcast days keep the valley mist an even haze (no glowing blob over the far valley; under
  falling snow the Phase-1 valley glow is kept, as in Phase 1); a dry grey deck is a high lid (~2900 m: no flat
  "table mountain" cut through the massif), a rain deck still hangs at ~1150 m. On crisp days the composite sparkle
  is denser and brighter (`uGradeP.z` > 1).

Tests: every check green (check, sim, smoke, hooks, interact, phase2 incl. the one-year soak, fps). Changed by
design: `sim.mjs` melt-curve expectation (a spring pack now lingers on the slopes: mid-spring 279 s, summer 56 s,
winter never), the goldens `anchor-cover0` (narrower melt-margin matting on the dormant meadow, mean .36) and
`anchor-storm` (roofs whiten sooner under ACC 200, mean 1.2); `anchor-cover1` unchanged. Performance (1920x1080 dpr 2,
load average ~20): every gated state 103-128 fps at rung 0 (fog 105, blizzard amount 1 103, sleet extreme 87).
GPU-timer A/B vs stage 2a (p05, min of reps): whole frame +0.4..+0.8 ms on dry weather, +1.65 ms on fog days (the
banks; ~+0.2 ms of their code when off); shade pass clear +0.35 ms, fog +0.7 ms.

Left open: bare larches are opaque crowns and the far valley-flank larches sit in terrain shadow (G-buffer limits);
the Phase-1 valley glow under falling snow is kept for parity; a manual snow pick in summer / autumn shows patchy cover
after 90 s (it snows onto a bare meadow, by design).

## 13. Phones and tablets

Carried over from the Phase-1 hotfix (`9915adc`, favicon `7659bd7`) and `docs/PHASE2_PLAN.md` Appendix B.

- **Sizing** (gl.js, css/ui.css). The canvas is `position: fixed; inset: 0; width: 100%; height: 100%` (not
  `100vw × 100vh`: on phones vh is the largest viewport) and its buffer is read back from that box:
  `S.cssSize()` = `clientWidth × clientHeight`, `S.targetSize()` = `round(box × min(dpr, 1.25))` (scaled down to
  `GB_MAX_PX`). Every source re-allocates through one 150 ms debounce: window `resize`, `orientationchange`,
  `visualViewport` resize, `ResizeObserver(canvas)`, the DPR media query, and `S.checkSize()`, which main.js calls every
  frame and which looks at most twice a second (wall time) and only schedules while no allocate is pending (`resizeTimer`
  is 0 once the timer fired), so it can never keep pushing a pending one back at a high frame rate (the bug of the first
  Phase-1 hotfix). The pointer maps through the same box (input.js). `viewport-fit=cover`, an inline SVG favicon,
  `overscroll-behavior: none`, no long-press callout, no landscape text inflation.
- **Framing** (the valley's `frameCamera(asp)` in js/scenes/valley.js since Phase 3; `S.frameCamera` delegates to the
  active scene; called by `allocate`, by a scene switch and once at boot before the sim starts; the wind is
  camera-relative). Landscape (`w/h ≥ 1.25`) is the Phase-1 camera bit for bit (`tests/mobile.mjs` compares the
  strings, the sign of zero included). With `t = smooth(1.25, 0.6, asp)`: yaw `−9°·t`, pitch `−12° − 4°·t`, and
  `tan(fovY/2) = max(tan 22°, tan 17° / asp)` (horizontal fov ≥ 34°). The hotfix blended that last term by `t` too,
  which let the horizontal fov dip to 33.85° around aspect 0.7 (a portrait tablet); `max()` gives the same value for
  every phone (asp ≤ 0.6) and every landscape. 390×844: hfov 34°, vfov 67°; 820×1180: hfov 34°, yaw −8.5°.
  `camF / camR / camU` are mutated in place (render.js, precip.js, main.js, derive/precip.js and sim/wind.js alias the
  arrays); `S.TANH` is read at call time everywhere (`uTanH`, the bake's `uPixAng`, the sway and flake focal lengths,
  the precipitation layer boxes); wind.js refreshes its ground-projected `camF` each step (the steer and the gale line
  follow the view). A re-framed camera drops the old G-buffer: the new one is revealed like a first load (the old one
  holds other rays, an aspect remap cannot blend them). Precipitation counts are per layer, not per area: a portrait
  phone sees ~1.4× the 16:9 flake density per solid angle (the unframed portrait camera would have been ~3.9×), a
  portrait tablet ~2.2×.
- **Touch** (input.js, §3): a one-finger drag is the left-button drag; a lifted finger, `pointercancel` or a lost
  capture ends it; other fingers are ignored. `touch-action: none` on the canvas and the icon, `pan-y` on the pop-over.
- **Chrome** (css/ui.css, ui.js). The icon, pop-over and hint clear `env(safe-area-inset-*)`. The icon's 28 px glyph
  has a 44 px tap target. Hover styles only under `(hover: hover)` (a tap would leave them stuck). Under
  `(pointer: coarse)` (Phase 3): place cards 46 px (44 on short screens), season chips 36, weather cells 54 (48-50
  compact), hazard buttons 44, the switch 36, slider rows 32 px with a 22 px thumb (`--th`; the tick labels follow it);
  a desktop keeps place 42, chips 26, weather 50, hazards 34, sliders 14. The glass is a `rgba(16, 32, 58, .82 → .76)` gradient with
  `--ink2` .84, `--ink3` .78, `--fill` .17 (≥ 4.5:1 even over pure white). The pop-over is
  `max-width: calc(100% − 44px − insets)` and `max-height: calc(100% − 76px − insets)` (scrolls inside only as a last
  resort); `#pop` has z-index 2, so a fading hint never shows through the glass. Measured: desktop 272×545; 390×844
  portrait 272×609 above the glyph; a short portrait (`max-width: 599px` and `max-height: 760px`: Safari's bars showing;
  the speed tick labels hidden, tighter chips) 272×567 at 390×664; a short window (`max-height: 500px` and
  `min-width: 600px`: a landscape phone) gets the compact layout in four blocks — place + season over time on the
  left, weather + amount over the hazards on the right, the two lower hairlines aligned; the DOM order still reads left
  to right — opening beside the glyph, 548×334 at 844×390. Nothing scrolls in any of these.
- **Performance**. A 390×844 dpr-3 phone renders 488×1055 (0.5 Mpx, 16% of the 1920×1080 dpr-2 desktop's 3.2 Mpx).
  *Bake stripes / iOS GPU watchdog*: bake cost measured on the M4 (blended draws so Apple's hidden-surface removal
  cannot drop repeats): 52-840 µs per row at 488 px (the forest / wall rows cost most), the whole phone bake ~0.26 s of
  GPU; 844×390 0.55-1.0 ms per row; 820×1180 0.5-2.1 ms. The first stripe is `round(H / 120)` rows (phone: 9 rows,
  ≤ 7.5 ms on the M4's worst rows), and a stripe grows only while its frame stays inside 34 ms (first load) /
  ~1.35 frame periods (rebake), shrinking ×0.6 on an overrun; even a GPU 7× slower than the M4 with 2-3 frames of
  feedback lag and a 2.8× row-cost jump overshoots to ~150 ms once, far below the multi-second watchdog. The hard cap
  `ceil(H / 6)` rows is 176 rows on the phone (≤ 148 ms on the M4's worst rows) and is only reachable while frames stay
  inside budget. *Quality ladder* (perf.js): modelled on a 60 Hz display (`tests/mobile.mjs`; GPU frames 10-70 ms,
  vsync-locked and pipelined presentation), the stage-2 ladder never stepped down when every frame missed vsync (a
  steady 30 fps reads as a 30 Hz display) and flapped between two rungs every ~2 min when the GPU sat just over a
  rung's budget (up to 59 changes an hour). Now a step up is judged on the next window, the ladder never re-enters a
  rung it had to leave after climbing into it (the ceiling resets on resize / context restore), and a steady slow
  cadence (≤ ~38 fps) gets one probe at the cheapest rung (kept if the cadence improves by 20%, else undone for good —
  a 30 fps low-power cap costs one ~3 s probe): at most 9 changes in an hour, none after 20 minutes. Fast GPUs (the
  desktop fps gate, 120 Hz) are never touched.
- **Tests**: `tests/mobile.mjs` (§10); `cdp.mjs` `open({ mobile, preload })` emulates a phone (touch, coarse pointer,
  an iPhone UA; resizes keep it) and injects a script before the page's own (e.g. to remove `ResizeObserver`).
  Captures: `work/mobile/` (`final/` the finished build per device and the pop-over on both phone orientations,
  `test-shots/` from `mobile.mjs --out`, `before/` the stage-2 build; `app-before-mobile/` is that build). Result: the
  whole `all.sh` green (fps gate at rung 0 for every state, 108-139 fps at load ~6).

## 14. Phase 3: scenes, switching, the house, the hazards

The Phase-3 decisions are in `docs/PHASE3_PLAN.md` (Korean, with the binding English agent contract). Stage 0 built
the engine and froze the contracts below with a placeholder house and a neutral hazard framework; the stage-1 lanes
built the house (H: shape and bake, then its look), the hazards (Z) and the chrome (U, §3 Chrome); stage 2a integrated
them (§15). Privacy (binding): the reference photo is never committed or published, no street-sign text and no house
number appear in the scene; the house is a 3D interpretation of the style.

### Scene registry (`S.scenes`, js/scenes/*.js)

| Field | Meaning | valley | house |
|---|---|---|---|
| `id`, `name` | Registry key; the UI's label | `valley`, 알프스 계곡 | `house`, 우리 집 |
| `frameCamera(asp)` | Frames the camera for an aspect ratio through `S.setCamera(pos, yaw, pitch, tanV, fovY)`; returns true when it moved; no other side effect (derive/events.js dry-runs it once per scene for the hazards' landscape staging) | §13 (Phase-1 camera in landscape, bit for bit) | landscape (aspect ≥ 1.25): eye (1.2, 1.65, −22.5) on the far side of the street, yaw 0, pitch 5°, vfov 40° (16:9: 66° across; the street ~6% of the frame). Toward portrait, with `t = smooth(1.25, .6, asp)`: `tanV = max(tan 20°, lerp(tan 29°·390/844, tan 20°·1.25, smooth(.46, 1.25, asp)) / asp)` (the horizontal fov narrows from the landscape one at 1.25 to 29° on a 390×844 phone; 820×1180: ~33° across, 47° vertical), x 1.2 → 3.4 m (centred on the entry and both windows), z −22.5 → −23, pitch `= vfov/2 − lerp(15°, 16.5°, t)` (the bottom edge 15-16.5° below the horizon; stage 2b: was 18°; a phone tilts 1.5° further up: a thinner street band at the bottom, the palms and the evening sky above the house). 390×844: pitch 12.5°, vfov 58° |
| `sun` | The baked sun direction (unit, copied into `S.SUN` in place) | (−.70, .47, −.17)/‖·‖, 33° up | (−.8, .21, −.56)/‖·‖: golden hour, 12° up from the front-left (behind the camera's left shoulder) |
| `progs` | Program name -> recipe for the scene-dependent programs (§5) | `gbuf`, `shade` (and the shared `comp`, `sky`) | `gbuf@house`, `shade@house`, `comp@house`, `sky@house` |
| `bakeIter` | The bake state machine's iteration cap (`uIter`) | 1039 | 431 (300 march, 7 ground bisection, 4 normal, 110 shadow, 5 AO, +5) |
| `variants` | The scene bakes variants (gl.js `S.setBakeVariant`; 0 otherwise) | – | true: 0 leafy, 1 bare winter crowns |
| `derive` | The scene's derive module (frame after atmos), or null | null | `house` (derive/house.js) |
| `surface` | derive/surface.js: `meadowAlt` (visCover), `snowlineW` (uSnowline.y), `mild` (stage 2b: the scene's own milder snowline `{line, tau, dT}`, or null) | −50, 300, null | 0, 300, `{ line: 2100, tau: 120, dT: 10 }` |
| `atmos` | derive/atmos.js: `coverMix` / `coverAlt` (the exposure's snow keys), `mist` {level, scale, floor, gain, swell, glow, sea, fogInv}, `cloud` {cutL, cutR, fade, undul, split, soft} | the Phase-2 constants verbatim (`soft` 0) | `coverMix` [1, 0, 0]; mist: an even ground haze on fair days, a street-scale (tule) fog ~45 m deep on fog days (`scale` [220, 300, 45], `fogInv` 38: ~40% of the facade's light reaches the camera at 25 m, the palms become silhouettes), no fog-sea banks (`sea` 0); clouds down to ~0.5 km over the whole sky (cuts 500 / 400 m, fade 1500 / 1200 m), `soft` .12 (the cumulus clean-up) |

`S.useScene(id)` makes a scene active (the sun is copied in place); scenes/valley.js activates the valley at load, so
the camera and the sun exist before any sim step (node tests included). The ground model is shared and in the valley's
metres: the house's lawn sits at the valley meadow's level (y ~ 0), so the same cover applies to it. **The milder
yard** (stage 2b, derive/surface.js, the scene's `surface.mild`): a California yard rarely holds snow, so a scene with
`mild` keeps its own snowline (stepped whatever the scene, deterministic, fast-forward included): while snow falls
(`precip·snowFrac > .02`) it follows the shared one down (the same patches come in, the same cover); once the snowfall
stops it climbs back to `mild.line` (2100 m: every threshold of the yard bare) with a time constant of `mild.tau`
climate-s, faster in sun and in warmth (the air `mild.dT` °C milder than the alpine meadow's), so the yard melts out a
few minutes (1×) after a snowfall, the sunny lawn first and the roof last, while the valley stays white. The active
scene's line feeds `uSnowline.x`, `coverAt` / `visCover` (the house's exposure, the quake dust, the dusk's 'snowy'
key); a pinned ground (`?cover` with `?storm=0`, `?ground`) shows the shared line. A winter or early-spring house
under a clear, cumulus, overcast or fog sky is therefore green and bare; snow and blizzard picks whiten it.

### Switching (`S.setScene(id)`, main.js; `snowSim.setScene`, `?scene=`)

The world goes on, only the place changes. **Kept**: climate, weather, ground, wind, hazards, every animation clock,
the chrome, `R.readyTime` (the start hint and the icon lift do not replay). **Re-done** (gl.js `S.switchSceneGL`): the
scene's programs (`S.programsFor`: built once per context and cached; prewarmed in the background, §5), its camera for
the canvas, the old G-buffer dropped (it holds the other scene's rays) and a new one baked and revealed like a first
load (`state().ready` false until the swap, §3), the sky's temporal history restarted, the precipitation boxes re-laid
(`S.layoutLayers`), the quality ladder restarted with its scaled targets (another scene, another GPU budget). An
unknown id or the active scene is a no-op; a switch before initGL or during a context loss only re-frames (initGL builds
the active scene's set). Resize, DPR, rotation and context loss work in both scenes (the scene's `frameCamera`
re-frames; a restore rebuilds its set and restarts the prewarm). A switch during a bake (or during the house's variant
rebake) drops that bake. Measured on the M4 with the GPU queue drained: a prewarmed switch costs 1-3 ms of JS
(unprewarmed, the first switch compiled for ~40-50 ms), the house bake ~0.2-0.3 s wall at 2400×1350 (striped, the
stripe budget adapting). In the uncapped headless harness any sync GL call (the switch's `checkFramebufferStatus`)
waits for the deep queue of uncapped frames (~1.3 s at 1920×1080 dpr 2): a harness artefact (with vsync the queue is a
frame or two). No GL object leaks (20 switches + mid-bake switches: textures, framebuffers and programs constant once
the prewarm is done). A switch, a resize or a frame between a context loss and its `webglcontextlost` event does
nothing against the dead context (polish: `S.ctxLost` also reads `gl.isContextLost()`, which is true at once; before,
a `setScene` in that gap logged 11 framebuffer-incomplete errors); the restore builds the active scene's set.

**The world does not depend on the place** (polish): the sim's camera-relative state — the natural gale line
(sim/wind.js), the veil / rain-gust scroll integrals (derive/precip.js `step`) and the tree-sway phase (main.js) —
follows the world's reference frame `S.worldR` / `S.worldF` (core.js `S.frameCamera`: the valley's camera for the
current aspect, from one dry run of its `frameCamera` while another scene is shown; in the valley the live camera
itself, so the valley's numbers are Phase 2's bit for bit). The per-frame screen-space values (the drag steer, the
veil / rain directions, the sway lean) keep the live camera. Before the polish all of it followed the live camera, so a
visit to the house shifted the wind integrals, the cloud drift, the particles and the scrolls for good (valley -> house
-> valley against an unswitched run, measured: max 5 in clear, 99 in rain, 150 in a blizzard; the particles elsewhere);
now the round trip gives the same `state()` and `S.F` in every weather and on a phone, the image within 1 LSB on a few
sky pixels (the restarted half-float cloud history; tests/scenes.mjs: snow, a blizzard's gale, rain on a phone). In
the house the gale line turns by ~0.3° in landscape (the valley's pitch) and up to 9° in portrait (the valley's
portrait yaw): far inside each weather event's own heading changes. The house derive's own outputs (`uCozy`,
`uHouse*`) stay in `S.F` after a visit; no valley program reads them.

### The house (glsl/house/*, scenes/house.js, derive/house.js)

A single-story California ranch house at the end of the day: a gabled two-car garage on the left (a white sectional
door with a row of arched panes), stained cedar lap siding, white trim, a recessed entry with an oval-glass door and a
porch lantern, two gridded windows, a dark shingle roof with vents and a flue; door planters, a bench, wheelie bins, a
foundation bed of shrubs and flowering perennials, a curved lawn behind a concrete edge, a white gravel strip, the
driveway, a walkway with brick inlays, four small fruit trees; behind it two tall palms (shaggy skirts, hanging dead
fronds), cypresses, broad live oaks and shade trees with open, irregular crowns, the neighbours' houses, a wood fence,
a street lamp on the near-right corner (in place of the street-sign pole), backdrop canopy cards hiding the horizon.
No car, no street-sign text, no house number.

**House space** (house-sdf.js): metres, y up, the house faces +z with its front wall at z = 0; **world = house space
mirrored in z** (`hsp()`, an involution: the engine's yaw-0 camera looks toward +z). Main body x −2.5..11, z −9..0
(side gable, ridge 4.84 m along x), garage wing x −9.4..−2.5 protruding to z 2.4 (front gable), eaves 2.72 m; lawn to
z 11, sidewalk 11..12.5, parkway, curb 14.275, street to 25.65 (world z −25.65..−14.3, ~0.15 m lower). The bake marches
in house space and flips its normals back; the shading works in world space and uses `hsp()` for the lights.
**The bake** (pure SDF; one `sceneQ` call site; phases march (objects sphere-traced, the ground heightfield stepped) ->
ground bisection -> normal -> soft sun shadow (k 14, ≤ 110 steps) -> 5-tap AO -> `houseMaterials`). SDF early-outs: a
group far from p returns its **true 3D bound** only when that bound exceeds `gMargin` (0.35 while marching, max(0.35,
0.12 ts) along a shadow ray): the soft shadow reads d / ts as a penumbra, and a slab bound prints contour bands. Thin
parts (frond blades, twigs) are widened to the pixel footprint `gFp` so they cover whole pixels instead of stippling;
hits inside the non-Lipschitz leafy noise are bisected. Cost (wall time to a 1-px readback, GPU queue drained): ~0.2-0.26
s at 2400×1350, ~33 ms at 488×1055 (a 390×844 dpr-3 phone; the stripe controller unchanged).

**Bake variants** (gl.js, render.js; scenes with `variants`): derive/house.js wants the bare variant from the leaf
drop (year phase .745, ~25 November) to the leaf-out (phase 0, 1 March; ±.006 hysteresis; set at init, so a winter
boot bakes bare at once) and calls `S.setBakeVariant(v)` (every scene; only a scene with `variants` acts on it).
`S.variantTick()` (each render) then rebakes the wanted variant behind the live scene (`R.varBake`; every pass keeps
reading only the shown buffer, `state().ready` stays true), and when the last stripe lands gbuf@house's **copy mode**
(`uDissolve` = (1, disP, p)) copies the new buffer into the shown one where a smooth screen noise lies in this frame's
band, over `S.VARIANT_DISSOLVE` = 2 s (leaves fall / come out in clusters); then the buffers swap (`R.gbVar`,
`R.varMs`). In the bare variant the deciduous and fruit crowns are skeletons with a third twig level plus a fibrous twig
haze (G3.a); where the haze lies over the sky the pixel becomes a haze surface at the crown, except one 'keeper' pixel
per 2×2 block that stays sky so the half-res cloud pass still draws the clouds behind it.

**The look** (derive/house.js over derive/atmos.js; SURFACE_HOUSE; COMP_HOUSE). A clear evening is golden: a warm low
sun (×(1.14, .76, .46)), a cooler and deeper shade, a deep blue anti-solar zenith over a pale horizon under a peach
evening haze (stage 2b: the house's own sky gradient, `sceneSky`, §16), a few sunset clouds (cover ≥ .48) and cirrus lit by the low sun, a warm white balance, golden highlights
(bright pixels keep their hue instead of washing to white), `uCozy` .4. A deck, fog, rain, snow or a storm is a cozy
dusk: dimmer and bluer (exposure down to ~.72×), `uCozy` 1, so the windows, the porch lantern and the street lamp carry
the scene; fog days have a veiled sun and a dark blue mist with drifting street wisps; a thunderstorm is darker and
cooler than rain (the house's own storm palette, `stormLook`, §4). Per frame (SURFACE_HOUSE): the California lawn
(green from the late-autumn rains through spring, golden dry patches in late summer), fruit blossom (white..pink, also
on bare twigs in late February), autumn colour and browning, the perennials flowering April-August; snow on roofs,
lawn, crowns, shrubs and the fence cap (drift relief, thaw, shelter), the street whitening through its tyre-track
thresholds; wet ground darkening, puddles with rims, depth and rain rings, screen-space reflections in puddles and
glossy wet ground (`hSSR`, marching G0 and sampling the previous frame `uPrevHdr`, falling back to the sky with the
cloud pass `uSkyH`; one frame late, invisible with the static camera), gutter drips; glass with Fresnel over the lit
room's emission, the lamps, and short-range warm point lights (porch, street lamp, windows) scaled by `uCozy`. The
composite step (COMP_HOUSE `sceneComp`, on the linear HDR frame before the exposure): lamp and window halos in the air
(fog, rain, falling snow; skipped in clear air, a closed form away from the lamp), fog wisps, the golden highlights.

### House material contract (G0.y ids, G1, G3; `HOUSE_IDS` in house-sdf.js)

G0 = t, `id + 0.9 × sway`, sun shadow, AO (as the valley). G0.y's fraction is the **sway weight**, vegetation only
(ids 2..5; 0 elsewhere): height fraction × sqrt(H / 18) × 0.3, stored ready-scaled per plant (the glue's 18 m reference
tore 45 m-distant palm trunks in wind); FS_SHADE's `treeH` through SURFACE_HOUSE's `SCENE_SWAY`. G1 = the reference
albedo (lawn: fresh winter / spring green; trees: summer leaf), `snowT`; for glass (9) and the garage door's panes (10
with b = 1) G1 is the lit room's emission colour. G2 = oct(detail normal), oct(smooth normal), world space (the bake
flips them back from house space). G3 (RGBA8, k/255):

- **r variation**: lawn dry-patch potential, board / stone / pavement tone, roof weathering, blossom tint (fruit: 0
  white .. 1 pink), autumn hue (deciduous: 0 gold .. 1 red), the room level behind glass (1 windows, .75 the door's
  oval, .35 a neighbour's); id 4: < .45 plain, .45-.7 a lavender-flowering shrub, ≥ .75 a flowering perennial;
- **g water / leaf**: hard ground: puddle potential (gutters, flat low spots, the dip in the sidewalk in front of the
  windows); vegetation: 1 foliage, 0 wood (.5 = a haze-over-sky pixel of the bare variant);
- **b object / light**: vegetation: the per-plant random (phenology offset; the perennials' colour); glass, the
  garage-door panes, the lantern glass: the light mask (1 = emits with `uCozy`);
- **a shelter + haze** = .5 × shelter + .5 × twig haze (decode: shelter = a ≥ .5, haze = 2a − shelter).

| id | Material | Notes (G3; season, snow, wet, emission per frame) |
|---|---|---|
| 1 | lawn | r dry-patch potential; California cycle: lush spring, green winter, golden dry patches in summer / autumn; whitens early and patchily, melts with ragged edges |
| 2 | fruit tree | r blossom tint; blossom on the new crown early March, on bare twigs late Feb; autumn, browning; bare variant |
| 3 | palm | fronds and trunk; r = 1 for the dead skirt and hanging dead fronds; evergreen; leaf translucency |
| 4 | evergreen | cypress, live oak, foundation shrubs (r .45-.7: lavender flowers early summer), planter balls, the backdrop canopy cards; r ≥ .75: the perennials (colour by b; April-August, brown in autumn, cut back in winter) |
| 5 | deciduous | r autumn hue; leaf-out, gold..red, browning; bare variant |
| 6 | roof shingles | snowT .07-.18 by a smooth drift field; wet gloss |
| 7 | cedar siding | r board tone; sheltered under the eaves |
| 8 | trim / stucco | fascia, soffit, frames, muntins, the front door, stucco and the neighbours' walls |
| 9 | glass | r room level; Fresnel over the room's emission (G1) × `uCozy` |
| 10 | garage door | b = 1: the arched panes (emission × `uCozy`) |
| 11 | concrete | driveway, sidewalks, curbs, gutters, walkway, stoop; g puddles; crack decals |
| 12 | asphalt | the street: tyre tracks, a slushy snow edge; g puddles (gutters); crack decals |
| 13 | brick / terracotta | the walkway's bands, the pots; crack decals |
| 14 | gravel | the white strip |
| 15 | wood | fence (snow lip on the cap rail), bench |
| 16 | lamp | the street lamp's pole and lantern, the porch lantern; b lantern glass (emits, brightest at the bulb) |
| 17 | soil | mulch, planting beds, the doormat |
| 18 | fixtures | roof vents, flue, wheelie bins (painted metal, plastic) |

Snow (all ids): the valley's `effectiveCover` model through the same constants (`S.SNOWLINE`), the per-pixel threshold
from the bake, none where sheltered, the thaw like the valley's. `uCozy` (derive/house.js): .4 at a clear golden hour,
1 under a deck, in fog, rain, snow, storms.

### Hazards (lane Z; js/sim/events.js, derive/events.js, glsl/hazard*.js, precip.js)

- **Timelines** (`S.events`, physical seconds, stepped after the wind, fast-forward included): `s.quake` (envelope ×
  the event's magnitude `quakeMag` .6-1: P waves 0-2.5 s, the S-wave main shock peaking ~3-4.5 s, aftershocks ~10.6 and
  13 s, gone at 15 s; `quakeT` its age, `quakeN` its counter, `crackT` the cracks' age: 0..60 s after the main shock),
  `s.smoke` (wildfire, 180 s: ramps in over 25 s, holds, clears over the last 30 s; `fireT`, `fireN`, `fireClock`: a
  renewal keeps the columns' clock running), `s.flash` (the last strike's 2-4 return strokes over .2-.8 s, ~45 ms decay)
  and `s.strike` { n, t0, kind 'cg' | 'ic' | 'heat', az (in half-fovs, ±1.25: most strikes in frame), dist, u[6] (the
  scene's placement / shape), dur, amp, pulses }, `s.strikes` the count. Lightning: `ch.lightning` (the thunder state,
  `?wx=lightning:x`) is a rate of up to 1 strike / 8 s through a hazard accumulator; natural strike n fires at
  `−ln(1 − u_n)`. All randomness is counter based (`S.rand(seed, n, 1000 + k)`, separate counters for natural strikes,
  triggered strikes, quakes, fires and the automatic hazards): the same `?seed&t` give the same strikes, UI triggers,
  the scene and the speed never shift the natural sequence. A strike triggered under a clear sky is a distant heat
  flash. **hazardsAuto** (default false, seeded): quakes every 30-60 min; wildfires only in late summer / autumn (phase
  ~.38-.74) at ~0.85 a year at 1×, at least 900 s after the last one.
- **API**: `snowSim.trigger('quake' | 'wildfire' | 'strike')` (returns the snapshot; unknown kinds do nothing),
  `snowSim.hazardsAuto`; `?event=` at boot; `state().hazards`.
- **Thunderstorm** (§3 Weather): the deck darkens and lowers (§4 override order), heavier rain, gusts. **Strikes**
  (derive/events.js): placed per scene relative to the camera (valley cloud-to-ground 0.7-6.3 km out on the forest
  slopes, ridges and the wall, the channel run to y = −1400 and cut by the G-buffer depth test where it meets the
  terrain; house: most 2-6 km out, whole between the palms and behind the roofline, some 0.3-1 km, ~1 in 7 at 90-230 m;
  intra-cloud crawlers under the deck); the bolt: a midpoint-displacement main channel + 4-7 branches and sub-branches
  (≤ 160 world-space points, cached per strike), drawn by `bolt` (a hot 1-3 px core and a violet glow, additive into
  `R.hdr`, depth-tested against G0, fogged, veiled by the cloud pass, fading into the deck); the flash lights the clouds
  per frame (`hazardLight`: lumpy, strongest around the channel's top; its ambient share is taken back out of the EMA
  cloud pass in `hazardSky`), the surfaces (a directional light from the channel's nearest point with a silhouette rim;
  the ambient part through `uSkyAmb`), the rain streaks and wet ground (`uSkyZen` / `uSkyHor`) and the rain haze
  (`uFogCol`).
- **Earthquake**: a screen-space shake in the composite (`hazardShake` / `hazardComp`): a closed form in the quake's
  age (low-frequency sway, a high-frequency jitter strongest in the P waves, roll), an overscan zoom from the shake's
  amplitude bound (≤ ~1.03, exactly 1 afterwards; no frame edge or blur tap ever leaves the frame, 16:9 and portrait),
  a 7-tap directional blur over the 1/60 s motion; the particles' ~2 cm parallax; the tree-sway kick on `S.anim.swayPh`;
  dust plumes (`dust`, anchored through G-buffer lookups so they follow the geometry: valley rockfall dust down the
  cliff faces, white powder off snowy cliffs; house puffs along the curb, the driveway and walkway edges and the fence;
  wet ground raises little, a snowy street none); crack decals (`hazardSurface`: a fault plus a network with chipped
  lips on the house's concrete, asphalt and brick (ids 11-13) and the valley's rock and path; open with the main shock,
  fade over 60 s; on snow only faint shadow lines); the house's lights flicker through `F.uCozy` (down to ~.3; a scene
  derive could take this over with `S.derive.house.quakeFlicker = true`).
- **Wildfire smoke**: the atmosphere override (§4: a dim reddened sun, direct light ~÷3, a brown-grey zenith over an
  orange horizon, an orange-brown haze, lower contrast, a warm grade, no snow sparkle); a smoke-veiled red sun disc with
  drifting bands placed in view (both baked suns are behind the camera) and the far fire's glow hugging the ridge /
  treeline with billowing columns bending downwind into a pall (`hazardLight` on the sky), both world-fixed in the
  scene's landscape framing (they hold on a phone); brown clouds (`hazardSky`); ash and embers (§7). Rain dampens the
  fire (half the haze, no embers, fewer flakes); an overcast deck hides the sun disc, the glow and the columns.
- **Staging** (derive/events.js `SCENE`, camera-relative; the fire, the veiled sun and the cracks use the scene's
  landscape framing, found by one dry run of its `frameCamera(16/9)`): valley — channel foot −1400 m (light from above
  −300 m), flash distance scale 2200 m, cracks 520 m ahead (radius 520 m, cells 22 m), fire az −.42 (behind the left
  massif), sun az −.12 / el .12, smoke haze 1/5200 m; house — foot −3 m, light foot 0, scale 700 m, cracks 12.5 m
  ahead, 1.5 m right (radius 15 m, cells 1.15 m: the driveway, the walkway, the sidewalks and the street), fire az .24
  (over the backyard trees right of the tall palm), sun az −.1 / el .3 (in open sky left of the tall palm), smoke haze
  1/1100 m. Re-checked against the final house in stage 2a (§15).
- **Uniforms** (§4) and **GLSL hooks** (`HAZARD`, included right before the glue of sky, shade, shade@house, comp and
  comp@house): `hazardSky(acc, T, rd, tHit)` in the cloud pass before its temporal blend; `hazardLight(col, uv, g0, rd,
  t, cl)` on every shading pixel (surfaces before the aerial perspective, the sky after skyPixel); `hazardSurface(col,
  uv, g0, rd, t)` right after `shadeSurface`; `hazardShake(uv)` and `hazardComp(hdr, bloom, bloomStr, uv)` in the
  composite. Each sits behind a uniform branch on its own hazard's uniforms and returns its input bit for bit while
  that hazard is off: with no hazard running every valley image is the Phase-2 one. While no hazard is on at all the
  frame draws the hook-free twins of these programs (polish, §5: `HAZARD_IDLE`, render.js `hazardsIdle`, whose
  conditions mirror these early-outs; tests/check.mjs pins them, so a change to a hook's early-out must update
  `hazardsIdle` too). In the shade programs a hook sees
  the scene's surface chunk; sky and comp take scene-dependent behaviour from uniforms (`uCrackQ.w` = the scene).
- **Draws**: `S.drawHazards(ctx)` after the precipitation (render.js; precip.js): the bolt and the dust. Ash and
  embers are precipitation layers (§7).

### Tests (Phase 3)

`sh app/tests/all.sh` runs check, sim, smoke, hooks, interact, mobile, **scenes**, **house**, **hazards**, phase2 and
fps (the house's weathers and the hazards in both scenes included). check.mjs adds the scene-registry contract (shape,
registered recipes, profiles with the valley's keys, every scene program's uniforms set with its scene active), the
house bake rules and the hazard hooks in the glue. The parity gate is max 0 (polish; it tolerated max 1 / mean < 0.001
before, which would also have hidden a deterministic 1-LSB codegen delta, §5): the bake's stripe pacing follows the wall
clock, so under a heavy machine load the last stripe can land on another frame and the cloud pass's half-float
history keeps a one-ulp residue (the Phase-2 copy against itself with only that pacing perturbed: max 1, mean 0.0);
such a pair is captured again up to twice, since the noise clears and a real delta repeats. The Phase-2 reference
comes from git (tests/ref.mjs, §10). Stage-0 captures: `work/phase3/stage0/`; the
lanes': `work/lanes3/{house,hazards,ui}/shots/`; stage 2a: `work/phase3/stage2/s2a/`; stage 2b: `work/phase3/stage2/s2b/`
(§16). Stage 2b changed three expectations by design: house.mjs's phone pitch (11 -> 12.5°) and its composite-hook
check (FS_COMP_SCENE also carries `sceneReveal`; still: FS_COMP byte-identical, the valley composite max 0), and
check.mjs knows `sky@house` (HAZARD before its glue; the sky pass-local uniforms).

## 15. Phase-3 stage-2a integration record

The three stage-1 lanes (H house, Z hazards, U UI) were merged into `app/` (the pre-merge copy is
`work/phase3/app-pre-merge3` = stage 0; the lanes' copies and captures are in `work/lanes3/`). Cross-lane items
resolved in the merged tree:

- **Two frozen-test expectations were stale by design** (both cross-lane effects, re-anchored to the true invariant,
  not weakened): house.mjs's "the valley comp source is byte-identical to the stage-0 copy" broke because lane Z's
  HAZARD chunk (inlined into every comp) legitimately changed; it now asserts that the valley's comp recipe is stage
  0's with every chunk byte-identical except HAZARD (assembling stage 0's recipe with today's HAZARD gives today's
  source), that FS_COMP is byte-identical, that FS_COMP_SCENE adds exactly the two `sceneComp` lines, and — in pixels —
  that the valley's composite (a crisp winter evening, the sparkle on) equals the stage-0 copy's (max 0). scenes.mjs's
  "programs +2 once" broke because the house builds three programs of its own (gbuf@house, shade@house, comp@house);
  with the prewarm it now asserts the real no-leak invariant: every registered recipe is compiled exactly once after
  the first ready (16 recipes, 16 GL programs), and 20 switches + 6 mid-bake switches create no texture, framebuffer
  or program at all (also without `KHR_parallel_shader_compile`).
- **The house's window flicker** (Z ↔ H): lane H reads no `uQuake`; lane Z scales `F.uCozy` after derive/house.js, and
  `uCozy` is declared by both SURFACE_HOUSE and COMP_HOUSE, so the windows, the light pools, their puddle reflections and
  the halos dim together (house.mjs: the uploaded `uCozy` of shade@house and comp@house equals `S.F.uCozy` on every
  frame of a quake, 1 → ~0.28 in the main shock).
- **The override order** (Z over H, §4): lane Z's storm darkening (sky / ambient / haze × .62-.72) was applied on top of
  lane H's own storm dusk (both keyed on `ch.lightning`), a double darkening (mean image level 75 → 59 in the house's
  summer thunder vs lane H's tuned frame). The scene derive now declares `stormLook` and events.js keeps its darkening
  for scenes without one (the valley); the deck lowering, flashes, smoke and flicker compose over every scene's palette
  (hazards.mjs checks the order). The remaining difference to lane H's frame (mean 75 → 68) is lane Z's heavier
  thunder preset (overcast 1, precip .85, heavy .35), by design; the balance is stage 2b's.
- **Hazard staging re-checked against the final house** (lane Z tuned against the stage-0 placeholder; captures in
  `work/phase3/stage2/s2a/stage/`, 1600×900 and a 390×844 dpr-3 phone): the `SCENE.house` constants of derive/events.js
  hold and were left unchanged. The veiled sun (az −.1, el .3 of the landscape framing) sits in open sky left of the
  tall palm in both framings (the final palms moved from the placeholder's; it no longer touches a crown); the far
  fire's glow and its columns (az .24, base .15) rise over the backyard oaks right of the tall palm and stay in a
  phone's frame; bolts land behind the palms, the oaks and the roofline (the depth test against the final G-buffer
  cuts them), a crawler hangs under the deck; the crack decal (12.5 m ahead, radius 15 m) covers the driveway, the
  walkway and both sidewalks — the crack material ids 11-13 and the dust anchors (edges of 11-14, the fence 15) are
  unchanged in the final 18-id table (18 fixtures is new and takes neither); the dust puffs rise along the sidewalk,
  parkway and curb edges.
- **The fps harness flake**: under load the cdp harness can return a non-string capture value; fps.mjs crashed on
  `JSON.parse`. It now retries such a run (up to reps + 3 attempts), never counts a harness error as a page error, and
  fails a state only when no measurement came back. The hazard × scene rows moved into fps.mjs (`hz ...`), so all.sh
  measures them once (hazards.mjs `--only fps` still has its own).
- **Scene switching**: the prewarm (§5); a switch is 1-3 ms of JS instead of ~40-50 ms of compile on the first visit
  of each scene. `state().ready` semantics (§3) unchanged and documented; the chrome's busy sheen follows it.

**Performance** (superseded by §17's steady-state re-baseline: these rows were counted from 1.5 s after `ready`,
which on a loaded machine can include the post-bake stall and burst) (Apple M4, a machine shared with other agents, load average ~3-4; `fps.mjs`, 1920×1080 dpr 2 = render
2400×1350, uncapped, best of 2, every state at quality rung 0; `work/phase3/stage2/s2a/all-1.log`):

| States | fps |
|---|---|
| valley, the Phase-2 weathers and stress states | 115-145 (fog 119, blizzard amount 1 115; heavy sleet, info, 98) |
| house, every weather | 89-124 (clear 124, cumulus 109, overcast 106, fog 109, rain 95, rain amount 1 94, snow 89, blizzard 102, blizzard over cover 1 102, thunder 95) |
| valley hazards: thunder + a strike every 0.4 s / quake main shock / quake in rain / full wildfire / all at once | 131 / 137 / 132 / 151 / 124 |
| house hazards: the same five | 93 / 110 / 87 / 113 / **77** |

The house "all at once" (a thunderstorm with strikes every 0.4 s, full wildfire smoke with ash, a quake's main shock
with its dust, blur and cracks) measured 71.8 in the merge run (loaded) and 72.7 on the quiet machine before stage 2a;
an ablation (`s2a/ablate.mjs`) put most of the hazards' extra ~2.5 ms over the plain thunderstorm on the wildfire's
sky work: `smokeSky` ran its 5 noise fetches and 3 × 8 billow loop on every sky pixel of a ±36° window (the whole
house frame). Now each column is bounded conservatively at the pixel's elevation and the noise and loop run only near
one (output unchanged: max 1 LSB in valley / house / phone / gale captures), the columns and the veiled sun are skipped
where the deck hides them, and the quake blur fetches the (already blurred) bloom once instead of 7 times (max 2 LSB).
Interleaved A/B: −0.9..1.5 ms in the house all at once, −0.5..1.2 ms in a house wildfire; the row now reads 75.6-76.8
(the plain house thunderstorm, 95-100, is the floor). Bake: the house 207 / 179 ms wall (leafy / bare) at 2400×1350,
31 / 30 ms at 488×1055. Phone stripes (`s2a/rowcost.mjs`, 488×1055, 8-row bands to a drained readback): the house costs
~60-100 µs per row at the median and ≤ 0.26 ms at the worst row (the valley ~0.4 / 1.4 ms), so the stripe controller
(first stripe 9 rows, cap 176 rows) is far inside the iOS watchdog for the house: worst first stripe 4 ms, worst
capped stripe 36 ms on the M4. Switching: a prewarmed switch 1-2 ms of JS (drained queue).

**Tests**: `sh app/tests/all.sh` green in one run (`s2a/all-1.log`): check, sim, smoke, hooks, interact, mobile,
scenes (valley parity max 0 in all 7 states, the prewarm with and without the extension, 20 + 6 switches with nothing
created, the round trip, resize / context loss, the single-file bundle max 0 for both scenes), house (incl. the
re-anchored comp checks, the flicker propagation), hazards (incl. the override order), phase2 (the one-year soak: longest
frame gap 435 ms, exposure step ≤ 0.0006 / frame) and the fps gate (all 31 gated states).

Left open (stage 2b and later; what stage 2b did with each: §16): the art direction of the merged looks (the storm dusk under lane Z's heavier preset,
the quake dust's size near the camera, the smoke over the golden hour); the shared alpine ground still allows snow
patches on a mid-spring California lawn; in the uncapped headless harness the valley's ~2 s bake keeps the GPU queue
full for ~1.5 s after `ready` (frames 100-300 ms apart, then normal) — a pre-existing harness artefact of the deep
uncapped queue (with vsync the stripe budget follows the real GPU time), not seen with the house's 0.2 s bake.

## 16. Phase-3 stage-2b art-direction record

The house (4 seasons × 8 weathers at `?scene=house&season=S&weather=W&t=90&frames=480`, 1600×900, plus its boot),
phone tiles (390×844 dpr 3 portrait, 844×390 landscape), the hazards in both scenes (deterministic `?frames` captures
with a trigger at a fixed frame, so a 45 ms stroke is caught: strikes in a natural thunderstorm, the quake's main
shock, its cracks, a full wildfire, all at once; desktop and phone), transition sequences (the scene-switch reveal,
clear -> rain, rain -> clear with the ground drying, leaf drop, leaf-out) and the valley against the live site were
shot after every round (r00-r10 in `work/phase3/stage2/s2b/`, plus sub-rounds; scripts `s2b/matrix.mjs` (sheets
`s2b/sheets.py`), `s2b/strikeseq.mjs`, `s2b/trans.mjs`, `s2b/probe.mjs`, `s2b/nancheck.py`). Finals:
`work/phase3/stage2/final-house-matrix.png`, `final-hazards.png`, `final-phones.png`, full-resolution `final-*.png`.
The valley matches https://fourseason-lac.vercel.app/ pixel for pixel in every state compared (boot, summer clear,
winter snow, autumn fog, autumn rain, spring cumulus, the 390×844 phone boot: max diff 0).

**The house**
- **Sky** (SURFACE_HOUSE `sceneSky`, FS_SHADE's `SCENE_SKY` hook; `uHouseSky`, derive/house.js). ATMOS's analytic sky
  mixes its horizon colour into the whole visible band (`pow(y, .5)`: ~35% even 25° up) and its warm haze inscatter
  over it, which made the golden-hour sky a pale lilac. The house's sky pixels (and their reflections, the twig haze
  over the sky) now add a difference to `skyPixel`: a zenith-weighted gradient (`1 − exp(−7.5 y)`) from a turquoise-
  white low sky (`HOR` .40/.60/.74) to a deep blue zenith (`ZEN` .018/.075/.38), an apricot glow hugging the treeline
  (`uHorBand`), wider and brighter toward the low sun, a faint sunward glow, and the warm haze's inscatter taken back
  out above ~10° (clean air aloft). Weighted by the golden hour `g·(1 − precip)`: under a deck, fog or rain it is
  ATMOS's sky exactly. Measured at the top of a summer-clear frame: (70, 108, 187) sRGB (was (154, 168, 202)).
- **Clouds**: fair-weather cumulus over the house hang lower (base ~1150 m: fewer, larger cells from the street), cover
  −30% under cumulus at golden hour, and `sky@house` (FS_SKY_SOFT, `uCloudSoft` .12 × uCumulus) makes the thin fringes
  of a cell shed their specks: the field of small far fragments is gone.
- **Broadleaf crowns** (house-sdf.js `leafClumps`): the leaf masses are rebuilt as clumps of leaves — warped, jittered
  spheres on a 0.66 m (oak 0.8 m; fruit trees 0.22 m) lattice, smooth-unioned, filling a shell under the envelope, with
  two leaf-texture octaves that fade below ~3 px — so every clump catches the low sun on its own top and the silhouette
  breaks into clumps; the crown's smooth normal (G2.zw) leans 70% toward the crown's dome (centre from the plant index)
  and the foliage is shaded half on it (one soft crown, not a lit bump each); crown interior AO .4 -> .6; a ~1.5 m
  hue drift across the crown (yellow-green young growth, blue-green older leaves).
- **Palms**: each fan has its own elevation (±.32 rad) and twist about its petiole (±.3 rad); the spreading and drooping
  tiers sit higher (.62 / −.15 rad): a rounded head of fans instead of stacked discs from below; the older, lower fronds
  paler and yellower.
- **Cedar siding** (gbuf-house.js `cedar`): mixed boards — honey, amber, russet, now and then a dark one — instead of
  one orange stain.
- **The street**: weathered lighter asphalt with polished wheel paths, aggregate speckle, tar snakes and patches; the
  curb's face an aged grey with expansion joints (it was one bright tan stripe across the frame).
- **Lawn**: spring a touch less vivid, winter a softer duller green.
- **Snow sparkle at golden hour**: the sparkle gate ×(1 + .9 g) (denser, brighter glints on a sunlit white yard).
- **The milder yard** (§14, derive/surface.js, `surface.mild`): spring / winter / late-autumn houses are green and bare
  under a dry sky; snow and blizzard picks still whiten the yard, which melts out a few minutes after the snowfall.
- **Fog evening**: a darker, bluer mist (exposure ×.84 in fog); the lamps and windows carry it.
- **Framing**: a phone tilts 1.5° further up (390×844 pitch 12.5°): a thinner street band, the palms and sky above.
  Landscape is unchanged (pitch 5°, the street ~6% of a 16:9 frame); tablets, a square and 21:9 were checked.
- **A G-buffer guard**: the bake writes the geometric normal where a normal comes out non-finite. An Apple-GPU
  miscompile, reproducible with a recorded stripe sequence (`s2b/nanprobe4.mjs`) once the crown-normal state was added
  to the bake loop, left NaN normals in whole tile rows (they bloomed into black-and-white blocks); the crown centre is
  therefore derived from the plant index (no extra loop state) and the guard stays as a belt-and-braces.

**Hazards (both scenes)**
- **Lightning**: a softer, wider violet glow around the hot core (the lit air and rain: no flat white line), the deck lit
  hardest where the channel leaves it (a tighter, brighter core around its top over the broad glow), the bloom raised
  for the stroke, and a strike behind the scene rims the silhouettes (crowns, fronds, the roofline: +1.6 rim when the
  channel lies behind the pixel, plus a wet sheen in rain). A near strike leans in proportion to its distance, so it
  stays where its azimuth put it. The valley's thunderstorm is a storm now, not a bright hazy rain day: its storm
  darkening (sky / horizon −42%, ambient −30%) plus exposure −22%, the sun −35%, a little more contrast (the house keeps
  its own storm dusk, `stormLook`).
- **Earthquake**: the house dust is 26 distinct plumes (was 40 overlapping into a band): tighter puffs thrown up
  0.3-1.3 m along the curbs, the driveway and walkway edges and the fence, thinner near the camera, plus grit falling
  off the eaves; the shake, its overscan, the cracks and the light flicker are lane Z's.
- **Wildfire**: the 2020 orange sky rather than a beige fog: a saturated amber-orange low sky and haze under a dark rust
  pall overhead (`smokeSky` darkens the high sky; the smoke's scale height halved), the sun redder through the smoke,
  a larger, deeper red sun disc with a stronger halo, the grade warmer and less washed (desaturation .24 -> .06,
  contrast −20% instead of −45%), exposure ×.86 (was ×1.15). The valley's smoke haze is 1/8000 m (was 1/5200): the
  massif, the columns behind it and the forest read through the orange air.

**Transitions**
- **Scene switch** (FS_COMP_SCENE `sceneReveal`, COMP_HOUSE): switching to the house (or booting it) reveals the house
  rising into its own evening sky — the golden gradient (or ATMOS's sky under a deck), graded like the frame, with a
  soft mist at the horizon — instead of the flat pale screen; the valley keeps FS_COMP's backdrop (byte-identical).
- **Leaf drop / leaf-out dissolve** (gbuf@house copy mode): where the new variant shows a hard surface (walls, roof,
  ground: what changes there is the crowns' shadow and AO) the order is per pixel, so the shadows fade as a fine dither
  instead of in blotches across the garage door; the crowns keep the leaf clusters.
- **Weather**: clear -> rain (the deck closes over 60 s, the lights come up, the ground darkens, puddles form) and
  rain -> clear (the deck opens, the ground dries from soaked gloss through damp to dry over ~4-8 min, the puddles last)
  were checked frame by frame; unchanged.

**Tests**: `sh app/tests/all.sh` green in one run (`s2b/all-1.log`): check, sim, smoke, hooks, interact, mobile,
scenes (valley parity max 0 in all 7 states incl. the phone, the prewarm (17 of 17 recipes) with and without the
extension, 20 + 6 switches creating nothing, the round trip, resize / context loss, the single-file bundle max 0 for
both scenes), house, hazards (valley parity with no hazard max 0-1, no GL leak), phase2 (the one-year soak: exposure
step ≤ 0.00063 / frame, heap 4.8-5.9 MB, longest frame gap 559 ms) and the fps gate (all 31 states); after the last
bake tweak check, house, scenes (house, switch, bundle) and the house fps rows were rerun green (`s2b/tests-final.log`,
`s2b/fps-final.log`). Changed by design (§14 Tests): house.mjs's phone pitch and its composite-hook check, check.mjs's
`sky@house` entries.

**Performance** (superseded by §17's steady-state re-baseline, as §15's) (Apple M4, load average 3-5; `fps.mjs`, 1920×1080 dpr 2 = render 2400×1350, uncapped, best of 2,
every state at quality rung 0):

| States | fps (stage 2a -> 2b) |
|---|---|
| valley, the Phase-2 weathers and stress states | 116-149 (fog 123, blizzard amount 1 116) — unchanged images, within the run-to-run spread |
| house, every weather | clear 124 -> 122, cumulus 109 -> 110, overcast 106 -> 106, fog 109 -> 108, rain 95 -> 94, rain amount 1 94 -> 93, snow 89 -> 89, blizzard 102 -> 103, blizzard + cover 1 102 -> 102, thunder 95 -> 94 |
| valley hazards: thunder + strikes / quake / quake in rain / wildfire / all at once | 136 / 140 / 134 / 153 / 127 |
| house hazards: the same five | 91 / 113 / 88 / 112 / 77 |

The house's sky delta (one `fogAtM` per sky pixel) and the clumped crowns cost ~1 fps; the floor is the house "all at
once" at 77 (75.6-76.8 in stage 2a). Bake: the house 253 / 189 ms wall (leafy / bare) at 2400×1350 (stage 2a 207 / 179:
the leaf clumps), 36 / 30 ms at 488×1055. Phone stripes (`s2a/rowcost.mjs`, 488×1055): per row p50 87 µs, p90 250 µs,
max 287 µs (incl. ~25 µs readback overhead); the worst first stripe (9 rows) 4.5 ms, the worst capped stripe (176 rows)
42 ms on the M4 — far inside the iOS watchdog.

Left open: the broadleaf crowns are stylised clumps (a painterly read, not botanical leaves) and read as round lumps on
a phone (the 488×1055 render is upscaled 2.4×); the twig haze of the bare crowns is a fibrous screen pattern; ash is
sub-pixel beyond ~25 m; the quake's shake is judged in stills only (amplitudes unchanged from lane Z); a live switch's
reveal is too fast for the headless screenshots (judged with deterministic `?frames` captures).

## 17. Phase-3 polish: engineering, robustness, tests

The engineering lens of the verification panel (`work/phase3/verify/valley-regression/`) and the engineering items of
the other lenses. The pre-polish tree is `work/phase3/polish/app-before-engineering`; probes and logs are in
`work/phase3/polish/eng/`.

- **Harness isolation** (tests/cdp.mjs, §10): Chrome picks its own debugging port (`--remote-debugging-port=0`), the
  session reads it with the browser target from its fresh profile's `DevToolsActivePort` and checks `/json/version`
  against it before touching a page; the old random port 9300-9899 could attach to another agent's Chrome and navigate
  its page (reproduced by the panel; `eng/collide2.mjs`: three parallel sessions next to a Chrome already on a port,
  the other page untouched). Every Chrome a test process started is killed on exit, also on SIGINT / SIGTERM / SIGHUP.
  `work/phase3/polish/cdpshot.mjs` is the reviewers' screenshot CLI rebuilt on this launcher (same arguments).
- **The Phase-2 reference from git** (tests/ref.mjs, §10): scenes, hazards, check and house compare with git commit
  `f311fc6` (the live site's source), extracted once into the OS temp dir; a fresh clone runs the parity checks (the
  gitignored `work/` copies were the only source before, and their absence skipped the checks silently); a missing
  reference fails. house.mjs's composite checks were re-anchored from the stage-0 copy to Phase 2 (FS_COMP = Phase 2's
  + exactly the shake / hazardComp lines). phase2.mjs's Phase-1 anchor still adds an informational line against the
  stage-0a copy when it exists (its gate is the committed goldens).
- **Exact parity** (§5, §14): the gates are max 0, a pair inside the capture-noise floor is captured again up to twice.
  That exposed the deterministic 1-LSB codegen delta of the inlined hooks (autumn rain, seed 2: one sky pixel; summer
  rain, seed 3: two), fixed by **the hook-free twins** (§5): while no hazard is on, the frame draws sky / shade / comp
  without HAZARD; every gated valley state, the live-file A/Bs of both rain frames and the bundle are max 0.
- **Boot** (§5): the set's programs are started together and then finished; the hazards' draws and the full (hooked)
  sky / shade / comp are lazy and prewarmed (with `KHR_parallel_shader_compile`); shader objects are deleted after the
  link. Valley boot compile 125-137 ms → ~40 ms (Phase 2: 95-114), house 148 → ~56 ms, without the extension 147 → ~61
  ms; no first-hazard hitch either way (max frame gap 3-8 ms when a strike, fire or quake first draws).
- **Steady frame rate** (`eng/steady.mjs`: median of 1 s windows 4-11 s after ready, 1920×1080 dpr 2, two runs,
  interleaved): valley summer clear 166-172 → 170-174 fps (Phase 2 173-177), summer rain 150-153 → 153-156 (Phase 2
  154-159); house summer clear 129-131 → 131-134, autumn rain 97-98 → 99.
- **The world does not depend on the place** (§14): the gale line, the veil / gust scrolls and the sway phase follow
  the valley's camera for the aspect (`S.worldR` / `worldF`); a valley -> house -> valley trip gives the same state()
  and S.F in snow, a blizzard and phone rain (it drifted up to max 150 in a blizzard). The house's gale turns by ~0.3°
  in landscape (≤ 9° in portrait); its images otherwise unchanged (A/B: mean 0.03, a few isolated bake pixels).
- **Robustness**: the context-loss race (§14; `S.ctxLost` reads `gl.isContextLost()`); the house bake's NaN guards (the
  geometric normal falls back to facing the ray before the shadow and AO probes, a non-finite shadow / AO falls back to
  lit / open, the roof's up-slope direction is 0 rather than NaN on a level patch; house.mjs `nan` reads G0-G2 back in
  both variants at 2400×1350 and 488×1055 and after the stage-2b stripe sequence and finds every value finite, and fails
  on an injected NaN); the quake's particle parallax no longer allocates two arrays per layer per frame; main.js takes
  the scenes' derive modules from the registry. Checked and left: the house SSR on the first frame after a reallocation
  (hSSR already treats a cleared `uPrevHdr` as no hit and falls back to the sky).
- **Tests**: fps.mjs settles before measuring (§10) and gates two stress rows; hazards.mjs's leak baseline waits for the
  prewarm (the lazy programs); mobile.mjs waits for the hint instead of a fixed 0.7 s (a flake at 844×390 over the
  house: the hint fades in 0.5 s of the animation clock after ready); scenes.mjs adds the context-loss race and the
  round trip in a gale and on a phone; check.mjs pins `HAZARD_IDLE` and the hooks' early-outs.
- **Docs**: render.js's header (texture units 5 / 6, the derive order, the hazard draws), sim/weather.js's header (a
  thunderstorm's after-effects persist), §5 / §10 / §14 here, the page title (사계절). The repository README (outside
  `app/`) is brought up to Phase 3 in `work/phase3/polish/README.md`, to be copied to the root.

**Performance, re-baselined** (Apple M4, load average 3.8-5, other agents' work possible; `fps.mjs`, 1920×1080 dpr 2 =
render 2400×1350, uncapped, best of 2, every state at quality rung 0, each run measured after the frame rate settled:
4-6 s after `ready`; `work/phase3/polish/eng/logs/fps-1.log`). These replace §15 / §16's tables, whose valley rows
could include the post-bake stall and burst:

| States | fps |
|---|---|
| valley | clear 171, cumulus 155, overcast 157, fog 123, rain 138, snow 124, blizzard 122, blizzard + cover 1 122, rain amount 1 136, rain caps 134, blizzard amount 1 120; heavy sleet (info) 99 |
| house | clear 124, cumulus 111, overcast 106, fog 108, rain 93, rain amount 1 92, snow 89, blizzard 104, blizzard + cover 1 103, thunder 94 |
| valley hazards: thunder + a strike every 0.4 s / quake main shock / quake in rain / full wildfire / all at once | 132 / 138 / 132 / 149 / 125 |
| house hazards: the same five | 88 / 112 / 86 / 107 / 76 |
| stress (new, gated): the house in snow at amount 1 under full smoke / the valley blizzard at amount 1 over cover 1 with full smoke, a quake and strikes | 76 / 104 |

The floor is the house under every hazard at once and the house's snow at amount 1 in full smoke (~76); on a quieter
machine (load ~2) the two stress rows read 90 / 122.
