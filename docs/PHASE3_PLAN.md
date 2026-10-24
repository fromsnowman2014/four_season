# Phase 3 계획 — 두 번째 장소 "우리 집"과 자연 현상

## 1. 가능성 판단 (그래픽·게임 디자이너 관점)

### 1-1. 사진 속 집을 어떻게 장면으로 만들까

| 방식 | 내용 | 사계절·날씨 엔진과의 궁합 | 판단 |
|---|---|---|---|
| A. 사진을 배경으로 그대로 쓰기 | 사진 위에 눈과 비 입자만 겹침 | 나쁨. 사진에 해 질 녘 역광이 이미 고정돼 있음. 지붕에 눈이 쌓이거나, 마당이 젖거나, 계절 색이 바뀌거나, 번개가 집을 비추는 효과는 수작업 마스크 없이 불가능 | ✗ |
| B. AI 이미지 생성으로 아름다운 정지 그림 만들기 | 외부 생성 서비스에 사진을 올려야 함 | A와 같은 한계(정지된 그림)에 더해, **집 사진을 외부 서비스에 업로드**해야 함 | ✗ |
| **C. 사진의 집을 절차적 3D로 다시 짓기** | 알프스 계곡과 같은 방식으로 레이마칭(SDF)해 G-buffer에 한 번 구워 둠 | **완벽함.** 지붕과 잔디에 눈이 쌓이고, 진입로가 젖고 웅덩이가 생기고, 계절 따라 나무가 꽃피고 잎이 떨어지고, 번개 빛과 해 질 녘 빛이 집을 비추고, 입자가 집 뒤로 가려짐 | **✓ 채택** |

C 방식으로 사진에서 가져올 것과 바꿀 것:

- **유지하는 집 스타일**
  - 단층 랜치 하우스, 왼쪽의 박공 차고(아치형 창이 줄지어 난 흰 차고문), 가로 삼나무 판재 외벽, 흰 트림
  - 타원 유리가 든 현관문, 격자창 두 개, 짙은 아스팔트 지붕
  - 앞마당의 둥근 잔디밭과 콘크리트 경계, 흰 자갈, 어린 과실나무들, 붉은 벽돌이 섞인 진입로·보도
  - 뒤편의 키 큰 야자수 두 그루, 사이프러스, 오른쪽 나무 울타리와 이웃 창고
- **보완하는 것**
  - 차는 없앰.
  - 조명은 역광 대신 앞쪽 비스듬한 황금빛 노을빛으로 바꿈. 삼나무 판재가 따뜻하게 빛나고 잔디에 나무 그림자가 길게 드리워짐.
  - 창문에 따뜻한 실내등과 현관등을 둠. 비, 눈, 안개 날에 더 아늑해짐.
  - 구도를 정리해 집이 중심에 오고, 하늘의 노을 구름이 위로 펼쳐지게 함.

**개인정보 보호를 위한 결정**
- GitHub 저장소와 Vercel 사이트는 공개되어 있습니다.
- 그래서 원본 사진은 저장소에 올리지 않습니다. 에이전트가 참고용으로만 쓰는 로컬 사본만 둡니다.
- 거리 표지판 글자와 번지수는 넣지 않습니다. 기둥만 가로등으로 바꿉니다.
- 장면은 같은 스타일의 집을 새로 지은 것이지, 사진을 복제한 것이 아닙니다.

### 1-2. 자연 현상(재해) — 무엇이 가능한가

| 현상 | 구현 방법 | 비용과 위험 | Phase 3 |
|---|---|---|---|
| **뇌우 + 번개** | 새 날씨 상태 '뇌우'. 갈래 친 번갯불을 깊이 판정이 되는 빛 띠로 그림. 구름 속 섬광과 장면 전체 섬광을 2~4번 깜빡임. 강한 비와 돌풍. | 낮음~중간. 계곡과 집 양쪽에서 동작. | ✅ |
| **지진** | 이벤트로 발생(약 15초: 미진 → 본진 → 여진). 화면을 흔들되 가장자리를 숨기도록 오버스캔하고 모션 블러를 줌. 나무·기둥이 크게 흔들림. 계곡은 절벽 낙석 먼지 기둥, 집은 길·마당 먼지와 창문 불빛 깜빡임. 진입로·길에 균열 무늬가 생겼다가 서서히 사라짐. | 중간. 카메라를 정말로 움직이면 미리 구운 G-buffer가 깨지므로 **화면 공간 흔들림**으로 처리함. | ✅ |
| **산불 연기** | 이벤트로 발생(약 3분). 주황·갈색 연무, 붉은 해, 하늘빛 바뀜. 재가 떨어짐(눈 입자 엔진을 재 모드로 재사용). 불티가 떠다니고 먼 능선이 붉게 빛남. | 낮음~중간. 캘리포니아 집에 잘 어울림. | ✅ |
| 우박 | 땅에 맞고 튀려면 입자 충돌이 필요한데, 현재 입자는 상태가 없는 구조 | 중간~높음 | ⏭ Phase 4 |
| 홍수(물 차오름) | 수면 셰이딩과 반사, 수위 상승 | 중간 | ⏭ Phase 4 |
| 토네이도, 화산, 쓰나미 | 볼류메트릭 깔때기, 대형 유체 | 높음 | ⏭ Phase 4 이후 |
| 소리(빗소리, 천둥, 바람) | WebAudio. 자동 재생 제한이 있어 사용자 동작이 필요함 | 중간 | ⏭ Phase 4 |
| 낮과 밤의 순환 | 해가 움직이면 다시 구워야 함. 밤 조명과 별도 필요 | 높음 | ⏭ Phase 4 |

### 1-3. 장소 바꾸기 — 메뉴 vs 스와이프

- 한 손가락 스와이프는 이미 **바람 만들기**에 쓰입니다.
- 화면 가장자리 스와이프는 iOS 브라우저의 뒤로 가기와 겹칩니다.
- 그래서 장소 선택은 **설정 창 맨 위의 '장소' 카드 두 장**(알프스 계곡 / 우리 집)으로 합니다. 키보드 ← → 키로도 바꿀 수 있습니다.
- 바꿀 때는 지금처럼 장면이 아래에서부터 다시 드러납니다(1~2초).
- **계절, 날씨, 쌓인 눈은 그대로 이어집니다.** 같은 세계의 다른 장소이기 때문입니다.
- 처음 열면 지금처럼 알프스 계곡이 기본입니다.

## 2. Phase 3 범위

1. **다중 장소 엔진 (리팩터링)**
   - 장소마다 다음을 따로 가집니다: G-buffer 굽기 셰이더, 카메라·태양, 대기 프로필, 표면 셰이딩.
   - 실행 중에 장소를 전환할 수 있습니다.
   - URL로 지정할 수 있습니다: `?scene=valley|house`
   - 계곡은 Phase 2와 픽셀이 같아야 합니다.
2. **"우리 집" 장면**
   - 3D로 지은 집과 정원, 거리, 배경 나무
   - 황금빛 노을 조명, 창문 불빛과 현관등
   - 계절 표현: 잔디(캘리포니아식으로 겨울·봄은 초록, 여름은 마른 금빛), 과실나무(봄 꽃 → 여름 잎 → 가을 단풍 → 겨울 가지), 야자수와 사이프러스는 사철 푸름
   - 눈: 지붕, 잔디, 나무에 쌓임
   - 비: 진입로, 보도, 지붕이 젖고 웅덩이가 생김
   - 모바일 세로 구도
3. **자연 현상**
   - 뇌우(날씨 상태, 여름에 자동으로 발생)
   - 지진, 산불 연기(설정 창에서 직접 일으킴. '가끔 자동으로' 옵션은 기본 꺼짐)
   - 계곡과 집 모두에서 동작
4. **UI**
   - 설정 창에 '장소' 카드를 추가합니다.
   - 날씨 그리드에 '뇌우'를 추가합니다(5×2).
   - '자연 현상' 줄을 추가합니다(지진, 산불, 가끔 자동으로).
   - 데스크톱과 휴대폰 레이아웃을 모두 맞춥니다.
5. **품질 기준**
   - Retina 1080p에서 모든 장소, 날씨, 현상이 60fps 이상
   - 집 장면의 굽기 시간은 데스크톱에서 2초 이내, 휴대폰에서 감당할 수 있는 수준
   - 결정성(같은 시드면 같은 결과), 테스트, 단일 파일 릴리스

## 3. 실행 단계 (에이전트)

| 단계 | 내용 | 진행 |
|---|---|---|
| 0 | 다중 장소 리팩터링, 계약 고정, 집 자리표시 장면, 현상 프레임워크 골격, 계곡 픽셀 일치 테스트 | 1명 |
| 1 | 병렬 레인. 각자 개인 사본에서 자기 파일만 수정 | 4~5명 |
| | 집 체인: H1 집 짓기(형태와 굽기 재질) → H2 집 룩(계절, 날씨, 조명, 대기) | 순차 |
| | Z 자연 현상: 뇌우·번개, 지진, 산불·재·불티 | 병렬 |
| | U UI: 장소 카드, 날씨·현상 컨트롤, 모바일 | 병렬 |
| 2 | 통합(엔지니어링), 그다음 아트 디렉션(장소 × 계절 × 날씨 × 현상 매트릭스) | 순차 2명 |
| 3 | 검증 패널(관점별 심사, 모바일 포함) | 병렬 |
| 4 | 폴리시, 릴리스(빌드 → push → Vercel 확인) | 순차 |

---

## Appendix — Agent contract (English, binding for Phase 3 agents)

### Scenes
- `S.scenes[id]`: `valley` (the Phase-2 scene) and `house`. Each one provides:
  - its G-buffer program recipe (its own bake chunks writing the shared G0..G3 layout);
  - `frameCamera(asp)` (landscape and portrait);
  - a fixed sun direction (baked);
  - an atmosphere profile (fog/haze/mist/cloud-cut/exposure overrides consumed by `derive/atmos`);
  - a surface profile (snowline use, vegetation types, material table);
  - an optional `SCENE_*` define for the shade/comp/flake programs.
- `?scene=valley|house`. The default is `valley`. `snowSim.setScene(id)` switches with the first-load reveal.
- Climate, weather and ground state are shared across scenes. Switching keeps the season, weather and cover.
- The valley must stay pixel-identical to Phase 2 (`releases/` reference = the current root `index.html` built from `app/`).

### Valley parity, privacy and the house scale
- **Privacy:** never commit or publish the reference photo, street-sign text or a house number. The house is a 3D interpretation of the style.
- **House scale:**
  - the near meadow/lawn sits around y ≈ 0;
  - the house is about 18–22 m wide and 5–6 m tall at the ridge;
  - the camera stands across the street at about 1.6–3 m eye height and 18–30 m away;
  - the backdrop (palms, trees, neighbours, sky) reaches up to about 300 m;
  - the far sky and clouds are shared.

### Materials (house)
- They extend the G0 material ids and the G3 semantics. Stage 0 freezes the exact table.
- Each material needs a season rule, a wet rule and a snow rule:
  - roof shingles, cedar siding, painted trim, glass/window, garage door, concrete, asphalt, brick, gravel;
  - lawn, fruit tree, palm, cypress, deciduous tree, fence wood, lamp post.
- Emissive windows and the porch light are per-frame (`uCozy`, 0..1: stronger in overcast, rain, snow, fog and storms).

### Hazards (shared by both scenes)
- **Thunderstorm** is weather state `thunder`. It is like rain plus `ch.lightning` (strike rate), with heavier rain and gusts, and is reachable mostly in summer and late spring.
- **Strikes** are events from a counter-based RNG (deterministic with `?seed&t`).
  - Each strike has a bolt path (procedural branching, world-space, depth-tested against the G-buffer), a flash timeline (2–4 pulses over 0.2–0.8 s), and the light it gives to clouds and the scene.
  - Uniform `uFlash`: rgb intensity plus position/direction.
- **Earthquake** is an event of about 15 s with a P / S / aftershock envelope.
  - Shake is screen-space in the composite (overscan zoom of about 1.02–1.04 while shaking, offset plus a slight roll, directional blur).
  - `uQuake`: offset.xy, roll, intensity.
  - Also: a tree/pole sway boost, dust plumes (particles), window-light flicker in the house, and crack decals on hard ground that fade over about 60 s.
- **Wildfire smoke** is an event of about 180 s with a ramp.
  - The atmosphere override uses orange-brown haze, a dim red sun and a sepia sky.
  - Particles: an ash population (the flake core in an ash mode) and embers (additive).
  - A distant glow sits on the horizon or ridge.
- **API:** `snowSim.trigger('quake' | 'wildfire' | 'strike')`, `snowSim.hazardsAuto` (default false), `?event=quake|wildfire` (starts at boot), `?wx=...,lightning:1`.

### Performance and compatibility
- Uncapped fps ≥ 60 at 1920×1080 with dpr 2 for every scene × weather × hazard.
- The house bake stays under about 2 s GPU on an M-series Mac, and its stripe budget stays safe for phones.
- No new console errors, and every test stays green.
- file:// and single-file release must keep working (`tools/build.mjs`).

### Deferred to Phase 4
Hail, flood, tornado, volcano and tsunami; audio; a day/night cycle; swipe-to-switch scenes; upload-your-photo scenes; more scenes.
