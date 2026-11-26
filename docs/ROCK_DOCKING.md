# 갯바위 접안정보

바다수첩의 공간 레이어에서 기존 docking 항목을 사용한다. 운영 지점과 보존 자료 55건은 분리하며, 예시 지점을 자동 등록하지 않는다. 지도 위 상시 버튼은 추가하지 않는다.

## 사용 흐름

- 공간 레이어에서 표시 ON/OFF, 섬별 접이식 목록, 지점 등록을 제공한다.
- 목록에는 지점명만 표시하고 선택하면 해당 위치로 이동한다. 같은 섬 이름은 정규화한 공통 ID로 중복 생성을 방지한다.
- 기존 Kakao/Leaflet 캔버스의 마커 방식을 재사용한다. 확대 수준 12 이상에서 작은 마커와 44px 터치 영역을 표시한다.
- 마커 선택은 지도 카메라를 이동시키지 않고 사진 중심 하단 패널을 연다. 사진이 있으면 58dvh, 없으면 작은 패널로 표시한다. 최대 너비 36rem, 내부 스크롤, safe area를 적용한다.
- 원경/근경을 첫 줄에, 추가 사진 최대 2장을 다음 줄에 표시한다. 선박별 범위, 예상 조위 상태, 메모 건수, 최종 확인일, 상세 보기를 제공한다.
- 사진 확대는 좌우 스와이프, 이전/다음, 키보드 화살표, 닫기/Escape를 지원한다. 수직 이동은 사진 전환으로 처리하지 않는다.
- 상세에서 작성자 수정/삭제와 공동 현장 메모를 제공한다. 위치 선택 동안만 임시 지도 선택 모드를 사용하고 완료/취소 시 이전 뷰포트로 복귀한다.
- 수색지원 버튼은 바다수첩 내부 행위허가 바로 오른쪽에 표시한다. 홈 메뉴에는 없으며 클릭 기능은 구현하지 않았다.

## 데이터와 권한

기존 Firebase Google 로그인과 유효한 사용자 프로필(users/{uid}, uid 일치, 한글 두 글자 realName)을 요구한다.

| 경로 | 역할 |
| --- | --- |
| rockDockingIslands/{정규화한 섬 이름} | 공통 섬, 인증 회원 생성, 생성 후 변경/삭제 금지 |
| rockDockingPoints/{UUID} | 좌표, 선박 범위, 사진 메타데이터, 확인일, 작성/수정 정보, revision |
| rockDockingPoints/{id}/notes/{id} | 직원별 메모, pinned, 작성/수정 정보, revision |

인증된 회원이 공동 열람/등록한다. 본인 지점/메모만 수정할 수 있고 다른 직원의 기록을 임의 변경할 수 없다. 기존 calendarAdmins 관리자는 삭제 정리만 가능하다. 지점 삭제는 tombstone이며 다른 직원의 하위 메모를 물리적으로 삭제하지 않는다. 수정은 revision 트랜잭션으로 충돌을 검사한다. 메모는 중요 항목을 먼저 표시한다.

[Firestore 규칙](../firestore.rules), [Storage 규칙](../storage.rules), [Firebase 에뮬레이터 설정](../firebase.json)이 서버 권한을 검사한다. 기존 달력/공지/행위허가 규칙은 보존한다. 이 파일들의 Git 반영이나 Pages 배포는 Firebase 규칙 배포를 수행하지 않는다.

## 사진 저장

- 버킷: badakkomkkomi-firebase.firebasestorage.app
- WebP, 긴 변 최대 1600px, 1~512000byte, 전체 최대 4장(원경 1, 근경 1, 추가 2).
- Firestore에는 경로/역할/용량/치수 메타데이터만 저장한다. 실제 사진, Base64, 공개 다운로드 토큰 URL은 Git/Firestore에 저장하지 않는다.
- 논리 photo-1..photo-4는 기존 Firestore UUID 검증과 호환되는 아래 고정 파일을 사용한다.

| 슬롯 | UUID |
| --- | --- |
| photo-1 | 00000000-0000-4000-8000-000000000001 |
| photo-2 | 00000000-0000-4000-8000-000000000002 |
| photo-3 | 00000000-0000-4000-8000-000000000003 |
| photo-4 | 00000000-0000-4000-8000-000000000004 |

경로는 rockDocking/{pointId}/{authorUid}/{고정UUID}.webp이다. Storage 규칙은 지점 소유자 폴더의 네 파일만 생성/교체하도록 제한한다. 임의 이름, 다섯 번째 파일, 다른 작성자의 교체/삭제, 비회원, 잘못된 프로필, MIME/용량 불일치는 거부한다. 기존 관리자 삭제 정리만 허용한다. 사용자별 객체 목록 조회는 허용하지 않는다. 서버 규칙은 이미지 바이너리/픽셀을 디코딩하지 않으며 브라우저가 실제 WebP 변환과 치수 제한을 수행한다.

사진은 선택한 지점에서만 인증 다운로드한다. 브라우저에서 480px 미리보기를 만들고 확대 시 동일 Blob의 전체 크기 URL을 생성한다. 별도 서버 썸네일은 없으므로 최초 전송량은 압축 사진 크기와 같다. 확대/스와이프는 추가 요청하지 않으며 URL은 닫기/패널 전환 시 해제한다. 사진은 PWA 사전 캐시에 포함하지 않고 Storage 요청은 NetworkOnly를 사용한다.

### 저장과 실패 복구

지점/메모 저장 → 서버 문서 확인 → 슬롯 계획 → 기존 파일 백업 → 파일 변경 → 사진 메타데이터 트랜잭션 순서다. 신규 슬롯은 getMetadata에서 object-not-found가 확인되면 미디어 다운로드를 생략한다. 권한/통신 오류는 빈 슬롯으로 취급하지 않는다.

파일 또는 메타데이터 실패 시 기존 revision이 유지된 경우에만 백업을 복구하고 새 파일을 정리한다. 커밋 결과가 불명확하거나 동시 수정이 감지되면 최신 자료를 덮어쓰지 않고 재저장을 잠근다. Firestore와 Storage는 하나의 원자적 트랜잭션이 아니므로 복구 실패는 별도 확인이 필요하다. 첫 단계에서 이미 저장된 지점/메모를 임의 삭제하지 않고 사용자에게 저장 사실을 알린다. 사진 교체는 같은 용량이라도 revision을 갱신한다.

화면에 실패 단계/Firebase 코드를 표시하고 콘솔에는 stage/path/code만 기록한다. 토큰/인증 헤더/서버 오류 응답 본문은 기록하지 않는다. SDK 재시도에 별도의 무한 재시도를 추가하지 않는다.

## 운영 설정과 남은 제약 (2026-11-26)

Firestore/Storage 규칙 및 승인된 Storage→Firestore 문서 읽기 서비스 연결은 이미 적용되어 있다. 실제 로컬 사진 저장/조회 성공은 사용자가 확인했다. 규칙/버킷/IAM 원본 백업과 영수증은 로컬 보관하며 공개 저장소에 포함하지 않는다.

사진 CORS 문제는 정상 media GET의 200/Range 206 응답에 Access-Control-Allow-Origin이 없던 것으로 재현했다. 기존 OPTIONS/403에는 헤더가 있어 사전 요청만으로 발견되지 않았다. 승인된 두 로컬 origin(http://localhost:5174, http://127.0.0.1:5174)에 GET, Content-Type/Content-Range 노출, maxAgeSeconds 600을 적용한 뒤 정상 응답 헤더를 확인했다. Authorization은 Firebase 인증, Range는 SDK 다운로드 제한을 위한 정상 헤더다.

**현재 Pages origin https://fiesta5155.github.io는 CORS 허용 목록에 없다.** 따라서 Pages의 사진 조회와 기존 사진 백업/교체는 운영 origin 허용 전까지 제한된다. Pages 프런트엔드 배포와 사진 CORS 준비 상태를 구분해야 한다. 이번 릴리스에서는 요청에 따라 CORS/IAM/운영 규칙을 변경하지 않는다. 추후 별도 승인 후 CORS를 보완해야 하며 origin에 /badakkomkkomi/ 경로를 넣지 않는다.

GitHub Actions의 VITE_FIREBASE_STORAGE_BUCKET 변수가 위 버킷과 일치함을 읽기 전용으로 확인했다. 기존 배포 워크플로는 Storage를 포함한 Firebase 웹 설정을 빌드에 전달한다. 비공개 자격증명은 VITE_ 변수에 넣지 않는다.

조위는 기존 KHOA 정적 만조/간조 보간을 재사용한다. 다만 기준면/시간대의 검증 근거가 없어 ROCK_DOCKING_TIDE_REFERENCE는 null이다. 자동 비교는 미확인(회색)으로 유지하며 임의 기준을 가정하지 않는다. 선박별 등록 범위와 직접 선택한 날짜/시간은 보존한다. 비교 경계는 10cm 상수다.

## 검증과 재실행

- TypeScript, 일반 테스트 260개, 프로젝트 lint(Oxlint: 기존 경고 11개), 프로덕션 build, verify를 실행한다.
- Firebase 에뮬레이터 테스트 45개: 회원/소유권, 기존 달력/공지/행위허가, 최대 4장과 임의 경로 차단, 정상 저장/교체/삭제, 복구, 원본 코드 보존.
- 패널 브라우저 QA: 320/390/1280px × 사진 0/1/2/4장, 로딩/넘침/메모 건수/확대/스와이프/닫기/상세 전환/다운로드 재사용.
- 전체 지도 QA: Leaflet·Kakao × 320/390/1280px. 갯바위 목록·마커·토글·상세·드래프트 보존과 기존 공간 레이어 정책을 검사한다. Firebase/Kakao SDK는 합성 자료, Leaflet 캔버스는 실제 렌더링을 사용하며 운영 데이터에 쓰지 않는다.
- 이전 React useState 오류는 QA가 앱과 다른 최적화 모듈 인스턴스를 불러온 문제였다. mapWorkspaceFixtures는 앱의 실제 React/ReactDOM/Leaflet URL(캐시 경로/쿼리 포함)을 재사용한다. 별도 Vite 테스트 서버의 cacheDir도 사용자 서버와 분리한다.
- 운영 Firebase 규칙/IAM/CORS 변경과 운영 데이터 쓰기는 배포 전 테스트에 포함하지 않는다.

기본 명령: npm test, npm run lint, npm run build, npm run verify. Firebase 권한 테스트는 Java 21 이상과 Firebase CLI를 준비하고 npm run test:rock-rules를 실행한다. 전체 기존 권한 테스트는 test:rules도 함께 실행한다.

브라우저 QA는 PLAYWRIGHT_MODULE(기존 로컬 Playwright 모듈 경로), CHROME_EXECUTABLE, QA_ORIGIN을 지정해 src/tests/rockDocking.browser.mjs를 실행한다. 패널만 독립 확인할 때는 QA_STATIC=1로 src/tests/rockDockingPanel.browser.mjs를 실행한다. 운영 사용자 세션/브라우저 프로필을 사용하지 않는다.
