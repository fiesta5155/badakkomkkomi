# Google 로그인·실명 등록 1단계 설정

대상 프로젝트 ID는 `badakkomkkomi-firebase`입니다. 기존 Firebase 웹 앱의 `firebaseConfig` 값을 사용합니다. 이 단계는 달력 저장소를 이전하거나 공유하지 않습니다. 로그아웃해도 달력·공간 레이어·개인 설정을 삭제하지 않습니다.

## 로컬 환경변수

프로젝트 루트의 `.env.local`에 기존 웹 앱 값을 입력합니다. 이 파일은 `.gitignore`의 `.env.*`와 `*.local` 규칙으로 Git에서 제외됩니다. 예시 파일은 [`.env.example`](../.env.example)입니다.

| firebaseConfig 필드 | 환경변수 | 필수 여부 |
| --- | --- | --- |
| apiKey | VITE_FIREBASE_API_KEY | 필수 |
| authDomain | VITE_FIREBASE_AUTH_DOMAIN | 필수 |
| projectId | VITE_FIREBASE_PROJECT_ID | 필수: badakkomkkomi-firebase |
| appId | VITE_FIREBASE_APP_ID | 필수 |
| storageBucket | VITE_FIREBASE_STORAGE_BUCKET | 기존 설정에 있을 때 |
| messagingSenderId | VITE_FIREBASE_MESSAGING_SENDER_ID | 기존 설정에 있을 때 |
| measurementId | VITE_FIREBASE_MEASUREMENT_ID | 기존 설정에 있을 때 |

설정값을 추측하거나 새 API 키를 발급할 필요가 없습니다. 빈 값이 있으면 로그인만 비활성화되고 기존 앱 기능은 유지됩니다. Vite는 `.env.local` 변경 시 개발 서버를 다시 시작합니다. 반영되지 않으면 해당 프로젝트의 개발 서버만 재시작하세요.

`VITE_*`는 브라우저 빌드에 포함됩니다. Firebase 웹 설정은 공개 식별 정보이며, 서비스 계정 비공개 키·OAuth 비밀값·인증 토큰을 넣거나 로그에 출력하면 안 됩니다.

## Firebase 콘솔에서 직접 적용할 항목

1. Firebase 콘솔에서 프로젝트 ID `badakkomkkomi-firebase`를 확인합니다. 기존 웹 앱의 설정을 복사하며 새 프로젝트를 만들지 않습니다.
2. Authentication → 로그인 방법 → Google을 활성화하고 지원 이메일을 저장합니다. 다른 로그인 제공자나 직원 승인 명단은 필요하지 않습니다.
3. Authentication → 설정 → 승인된 도메인에 개발용 `localhost`, 실제 GitHub Pages 호스트 `fiesta5155.github.io` 또는 사용하는 운영 호스트를 등록합니다. 프로토콜·포트·경로는 입력하지 않습니다.
4. Firestore Database가 없으면 Standard의 `(default)` DB를 프로덕션 모드로 준비합니다. 신규 생성 시 위치는 먼저 확인하며, 이미 있는 DB를 삭제하거나 다시 만들지 않습니다.
5. Firestore → 규칙에 [`firestore.rules`](../firestore.rules)를 검토해 적용합니다. 이 파일은 본인 `users/{uid}` 프로필만 허용하며 다른 원격 경로를 거부합니다. 기존 DB에서 다른 서비스가 사용 중이면 그 규칙을 백업한 후 본인 프로필 규칙을 병합하세요. 넓은 기존 허용 규칙이 남으면 별도의 거부 규칙으로 상쇄되지 않습니다.
6. 일반 Chrome·Edge에서 로그인 → 실명 등록 → 로그아웃 → 재로그인을 시험합니다. 이름은 `범진`, `승환`처럼 한글 완성형 정확히 두 글자여야 하며 동명이인은 허용됩니다. Google 계정의 표시 이름을 자동 실명으로 저장하지 않습니다.

실명을 실제 신원 정보와 대조하는 인증 절차는 없습니다. 로그인한 본인이 입력하는 이름이며 접근 권한은 이름이 아닌 Firebase UID로 판별합니다. 다른 사람의 프로필 조회·수정, 프로필 목록 조회·삭제는 허용하지 않습니다.

최초 프로필은 서버에서 존재하지 않음을 확인한 뒤 등록합니다. 네트워크·Rules 오류는 이름 미등록으로 간주하지 않습니다. 저장은 트랜잭션의 서버 응답이 성공해야 완료되며 기존 생성시각은 보존됩니다. 프로필 조회 실패 시 홈의 ‘다시 확인’ 또는 로그아웃을 이용할 수 있습니다.

Simple Browser는 로그인 팝업·브라우저 인증 정책 때문에 실패할 수 있으므로 실제 Google 인증은 일반 브라우저에서 시험하세요. 이번 단계에서는 팝업 로그인을 사용하며, 실패 시 무조건 리디렉션으로 바꾸지 않습니다.

## GitHub Pages 빌드 준비

`.env.local`은 Push되지 않습니다. 추후 배포를 승인하기 전에 GitHub 저장소 Settings → Secrets and variables → Actions → Variables에 같은 이름의 `VITE_FIREBASE_*` 값을 등록해야 합니다. 워크플로는 이 변수들을 빌드에 전달합니다. 현재 작업은 GitHub 변수·Firebase 콘솔을 변경하거나 배포하지 않습니다.

## 검증

```text
npm test
npm run lint
npm run build
npm run verify
```

Rules 통합 검사는 Java 21 이상이 있는 개발 환경에서 `npm run test:rules`로 실행합니다. 고정된 Firebase CLI를 임시 실행하며 `firebase.json`의 127.0.0.1:8085와 `demo-bada-profile` 에뮬레이터만 사용합니다. 실제 프로젝트의 데이터나 인증 토큰을 사용하지 않습니다.

Rules 검사는 본인 등록·재조회·이름 변경, 동명이인, 비로그인·타인 접근 거부, 잘못된 이름·UID·권한 필드·시각 위조를 다룹니다. 실제 Google 팝업 인증은 콘솔 설정 완료 후 사용자가 직접 확인해야 합니다.

공식 안내: [Google 로그인](https://firebase.google.com/docs/auth/web/google-signin), [Firestore 필드 검증](https://firebase.google.com/docs/firestore/security/rules-fields), [Rules 테스트](https://firebase.google.com/docs/rules/unit-tests), [Firebase API 키](https://firebase.google.com/docs/projects/api-keys).
