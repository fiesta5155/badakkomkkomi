# KHOA 날짜별 조위 시계열

기존 고·저조 수집과 달력을 유지한다. 갯바위 레이어에는 아래의 시험 운영용 경험 범위 비교만 연결하며, 검증 완료 경로의 ROCK_DOCKING_TIDE_REFERENCE는 null을 유지한다.

## 갯바위 시험 운영용 참고 비교

[시험 비교](../src/services/rockDockingTrialTides.ts)는 원문 시각을 KST로 해석하는 시험 운영 경로다. API 시간대·기준면을 공식 검증했다는 뜻이 아니며 원본 검증값 false와 기존 estimateRockTide의 검증 조건을 변경하지 않는다. 지점에 등록된 참조 코드의 예보 조위와 직원이 입력한 경험 범위를 비교하며 현지 수위나 접안 안전을 보장하지 않는다. 등록 범위와 기준면을 다시 쓰지 않는다.

[전용 훅](../src/hooks/useRockTrialTides.ts)은 자료가 준비된 갯바위 레이어를 사용하거나 지점 정보를 볼 때만 현재 날짜 파일을 요청한다. 홈/일반 바다수첩 진입, 지도 이동·확대에는 요청하지 않는다. 두 지점은 한 파일과 기존 요청 공유/메모리/PWA 캐시를 재사용한다. 현재 시각은 매분 및 화면 복귀 시 갱신하고, 네트워크 재확인은 활성화·날짜 변경·화면 복귀·온라인 복귀 때만 수행한다. 분 갱신 자체는 네트워크 폴링이 아니다.

현재 시각 양옆 5분 표본을 선형 보간하며 23:55 이후에는 내장 nextMidnightCm을 사용한다. 계산값의 음수·소수를 보존하고 UI 표시만 소수 첫째 자리로 정리한다. 파일 날짜·스키마·참조 코드·36시간 신선도 검사 실패 시 미확인이다. 101호·103호는 독립 비교하며 기존 10cm 경계와 색상을 사용한다. 마커 배열은 실제 위치/이름/색상이 바뀔 때만 교체하여 매분 지도 도형 재생성을 방지한다.

## 파일과 기준

public/data/tide-series/YYYY-MM-DD.json은 한 날짜의 통영 DT_0014·고현항 SO_0552 자료를 함께 담는다. schemaVersion, date, generatedAt(UTC ISO), unit=cm, intervalMinutes=5, reference, stations를 사용한다. 각 station은 code, heightsCm(288개), nextMidnightCm만 가진다. 배열의 0은 응답 원문의 00:00, 287은 23:55이며 경계값은 다음 날짜 00:00이다. 음수/소수를 반올림·보정하지 않는다.

reference.verticalDatumVerified와 reference.timeZoneVerified는 모두 false다. 요청 날짜와 수집 예약을 KST로 정하는 것과 API 응답 시간대/수직기준면을 공식 확인하는 것은 다르다. 검증 완료 자동 비교나 안전 판정에 연결하지 않으며 위 시험 참고 비교와 구분한다. tideSeriesBracket은 원문 표본 두 개만 반환하며 조위 보간/색상 판정을 실행하지 않는다.

## 수집과 묶음 교체

[수집기](../scripts/collect-khoa-tide-series.mjs)는 KHOA_SERVICE_KEY를 서버 환경에서 읽는다. API는 공공데이터포털 15156022의 tideFcstTime/GetTideFcstTimeApiService이며 min=5, numOfRows=300을 요청한다. KST 오늘부터 32일 × 2지점 64회와 마지막 날짜 다음 날 00:00(각 지점 numOfRows=1) 2회로 정상 66회다.

응답 결과코드, 페이지 메타데이터, 전체 288건, 원문의 정확한 날짜/5분 시각 순서/이름/좌표 범위/유한한 숫자를 검사한다. 누락·중복·순서 오류·문자열 숫자를 거부한다. 요청 간 150ms, 타임아웃 15초, 전송 오류·429·5xx에 최대 한 번 재시도(1초 대기), 전체 예산 132회다. 인증/응용 오류·형식/자료 오류는 재시도하지 않는다. 오류 로그에는 제한된 이유/지점/날짜/상태코드만 포함하며 URL·키·서버 응답 본문·원본 예외는 출력하지 않는다.

32일 전부 성공해야 생성한다. manifest.json은 같은 generatedAt의 연속 32일과 각 파일 SHA-256을 기록한다. 파일별 스키마/해시/날짜/생성시각, 날짜 사이 nextMidnightCm 일치를 모두 검사한다. [묶음 처리](../scripts/lib/khoa-tide-series.mjs)는 public 밖의 .dev 거래 디렉터리에 완성본을 쓴 후 폴더를 교체한다. 날짜 파일을 하나씩 운영 디렉터리에 덮어쓰지 않는다. 교체 실패는 이전 폴더를 복구하며, 알 수 없는 이전 파일은 비공개 거래 백업에 남긴다. 디스크/프로세스 장애의 완전한 원자성을 보장하지 않으므로 빌드 직전에도 전체 묶음을 검증하고 실패하면 기준 묶음으로 복구하거나 배포를 중단한다.

[복구기](../scripts/prepare-khoa-tide-series.mjs)는 검증된 로컬/성공 배포 artifact를 먼저 사용한다. 없으면 게시된 manifest와 32일 자료를 최대 4개 동시 정적 요청으로 복구한다. manifest 404만 초기 미수집으로 인정한다. 네트워크 실패·손상·부분 자료를 미수집으로 바꾸지 않고 배포를 막아 기존 Pages를 보존한다. 자료가 없는 초기 상태에서는 가짜 빈 성공 JSON을 생성하지 않는다.

## GitHub Actions

기존 [Pages 워크플로](../.github/workflows/deploy-pages.yml)의 단일 배포와 concurrency를 재사용한다. 예약은 그대로 17 19 * * * UTC(KST 04:17 예정)다.

1. 성공 배포한 khoa-tide-series-실행ID-시도번호 artifact를 복구하고, 없으면 운영 Pages로 복구한다.
2. 기준 묶음을 runner.temp에 백업한다.
3. schedule/workflow_dispatch에서 오늘 시작하는 정상 묶음이 없을 때만 수집한다. 오늘 정상 자료가 있으면 중복 수집하지 않는다. 실패한 날의 수동 재시도는 가능하다.
4. push와 항행경보 workflow_run은 시계열 API를 호출하지 않는다. 첫 도입 시에는 예약을 기다리거나 별도 수동 실행이 필요하다.
5. 시계열 수집 실패는 고·저조 처리와 분리한다. 최종 검증에서 이전 정상 묶음을 복구하고, 불완전한 폴더가 남으면 배포를 막는다. 초기 미수집이면 시계열은 제공하지 않으며 기존 달력 자료는 유지한다.
6. 실제 Pages 배포 성공 후에만 시계열 묶음을 artifact(90일 요청)로 보관한다. 운영 Secret은 기존 KHOA_SERVICE_KEY를 재사용한다.

소스 변경, 워크플로 수정, 로컬 데이터 생성만 수행했으며 이 작업에서 GitHub workflow를 실행하거나 push/배포하지 않는다. 고·저조 JSON 구조·수집 조건과 항행경보 스케줄은 변경하지 않는다.

## 필요한 날짜만 접근

[접근 서비스](../src/services/khoaTideSeriesService.ts)의 loadTideSeriesDay(date, base)는 호출한 날짜 파일 한 개만 요청한다. import/생성 시 네트워크 요청은 없으며 지도 이동과도 연결되지 않는다. BASE_URL을 적용해 Pages 하위 경로를 지원한다. 파일 하나에 두 지점과 다음 자정이 있으므로 두 지점/경계 계산을 위해 다른 날짜를 추가 다운로드할 필요가 없다.

동일 날짜 진행 요청은 공유하고 성공 결과만 LRU 최대 8일/메모리 재사용 1시간으로 보관한다. 실패는 메모리에 저장하지 않아 다음 명시 요청에서 재시도한다. 잘못된 날짜·404·손상 JSON은 빈 정상 자료가 아니라 오류다. 더 오래된 CDN/SW 응답은 메모리의 새 세대를 되돌리지 않는다. 결과는 변경 불가능하게 고정한다. 생성 시각 기반 신선도는 별도 tideSeriesFreshness(36시간)를 사용하며 캐시 적중을 최신이라는 뜻으로 해석하지 않는다.

## PWA

별도 bada-khoa-tide-series-v1 캐시에 NetworkFirst(3초 fallback), 최대 35파일, 캐시 보존 최대 72시간을 적용한다. 시계열 디렉터리는 사전 캐시에서 제외한다. manifest 등 메타데이터는 NetworkOnly다. 기존 data/tides의 validator/캐시와 분리한다.

[SW 플러그인](../scripts/khoa-tide-series-cache.ts)은 fetchDidSucceed, cacheWillUpdate, cachedResponseWillBeUsed에서 요청 날짜와 자체 완결형 스키마를 검사한다. 오류·불완전 응답은 저장하지 않고 정상 이전 캐시가 있으면 오프라인/실패 fallback으로 사용한다. 더 오래된 생성 시각의 응답은 최신 정상 캐시를 되돌리지 않는다. 유효성 검사는 SW에 직렬화 가능한 형태이며 빌드 후 브라우저에서도 검사한다. 기존 조석·항행경보·지도·사진 캐시는 유지한다.

## 로컬 검증

- 수집: KHOA_SERVICE_KEY가 있는 환경에서 node scripts/collect-khoa-tide-series.mjs
- 복구/배포 전 검증: node scripts/prepare-khoa-tide-series.mjs (환경의 artifact/Pages 경로 사용), 또는 --finalize
- 자료는 Git 제외 public/data/tide-series에 생성된다. 원문 응답이나 인증키를 소스/정적 JSON에 기록하지 않는다.
- node --test src/tests/khoaTideSeries.test.ts 및 기존 npm test/lint/build/verify를 실행한다.

공식 기준면/시간대 확인과 검증 완료 경로 활성화는 별도 후속 작업이다. Firebase 규칙/IAM/CORS/운영 문서는 변경하지 않는다.

## 이번 로컬 실측 결과 (2026-11-26)

실제 API 전체 수집 1회: 66요청, 17.303초, 2026-11-26~2026-12-27 날짜 파일 32개. 날짜 파일은 3964~4083byte, 합계 129003byte이며 manifest는 3207byte다. 각 파일의 두 배열은 288개씩이고 마지막 다음 자정 값도 수집했다. 데이터와 검증 로그에서 현재 인증키가 포함되지 않았음을 검사했다. 생성 파일은 Git 제외 경로에만 있다.

일반 테스트 273개, TypeScript, Oxlint(기존 경고 11개), build, verify가 통과했다. 프로덕션 SW 브라우저 검증은 홈/바다수첩 진입 시 요청 0건, 정상 오프라인 fallback, 손상/오류 응답 비캐시, 세대 역전 방지, 35개 제한, 72시간 만료를 통과했다. 기존 갯바위 UI 회귀는 390px Leaflet·Kakao(외부 서비스는 대역)에서 통과했다. SW 브라우저 검증은 수집 및 build 후 기존 PLAYWRIGHT_MODULE/CHROME_EXECUTABLE을 지정해 node src/tests/khoaTideSeries.browser.mjs로 재실행한다.

배포 artifact는 한 세대만 포함한다. 다만 브라우저/Pages CDN에는 이전 캐시가 남을 수 있으므로 캐시 적중을 최신으로 보장하지 않는다. 날짜 파일 자체의 생성 시각·신선도와 내장된 다음 자정 값을 사용하고, 향후 여러 파일을 결합하는 기능은 생성 시각 일치 여부도 검사해야 한다. 실제 GitHub 예약 실행과 운영 배포는 이번에 수행하지 않았다.
