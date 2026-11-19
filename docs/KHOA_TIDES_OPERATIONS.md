# KHOA 조석예보 정적 갱신

구현 기반은 [수집기](../scripts/update-khoa-tides.mjs), [복구기](../scripts/prepare-khoa-tides.mjs), [워크플로](../.github/workflows/deploy-pages.yml), [스키마](../src/services/khoaTideSchema.ts)입니다. 날짜 상세 카드는 정적 JSON을 재사용합니다. 예측 시각은 `HH:mm` 원문이며 시간대·조위 기준면은 공식 근거 확보 전까지 기록하지 않습니다. 생성 시각만 UTC ISO 8601입니다.

## 실행과 호출량

- 예약: `17 19 * * *` UTC, 다음 날 KST 04:17 예정. 지연·누락 가능하며 공개 저장소의 60일 무활동 시 예약 비활성화도 점검합니다.
- 수동: Actions에서 main의 배포 워크플로 Run workflow. Re-run은 원래 SHA를 쓰므로 main이 바뀌었다면 최신 main에서 새 실행을 시작합니다.
- 수집: KST 오늘부터 32일, 통영 DT_0014·고현항 SO_0552, 보통 64회. 요청 간 150ms, 요청 제한 15초, 전송 오류·429·5xx에만 한 번 재시도. 한 실행 최대 140회이며 예산 소진 시 실패합니다. 페이지당 100개, 최대 3페이지·300개 사건을 허용합니다.
- `KHOA_SERVICE_KEY` 없이 직접 수집하면 실패하고 기존 파일은 보존됩니다. Windows User 변수는 프로세스가 상속하거나 운영자가 프로세스에 로드해야 합니다. 키를 명령 인수에 넣지 않습니다.

## 배포 전 준비

정적 JSON 갱신 기반은 배포되어 있으며 날짜 상세 카드가 이 자료를 조회합니다. 새 운영 환경의 Secret은 승인 후 Settings → Secrets and variables → Actions에 `KHOA_SERVICE_KEY`로 등록합니다. Secret은 수집 단계에만 전달하며 `VITE_` 공개 변수로 만들지 않습니다. 현재 키의 유효기간·운영 승인 상태·승인 호출량도 확인합니다.

## 정상 자료 승계와 실패

모든 실행은 같은 Pages concurrency 그룹에서 직렬화하며 main만 배포합니다. 신규 코드가 도착해 main SHA가 달라진 실행은 배포 직전 실패합니다. GitHub는 대기 실행을 교체할 수 있으므로 매일 정시 완료를 보장하지 않습니다.

1. 이전 **성공** 실행이 배포 후 저장한 `khoa-tides-실행ID-시도번호` artifact를 찾습니다. main, 워크플로 경로, 실행 성공 여부를 확인합니다. 기록 탐색은 최대 300개 artifact로 제한합니다.
2. artifact는 90일 보존을 요청하지만 저장소 정책·수동 삭제에 따라 짧아질 수 있습니다. 다운로드 실패·만료 시 운영 Pages의 `data/tides/latest.json`을 별도로 조회합니다. 로컬 파일·artifact·Pages 후보를 모두 검증하고 생성 시각이 가장 최신인 것을 선택합니다.
3. push는 복구된 자료를 그대로 빌드에 포함합니다. 복구 자료가 없으면 최초 수집이 필수이며, 키가 없거나 수집 실패하면 새 배포를 중단합니다. 예약·수동 실행은 항상 새 32일 묶음을 수집합니다.
4. 날짜별 하나라도 오류·결측·페이지 누락이면 새 묶음을 게시하지 않습니다. 수집 완료 후 검증된 결과만 임시 파일에서 원자적 rename으로 교체합니다. 기존 생성 시각을 새 시각으로 바꾸지 않습니다.
5. lint/test/build/verify와 SHA 확인 후 전체 Pages artifact를 배포하고 그 뒤 조석 백업을 저장합니다. 배포 실패는 정상 백업으로 기록하지 않습니다. 배포는 성공했지만 백업 업로드만 실패했다면 다음 실행은 Pages 사본으로 복구할 수 있습니다. 두 복구원이 모두 없으면 성공적인 재수집 외의 조용한 우회는 없습니다.

generatedAt이 오래된 자료도 복구에는 사용할 수 있으나 최신 예보라고 간주하지 않습니다. `tideFreshness()`는 36시간 경과·미래 시각을 stale로 판정하고 실제 수록 시작·종료 날짜를 제공합니다. 범위 밖 날짜를 임의 생성하지 않습니다. artifact 장기 보존은 보장되지 않으며 두 복구원 상실 시 API 재수집이 필요합니다.

## 캐시

`data/tides/**`는 프리캐시에서 제외합니다. 같은 출처의 조석 경로를 일반 JSON보다 먼저 NetworkFirst로 처리합니다. 네트워크 요청은 no-store이며 3초 지연 시 정상 캐시로 응답하고 백그라운드 갱신을 계속합니다. JSON 구조·지점·32일 범위·숫자·시각을 검증한 응답만 캐시에 넣습니다. HTTP 200 오류 JSON도 거부하며 이전 응답보다 오래된 CDN 응답은 정상 캐시를 되돌리지 않습니다. 오프라인에는 마지막 정상 사본과 원래 generatedAt을 유지합니다.

데이터 전용 캐시는 별도로 보관하고 쿼리를 제거한 키 하나를 사용합니다. 브라우저가 저장소를 제거하면 오프라인 사본은 사라질 수 있습니다. Pages HTTP 캐시는 실제 응답에서 max-age=600이 관측됐으므로 즉시 반영은 보장되지 않습니다. 프리캐시에서 제외되므로 JSON 내용만 바뀌면 SW·앱 셸 리비전은 바뀌지 않습니다.

## 검증 경계

단위 테스트는 API·파일 실패·복구·Workbox 직렬화 콜백을 로컬에서 검증합니다. 실제 GitHub 예약·환경 보호규칙·artifact API·Pages 배포·설치된 PWA 전환은 별도 승인 후 운영 검증해야 합니다. 로컬 빌드 비교로 데이터만 변경했을 때 SW와 앱 셸 해시가 유지되는지 확인합니다. 기존 Firebase 설정, 달력 물때 명칭, 날씨 서비스는 변경하지 않습니다.

공식 근거: [API](https://www.data.go.kr/data/15156018/openapi.do), [Actions 예약](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [Pages 배포](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
