# 제공된 운영 규칙 기준 행위허가 병합

## 원문과 백업

병합 준비 당시 사용자가 Firebase Console에서 확보하여 제공한 첨부 파일 `Pasted text.txt`를 원문으로 사용했다. 병합 준비 단계에서는 운영 API 조회·게시를 하지 않았다. 이후 승인에 따른 운영 재조회·배포 결과는 아래 배포 기록에 구분해 남겼다.

- 원문 백업: [firestore.production-before-permits.rules](backups/firestore.production-before-permits.rules)
- 원문 크기: 7,568바이트. 첨부와 백업이 바이트 단위로 동일하다.
- SHA-256: `61f0353130be33a5ac8a5665fb89522e8835bdceb19301e2476b841d86e0d622`
- 병합본: [firestore.rules](../firestore.rules)

## 차이와 권한

운영 원문의 마지막 기본 거부 규칙 앞에 행위허가 블록 76줄만 삽입했다. 기존 함수, 컬렉션 규칙, 주석, 기본 거부, 원문 줄바꿈은 보존했다. 병합 블록을 제거하면 원문 백업과 바이트 단위로 일치한다. 신규 블록은 함수 8개와 match 2개이며 기존 `calendarUser()`와 `calendarAdmin()`을 재사용한다.

- `activityPermits/{id}`: 기존 로그인·실명 프로필 조건으로 읽기·등록. 작성자만 수정. 작성자 또는 기존 달력 관리자만 삭제.
- `permitInvestigations/{id}`: 같은 읽기·등록/수정/삭제 정책. 허가 구역 스냅샷 출처와 조사 날짜·선박·상태 검증.
- 작성자 UID·작성자명·생성 시각·조사 일정의 permitId는 수정 허용 필드에서 제외한다. 등록 시 인증 UID와 작성자가 일치해야 한다.
- 기존 저장 형식과의 호환성을 위해 종료일에서 계산한 한 달 뒤 KST 시각과 expiresAt이 정확히 일치해야 한다. 이 메타데이터를 임의 변경하는 요청은 거부한다. TTL은 사용하지 않으며 현재 원본 삭제는 작성자·관리자의 수동 삭제만 허용한다.
- 기존 Google 로그인·실명 조건은 별도의 직원 명부 검증이 아니다. 기하 상세 검증은 클라이언트 저장/읽기에서 수행하며 서버 규칙은 꼭짓점 배열 크기를 제한한다. 이 검증 범위는 기존 로컬 구현과 동일하다.

## 검증 및 적용 경계

`npm test`의 원문 보존 검증, `npm run test:rules`의 기존 프로필·달력·메모·공지·행위허가 회귀 검증, `firebaseProductionMerge.rules.mjs`의 원문 → 병합본 → 백업 복구 시험을 실행한다. 모든 Firestore 시험은 `demo-bada-profile` 로컬 에뮬레이터만 사용한다. 실제 운영 설정은 읽기 전용으로 별도 확인하며 TTL은 활성화하지 않는다.

검증 결과: 단위 테스트 135건, Firebase 에뮬레이터 33건 모두 통과. 제공된 원문에서 실제 목록 쿼리의 `permission-denied`를 재현했고 병합 후 조회·등록 성공 및 백업 복구 후 기존 달력/허가 문서 보존을 확인했다. lint는 오류 없이 기존 경고 11건, build와 verify는 통과했다. 원문 보존/권한 테스트를 추가하고 `package.json`의 `test:rules` 실행 목록에 병합·복구 테스트를 포함했다.

아래는 이미 완료된 2026-11-19 규칙 배포의 명령 기록이다. 현재 GitHub Pages 반영 작업에서는 Firebase 규칙을 재배포하지 않는다. 향후 규칙 변경이 별도 승인되면 당시 최신 운영 원문을 새로 백업·병합·검증해야 한다.

```powershell
firebase deploy --project badakkomkkomi-firebase --only firestore:rules --config firebase.json
```

CLI 배포는 전체 규칙 스냅샷을 교체하므로 원문 보존 검증을 통과한 병합본만 사용한다. 문제 발생 시 Console Rules 편집기에 위 백업 원문 전체를 복원·게시한다. 규칙 복구는 문서를 삭제하지 않으며, 새 권한 아래서 이미 발생한 데이터 변경을 되돌리지는 않는다. 색인·TTL·관리자 문서·앱 코드·Pages는 변경하지 않는다.

## 2026-11-19 승인 후 운영 배포 기록

- CLI 로그인 1개 계정 및 `badakkomkkomi-firebase` 프로젝트 접근 확인.
- 운영 Rules API에서 조회한 기존 원문이 병합 전 백업과 바이트 단위로 동일함을 확인. 배포 명령 직전에 다시 비교하여 동일함을 확인.
- 배포 직전 원문 백업과 릴리스 메타데이터는 로컬 `docs/backups/`에 저장했다. 운영 조회·실행 기록은 Git에 포함하지 않는다. Git에는 위 원문 보존 테스트가 사용하는 규칙 백업만 포함한다.
- 에뮬레이터 권한 테스트 33건, 단위 테스트 135건 재통과 후 Firebase CLI 15.37.0에서 `deploy --project badakkomkkomi-firebase --only firestore:rules --config firebase.json` 실행. 종료 코드 0, JSON status `success` 확인.
- 게시 시각: 2026-11-19 14:44:43 KST. 운영 재조회 시각: 14:45:15 KST.
- 배포 후 활성 Ruleset: `d1ea3b6a-0220-4f0d-a3de-e3fa5f22f093`.
- 게시 원문 SHA-256: `2443231e5f156317e73bc95199c39054c4025e109f4c1cce27eefa1be7ff4614`. 로컬 병합본과 바이트 단위로 일치하며 추가 블록을 제거하면 기존 운영 원문과 동일하다.
- 배포된 원문과 배포·재조회 결과는 로컬 `docs/backups/`에 보관했다.
- 색인·TTL·문서 데이터·Git commit/push·Pages는 변경하지 않았다. 운영 사용자 세션의 실제 목록 조회와 등록·수정·삭제는 이번 배포 기록으로 검증하지 않는다. 테스트 문서도 생성하지 않았다.
