# Architecture (Phase 2, integrated: stage 2a; art direction: stage 2b)

`app/` is the Phase-2 build: the Phase-1 single file split into classic scripts (stage 0a), the Phase-2 contracts
frozen on top (stage 0b), the five stage-1 lanes merged (A sim, B UI / input, C sky / atmosphere, D ground / seasons,
E precipitation), the cross-lane integration of stage 2a (§11) and the art direction of the season x weather matrix
(stage 2b, §12), and phones / tablets (§13). Open `app/index.html` by double-click (file://):
no modules, no fetch / XHR, no workers.

The lane ownership of stage 1 is history now: from stage 2 on any file may change, but the contracts below (the
namespace rule, the module shapes, `S.F`, the program recipes, the G-buffer layout, the texture units, the input
contract) are what the code and the tests rely on. Change them deliberately and update this file and the tests.

## 1. Files and load order

`index.html` holds the markup (the `#ui` block between its comments) and the `<script src>` list, in this order.

| # | File | Role | Stage-1 lane |
|---|---|---|---|
| 1 | `js/core.js` | `window.SNOW`. `S.cfg` holds every URL hook, parsed once. Math, `S.rand` / `S.vn1` / `S.hash32` (counter-based randomness), `S.override` (the debug-hook helper), the camera (`S.frameCamera(asp)`, §13) and sun, the GLSL registry, `S.derive = {}`, and `S.F` with its neutral defaults. | frozen |
| 2 | `js/glsl/common.js` | Chunks `COMMON`, `ENV`, `VS_FULL`, `GBUF` (G0..G3), `PRECISION_F`, `PRECISION_FI`. | frozen |
| 3 | `js/glsl/atmos.js` | `ATMOS`: sky colour + cirrus, stratus, the cloud weather map, the cumulus cells and `cloudCover`, `cloudShadow`, aerial perspective (haze, valley mist / fog sea and its banks `fogTopH` / `fogBanks`, storm extinction), mist banks. Entry points `skyPixel`, `applyAtmos`; `fogAtM` (with the fog-sea banks: the shading pass) vs `fogAt` (without: particles, cloud pass). | C |
| 4-6 | `js/glsl/gbuf-noise.js`, `gbuf-terrain.js`, `gbuf-objects.js` | Bake chunks: noise, terrain `terrainH`, trees and chalets. | frozen |
| 7 | `js/glsl/gbuf-materials.js` | `GBUF_MATERIALS`: `gbMaterials(...)` writes the albedo (summer reference), `snowT`, the normals and G3 (with `larchShare`, the larch stand field). | D |
| 8 | `js/glsl/gbuf-main.js` | `GBUF_HEAD` (o0..o3), `GBUF_MAIN` (`sceneQ`, the state machine). Program `gbuf`. | frozen |
| 9 | `js/glsl/surface.js` | `SURFACE`: `effectiveCover`, `snowCover`, `driftH`, the seasons (`grassSeason`, `larchSeason`, `flowers`), `shadeSurface`, `surfaceDebug`. Also the JS twin of the snowline offset, `S.snowlineOffset` (§5). | D |
| 10 | `js/glsl/sky.js` | `FS_SKY`, program `sky` (half-res clouds, march clamped at the terrain). | C |
| 11 | `js/glsl/veil.js` | `VEIL`: the distant snow veil, the rain veil, the far rain curtains, `applyVeil`. | E |
| 12 | `js/glsl/shade.js` | `FS_SHADE`, program `shade`. Glue only (§5). | frozen |
| 13 | `js/glsl/flake.js` | `PRECIP_VS` (the shared precipitation VS core), `VS_FLAKE`, `FS_FLAKE`, program `flake`. | E |
| 14 | `js/glsl/rain.js` | `VS_RAIN`, `FS_RAIN`, program `rain`. | E |
| 15 | `js/glsl/post.js` | `FS_FXAA`, `FS_DOWN`, `FS_UP`, `FS_COMP`; programs `fxaa`, `down`, `up`, `comp`. | C |
| 16 | `js/gl.js` | Context, GLSL assembly + compile (errors mapped to chunk:line), the generic-upload tables, render targets, `S.GB_LAYOUT` and the G-buffer allocation (G3 RGBA8, RGBA16F fallback), `S.R`, the canvas box size (`S.cssSize`, `S.targetSize`), allocate (re-frames the camera) / resize sources / `S.checkSize` / DPR, context loss, `initGL`. | frozen |
| 17 | `js/perf.js` | Quality ladder `S.perf`, `controller` (judged step-ups, a ceiling, the steady-slow probe: §13), `adaptStripe`, `resetPerf`. | frozen |
| 18-21 | `js/sim/climate.js`, `weather.js`, `ground.js`, `wind.js` | The sim (§3). Pure JS, load in node. | A |
| 22 | `js/derive/surface.js` | Ground / season state to `S.F`; `visCover`, `coverAt(alt)`. | D |
| 23 | `js/derive/precip.js` | Precipitation to `S.F`, plus the fall / tumble / rain / veil clocks. | E |
| 24 | `js/derive/atmos.js` | Light, atmosphere, clouds, exposure and grade to `S.F` (`S.lighting` holds the light colours), plus the cloud-drift clock. | C |
| 25 | `js/precip.js` | Layer descriptors, lattice wrap, `S.drawPrecip(ctx)`, `S.layoutLayers`, `S.precipCount`. | E |
| 26 | `js/render.js` | `S.deriveF` (static fields, then the three derives), `S.uploadF`, `bindGB`, `S.passCtx`, `S.render` (7 passes). | frozen |
| 27 | `js/input.js` | `S.mouse` (drag-only wind input), `S.bindInput`, `S.stepInput`, `S.pruneSegs`. | B |
| 28 | `js/ui.js` | `S.ui`, `S.bindUI`, `S.syncUI`, `S.updateUI`. | B |
| 29 | `js/main.js` | `S.anim`, `S.initSim`, `S.simStep`, `S.advance`, `S.state`, `S.makeApi`, the frame loop, `boot()`. | frozen |

Also: `css/ui.css` and the `#ui` block of `index.html` (B), `tests/` (§10), `tests/golden/` (the anchor goldens).

## 2. Namespace rules

- Each file is exactly `(function (S) { 'use strict'; ... })(window.SNOW);`. In `core.js` the argument is
  `(window.SNOW = {})`. Nothing else sits at top level: classic scripts share one global lexical scope. `window.SNOW`
  and `window.snowSim` are the only globals.
- Only `main.js` has a load-time side effect: `boot()`, and only when a `document` exists. Every file loads in a bare
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
3. `S.wind.step(dt)` (physical time).
4. `anim.dispA += windA·dt`, `anim.dispB += windB·dt`.
5. `S.derive.surface.step(dt)`, `precip.step(dt)`, `atmos.step(dt)`: the derive modules' own clocks.
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
| `veilI[4]`, `veilR[4]`, `gustR[2]` | derive/precip.js | Snow veil, rain veil and rain gust-band scrolls, mod 256; they hold during fast-forward. |

### Module shape

`S.<mod> = { s, init(cfg), step(dt, ff), snapshot(), api }` for `climate`, `weather`, `ground`, `wind`. `s` is plain
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

Presets (channel order `cloudCov cumulus overcast cirrus fog precip gale heavy tempOff`; the canonical values the
look is tuned against):

| State | cloudCov | cumulus | overcast | cirrus | fog | precip | gale | heavy | tempOff |
|---|---|---|---|---|---|---|---|---|---|
| clear | .15 | 0 | 0 | .35 | 0 | 0 | .05 | 0 | +1 |
| cumulus | .55 | 1 | .1 | .2 | 0 | 0 | .2 | 0 | 0 |
| overcast | .95 | .2 | .75 | 0 | .1 | 0 | .3 | 0 | −1 |
| fog | .75 | 0 | .5 | 0 | 1 | 0 | 0 | 0 | −1 |
| rain | .97 | 0 | .85 | 0 | .2 | .65 | .4 | 0 | +1 |
| snow | .75 | .2 | .35 | .4 | .05 | .75 | .15 | 0 | −3 |
| blizzard | .98 | 0 | 1 | 0 | .2 | 1 | 1 | 1 | −6 |

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

One season glyph in the corner (blossom / sun / leaf / snowflake, cross-fading on `floor(phase·4)`), a glass pop-over
and a start hint. The pop-over: status line (`S.climate.seasonKo(phase)` · weather; during a transition
`cur → next` with the hairline filling by `progress`), season segments (자동 + four; checked = `pinned`), a year track,
weather grid (자동 + seven; checked = `manual`, else 자동 when `auto`, else `cur`), the speed slider (stops 0.25-8×,
caption `1년 = …`: 8× reads `1년 = 2분 30초`), the amount slider. The hint reads `드래그하여 바람을 일으켜 보세요`, on a
touch screen (`(hover: none) and (pointer: coarse)`) `화면을 쓸어 바람을 일으켜 보세요`; it hides for good once the
pop-over opens. It writes only through `S.climate.api` (`setSeason`,
`speed`) and `S.weather.api` (`setWeather`, `amount`, `auto`), and re-reads the sim on open and every 6 frames while
open. Closing: outside press, Escape, 6 s idle (paused while hovered or keyboard-focused). `?ui=0` removes it all.

### window.snowSim and state()

`snowSim` = `state()`, `advance(sec)` (returns the state), and the module APIs: `setSeason`, `speed` (climate);
`setWeather`, `setStorm`, `triggerBlizzard`, `amount`, `auto` (weather); `setCoverage`, `reset`, `resetSnow` (ground).

`state()`: the Phase-1 fields `coverage storm sky tail windX windZ flakeCount fps ready amount auto quality perfLevel
frameMs buildMs compileMs res renderRes`, then `season seasonKo phase speed seasonPinned`, `weather{cur, next,
progress, manual, nextAt} temp snowFrac precip white`, `wet snowline`, `wind{x, z, steer}`, then `rainCount` and `g3`.

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

The Phase-1 anchor (the regression state of `tests/phase2.mjs`):
`?wx=cloudCov:.6,cumulus:0,overcast:0,cirrus:1,fog:0,precip:1,gale:0,heavy:0,tempOff:0,snowFrac:1&ground=cover:C,wet:0&yp=.875`
(winter `?yp` keeps the date out: dry snow, the winter palette, the snowline below the scene).

## 4. The frame bundle S.F

`S.F[uniformName] = value`: a number for float / int / uint, an array or Float32Array for vectors, `{unit, tex}` for
a sampler. `S.uploadF(prog)` uploads every entry to every program that declares the name (setter from the
`getActiveUniform` type). `S.deriveF()` sets the static fields, then `S.derive.surface.frame(F)`, `precip.frame(F)`,
`atmos.frame(F)`; a later derive may read what an earlier one set (atmos reads `F.uCover`, `F.uSnowCurtain`,
`S.derive.surface.visCover / coverAt`). Values no derive sets keep their `core.js` default ("–": always set).

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
| `uExposure`, `uBloomStr` | float | atmos | Composite exposure (§ below), bloom strength | – | FS_COMP |
| `uGrade`, `uGradeP` | vec3 | atmos | White balance; desaturation, S-curve, sparkle gate (> 1 on crisp fair days: denser, brighter glints) | – | FS_COMP |

**Exposure** (derive/atmos.js): `lerp(1, .54, cover^1.3) × lerp(1, 1.05, curtain) × lerp(comp, 1, keep) × (1 − .1·fog)`,
where `cover = .7·visCover + .2·coverAt(800) + .1·coverAt(2000)` (the snow the camera actually sees, through the shared
snowline model), `comp = min(1.55 − 0.3·rain, (E_ref/E)^.45)` a partial auto-exposure on the light level (a rain
day stays a little moodier), and
`keep = max(cover, curtain, falling snow)` keeps snow scenes on the Phase-1 exposure.

**Pass-local uniforms** (set by name, never in `S.F`): every pass `uRes`; gbuf `uPixAng uIter`; sky `uPrev uPrevD
uBlend uFrame uSteps`; shade `uSky uSkyD uSway`; fxaa `uTex uInv`; flake / rain `uScene uAspect uFocalPx uCocK uFocus
uSeed uMs uMa uMn` and per layer `uDispA uDispB uFallQ uFallLH uLayer uSlice uHalfXY uCount` (+ rain `uPushK`); down /
up `uSrc uSrcInv uDstRes uThresh`; comp `uHdr uBloom uScene uTwinkleT uFrame`; every G-buffer reader `uG0..3 uN0..3
uGb` (`bindGB`).

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

| Program | VS | FS |
|---|---|---|
| `gbuf` | VS_FULL | COMMON, GBUF_HEAD, GBUF_NOISE, GBUF_TERRAIN, GBUF_OBJECTS, GBUF_MATERIALS, GBUF_MAIN |
| `sky` | VS_FULL | COMMON, ENV, ATMOS, GBUF, FS_SKY |
| `shade` | VS_FULL | COMMON, ENV, ATMOS, GBUF, SURFACE, VEIL, FS_SHADE |
| `fxaa` | VS_FULL | FS_FXAA |
| `flake` | COMMON, ENV, ATMOS, PRECIP_VS, VS_FLAKE | PRECISION_FI, ENV, GBUF, FS_FLAKE |
| `rain` | COMMON, ENV, ATMOS, PRECIP_VS, VS_RAIN | PRECISION_FI, ENV, GBUF, FS_RAIN |
| `down` / `up` | VS_FULL | FS_DOWN / FS_UP |
| `comp` | VS_FULL | COMMON, ENV, ATMOS, GBUF, FS_COMP (the sparkle calls `camRay` + `cloudShadow`) |

- **ENV** declares the shared environment uniforms. Every per-frame program includes it right after its precision
  header; the bake never does, so environment state cannot reach or recompile the bake.
- **FS_SHADE is glue**: tree-sway remap of the G-buffer lookup, the cloud-pass fetch, then a sky pixel
  `applyVeil(skyPixel(rd, cl), t, frag)`, a surface pixel `shadeSurface(uv, g0, rd, t, snowMask)` →
  `applyAtmos(col, t, rd, cl, cT)` → `applyVeil`, or with `uView > 0` `surfaceDebug`. Keep these signatures.
- **The sky pass** marches the slab at half resolution with temporal accumulation (EMA 0.3, restarted by `uSkyResp`)
  and stops at the terrain: `terrainT` reads G0 through the GBUF chunk (render.js binds the G-buffer like every other
  pass; during a resize rebake the baked rows read the new buffer, the rest the old one aspect-remapped; on the first
  load unbaked rows read as sky behind the reveal). The second target `uSkyD` stores the mean cloud distance **in km**
  × opacity (`applyAtmos` multiplies by 1000).
- **PRECIP_VS** (flake.js) is the stateless core of both particle VS: uniforms, hashes, slice-box wrap, projection,
  slice fade, frustum test, the drag wake with a per-call weight.
- **The bake**: `sceneQ` is the only scene query; `gbMaterials(...)` is called once, never calls `terrainH` /
  `sceneQ`, reads `forestDensity` once; no ATMOS / SURFACE; everything it writes is season-neutral.
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
| 3, 4 | `uSky`, `uSkyD` (shade) |
| 5, 6 | Free |
| 7 | `uNoise` |
| 8-11 | `uG0..uG3` (shown G-buffer) |
| 12-15 | `uN0..uN3` (the one being baked) |

`bindGB(u, 8)` binds the G-buffer in sky, shade, precipitation and comp. No program samples its own target.

**Scene alpha**: FS_SHADE writes `snow × G0.z × smoothstep(.5, .95, cloudShadow) × (1 − wetSnow)` (0 on the sky and
in a debug view). Consumers never recompute cover: the composite sparkle (density `0.016·a²`, also gated per glint by
`cloudShadow²` and by `uGradeP.z`) and the flake tint over snow. Read it from `R.scene`, never `R.hdr`.

**Precipitation** (precip.js). Layer descriptor:
`{ id, kind: 'snow'|'rain', prog, z0, z1, fade, base, max, heavy, vlo, vhi, fallKey, rateKey, wet (snow) | push (rain) }`.

- Count: `min(max·flakeMul, base·amountMul·flakeMul·F[rateKey]·(1 + (heavy − 1)·uHeavy)·(1 + (wet − 1)·uWetSnow))`.
- Snow ids 0-4 (near bokeh, crystals, mid, far, hero); rain ids 5-8 (near defocused drops, near streaks, mid, far
  fine streaks: 14-70 m). Layers draw far to near (sorted by `z1`), switching program only when the kind changes, so
  rain and snow interleave by depth; sleet = both populations with counts crossfading by `snowFrac`. A particle never
  changes kind, bin or speed range; fall-speed changes go only through the integrals.
- Budget at amount .5: calm snow ~45-60k, blizzard ~183k, rain ~15k; heavy rain caps ~54k.
- render.js calls `S.drawPrecip(S.passCtx)` between FXAA and bloom into `R.hdr`, premultiplied
  (`ctx = { use, bindGB, bindTex }`).

## 8. Debug views (`?view=`)

`uView` 1..8: `alb` (baked albedo), `snowT` (grey 0..1, red < 0, blue > 1), `g3r` rock, `g3g` soil, `g3b` larch,
`g3a` moist, `cEff` (effective cover incl. the snowline's aspect / noise shift, like snowT), `wet` (wetness × gloss
potential). `surfaceDebug` draws it, the composite shows it ungraded, no precipitation.

## 9. Frame order

**Boot** (main.js): `initContext`, `bindGLEvents`, `frameCamera` for the canvas box's aspect, `initSim(cfg)`, `bindInput`, `bindUI` (or remove the chrome),
`syncUI`, `window.snowSim = makeApi()`, `advance(?t)`, `?cover`, `initGL` (extensions, `buildPrograms`, noise,
`allocate` → striped bake), `requestAnimationFrame`.

**Per frame**: next rAF; real `dt` clamped to 0.1 s; `adaptStripe` after a stripe frame; fixed `dt` under `?fixed` /
`?frames`; `simStep(dt)`; `deriveF()`; `render()`: 1 G-buffer stripe or swap, 2 half-res clouds, 3 shade, 4 FXAA,
5 `drawPrecip`, 6 bloom, 7 composite; the quality controller; `updateUI`; `checkSize` (twice a second, §13).

## 10. Tests

From the project root (headless Chrome on the real GPU, Python 3 + PIL). `sh app/tests/all.sh [phase2 args]` runs
them all; every browser test fails on any console error / warning. `cdp.mjs` is the harness (`capture()` one-shot,
`open()` a live session; a watchdog fails a page that stops answering instead of hanging).

| Command | Checks |
|---|---|
| `node app/tests/check.mjs` | Syntax, the one-IIFE rule, no load-time side effects, the registry and chunk:line mapping, no uniform declared twice per stage, ENV placement, bake rules, glue calls, every declared uniform set, module shapes; fxaa / down / up unchanged since 0a. |
| `node app/tests/sim.mjs [--quiet]` | Node, no DOM / GL (lane A): shapes, year length, speed scaling, season ease, seasonKo, the first weather, picks / holds / auto, staging, Markov rules and per-season statistics, no channel jumps under 165 random UI actions, counter RNG, 16-year ground means, melt / wet / snowline, wind (plain pointer motion has zero effect, drag steer, cap, 15 s half-life, veer, gale), determinism incl. `?speed=8&t=600`. |
| `node app/tests/smoke.mjs` | Plain file:// load with zero console errors; a broken chunk reports `BROKEN:3`. |
| `node app/tests/hooks.mjs` | `?gb16=1` renders the RGBA8 image within the capture noise; every `?view` renders and they all differ; `?wx`, `?ground`, `?yp` reach the frame (the year phase now drives the season shading). |
| `node app/tests/interact.mjs` | The chrome and the pointer contract against expected values: API surface, hint, glyph, open / close / Escape / Enter / outside press / 6 s auto-close, status line from the real sim (`눈 → 비` + hairline), weather / season chips, arrow keys, speed caption, amount, API → chrome sync, buttonless sweep = nothing, drag steers with the grabbing cursor and decays, `?ui=0`. |
| `node app/tests/mobile.mjs [--out DIR]` | Phones and tablets with mobile emulation (touch, coarse pointer, iPhone UA; §13): canvas fills the screen and its buffer is `round(box × 1.25)` on 390×844 / 430×932 / 844×390 / 820×1180 / 1180×820; the per-aspect framing reaches the uniforms and the precipitation boxes (landscape = the desktop camera bit for bit); the keyboard-dismissed and rotation sequences re-size and re-frame with the first-load reveal; the stale-size check alone (no ResizeObserver) re-sizes at an uncapped frame rate; a one-finger drag steers along the re-framed camera, a second finger is ignored, lifting / cancel / lost capture end it, a buttonless sweep does nothing; the pop-over fits 390×844 and 844×390 without scrolling with finger-sized targets and hides the hint; the desktop pop-over geometry and the 1920×1080 camera are unchanged; the quality ladder (node, `js/perf.js` on a modelled 60 Hz display) settles. |
| `node app/tests/phase2.mjs [--only …] [--update-golden]` | Boot hooks; every weather pick a 60 s transition (0 / 30 / 60 / 75 s via `advance`, and at 8× real time with screenshots); season-pick ease; drag-only wind (deterministic: a hover sweep leaves the animation state bit-identical, a drag moves the particles' wind and uploads the wake to both programs while the cloud drift and natural wind stay bit-identical); 15 s steer half-life live; determinism at `t=300` / `t=900`; the Phase-1 anchor (cover 1, cover 0, `?storm=1`) against `tests/golden` (+ informational vs 0a); a one-year soak at 8× (`?seed=7`, chrome on): timeline, no NaN / Infinity in `S.F`, per-frame `uExposure` continuity, no stuck state, heap stable, `year-sheet.png`. |
| `node app/tests/fps.mjs` | Performance gate: uncapped fps ≥ 60 at 1920×1080 dpr 2 (render 2400×1350) for each weather in its season, blizzard over full cover, rain at amount 1, rain at the caps, blizzard at amount 1 (+ an informational heavy-sleet extreme); quality rung must stay 0. Run on a quiet machine. |
| `node app/tests/parity.mjs` | Retired as a gate in stage 2a (Phase 2 changes the image by design); kept as a comparison tool against stage 0a. |

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
- **Framing** (core.js `S.frameCamera(asp)`, called by `allocate` and once at boot before the sim starts; the wind is
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
  `(pointer: coarse)`: season chips 36 px, weather cells 54 px, slider rows 32 px with a 22 px thumb (`--th`; the tick
  labels follow it); a desktop keeps 26 / 50 / 14 px. The pop-over is `max-width: calc(100% − 44px − insets)` and
  `max-height: calc(100% − 76px − insets)` (scrolls inside only as a last resort). A short window
  (`max-height: 500px` and `min-width: 600px`: a landscape phone) gets the compact layout: two columns (season, year,
  time on the left; weather and amount on the right; the DOM order still reads left to right), opening beside the
  glyph instead of above it — 528×267 px on 844×390, nothing scrolls. 390×844 portrait: 272×437 px above the glyph.
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
