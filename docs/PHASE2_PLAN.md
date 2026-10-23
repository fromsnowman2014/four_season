# Phase 2 계획 — 계절과 날씨

## 1. 요구사항 정리 (취사 선택)

| 요구 | 결정 | 이유 / 구체화 |
|---|---|---|
| 계절 기능 | ✅ 채택 | 연중 시계(year phase 0..1)를 연속적으로 흐르게 함. 봄 0, 여름 .25, 가을 .5, 겨울 .75 |
| 5분마다 계절 변화, 20분 = 1년 | ✅ 기본값 | 1× = 1년 1200초. 시간 흐름은 0.25×, 0.5×, 1×, 2×, 4×, 8×에서 고름 (8× 상한: 그 이상이면 1분 전환이 무너짐) |
| 시간 흐름은 아이콘 클릭 후에만 선택 | ✅ | 화면에 상시 노출하는 UI 없음. 팝오버 안에서만 고름 |
| 날씨: 눈, 비, 맑음, 구름+구름 그림자 등 | ✅ 확장 | **맑음 · 구름**(흘러가는 적운과 움직이는 그림자) **· 흐림 · 안개 · 비 · 눈 · 폭설** 7종과 자동. 안개는 와호장룡 분위기의 핵심이라 추가. 흐림은 비·눈 직전의 자연스러운 중간 상태 |
| 계절 따라 날씨가 달라짐 | ✅ | 계절별 마르코프 전이 확률과 기온 모델 사용. 기온이 1℃ 미만이면 눈, 이상이면 비. 진눈깨비 구간은 두 입자군을 교차 페이드 |
| 바람·날씨는 랜덤 | ✅ | 시드 기반 결정적 난수. `?seed`, `?t` 재현성 유지 |
| 다음 날씨로 완전히 바뀌는 데 약 1분 | ✅ | 60 기후초(1× 기준). 채널마다 시차를 둔 단계적 전환: 구름이 먼저 끼고, 그다음 비나 눈이 시작되고, 그친 뒤에 하늘이 갬 |
| 유저가 계절·날씨 선택 | ✅ | 고르면 1분 전환 후 고정. '자동'으로 되돌림 |
| 좌클릭 드래그로만 바람 | ✅ 동작 변경 | 마우스 이동만으로는 **아무 변화 없음**. 드래그 방향과 세기가 바람이 되고 놓으면 천천히 자연풍으로 돌아감. 드래그 중에는 커서 주변에 눈·비가 밀리는 반응 유지 |
| 깔끔한 인터페이스 | ✅ | 반투명 아이콘 하나만 둠. 팝오버에 상태 한 줄, 계절 칩, 날씨 칩(아이콘형), 시간 흐름, 강수량 |
| 리팩터링 | ✅ | 단일 143KB 파일을 고전 `<script src>` 모듈로 분할 (더블클릭 실행 유지). 셰이더 값 전달 규칙을 고정하고 레인별 병렬 개발 |

**제외하거나 보류한 항목 (전문가 판단)**

- **계절별 태양 고도 변화: 제외.** 그림자가 G-buffer에 한 번 구워지는 구조라 해 방향을 바꾸려면 전체를 다시 구워야 함(1~2초 와이프). 계절감은 태양 색·세기, 하늘·연무 색, 식생으로 표현함.
- **'쌓인 눈 초기화' 버튼: 제거.** 이제 계절과 기온에 따라 자연스럽게 녹으므로 필요 없음. UI도 단순해짐.
- **천둥번개·무지개 등 요청 외 효과: 넣지 않음.**
- **시작 계절: 실제 날짜 기준.** 오늘은 10월 하순이라 늦가을 + 첫눈으로 시작하므로 Phase 1의 눈 장면이 첫인상으로 이어짐. `?season=`으로 바꿀 수 있음.

## 2. 계절과 날씨가 화면에 주는 변화

| | 봄 | 여름 | 가을 | 겨울 |
|---|---|---|---|---|
| 풀 | 연두, 눈 녹은 자리부터 녹색으로 올라옴, 들꽃 | 짙은 초록, 늦여름엔 마른 능선이 황금빛 | 황갈색·호박색 | 휴면 볏짚색 (눈이 없을 때) |
| 낙엽송 | 연두 새잎 | 초록 | **금빛·주황** (역광 투과) | 앙상한 회갈색 가지, 눈이 덜 쌓임 |
| 가문비 | 사계절 짙은 녹색 (겨울엔 약간 어둡게) | | | |
| 설선 | ~2200m에서 위로 녹아 올라감 | ~3000m, 쿨루아르에만 잔설 | 첫눈으로 내려옴 | 초원까지 |
| 빛 | 맑고 부드러움 | 강하고 따뜻함, 우윳빛 연무 | 따뜻한 낮은 색온도, 맑은 공기 | 차고 푸른 빛 |

| 날씨 | 표현 |
|---|---|
| 맑음 | 높은 권운 약간, 선명한 그림자, 반짝임 |
| 구름 | 가까운 하늘까지 적운이 들어오고, **구름 그림자가 바람 따라 초원 위를 흘러감** |
| 흐림 | 층운 덮개, 직사광 사라짐, 노출 보정 |
| 안개 | 계곡과 샬레 분지를 채우는 안개 바다, 능선만 떠오름 (와호장룡) |
| 비 | 가늘고 빠른 빗줄기 + 원경의 비 커튼, 땅이 젖어 어두워지고 길·바위에 하늘이 비침, 길에 물웅덩이 |
| 눈 | Phase 1 눈송이. 기온 0℃ 근처에서는 크고 무거운 함박눈 |
| 폭설 | Phase 1 폭설 (단계적 화이트아웃) |

## 3. 구조 (리팩터링)

```
app/                      ← 개발 트리 (완성 후 루트로 릴리스)
  index.html              ← 마크업과 스크립트 로드 순서만
  css/ui.css
  js/core.js              ← window.SNOW 네임스페이스, URL 설정, 수학, 카운터 기반 RNG
  js/glsl/*.js            ← 셰이더 청크 등록 (common, gbuf-*, atmos, surface, veil, sky, shade, flake, rain, post)
  js/gl.js  js/render.js  js/perf.js
  js/sim/climate.js  weather.js  ground.js  wind.js   ← GL·DOM 없는 순수 JS, node 테스트 가능
  js/derive/atmos.js  surface.js  precip.js            ← 상태를 uniform 번들(S.F)로 변환
  js/input.js  js/ui.js  js/main.js
  tests/                  ← node 단위 테스트, 회귀 스크린샷 스크립트
dist/snow.html            ← 공유용 단일 파일 빌드 (스크립트 인라인)
```

규칙:
- 모든 파일은 `(function(S){ … })(window.SNOW)` 형태이고 전역은 `SNOW` 하나만 둔다.
- 셰이더는 청크로 등록하고 `buildPrograms()`에서 조립한다.
- uniform은 `S.F[name]` 번들 하나에서 일괄 업로드한다.

## 4. 실행 단계

| 단계 | 내용 | 진행 방식 | 검증 |
|---|---|---|---|
| **0a** | 단일 파일을 모듈로 분할 (동작 동일) | 에이전트 1 | Phase 1과 스크린샷 비교 (동일 상태 픽셀 차이 ≈ 0) |
| **0b** | 계약 고정: G-buffer G3 채널(바위·흙·낙엽송·습윤도), 공용 `effectiveCover` 셰이더 함수, 장면 알파 눈 마스크, `S.F` 번들, 시뮬 모듈 스텁과 디버그 훅(`?wx=`, `?yp=`, `?ground=`), 강수 레이어 기술자, 비 프로그램 자리 | 에이전트 1 | 중립값에서 0a와 동일 + node 테스트 |
| **1** | 5개 레인 병렬 구현. 레인마다 앱 트리의 개인 사본에서 자기 소유 파일만 수정 | 에이전트 5 | 레인별 스크린샷 매트릭스 |
| | A. 기후·날씨·지면·바람 시뮬 (+node 테스트) | | |
| | B. UI·입력 (팝오버 재설계, 좌드래그 전용 바람) | | |
| | C. 하늘·대기 (근거리 적운과 그림자, 흐림, 안개, 계절 색, 노출) | | |
| | D. 지표·계절 (풀·낙엽송·들꽃·설선·융설·젖은 땅) | | |
| | E. 강수 (비 입자, 진눈깨비·함박눈, 비 커튼, 레이어 깊이 정렬) | | |
| **2** | 통합과 아트 디렉션: 레인 병합, 4계절 × 7날씨 매트릭스 튜닝, 8× 연간 주행, 성능, 결정성, README, 단일 파일 빌드 | 에이전트 1 | 전체 매트릭스, Retina 60fps 이상 |
| **3** | 검증 패널 (5개 관점) | 에이전트 5 | 점수와 반드시 고칠 항목 |
| **4** | 폴리시 라운드 후 루트로 릴리스 | 에이전트 순차 | 최종 캡처 |

**성능 기준**: Retina(2400×1350)에서 모든 날씨 60fps 이상 (현재 여유 약 2배). 맑은 날은 입자 0이라 더 가벼움.

---

## Appendix — Agent contract (English, binding for all Phase 2 agents)

### Year / season
- `phase ∈ [0,1)`: 0 = start of spring (≈1 Mar), 0.25 summer, 0.5 autumn, 0.75 winter. YEAR = 1200 climate-seconds at 1×. Initial phase from the real date unless `?season=` (name or 0..1) / `?yp=` (debug, pins phase).
- Season weights `seasonW = [spring, summer, autumn, winter]`: smooth cyclic blend centred mid-season, sums to 1.
- Meadow temperature (°C): `T = 4 + 10·sin(2π(phase − 0.125)) + weatherTempOff`. Precip is snow when `T < 1`, rain when `T > 3`, mixed in between (`snowFrac` ramps).
- Speeds: 0.25, 0.5, 1, 2, 4, 8. Climate/weather/ground advance by `dt·speed` (substeps ≤ 0.25 s). **Particle motion, flutter, sway and the twinkle clocks always run on physical time.**

### Weather
- States: `clear, cumulus, overcast, fog, rain, snow, blizzard`. Each one is a target over the channels `{cloudCov, cumulus, overcast, cirrus, fog, precip, gale, heavy, tempOff}`. `snowFrac` is derived from T.
- Transition length D = 60 climate-s. Per-channel staged windows: clouds lead, precip lags in and leads out, the sky clears last. Every pick goes through a transition. "Instant" exists only for test hooks.
- Markov scheduler: season-dependent rows, no self-transitions, dwell 70–180 climate-s. A counter-based RNG `rand(seed, eventIdx, k)` means UI actions never perturb the sequence. Rain/snow are reachable only via overcast or cumulus. Blizzard is reachable only from snow/overcast and only when T < 0.
- A manual pick holds until the user picks 자동.

### Ground
- `cover` (0..1, Phase-1 threshold semantics). Snowfall rate is `+(1/300)·(1+4·heavy)·amount·precip·snowFrac` per climate-s. Melt is `max(T,0)/600·(1+1.5·sun) + rain·precip/120`.
- `wet` (0..1): rain wets fast (τ≈20 s) and sun/wind dry it slowly (τ≈120 s).
- `snowlineAlt` (m): seasonal plus recent snowfall.

### Wind
- Natural wind is closed-form in animation time and seed: slowly veering direction, seasonal base speed, gusts, and a weather `gale` term.
- The user drag vector is added on top while the left button is held. After release it decays with a half-life of ≈15 s.
- **Plain pointer movement must not change wind or create a wake.** Clouds drift with natural wind only.

### Data flow per frame
`input → climate(dtc) → weather(dtc) → ground(dtc) → wind(dt) → anim integrals (dispA/B, fallI, rainI, cloud) → derive.atmos / derive.surface / derive.precip → S.F → render`.

### Modules and state
- Sim modules have the shape `S.<mod> = { s, init(cfg), step(dt), snapshot(), api }`.
- They read other modules' `s` read-only and write only their own.

### Uniform bundle
- `S.F[uniformName] = value`. It is uploaded generically to every program that declares that uniform. Pass-local uniforms stay in render.js.
- To add a uniform, declare it in your own GLSL chunk and set it from your own derive file.

### G-buffer
- `G0 = (t, mat+frac, sunSh, ao)`, `G1 = (albedo summer-reference, snowT)`, `G2 = (oct nD, oct nS)`.
- New in Phase 2: **`G3 = RGBA8 (rock, soil/path, larch, moist/dryness)`**.
- `snowT` must not bake the season. The altitude snowline is applied per frame through the shared `effectiveCover()` in the SURFACE chunk, which is used by shade, flake and comp alike.

### Scene alpha
- FS_SHADE writes the final snow fraction (times sun visibility, for sparkle) into the scene alpha. Composite and flakes read it instead of recomputing cover.

### Debug hooks for parallel lanes
These override the sim after its step:
- `?yp=0..1` (year phase)
- `?wx=cloudCov:.5,cumulus:1,overcast:0,fog:0,precip:.6,snowFrac:0,gale:.2,heavy:0,cirrus:.3`
- `?ground=cover:.3,wet:.8`
- `?view=` debug views (alb, snowT, g3r, g3g, g3b, g3a, cEff, wet)

### Legacy hooks
These are kept:
- `?t ?seed ?cover ?ui ?fixed ?wind`
- `?storm=1` maps to an instant blizzard; `?storm=0` maps to auto-weather off with clear sky.
- `window.snowSim` keeps `state/setCoverage/setStorm/amount/auto`. Phase 2 adds `setSeason`, `setWeather`, `speed` and `advance`.

### Ownership in stage 1
Each lane edits only its own files, in its private copy `work/lanes/<lane>/app/`:
- **A** — `js/sim/*`, `tests/sim*`
- **B** — `css/ui.css`, `js/ui.js`, `js/input.js`, and the `#ui` markup block in `index.html`
- **C** — `js/glsl/atmos.js`, `js/glsl/sky.js`, `js/glsl/post.js`, `js/derive/atmos.js`
- **D** — `js/glsl/gbuf-materials.js`, `js/glsl/surface.js`, `js/derive/surface.js`
- **E** — `js/glsl/flake.js`, `js/glsl/rain.js`, `js/glsl/veil.js`, `js/derive/precip.js`, `js/precip.js`
- **Frozen** (changed only in stages 0 and 2): `core.js`, `gl.js`, `render.js`, `perf.js`, `main.js`, `js/glsl/common.js`, `js/glsl/shade.js` glue, and the script list in `index.html`.

### Determinism, performance and file://
- **Determinism**: `?seed&t` gives the same state, so `fastForward` must use the same step functions as live play.
- **Performance gate**: uncapped fps ≥ 60 at 1920×1080 with dpr 2, for every weather.
- **file://**: classic scripts only. No ES modules, no fetch, no workers.

## Appendix B — Mobile requirements (added 2026-10-22, from the user's phone test)

The Phase-1 site was hot-fixed for phones (commit "Fix mobile: fill the screen, frame the scene for portrait"). Phase 2 must carry the same behaviour into `app/` and extend it:
- Canvas styled `position:fixed; inset:0; width:100%; height:100%; touch-action:none`; pixel size from the canvas box (`clientWidth/clientHeight`), not `innerWidth/innerHeight`. Re-size on `ResizeObserver(canvas)`, `visualViewport` resize, `orientationchange`, and a twice-a-second stale-size check that never resets a pending debounce.
- Per-aspect camera framing `frameCamera(asp)`: landscape (w/h ≥ 1.25) unchanged; toward portrait the horizontal fov never drops below 34°, pitch −12° → −16°, yaw 0 → −9°; camera vectors mutated in place; a re-framed camera rebakes with the first-load reveal.
- Touch: wind = a one-finger drag (that is already the Phase-2 left-drag rule; pointerType touch counts as the primary button). A lifted finger ends the drag. No page panning or zooming over the scene. Touch hint "화면을 쓸어 바람을 일으켜 보세요".
- Chrome: icon and pop-over clear `env(safe-area-inset-*)`; pop-over `max-width: calc(100% - 44px)` and `max-height` fitting a landscape phone (scroll inside if needed); tap targets ≥ 44 px; the hint hides when the pop-over opens.
- Performance on phones: the adaptive quality ladder must reach a stable state on an A-series GPU; keep the bake stripe budget safe for iOS (GPU watchdog).
