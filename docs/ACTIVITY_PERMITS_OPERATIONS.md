# 행위허가 운영 준비

행위허가 Firestore 보안 규칙은 2026-11-19에 `badakkomkkomi-firebase` 운영에 배포하고 게시 원문 일치를 확인했다. `permitInvestigations`의 `vessel ASC, date ASC` 색인(`CICAgOjXh4EK`)은 READY 상태다. Firebase 무료 요금제를 유지하며 **TTL과 자동 삭제는 사용하지 않는다**. 원본은 작성자 또는 관리자가 수동 삭제한다. 운영 조회·배포 상세 기록은 로컬 `docs/backups/`에 별도 보관하며 Git에는 포함하지 않는다.

## 데이터와 권한

- `activityPermits/{id}`: 원본 도·분·초, 확인된 `EPSG:4326`, WGS84 십진수 좌표, 허가번호·대상·기간·비고·작성자 UID·revision·expiresAt.
- `permitInvestigations/{id}`: 하루·선박·예정/완료 상태·작성자와 허가구역 스냅샷. 허가 문서가 삭제되어도 독립적으로 유지한다.
- 여러 구역 일정은 Firestore 규칙의 문서 접근 한도를 넘지 않게 한 번에 최대 5개씩 원자적으로 등록한다. 같은 날짜에 추가 등록하여 5개보다 많은 일정을 보관할 수 있다.
- 기존 Google 로그인/한글 실명 프로필과 `calendarAdmins/{uid}.enabled`를 재사용한다. 본인만 수정, 본인 또는 관리자만 삭제한다. 관리자는 타인 자료를 수정하지 못한다.
- 규칙은 작성자·날짜·선박·기존 expiresAt 메타데이터·스냅샷 출처를 검증한다. DMS 상세 형식·변환 일치·다각형 자기교차 검사는 클라이언트 저장/읽기 양쪽에서 수행한다. Firestore 규칙은 반복문/연산 제한 때문에 꼭짓점 배열 크기(4~20)까지만 검사한다. SDK를 직접 사용하는 직원의 잘못된 기하 입력까지 서버에서 차단하려면 별도 신뢰 서버 검증이 필요하다.
- 좌표계가 미확인 또는 WGS84가 아닌 자료는 등록하지 않는다. 원본 좌표계를 확인하고 정식 변환한 후 사용한다.
- 종료일 다음 날부터 일반 지도에서 제외한다. 목록·과거 달력에서 명시적으로 선택한 구역은 상세 확인용으로 일시 표시한다.

## 운영 설정과 수동 삭제 정책

1. Firebase 무료 요금제와 결제 계정 미연결 상태를 유지한다. TTL 정책을 활성화하거나 결제 계정을 연결하지 않는다.
2. `firestore.permits.indexes.json`은 필요한 복합 색인만 담은 **참고용 템플릿**이다. `fieldOverrides`는 빈 배열이며 TTL 설정이 없다. 기존 운영 색인 전체를 이 파일로 대체하지 않는다.
3. `permitInvestigations`의 `vessel ASC, date ASC` 복합 색인은 생성 및 READY 확인을 완료했다. 앱 배포 시 다시 적용하지 않는다.
4. 종료일 다음 날부터 일반 지도에서 숨기되, 원본 자료는 목록에서 유지한다. 작성자 또는 관리자의 명시적 삭제만 사용한다. 원본을 삭제해도 별도 컬렉션의 달력 조사 기록과 스냅샷은 유지한다.
5. 보안 규칙은 2026-11-19 승인에 따라 배포 완료했다. 기존 규칙 경로와 관리자 문서는 변경하지 않았다. 향후 규칙 변경은 최신 운영 원문 비교와 별도 승인을 거친다.
6. 운영 데이터를 임의 변경하지 않는다. 등록·수정·수동 삭제·원본 삭제 후 달력 보존의 자동 검증은 로컬 에뮬레이터에서 수행한다. 실제 직원 계정의 UI 시험은 승인된 경우에만 수행한다.

`firebase.json`에는 색인 템플릿을 연결하지 않는다. GitHub Pages 워크플로는 앱 정적 파일만 배포하며 Firebase 운영 규칙·색인·TTL을 변경하지 않는다.

## expiresAt 호환 메타데이터

기존 저장 형식과 배포된 보안 규칙의 호환성을 위해 종료일에 달력상 한 달을 더하고 말일을 보정한 날짜의 KST 00:00을 expiresAt에 저장한다. 예: 2026-01-31 종료 → 2026-02-28 00:00 KST. 기간 연장은 같은 트랜잭션에서 expiresAt도 갱신한다. 이 계산은 고정 30일 계산이 아니며, 현재 정책에서 삭제를 실행하는 시각이 아니다.

expiresAt이 지나도 자동 삭제하지 않는다. 지도 숨김은 삭제와 독립적이며 foreground 30초 주기 및 화면 복귀 시 KST 날짜를 재확인한다.

공식 참고: [Firestore 무료 할당량](https://firebase.google.com/docs/firestore/quotas), [색인 설정 형식](https://firebase.google.com/docs/reference/firestore/indexes).

## 로컬 검증

`npm test`, `npm run lint`, `npm run build`, `npm run verify` 및 Java 21 환경에서 `npm run test:rules`. 규칙 테스트는 demo 프로젝트의 로컬 Firestore 에뮬레이터만 사용하며 운영 데이터에 접근하지 않는다. 작성자/관리자의 수동 삭제, 원본 삭제 후 달력 보존, 기간 종료와 지도 숨김, TTL 없는 색인 템플릿을 검증한다.

선택적 UI 검증: Vite 개발 서버 실행 후 `PLAYWRIGHT_MODULE`(설치된 Playwright 진입 파일), `CHROME_EXECUTABLE` 환경변수를 지정하고 `node src/tests/activityPermits.browser.mjs`를 실행한다. 별도 패키지를 자동 설치하지 않는다. 320/390/1280px에서 실제 등록·일정 컴포넌트와 Leaflet 폴리곤 확대·클릭·표시 전환을 시험한다. Firebase는 격리된 브라우저 문맥에서 메모리 대역으로 교체하고 외부 요청을 차단한다. 운영 Firebase·실제 Kakao SDK·물리 모바일 기기는 이 테스트로 검증하지 않는다.
