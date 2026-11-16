# 바다꼼꼬미 [v2.4] — 비개발자 운영자용 클린룸 신규 구축 · 데이터 운영 & ChatGPT Pro 자립 유지보수 바이블 (`DEPLOY_GUIDE.md`)

이 문서는 비개발자 운영자가 **바다꼼꼬미 PWA 앱**을 신규 계정(GitHub · Kakao)과 Windows 11 PC에 코드 수정 0줄(Zero-Config)로 구축하고, 이관 이후에는 별도 유료 API 키(`sk-...`) 과금 없이 본인이 구독 중인 **ChatGPT Pro / Codex**만을 활용하여 **정적 데이터(`GeoJSON`, `JSON`, 현장 사진, QGIS 레이어) 운영부터 기능 추가 개발·설계·외부 쿼터 관리까지 자립 수행**할 수 있도록 안내하는 실전 매뉴얼입니다.

- **이관 설계 · 외부 정책 팩트체크 · 문서 거버넌스 정본**: [`docs/HANDOVER_AND_DOCS_GOVERNANCE_BRIEF.md`](./docs/HANDOVER_AND_DOCS_GOVERNANCE_BRIEF.md)
- **공공데이터·해양기상·지도·알고리즘 전체 출처 명세**: [`docs/DATA_AND_TECH_SOURCES.md`](./docs/DATA_AND_TECH_SOURCES.md)
- **마스터 아키텍처 및 서브시스템 계약 정본**: [`docs/ARCHITECTURE_AND_DESIGN.md`](./docs/ARCHITECTURE_AND_DESIGN.md) · [`docs/designs/SITEMAP.md`](./docs/designs/SITEMAP.md)

> [!IMPORTANT]
> **운영 전 필수 확인 사항 (공개 범위 · 배포 경계 · 외부 서비스 약관)**
> 1. **GitHub Pages 공개성 (`G1`)**: GitHub Free 플랜에서 무료로 GitHub Pages를 사용하려면 저장소가 **`Public`**이어야 하며, 배포된 사이트와 `public/` 하위 정적 데이터(`GeoJSON`, `JSON`, 현장 사진) 및 번들은 인터넷에 공개됩니다. 대외비·민감 정보는 정적 파일에 포함하지 마십시오.
> 2. **기기 로컬 저장과 원격 조직 배포의 구분 (`G2`)**: 앱 내 `[레이어] ➔ [저장]` 기본 동작(`IndexedDB`)은 **현재 기기(브라우저) 내부 저장**입니다. 전 직원 단말기에 배포하려면 **Git 커밋 ➔ GitHub Actions 4단계 검증(`test · lint · build · verify`) 통과 ➔ GitHub Pages 배포**가 완료되어야 합니다.
> 3. **외부 서비스 무료 조건 (`G3`, 2026-11-16 기준)**:
>    - **Kakao Maps Web SDK**: 일 300,000회 무료 쿼터는 2026-07-21 이후 **계정당 최초 활성화 앱 1개**에만 기본 제공됩니다(신규 앱 생성 시 콘솔 쿼터 화면에서 무료 쿼터 대상 여부를 직접 확인해야 합니다).
>    - **Open-Meteo API**: 비상업적(Non-commercial) 용도 및 `CC BY 4.0` 출처 표시 조건 하에 일 10,000회 미만 호출이 허용됩니다.
>    - **ChatGPT Pro / Codex**: 별도 유료 OpenAI API 키(`sk-...`) 대신 **ChatGPT 계정 로그인(OAuth)**을 사용할 때만 기존 구독 플랜의 포함 사용량 범위 내에서 추가 API 요금 없이 사용할 수 있습니다.

---

## 전체 자동 배포 및 자립 유지보수 흐름 한눈에 보기

```text
[경로 A: 일상 데이터/레이어 관리 (코드 수정 0줄)]
  • 기본 권장: GitHub 웹 편집기 / GitHub Desktop / 로컬 VS Code에서 사진·JSON 수정 후 커밋
  • 인앱 QGIS 변환: 앱 내 [레이어]에서 .gpkg/.shp 변환 확인 후 GitHub 커밋(또는 개인 관리 PC 전용 PAT 연동)
                    ↓
[경로 B: ChatGPT Pro 활용 추가 개발·수정 (유료 API 과금 0원)]
  • 운영자: ChatGPT Pro(Codex/웹)에 '골든 프롬프트' 입력 ➔ 로컬 pwsh에서 4단계 검증 실행
    (npm test -> npm run lint -> npm run build -> npm run verify)
                    ↓
[GitHub 저장소 (<운영자계정>/<저장소명>) main 브랜치 Push]
                    ↓ (GitHub Actions 자동 검증·빌드 ~30초: .github/workflows/deploy-pages.yml)
[Workbox 서비스 워커 리비전 해시 갱신 + GitHub Pages 배포]
                    ↓ (skipWaiting + clientsClaim 즉시 반영)
[현장 작업자 스마트폰·태블릿·PC PWA 앱 최신 데이터/기능 자동 반영 완료!]
```

---

## [Part 1] Day-1 초기 이관 — 신규 계정(GitHub · Kakao) & Windows 11 개발환경 클린룸 구축

바다꼼꼬미는 [`vite.config.ts`](./vite.config.ts)의 `resolveViteBasePath()`와 [`src/services/githubLayerSyncService.ts`](./src/services/githubLayerSyncService.ts)의 `inferDefaultGitHubRepoCoords()`를 통해 **GitHub Actions의 `GITHUB_REPOSITORY`와 접속 도메인(`*.github.io`)에서 계정명과 저장소 이름을 자동 추론**합니다. 따라서 신규 운영자 계정으로 이관할 때 **소스 코드를 단 한 줄도 수정할 필요가 없습니다.**

### 1-A. 운영자 GitHub 신규 저장소 생성 및 GitHub Pages 활성화 (필수)

1. 운영자 GitHub 계정으로 로그인한 뒤 우측 상단 **`+` ➔ `New repository`**를 클릭합니다.
2. **Repository name**(예: `bada-kkomkkomi`)을 입력하고 공개 범위를 **`Public`**으로 선택해 생성합니다.
3. 프로젝트 전체 코드를 신규 저장소의 `main` 브랜치에 Push합니다.
4. **[필수 설정]** 저장소 상단 **`Settings`** 탭 ➔ 좌측 메뉴 **`Pages`** 클릭 ➔ **`Build and deployment` > `Source`** 드롭다운을 기본값(`Deploy from a branch`)에서 **`GitHub Actions`**로 변경합니다.

---

### 1-B. 운영자 Kakao Developers 신규 앱 생성 및 3대 필수 설정

바다꼼꼬미는 **Kakao Maps SDK v3**를 기본 지도로 사용하며, 도메인 미등록이나 해상 오프라인 상황에서는 **레거시 지도(Leaflet + OpenStreetMap)**로 자동 폴백됩니다. **[카카오 개발자 콘솔](https://developers.kakao.com)**에서 아래 **3단계 설정**을 순서대로 완료하십시오:

1. **Step 1. 신규 앱 생성 · 무료 쿼터 확인 및 카카오맵 활성화(`ON`)**:
   - `내 애플리케이션 > 애플리케이션 추가하기`로 새 앱을 생성한 뒤, 쿼터 화면에서 **계정당 최초 활성화 무료 쿼터(일 300,000회)** 적용 대상 앱인지 확인합니다.
   - 앱 설정 내 **`카카오맵(Kakao Map)` 제품 설정**으로 이동하여 **`사용 설정(활성화)` 스위치를 반드시 `ON`**으로 켭니다. (이 스위치가 꺼져 있으면 도메인과 키가 맞아도 `HTTP 403` 에러가 발생합니다.)
2. **Step 2. JavaScript 키 확인 및 SDK 도메인 등록 (하위 경로 제외)**:
   - **`앱 키 > JavaScript 키`**를 확인하고, 웹/SDK 도메인 등록란에 아래 Origin 주소를 줄바꿈으로 모두 등록합니다(하위 경로 `/bada-kkomkkomi/`는 붙이지 않습니다):
     ```text
     http://localhost:5173
     http://127.0.0.1:5173
     https://<운영자GitHub아이디>.github.io
     ```
     *(현재 기본 배포 기준: `https://gunnysis.github.io`)*
3. **Step 3. GitHub Actions Secret (`KAKAO_MAP_API_KEY`) 및 로컬 `.env` 등록**:
   - **GitHub 저장소**: `Settings > Secrets and variables > Actions > New repository secret` 클릭 ➔ **Name**: `KAKAO_MAP_API_KEY` / **Secret**: 복사한 카카오 **`JavaScript 키`** 입력 후 저장.
   - **로컬 PC (`.env`)**: 프로젝트 루트의 [`.env.example`](./.env.example)을 참고해 `.env` 파일을 만들고 아래 1줄을 입력합니다:
     ```env
     KAKAO_MAP_API_KEY=발급받은_카카오_JavaScript_키
     ```
   - **보안 주의**: `VITE_*` 또는 `KAKAO_*` 변수는 프로덕션 JS 번들에 포함됩니다. GitHub PAT(`github_pat_...`) 같은 비공개 토큰은 절대 `.env` 파일이나 코드에 넣지 마십시오.

---

### 1-C. Windows 11 로컬 개발환경 필수 5종 세팅 (15분 완성 코스)

Python, Docker, Android SDK 등 불필요한 도구 없이 Windows 11 PC에 아래 **필수 5종 도구**만 설치하면 됩니다.

| 순번 | 필수 도구 | 버전 요구사항 | Windows 11 PowerShell (`pwsh`) 설치 및 확인 명령 |
| :---: | :--- | :--- | :--- |
| **1** | **PowerShell 7 (`pwsh`)** | `7.x` 이상 | `winget install Microsoft.PowerShell` |
| **2** | **Git for Windows** | 최신 안정 버전 | `winget install Git.Git` |
| **3** | **`fnm` + Node.js** | **최소 `>=22.18.0`** (CI와 동일한 **Node 24 LTS 권장**) | `winget install Schniz.fnm` 설치 후 새 터미널에서:<br>`fnm install 24 && fnm default 24 && node -v` |
| **4** | **VS Code** | 최신 안정 버전 | `winget install Microsoft.VisualStudioCode` |
| **5** | **로컬 `.env` 파일** | `KAKAO_MAP_API_KEY` 설정 | 프로젝트 루트에 `.env` 파일 생성 (Git 커밋 제외 대상) |

---

## [Part 2] 배포 주소 및 스마트폰 · 태블릿 PWA 앱 설치 방법

- **현재 운영 배포 주소**: `https://gunnysis.github.io/bada-kkomkkomi/` (신규 운영자 계정 배포 시: `https://<운영자GitHub아이디>.github.io/<저장소명>/`)
- **이관 시 단말기 재설치 안내**: PWA 앱은 설치 시점의 도메인(Origin)에 귀속됩니다. 운영자 계정이 변경되어 배포 주소가 바뀌면 기존 스마트폰에 설치된 앱은 구 주소를 바라보게 되므로, 새 배포 주소로 접속해 1회 재설치해야 합니다.

### 1. 상단 헤더 `앱 설치` 버튼 활용
- Android Chrome, Edge, Samsung Internet 또는 iPhone/iPad Safari로 접속한 뒤, 화면 우측 상단 에메랄드색 **`앱 설치`** 버튼을 누르면 즉시 설치 프롬프트 또는 iOS 설치 안내 화면이 열립니다.

### 2. Android (갤럭시 · Chrome 브라우저)
1. Chrome 앱으로 배포 주소에 접속합니다.
2. 상단 **`앱 설치`** 버튼을 탭하거나 브라우저 우측 상단 메뉴(`⋮`) ➔ **`앱 설치`**를 탭합니다.

### 3. iPhone / iPad (Safari 브라우저)
1. Safari 앱으로 배포 주소에 접속합니다.
2. 하단 중앙 **`공유`** 버튼(네모 위 화살표) ➔ **`홈 화면에 추가`** ➔ 우측 상단 **`추가`**를 탭합니다.

---

## [Part 3] 비개발자 운영자의 4대 데이터 일상 관리 및 동시 수정 가드레일

운영자가 관리하는 모든 데이터는 `public/` 폴더 아래에 위치합니다.

| 관리 대상 | 파일 경로 | 용도 |
| :--- | :--- | :--- |
| **1. 접안 포인트 & 소규모 선착장 데이터 (55개소)** | [`public/data/docking_points.geojson`](./public/data/docking_points.geojson) | 갯바위 접안 포인트 및 소규모 선착장 좌표(`[경도, 위도]`), 물때, 위험요소, 5색 표식, 사진 경로 |
| **2. 현장 접안 사진** | `public/images/docking/` | 접안 포인트 상세창에 표시할 현장 사진 파일 |
| **3. 통합 항구·소규모 선착장 사전 (136개소 + 변침점 300개소)** | [`public/data/ports.json`](./public/data/ports.json) | 바닷길 시간계산기에서 지도 직접 항구 선택, 초성/별칭/섬 검색, A* 해상 실항로 우회 연산에 사용되는 항포구·선착장 목록 |
| **4. 운영자 설정 & 레이어** | [`public/config/app_config.json`](./public/config/app_config.json) | 현장 제보 수신 이메일 주소, 공간정보 레이어 목록, 기상 판정 기본 기준값 |

---

### 작업 A. 현장 접안 사진 추가/교체하기 (`public/images/docking/`)
1. GitHub 저장소 웹 화면에서 **`public` ➔ `images` ➔ `docking`** 폴더로 이동합니다.
2. 우측 상단 **`Add file` ➔ `Upload files`**를 클릭해 현장 사진(예: `ty-004-rock.jpg`)을 업로드합니다.
   - **주의사항 (대소문자 일관성 및 용량)**: 리눅스 서버는 대소문자를 엄격히 구분하므로 파일명은 항상 **영문 소문자, 숫자, 하이픈(`-`)** 조합으로 통일하고, 장당 1~2MB 이하의 `.jpg`/`.png`/`.webp` 이미지를 사용하세요.

---

### 작업 B & C. [핵심 가드레일] 접안 포인트(`docking_points.geojson`)와 항구 사전(`ports.json`) 양방향 동시 수정 규칙

> [!WARNING]
> **단독 수정 시 배포 차단 주의 ([`scripts/verify-integrity.mjs`](./scripts/verify-integrity.mjs) 무결성 규칙)**
> 바다꼼꼬미의 무결성 검증기는 [`public/data/docking_points.geojson`](./public/data/docking_points.geojson)에 등록된 모든 피처 `id`가 [`public/data/ports.json`](./public/data/ports.json)에도 존재하고, 두 파일의 위경도 좌표 차이가 **`1e-5`도(약 1m) 미만**일 것을 강제합니다.
> 따라서 신규 접안 포인트를 추가하거나 좌표를 수정할 때는 **반드시 두 파일을 한 세트로 동시에 수정**해야 합니다.

#### 두 파일 동시 수정 대조표

| 비교 항목 | 1. [`public/data/docking_points.geojson`](./public/data/docking_points.geojson) | 2. [`public/data/ports.json`](./public/data/ports.json) |
| :--- | :--- | :--- |
| **식별자 (`id`)** | `"id": "TY-004"` | `"id": "TY-004"` (**두 파일의 `id`가 100% 동일해야 함**) |
| **위경도 순서 (반대!)** | `"coordinates": [128.4278, 34.8378]`<br>**(`128`로 시작하는 경도가 앞, `34`로 시작하는 위도가 뒤!)** | `"lat": 34.8378, "lng": 128.4278`<br>**(`lat`에 위도 `34.xxxx`, `lng`에 경도 `128.xxxx` — 오차 `< 1e-5` 필수)** |
| **필수 속성** | `"color"`: `"red"` \| `"amber"` \| `"green"` \| `"blue"` \| `"purple"`<br>`"photos"`: `["/images/docking/파일명.jpg"]` | `"connectedWaypointIds"`: 존재하는 인근 해상 변침점 ID 1개 이상(예: `["WP-SAMDEOK-APPROACH"]`) |

#### 1) `public/data/docking_points.geojson` 항목 양식 (`"features": [ ... ]` 배열 내)
```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [128.4278, 34.8378]
  },
  "properties": {
    "id": "TY-004",
    "name": "통영 산양읍 삼덕항 물양장",
    "purpose": "연안 어장 환경조사 및 잠수장비 하역",
    "tide_info": "간조 시 수심 1.8m 확보, 남서풍 유입 시 파랑 주의",
    "hazard": "물양장 북측 끝단 수중 콘크리트 블록 돌출 — 선수 접안 금지",
    "color": "amber",
    "verified_date": "2026-11-08",
    "photos": [
      "/images/docking/ty-004-rock.jpg"
    ]
  }
}
```

#### 2) `public/data/ports.json` 짝꿍 항목 양식 (`"ports": [ ... ]` 배열 내)
```json
{
  "id": "TY-004",
  "name": "통영 산양읍 삼덕항 물양장",
  "region": "통영",
  "category": "docking",
  "subCategory": "official_docking",
  "lat": 34.8378,
  "lng": 128.4278,
  "seaApproachLat": 34.8365,
  "seaApproachLng": 128.4260,
  "description": "연안 어장 환경조사 및 잠수장비 하역 · 간조 수심 1.8m",
  "aliases": ["삼덕항물양장"],
  "eupmyeondong": "산양읍",
  "islandName": null,
  "portClassLabel": "공식 조사선 접안지",
  "facilityType": "QUAY_WALL",
  "facilityLabel": "물양장",
  "minDepthMeters": 1.8,
  "tidalSensitivity": "MEDIUM",
  "maxVesselTons": 20,
  "hazards": ["물양장 북측 끝단 수중 콘크리트 블록 돌출 — 선수 접안 금지"],
  "connectedWaypointIds": ["WP-SAMDEOK-APPROACH"]
}
```

---

### 작업 D. 제보 수신 이메일 및 QGIS 공간레이어 관리 (`public/config/app_config.json`)

1. **제보 수신 이메일 및 기본값 변경**: [`public/config/app_config.json`](./public/config/app_config.json)의 `"admin"`(`report_recipient_email`, `report_cc_email`), `"route_defaults"`, `"weather_defaults"`를 수정해 커밋하면 전 직원의 기본 설정이 갱신됩니다.
2. **신규 QGIS 공간정보 레이어 추가 및 배포**:
   - **기기 로컬 변환·적용 (`IndexedDB`)**: `꼬미의 바다수첩` 상단 **`[레이어]`** 버튼 클릭 ➔ QGIS에서 작업한 `.gpkg`, `.zip`(`.shp+.dbf+.prj+.cpg`), `.geojson`, `.kml` 파일을 그대로 업로드(한국 좌표계 `EPSG:5179`/`5186`/`5181` 및 `CP949` 한글 인코딩 자동 변환) ➔ 하단 **`[저장 (운영 반영)]`** 클릭 시 **현재 기기 브라우저(`IndexedDB`)**에 즉시 저장됩니다.
   - **전 직원 원격 배포 (기본 권장)**: 변환된 `EPSG:4326` GeoJSON 파일을 `public/data/layers/`에 업로드하고 `public/config/app_config.json`의 `"layers"` 배열에 등록한 뒤 GitHub 웹/Desktop/CLI로 커밋합니다.
   - **인앱 원격 자동 커밋 (개인 관리 PC 전용 선택 기능)**: 개인 전용 관리 PC에 한해 `[레이어 > 관리자 고급 설정]`에서 대상 저장소 단일 권한(`Contents: Read and write`, 짧은 만료일) Fine-grained PAT를 입력하고 자동 커밋 체크박스를 켜면 `[저장]` 시 원격 커밋이 함께 수행됩니다. *(보안 주의: 공용 PC나 현장 공용 단말기에는 브라우저 `localStorage`에 토큰이 남으므로 절대 PAT를 입력하지 마십시오.)*

---

## [Part 4] ChatGPT Pro / Codex 활용 자립 유지보수 플레이북 (추가 API 과금 방지)

### 4-1. 인증 방식 구분 (`Sign in with ChatGPT` vs 유료 API 키)
- 로컬 Codex CLI/VS Code 확장, ChatGPT 웹, 또는 Windows용 ChatGPT 앱을 사용할 때 **`Sign in with ChatGPT`(계정 로그인)**를 선택하면 기존 구독 플랜의 포함 사용량 범위 내에서 추가 API 요금 없이 사용할 수 있습니다(사용 한도 도달 시 다음 리셋 주기에 이어서 작업).
- 반면 OpenAI Platform(`platform.openai.com`)에서 별도 `OPENAI_API_KEY`(`sk-...`)를 발급해 연결하면 별도 종량제 요금이 청구되므로 사용하지 마십시오.

### 4-2. 상황별 복사·붙여넣기용 '골든 프롬프트(Golden Prompts)' 4종

#### 프롬프트 1. 신규 접안지 · 선착장 양방향 짝꿍 등록
```text
AGENTS.md와 scripts/verify-integrity.mjs의 불변식을 먼저 읽고 작업해줘.
신규 접안지 [명칭 / 위도 34.xxxx / 경도 128.xxxx / 수심 / 위험요소 / 색상]를 추가하려고 해.
반드시 public/data/docking_points.geojson ("coordinates": [경도, 위도] 순서)과 public/data/ports.json ("lat": 위도, "lng": 경도 및 가장 가까운 기존 해상 변침점 connectedWaypointIds 연결) 양쪽에 동일한 id와 오차 1e-5 이내 좌표로 동시에 추가하고, npm test && npm run verify가 통과하는지 확인해줘.
```

#### 프롬프트 2. 앱 버전 8개 파일 일괄 동기화
```text
앱 버전을 [새 버전, 예: 2.5.0 / 표시 버전: v2.5]로 올리려고 해.
scripts/verify-integrity.mjs의 버전 단일 정본(SSOT) 규칙에 맞춰 src/config/appVersion.ts, package.json, package-lock.json, vite.config.ts, index.html, README.md, DEPLOY_GUIDE.md, docs/DATA_AND_TECH_SOURCES.md 8개 파일을 한 번에 동기화하고 npm run verify로 검증해줘.
```

#### 프롬프트 3. 신규 기능 개발 및 SITEMAP/README 계약 등재
```text
AGENTS.md, docs/ARCHITECTURE_AND_DESIGN.md, docs/designs/SITEMAP.md를 먼저 읽고 [원하는 기능/UI 수정 내용]을 구현해줘.
만약 src/services/ 또는 src/hooks/에 새 파일을 추가하거나 인터페이스를 변경했다면 반드시 README.md 디렉터리 트리와 docs/designs/SITEMAP.md에 함께 등재하고, 마크다운 문서에는 file:// 로컬 경로 대신 상대경로만 사용해줘. 작업 후 npm test && npm run lint && npm run build && npm run verify 4단계가 모두 통과하도록 마무리해줘.
```

#### 프롬프트 4. 검증 게이트 및 GitHub Actions 에러 복구
```text
방금 수정 후 검증 명령(또는 GitHub Actions 빌드)에서 아래 에러 로그가 발생했어.
임시 우회 없이 scripts/verify-integrity.mjs와 AGENTS.md 기준의 근본 원인을 찾아서 수정하고 다시 4단계 검증을 통과시켜줘:
[여기에 터미널/Actions 에러 로그 붙여넣기]
```

### 4-3. 배포 전 로컬 4단계 검증 명령 (`pwsh`)
```powershell
npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$env:GITHUB_ACTIONS='true'
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run verify
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

---

## [Part 5] 외부 서비스 약관 및 무료 쿼터 조건 점검표

| 서비스명 | 무료 제공 기준 및 한도 | 확인 위치 및 운영자 수칙 |
| :--- | :--- | :--- |
| **1. 카카오맵 Web SDK v3** | **일 300,000회** 로드<br>*(2026-07-21 이후 계정당 최초 활성화 앱 1개 기준)* | • [카카오 개발자 콘솔](https://developers.kakao.com) ➔ `내 애플리케이션 > 쿼터/통계`에서 무료 쿼터 대상 앱 여부 및 일 호출량 확인.<br>• 장애·쿼터 초과 시 6.5초 내 자동으로 무료 OpenStreetMap(Leaflet) 엔진으로 폴백됨. |
| **2. Open-Meteo (ECMWF 기상)** | 비상업(Non-commercial) 용도 **일 10,000회** (시간당 5,000회, 분당 600회 미만) 및 `CC BY 4.0` 출처 표기 | • 앱 내 출처 표기를 유지하고, 백그라운드 무한 자동 새로고침(`setInterval` 폴링) 코드를 추가하지 말 것. |
| **3. GitHub Pages & Actions** | GitHub Free 기준 **`Public` 저장소**<br>(사이트 용량 `1 GB`, 월 트래픽 `100 GB` soft limit) | • 저장소 공개 범위를 `Public`으로 유지하고, 대용량 무압축 원본 영상/사진 업로드를 피할 것. |

---

## [Part 6] 1분 자가진단 — 증상별 원인 및 롤백 트러블슈팅 조견표

| 증상 / 문제 상황 | 주요 원인 | 즉시 해결 및 롤백 방법 |
| :--- | :--- | :--- |
| **1. 카카오맵 대신 레거시 지도(OSM)로 뜨고 상단에 진단 배지가 표시됨** | ① 카카오 콘솔에서 `카카오맵 사용 설정(ON)` 미설정,<br>② JavaScript 키 SDK 도메인에 현재 Origin 미등록,<br>③ GitHub Secret `KAKAO_MAP_API_KEY` 누락 | 상단 진단 배지를 눌러 현재 접속 Origin을 복사한 뒤 **[Part 1-B]의 3단계 설정**을 확인하고 `[카카오맵 즉시 재연결]` 클릭 |
| **2. GitHub에서 데이터를 수정해 커밋했는데 배포 사이트에 반영되지 않음** | `npm run verify`에서 JSON 문법 오류 또는 `docking_points.geojson`↔`ports.json` ID·좌표 불일치(`>1e-5`)를 감지해 배포를 중단함 | GitHub 저장소 `Actions` 탭에서 실패한 워크플로 로그의 `[Integrity Failure]` 원인을 확인해 **[Part 4-2] 프롬프트 4번**으로 수정하거나 직전 커밋으로 `Revert` |
| **3. 잘못된 레이어/데이터 반영 후 이전 정상 상태로 되돌리고 싶음** | 기기 로컬 레이어 오편집 또는 잘못된 원격 커밋 | • **기기 로컬(`IndexedDB`) 복원**: `[레이어 > 버전 이력]` 탭에서 이전 스냅샷 `[복원]` 클릭<br>• **원격 배포본 롤백**: GitHub 커밋 이력에서 직전 정상 커밋을 선택해 `Revert commit` 실행 |

---

## [부록] Cloudflare Pages로 이전/병행 배포 시 설정값 (선택 사항)

| 설정 항목 | 입력할 값 | 설명 |
| :--- | :--- | :--- |
| **Production branch** | `main` | `main` 브랜치에 파일을 올릴 때마다 자동 배포 |
| **Framework preset** | `Vite` | Vite 정적 빌드 프리셋 |
| **Build command** | `npm run build` | 타입 검사, 번들링 및 Workbox `sw.js` 생성 |
| **Build output directory** | `dist` | 최종 생성된 정적 파일 폴더 (`public/_headers` 자동 적용) |
| **Environment variables** | `KAKAO_MAP_API_KEY` = `JavaScript 키` | Cloudflare Pages 대시보드 환경변수에 등록 |
