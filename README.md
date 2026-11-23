# 바다꼼꼬미 (Bada-Kkomkkomi) [v2.4]

항행경보 수집·검증: [API 안내](./docs/NAVIGATIONAL_WARNINGS.md), [단일 Pages 배포 연결](./docs/NAVIGATIONAL_WARNING_DEPLOYMENT.md). 지도 표시는 비활성이고 실제 배포는 수행하지 않았습니다.

국립공원공단 해양국립공원(한려해상·통영·거제) 직원의 해상·도서 현장업무 지원을 위한 오프라인 우선(Offline-First) PWA 웹 애플리케이션입니다.
백엔드 서버나 외부 유료 DB 없이 **순수 정적 데이터(`GeoJSON`, `JSON`, 로컬 이미지) + 인앱 공간정보 운영 저장소(`IndexedDB` / GitHub 자동 커밋)만으로 무상(Zero-cost) 운영 및 자동 배포**되도록 설계되었습니다.

- **라이브 배포 URL (GitHub Pages)**: https://fiesta5155.github.io/badakkomkkomi/
- **GitHub 저장소**: https://github.com/gunnysis/bada-kkomkkomi
- **EGM 아키텍처 블루프린트 (Elephant-Goldfish Model `Hay`)**: [`AGENTS.md`](./AGENTS.md)
- **EGM 서브시스템 계약 인덱스 (`Peanuts`)**: [`docs/designs/SITEMAP.md`](./docs/designs/SITEMAP.md)
- **비개발자 운영자 매뉴얼**: [`DEPLOY_GUIDE.md`](./DEPLOY_GUIDE.md)
- **외부 데이터·API·지도·기술 출처 안내서 (일반인·운영자용)**: [`docs/DATA_AND_TECH_SOURCES.md`](./docs/DATA_AND_TECH_SOURCES.md)
- **아키텍처·구현 설계·트러블슈팅 단일 정본**: [`docs/ARCHITECTURE_AND_DESIGN.md`](./docs/ARCHITECTURE_AND_DESIGN.md)
- **비개발자 이관·클린룸 신규 구축 및 문서 거버넌스 기획·설계서**: [`docs/HANDOVER_AND_DOCS_GOVERNANCE_BRIEF.md`](./docs/HANDOVER_AND_DOCS_GOVERNANCE_BRIEF.md)
- **스트레스 테스트 권고안 및 심층 하드닝 통합 구현 설계서**: [`docs/HANDOVER_HARDENING_IMPLEMENTATION_PLAN.md`](./docs/HANDOVER_HARDENING_IMPLEMENTATION_PLAN.md)
- **비개발자 이관 작업 마스터 플랜 및 실전 안내서**: [`docs/reports/NON_DEVELOPER_HANDOVER_PLAN_AND_GUIDE.md`](./docs/reports/NON_DEVELOPER_HANDOVER_PLAN_AND_GUIDE.md)
- **이관 준비 전사 스트레스 테스트 및 검증 결과 보고서**: [`docs/reports/HANDOVER_STRESS_TEST_AND_VERIFICATION_REPORT.md`](./docs/reports/HANDOVER_STRESS_TEST_AND_VERIFICATION_REPORT.md)

---

## 1. 기술 스택 (Tech Stack)

| 영역 | 기술 및 버전 | 역할 |
| :--- | :--- | :--- |
| **Core** | Vite `8.3` + React `19.3` + TypeScript `7.0` | 초고속 번들링 및 엄격한 정적 타입 시스템 |
| **Styling & Brand Design** | Tailwind CSS `4.3` + Lucide React `1.70` + KNPS & NPIP (`AS 920~923`) Tokens | 국립공원공단(KNPS) 공식 CI · 한려해상 깃대종 팔색조('알로', `AS 920`) 10색 정품 팔레트 및 **한려해상 데이라이트 브리즈(Daylight Breeze)** 라이트 테마 기반 야외 직사광선 고대비 HUD |
| **Map & GIS Engine** | Kakao Maps SDK `v3` (Primary) + Leaflet `1.9.4` (Fallback) + `proj4` + `fflate` | 카카오 일반/순수위성/하이브리드 + 5종 오버레이 + 360° 3D 로드뷰 + QGIS `.gpkg`/`.zip(shp)`/`.kml`/`.geojson` 인앱 파서 & 한국 좌표계(`EPSG:5179`/`5186` 등) 자동 변환 |
| **PWA / Offline** | `vite-plugin-pwa` `2.0` + Workbox `7.4` | 정적 에셋 프리캐시(중복 0건 보장) + 현장 이미지·GeoJSON 런타임 캐시 (기상 API는 실시간 안전을 위해 캐시 배제) |
| **Linter & Integrity** | Oxlint `1.90` + `scripts/verify-integrity.mjs` | 116개 규칙 기반 정적 분석(`0 warnings, 0 errors`) 및 버전·데이터·항로 그래프·SW 프리캐시 자동 무결성 검증 |
| **CI/CD & Hosting** | GitHub Actions (`deploy-pages.yml`) / Cloudflare Pages | `main` 브랜치 Push 시 무상 빌드 및 자동 배포 |

---

## 2. 핵심 도메인 기능 (v2.4)

### 2.0. 국립공원공단(KNPS) 브랜드 디자인 시스템 & 인트로 미션 런치패드 (`HomeScreen` + `useAppRoute`)
- **국립공원공단(KNPS) 한려해상 비오필릭 디자인 시스템**: 국립공원공단 공식 상징 3원색(생태보전 그린 `#00854a`·`#10b981`, 청정 해양 블루 `#0066b3`·`#0ea5e9`, 생명력 태양 앰버 `#f59e0b`)과 한려해상 다도해 파노라마 일러스트, 국립공원 레인저(Ranger) 복장 마스코트, `accent-color` 브랜드 폼 컨트롤 및 `contrast-color()`/`oklch` 폴백 배지를 전 화면에 일관되게 적용했습니다.
- **2×2 포스터 런치패드 (`HomeScreen`)**: 초기 접속 시 무거운 지도 SDK 로드 없이 4대 기능 포스터 카드(`꼬미의 바다수첩`, `바닷길 콕콕`, `꼬미의 달력`, `꼬미의 조타실`)를 즉시 표시하며, 이전 작업 이어하기 배너 및 데이터·기술 출처/설정 진입을 지원합니다.
- **2단 슬림 HUD & 깊이 인식 히스토리 라우터**: 모바일 화면 상단 고정 바 점유율을 12% 미만(`~92px`)으로 압축하고, 인앱 진입 시 `[< 홈]` 클릭이 `window.history.back()`으로 동작하여 뒤로가기 무한 루프(Back-Button Trap)를 방지합니다.

### 2.1. 꼬미의 바다수첩 (`3.1`)
- **A. 운영 자료와 보존 자료 분리**:
  - 현장 확인된 갯바위 접안정보와 독립 위험정보는 각각 **0건**입니다. 기존 접안 55건(등급·수심·SVG 포함)은 조사 근거 미확인 보존 자료로 남기고 운영 지도에서는 제외합니다. 상세 관리에서 원본을 내려받을 수 있습니다.
  - 항·포구 명칭 **154곳**은 어촌어항관리시스템의 지명 참고 레이어입니다. 위치 일치 확인 83곳과 검증 보류 71곳의 공식 지도 좌표를 보존합니다. 명칭과 간결한 점을 표시하며 겹치는 이름은 확대 수준에 따라 줄입니다. 점을 누르면 이름을 확인할 수 있습니다. 해상 접근점이나 경로 계산과 연결하지 않습니다.
  - 기존 접안 필터·상세 컴포넌트는 보존하되, 운영 자료가 없는 동안 필터를 기본 화면에서 숨깁니다. 새 입력·공유 기능은 구현하지 않습니다.
- **B. 지도 정보 관리 (`LayerControlModal` + `spatialFileParser` + `layerStorageService`)**:
  - 기본 화면에서 접안 포인트·특별보호구역·위험정보·항·포구 명칭·행위허가·상괭이 관찰 기록을 압축형 카드(약 58~62px, 간격 8px)로 표시합니다. 접안 필터는 설정 아이콘으로 펼치고 내보내기는 다운로드 아이콘으로 실행합니다. 카드 순서는 기기별 UI 설정에만 저장하며 지도 그리기 순서는 바꾸지 않습니다. 국립공원 경계와 전문 기능은 **상세 관리**에서 접근합니다.
  - **QGIS 실무 파일 무변환 직접 업로드**: `.gpkg` (OGC GeoPackage SQLite3 바이너리), `.zip` / `.shp+.dbf+.prj+.cpg` (ESRI Shapefile), `.geojson`/`.json`, `.kml`/`.kmz` 파일을 브라우저에서 직접 파싱하며, 복수 레이어 포함 시 선택·일괄 반입을 지원합니다.
  - **한국 공공측량 좌표계(`EPSG:5179`, `5186`, `5187`, `5185`, `5181`, `5174`, `3857`) & `CP949`(`EUC-KR`) 인앱 자동 변환**: `proj4`와 `TextDecoder('euc-kr')`를 내장하여 별도의 QGIS 재투영이나 인코딩 변환 없이도 `EPSG:4326`(WGS 84) 및 정상 한글 속성으로 즉시 자동 복원합니다.
  - **전 도형(`Polygon`, `LineString`, `Point`) & 동적 스타일/피처 편집**: 선/면 색상, 두께, 실선/점선, 채우기 투명도, 지도 라벨 표시 속성(`labelField`), 피처 속성값 편집 및 Douglas-Peucker 모바일 경량화를 Kakao Map과 Legacy Leaflet 양쪽에서 동일하게 렌더링합니다.
  - **`[저장 (운영 반영)]` = 즉시 운영 반영**: 상세 관리 화면에서 **`[저장 (운영 반영)]`** 버튼을 누르면 즉시 활성 지도와 기기 영속 저장소(`IndexedDB` + `localStorage`, 최대 12개 버전 스냅샷 및 즉시 롤백 지원)에 운영 본으로 반영되며, 원격 GitHub 토큰 설정 시 `main` 브랜치 원자적 자동 커밋 및 GitHub Pages 배포까지 원클릭으로 수행합니다.
- **C. 현장정보 제보 (`FieldReportModal` + `emailReportService`)**:
  - 접안 포인트 상세창 또는 독립 제보 버튼(**`지도에서 위치 선택`** 지원)을 통해 위경도 좌표·현장 사진·자유 메모를 입력합니다.
  - 수신 이메일은 형식 확인 후 기기에 기억하며 기본 주소(`marine_admin@knps.or.kr`)로 복원할 수 있습니다. 규격화된 제보 내용을 메일 앱(`mailto:`)·공유창에 전달하며 최종 전송은 메일 앱에서 진행합니다. 앱에서는 실제 발송 성공 여부를 확인하지 않습니다.
- **D. 개인 상괭이 관찰 기록 (`PorpoiseObservationModal` + `usePorpoiseStorage`)**:
  - 지도 정보 관리의 상괭이 카드 **다운로드 아이콘(관찰기록 내보내기)**에서 현재 기기의 전체 기록을 관찰일시 순으로 UTF-8 BOM CSV(현지 조사표 14열)로 내보냅니다. 실명 등록이 완료된 로그인 프로필의 `realName`을 조사자로 사용하며, 저장된 현지 관찰일시와 기존 저장 키·구조는 그대로 유지합니다. 파일 공유 지원 기기에서는 기본 공유창을, 미지원 환경에서는 다운로드를 사용합니다.
  - 지도에서 상괭이 목격 위치를 탭하면 현재 일시와 기본 개체수(`1마리`)가 자동 입력되며, 기기 내부(`localStorage`)에 저장되어 전용 상괭이 표식으로 렌더링됩니다. (기획 명세에 따라 사진·메모·통계 기능 제외, 개별 조회·수정·삭제 및 레이어 표시/숨김 지원)

### 2.2. 바닷길 콕콕 (`3.2`)
- **A/B. 듀얼 모드 상단 탭**:
  - `바닷길 콕콕` 진입 시 상단 탭에서 **`시간계산 (직선거리·소규모 선착장)`**과 **`기상상태판정`** 독립 화면을 즉시 전환합니다.
- **C. 바닷길 시간계산기 (`RouteTimeCalculator` + `straightRouteService` + `routeGeoService`)**:
  - **자유 직선 그리기**: 지도 위 클릭 좌표를 보정하거나 항구에 맞추지 않고 `지점 1, 2, …`로 순서대로 추가합니다. 인접 지점만 직선으로 연결하며 마지막 점과 첫 점은 자동 연결하지 않습니다. `[되돌리기]`와 `[초기화]`를 제공합니다.
  - **이동경로 이름**: `ports.json`의 섬 이름과 실측 해안선의 이름 있는 도서만 경로 가까이에서 찾아 순서대로 표시합니다. 요약 카드에서는 두 줄로 줄이고 전체 보기에서 모든 이름을 표시합니다.
  - **직선거리 기반 예상시간 계산 (`routeGeoService`)**: 각 구간의 Haversine 거리를 해리(NM)로 환산하고 입력 속력(knots)으로 구간·전체 예상시간을 계산합니다. 섬 자동 우회·A* 탐색·자동 변침점 생성은 시간계산에서 사용하지 않습니다. 직선이 육지를 가로질 경우 실측 해안선 폴리곤으로 경고만 표시합니다. 이 결과는 실제 항해 가능 경로를 뜻하지 않습니다.
  - **직선 구간(`leg.pathPositions`) 및 중점 배지 (`KakaoMapCanvas` · `LegacyLeafletCanvas` · `routeLegLabelService`)**: 선택한 지점 사이의 직선을 3-Tier 폴리라인으로 렌더링하고, 구간 중점(`leg.midLat`, `leg.midLng`)에 **소요시간·거리 캡슐 배지(`약 N분 · X.X NM`)**와 정박지 드래그 마커(🟢출발/🟡경유/🔴도착)를 표시합니다.
  - **편의 제어**: 선박 속도 입력(기본 `15kn`) 및 원터치 프리셋(`10kn`, `15kn`, `20kn`, `28kn`), `[직선 그리기 / 이동만]` 전환, 하단 패널 접기/펼치기를 지원합니다.
- **D. ECMWF 전용 해상 기상상태 판정 (`MarineWeatherPanel` + `ecmwfWeatherService` + `useMarineWeather`)**:
  - **ECMWF 단일 모델 고정 (`ecmwf_ifs` + `ecmwf_wam`)**: Open-Meteo Forecast API(`models=ecmwf_ifs`, 9km 해상도 10m 풍속 `kn`)와 Marine API(`models=ecmwf_wam`, 9km 해상도 유의파고 `m`)를 명시적으로 고정 호출하며, 타 모델이나 Best Match로 임의 폴백하지 않습니다.
  - **타임스탬프(`Map`) 정합 결합 및 안전 실패(`unknown`) 원칙**: 단순 배열 인덱스가 아닌 동일 KST(`Asia/Seoul`) 타임스탬프 기준으로 풍속·파고를 결합하며, 두 값 중 하나라도 결측(`null`/`NaN`)이거나 오프라인/네트워크 오류 시 과거 캐시를 재사용하지 않고 상단 서브탭 배지와 패널 모두 즉시 `미확인(?)` / `판정불가 (?)`로 정직하게 표시합니다.
  - **양방향 항로 브릿지 & 활성 판정 기준치 상시 표기**: 현재 적용 중인 주의/보류 풍속·파고 기준치 요약 바, 48시간 타임라인 `[현재시각으로]` 원터치 복귀, `[+이 해역 경유지 추가]` 역방향 브릿지를 제공합니다.
  - **출처 및 연안 격자 한계 고지**: 화면 하단 `[출처·한계 상세 ⓘ]` 버튼을 통해 `ECMWF IFS HRES 9km · WAM 9km (Open-Meteo)` 원천 명세 및 9km 연안 격자 해상도 한계·안전 안내를 확인할 수 있습니다.

---

## 3. 프로젝트 디렉터리 구조

```text
bada-kkomkkomi/
├── AGENTS.md                          # Google EGM 최상위 아키텍처 블루프린트 (Hay)
├── _agents/skills/
│   └── bada-kkomkkomi-elephant/
│       └── SKILL.md                   # 프로젝트 전용 Elephant 아키텍처 컨텍스트 로더 스킬
├── .github/workflows/
│   └── deploy-pages.yml               # GitHub Pages 자동 빌드·배포 워크플로 (정적 설정·GeoJSON 무결성 검증 포함)
├── docs/
│   ├── ARCHITECTURE_AND_DESIGN.md     # 최종 구현 설계서 · 데이터 사전 · 트러블슈팅 단일 정본
│   ├── DATA_AND_TECH_SOURCES.md       # 외부 데이터 · API · 지도 · 기술 및 에셋 출처 안내서
│   ├── HANDOVER_AND_DOCS_GOVERNANCE_BRIEF.md # 비개발자 이관 · 클린룸 신규 구축 및 문서 거버넌스 통합 기획·설계서
│   ├── HANDOVER_HARDENING_IMPLEMENTATION_PLAN.md # 스트레스 테스트 권고안 및 심층 하드닝 통합 구현 설계서
│   ├── ROUTE_BERTHING_UX_ANALYSIS_REPORT.md # 정박지(출발·도착·경유지) 지정 UX 분석 및 초단순 리팩토링 명세서
│   ├── designs/
│   │   └── SITEMAP.md                 # Google EGM 서브시스템 살아있는 명세서 & 계약 인덱스 (Peanuts)
│   └── reports/
│       ├── HANDOVER_STRESS_TEST_AND_VERIFICATION_REPORT.md # 전사 스트레스 테스트 및 검증 결과 보고서
│       └── NON_DEVELOPER_HANDOVER_PLAN_AND_GUIDE.md        # 비개발자 이관 작업 마스터 플랜 및 실전 안내서
├── scripts/
│   ├── build-coastline-polygons.mjs   # OSM 실측 해안선 폴리곤 추출·단순화 빌드 스크립트
│   ├── sync-qgis-protected-areas.mjs  # 국립공원공단 공식 QGIS 특별보호구역(20개소) EPSG:5181→4326 동기화 스크립트
│   └── verify-integrity.mjs           # 전사 버전·데이터·항로(18,360쌍)·SW·EGM 계약·문서 링크 무결성 검증 게이트
├── public/
│   ├── _headers                       # Cloudflare Pages / 정적 서버 캐시 무효화 헤더 규칙
│   ├── config/
│   │   └── app_config.json            # 운영자 수신 이메일, 기본 해역, 속력·기상 기본값, 공간레이어 정의
│   ├── data/
│   │   ├── docking_points.geojson     # 출처 미확인 접안 보존 자료 55건 (좌표·원본 유지)
│   │   ├── operational/               # 운영 접안 0건 / 독립 위험정보 0건
│   │   ├── ports.json                 # 통영·거제 136개 항포구·선착장 사전 및 300개 해상 변침점 단일 연결 그래프
│   │   └── layers/
│   │       ├── national_park.geojson  # 한려해상국립공원 경계 폴리곤
│   │       └── protected_area.geojson # 한려해상국립공원 특별보호구역 정밀 폴리곤 (공단 공식 QGIS 20개소 전수 내장)
│   ├── icons/                         # PWA 홈 화면 아이콘 (192x192, 512x512, apple-touch-icon)
│   └── images/docking/                # 현장 접안지 사진/일러스트 에셋
├── .env.example                       # Kakao Map JavaScript API 키(KAKAO_MAP_API_KEY) 환경변수 예시
├── src/
│   ├── App.tsx                        # 메인 워크스페이스 오케스트레이터 (2단 슬림 HUD, 도메인 브릿지, 다중 필터)
│   ├── components/
│   │   ├── home/
│   │   │   └── HomeScreen.tsx         # 초기 접속 2×2 인트로 포스터 런치패드 & 이전 작업 이어하기
│   │   ├── calendar/
│   │   │   └── CalendarScreen.tsx     # 선박별 월간 달력·날짜 상세·일정 작성 화면
│   │   ├── MapView.tsx                # 통합 GIS 퍼사드 (Kakao Primary ↔ Legacy Leaflet 전환, 다중 배경지도·3D 독)
│   │   ├── map/
│   │   │   ├── KakaoMapCanvas.tsx     # Kakao Maps SDK v3 렌더링 엔진 (MapTypeId 10종, CustomOverlay, 폴리곤/항로)
│   │   │   ├── LegacyLeafletCanvas.tsx# 레거시 Leaflet + OpenStreetMap 폴백 엔진 (무중단 가용성 보장)
│   │   │   ├── Roadview3DModal.tsx    # 360° 3D 구면 현장 로드뷰 모달 (80m→200m 확장 탐색 및 위성+지형도 폴백)
│   │   │   └── mapMarkerTemplates.ts  # 5색 접안 마커(Hazard Halo)·선착장핀(52x52 히트영역)·상괭이·구간 시간배지·기상핀 HTML 팩토리
│   │   ├── DockingDetailSheet.tsx     # 접안 포인트 하단 슬라이딩 상세 시트 (3D 현장뷰 & 바닷길 계산 브릿지)
│   │   ├── PhotoGallery.tsx           # 현장 사진 전체화면 라이트박스 모달
│   │   ├── notebook/
│   │   │   ├── LayerControlModal.tsx        # 지도 정보 관리 기본 목록 / 전문 파일·레이어·이력 상세 관리
│   │   │   ├── mapInformationData.ts      # 운영 위험정보 파싱·지명 좌표·라벨 겹침 제어
│   │   │   ├── mapInformationVisibility.ts # 별도 UI 표시 설정 (기존 저장소 보존)
│   │   │   ├── MapInformationCards.tsx      # 6개 지도 정보 표시 카드·접안 필터·관찰기록 내보내기
│   │   │   ├── NavigationalWarningPanel.tsx # 정적 항행경보 목록·원문 상세·수집 상태
│   │   │   ├── mapInformationOrder.ts       # 지도 렌더링과 분리된 기기별 기본 카드 순서
│   │   │   ├── FieldReportModal.tsx         # 현장정보 이메일 제보 & 지도 위치 선택 모달
│   │   │   ├── PorpoiseObservationModal.tsx # 개인 상괭이 관찰 기록 추가/수정/삭제 모달
│   │   │   └── PorpoiseExportButton.tsx # 로그인 실명 확인 및 전체 관찰기록 CSV 공유·다운로드
│   │   └── navigation/
│   │       ├── RouteTimeCalculator.tsx      # 바닷길 시간계산기 패널 (예상시간·이동경로·구간거리·되돌리기)
│   │       ├── PortSelectModal.tsx          # 136개 항구·선착장 초성/별칭/섬/GPS 거리순 검색 모달
│   │       ├── MarineWeatherPanel.tsx       # ECMWF 전용 해상 기상상태 3단계 판정 패널 (항로 해역 칩 연동)
│   │       └── WeatherThresholdSettings.tsx # 기상 판정 기준값(풍속·파고) 설정 및 데이터·기술 출처 센터 모달
│   ├── config/
│   │   ├── appVersion.ts              # 앱 릴리즈 버전(APP_VERSION) 및 데이터셋 버전 단일 정본
│   │   └── dataSources.ts             # 6대 데이터·API·지도·알고리즘 출처 및 오프라인 동작 매트릭스 단일 정본(SSOT)
│   ├── data/
│   │   └── coastlinePolygons.ts       # 한려해상(통영·거제·고성·창원) 378개 실측 해안선·도서 폴리곤(12,794정점) 정본
│   ├── hooks/
│   │   ├── usePorpoiseLocationPicker.ts # 상괭이 활성 버튼 재클릭 GPS·수동 위치 선택·늦은 응답 차단
│   │   ├── useActivityPermits.ts     # 직원 공유 허가구역·관리자 구독 및 KST 기간 판정
│   │   ├── useCalendarDayConditions.ts # 날짜 상세 전용 조석·정오 날씨 구독 (월간 달력과 분리)
│   │   ├── useFirebaseAuth.ts         # Google 로그인·본인 실명 프로필 상태 및 계정 동작
│   │   ├── useSharedCalendar.ts       # 선박·월·계정별 Firestore 구독 및 정리
│   │   ├── useCalendarWeather.ts      # 캐시 우선 날씨 표시·한국 날짜/3시간 갱신·재진입 구독
│   │   ├── useAnnouncements.ts        # UID별 공지 관리자 확인·게시 공지 실시간 수신
│   │   ├── useAppRoute.ts             # URL Query 딥링크, Depth-Aware 히스토리 라우터(navigateHome), 프리셋 관리
│   │   ├── useAppConfig.ts            # app_config.json + IndexedDB 레이어 통합 로더 및 즉시 운영 반영
│   │   ├── useMarineWeather.ts        # ECMWF API 병렬 조회, KST 타임스탬프 매칭 및 3단계 등급 연산
│   │   └── usePorpoiseStorage.ts      # 상괭이 관찰 기록 localStorage 영속화
│   ├── utils/
│   │   └── geojsonMeta.ts             # 초기 부팅용 무의존성 WGS84 GeoJSON 메타데이터·BBox 정규화 유틸리티
│   ├── services/
│   │   ├── porpoiseLocationPicker.ts  # GPS 중복 요청·타임아웃·선택 세대 제어 (관찰 저장과 분리)
│   │   ├── porpoiseExportService.ts   # 현지 조사표 14열 CSV·UTF-8 BOM·기본 파일 공유·다운로드 (저장소 쓰기 없음)
│   │   ├── calendarDayConditions.ts   # KHOA 재사용·IFS/WAM 정오 결합·ENS 강수확률·요청 병합
│   │   ├── activityPermitModel.ts     # 원본 DMS·WGS84·다각형 검증·월 단위 만료·지도 레이어
│   │   ├── activityPermitService.ts   # 작성자 트랜잭션·별도 조사 일정 및 구역 스냅샷
│   │   ├── khoaTideSchema.ts          # KHOA 32일 묶음 검증·갱신 시각·신선도
│   │   ├── khoaTideService.ts         # 날짜 상세 카드용 정적 조석 JSON 검증·조회
│   │   ├── navigationalWarningService.ts # 정적 항행경보 검증·조회·KST 시각·상태
│   │   ├── navigationalWarningMap.ts # 검증된 항행경보 좌표·도형 및 기존 hazard 지도 연결
│   │   ├── firebaseClient.ts          # VITE_FIREBASE_* 기반 SDK 초기화 (설정 누락 시 기존 기능 유지)
│   │   ├── userProfileService.ts      # UID별 실명 프로필 서버 조회·저장 및 한글 두 글자 검증
│   │   ├── pwaInstallation.ts         # 조타실의 기기별 홈 화면 추가 안내 (실제 설치 가능 여부는 브라우저 이벤트 기준)
│   │   ├── calendarRepository.ts      # 기존 로컬 일정 호환 및 선박 선택 저장
│   │   ├── calendarFirestoreService.ts # 공유 일정 실시간 조회·트랜잭션 저장
│   │   ├── calendarWeatherCache.ts    # 지역·날짜별 날씨 캐시·요청 병합·실패 시 보존
│   │   ├── announcementModel.ts       # 공지 형식·정렬·순환·단일 관리자 UID 판별
│   │   ├── announcementService.ts     # 게시 조건 쿼리·공지 실시간 조회·관리자 쓰기 트랜잭션
│   │   ├── sharedCalendarModel.ts     # 공유 형식·한국 날짜·충돌 검사·로컬 백업 읽기
│   │   ├── routeIslandLabels.ts       # 실제 항구·해안선 데이터의 섬 이름을 경로 순서대로 표시
│   │   ├── straightRouteService.ts     # 클릭 좌표 보존·순서 번호·마지막 점 제거
│   │   ├── kakaoMapLoader.ts          # KAKAO_MAP_API_KEY 기반 SDK 동적 로더, 줌 레벨 변환기, 도메인 검증 진단기
│   │   ├── spatialFileParser.ts       # .gpkg, .zip(.shp/.dbf/.prj/.cpg), .geojson, .kml 인앱 파서 & EPSG:5179/CP949 자동 변환
│   │   ├── layerStorageService.ts     # IndexedDB + localStorage 레이어 영속 저장소 및 12개 버전 스냅샷 롤백
│   │   ├── githubLayerSyncService.ts  # [저장] 시 GitHub Git Data API 기반 원격 main 브랜치 원자적 자동 커밋
│   │   ├── ecmwfWeatherService.ts     # ECMWF IFS(풍속) + WAM(파고) 전용 URL 생성 및 KST 타임스탬프 결합기
│   │   ├── weatherThresholdStorage.ts # 공통 기상 기준 저장·복원 및 구형 기본값 호환 처리
│   │   ├── emailReportService.ts      # 이메일 제보 전문 포맷팅, mailto URI 생성, 클립보드 복사
│   │   ├── reportRecipientStorage.ts  # 제보 수신 이메일 검증·기기 저장·기본 주소 복원 (제보자명과 분리)
│   │   ├── routeGeoService.ts         # Haversine 직선거리·예상시간 계산 및 실측 해안선 교차 경고
│   │   ├── routeLegLabelService.ts    # 줌 레벨·구간 길이 적응형 지도 구간 배지(시간·NM) 포맷팅 서비스
│   │   ├── routePortSelectionService.ts # 136개 등록 항구 즉시 선택(applyDirectPortSelection)·유효성 검증·편집 후 정규화 서비스
│   │   └── workspaceDraftRepository.ts# 항로·선속·필터·제보자명 localStorage 드래프트 영속화 및 GPS 오류 분류기
│   ├── tests/
│   │   ├── calendarRepository.test.ts # 달력 월 배열·선박 분리·수정·삭제·저장 복원 테스트
│   │   ├── calendarWeatherCache.test.ts # 날씨 복원·갱신·실패·응답 순서·중복 요청 검사
│   │   └── coreServices.test.ts       # 핵심 도메인(해상 항로·즉시 항구 선택·기상·딥링크·워크스페이스·출처·EGM 계약) 단위 테스트
│   └── types/                         # 도메인별 TypeScript 엄격 타입 정의 (kakao, config, spatialLayer, docking, port, route, weather, porpoise, report)
├── DEPLOY_GUIDE.md                    # 비개발자 운영자용 데이터 교체 및 무상 배포 가이드
├── README.md                          # 프로젝트 개요 문서
└── vite.config.ts                     # Vite + Tailwind v4 + Workbox PWA 설정
```

---

## 4. 로컬 개발 및 검증 명령

Google 로그인·실명 등록의 환경변수와 1단계 콘솔 설정은 [Firebase 로그인 설정 안내](docs/FIREBASE_AUTH_SETUP.md)를 참고하세요. 2단계 공유 달력의 코드·로컬 규칙은 구현되었으며 운영 반영은 승인 대기 중입니다. 기존 localStorage 일정은 원본을 보존하고 공유 일정과 분리하며 자동 이전하지 않습니다. 규칙 게시·검증 절차는 [공유 달력 인수인계](HANDOVER.md)를 참고하세요.

```bash
# 의존성 설치
npm install

# 단위 테스트 실행 (Node.js 내장 테스트 러너 · 13개 핵심 도메인 검증)
npm test

# 정적 린트 검사 (oxlint 116개 규칙)
npm run lint

# 프로덕션 빌드 (TypeScript 타입 검증 + Vite 번들링 + Workbox 서비스 워커 생성)
npm run build

# 전사 데이터·버전·항로 그래프·SW 프리캐시 무결성 검증
npm run verify

# 로컬 개발 서버 실행
npm run dev
```
