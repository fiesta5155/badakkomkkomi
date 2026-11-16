# 바다꼼꼬미 (Bada-Kkomkkomi) 바닷길 정박지 UX 및 실항로 우회 곡선(`leg.pathPositions`) 상세 기술 명세서 (`ROUTE_BERTHING_UX_ANALYSIS_REPORT.md`)

- **문서 등급**: 바닷길 시간계산 서브시스템 상세 UX·렌더링 기술 명세서 (Subsystem Detailed Specification)
- **문서 버전**: `v2.4` (`2.4.0` 정합 · 무경계 순차 정박지 UX + 옵션 A `leg.pathPositions` 실항로 우회 곡선 + 초단순 요약 카드 구현 완료본)
- **상위 마스터 정본**: [`docs/ARCHITECTURE_AND_DESIGN.md`](./ARCHITECTURE_AND_DESIGN.md) · [`docs/designs/SITEMAP.md`](./designs/SITEMAP.md)
- **대상 사용자 페르소나**: 국립공원공단 내부 직원 (현장 해상순찰·단속 대원, 해양자원·상괭이 조사원, 공원시설 관리담당자, 행정실무자)

---

## 1. 핵심 아키텍처 결정 요약

1. **무경계 순차 정박지 상태 머신 (`appendSequentialRouteWaypoint` & `resolveSmartWaypoint`)**:
   - 항로 그리기(`isRouteDrawing === true`) 중 지도 위 항구 마커·빈 바다·해안가를 탭하면 **탭한 순서 그대로(`1번째=출발 ➔ 2번째=도착 ➔ 3번째+=경유지 승격 및 도착지 연장`)** 자동 연결됩니다.
   - 실측 해안선 폴리곤(378개) 내부 육지를 잘못 탭하거나 드래그한 경우 `snapLandPointToNearestSea`를 통해 최근접 해안 외측 바다로 자동 보정합니다.
   - `[✅ 도착 완료]` 버튼을 누르면 즉시 `isRouteDrawing = false`, `routeMapTapMode = 'pan_only'`(`이동만`)로 잠겨 화면 이동 중 오터치를 차단합니다.
2. **옵션 A 실항로 우회 곡선(`leg.pathPositions`) 및 50% 호장 중점 배지(`leg.midLat`, `leg.midLng`)**:
   - [`src/services/routeGeoService.ts`](../src/services/routeGeoService.ts)의 378개 실측 해안선 비관통 우회 엔진이 산출한 다중 정점 좌표열(`leg.pathPositions`)을 [`KakaoMapCanvas.tsx`](../src/components/map/KakaoMapCanvas.tsx)와 [`LegacyLeafletCanvas.tsx`](../src/components/map/LegacyLeafletCanvas.tsx) 양쪽에서 3-Tier 폴리라인으로 동일하게 렌더링합니다.
   - 구간 소요시간·해리 캡슐 배지는 단순 산술 평균이 아닌 실제 우회 바닷길 곡선의 50% 누적 거리 중점(`leg.midLat`, `leg.midLng`)에 배치하여 섬 육지 위로 배지가 올라가는 현상을 방지합니다.

---

## 2. 컴포넌트 및 서비스별 구현 명세

### 2.1 [`src/components/map/KakaoMapCanvas.tsx`](../src/components/map/KakaoMapCanvas.tsx) & [`src/components/map/LegacyLeafletCanvas.tsx`](../src/components/map/LegacyLeafletCanvas.tsx)

1. **`leg.pathPositions` 3-Tier 실항로 우회 곡선 렌더링**:
   ```ts
   const rawCoords: [number, number][] =
     leg.pathPositions && leg.pathPositions.length >= 2
       ? leg.pathPositions
       : [
           [leg.from.lat, leg.from.lng],
           [leg.to.lat, leg.to.lng],
         ];
   ```
   - Tier 1(`#020617` 외곽 케이싱) ➔ Tier 2(안전등급 컬러 코어) ➔ Tier 3(내부 방향 점선) 3중 폴리라인으로 위성지도와 일반지도 모두에서 높은 시인성을 보장합니다.
2. **전체항로 보기(`FitBounds`) 우회 정점 포함**:
   - `polylinePositions` 계산 시 `routeLegs`의 모든 `leg.pathPositions` 정점을 포함하여 섬 외곽 우회 곡선이 화면 가장자리에서 잘리지 않도록 여백을 확보합니다.
3. **정박지 마커 60fps 드래그 앤 드롭 (`attachDraggableToCustomOverlay` / `draggable={true}`)**:
   - 모든 정박지 마커(`routeWaypoints`)를 드래그하여 원하는 해역이나 인접 항구로 즉시 이동할 수 있으며, `4px` Deadzone과 `pointercancel` 복구 가드로 모바일 터치 오작동을 방지합니다.

---

### 2.2 [`src/components/navigation/RouteTimeCalculator.tsx`](../src/components/navigation/RouteTimeCalculator.tsx) & [`src/components/navigation/PortSelectModal.tsx`](../src/components/navigation/PortSelectModal.tsx)

1. **기본 진입 화면 (`sheetStage === 'summary'`, `isCollapsed`) — 초심플 요약 카드**:
   - 초기 진입 시 지도를 가리지 않도록 **`전체 예상 소요시간` (`0분` / `거리 · 속력` / `[전체 보기]`) + 하단 1줄 안내 및 `[도착 완료 / + 새 항로]` 바**만 노출합니다.
2. **펼침 화면 (`중간` / `전체`) 무충돌 레이아웃**:
   - **Row 1 (상단 헤더)**: 좌측 `예상 소요시간` + 선속 배지, 우측 `[⛶ 전체항로]` · `[↩ 실행취소]` · `[📋 복사]` · `[⇅ 반전]` · `[요약 | 중간 | 전체 ⌵]` 배치로 `360px` 모바일 폭에서 버튼 겹침을 원천 차단합니다.
   - **Zone 2 (중간 툴바)**: 좌측 `[이동만 | 항로 그리기]` 모드 스위치와 우측 `[👁 선착장(136)]` 토글만 양끝 배치합니다.
   - **공식 항구 명칭 보호**: 비항구 해상 지점(`wp.isCustomCoord === true`)에만 [`getNearbyMarinePlaceLabel`](../src/services/routeGeoService.ts) 기반 인근 해역명(`통영 당동항 보조물양장 인근`)을 표시하고, 공식 항구(`!wp.isCustomCoord`)는 정식 명칭(`삼덕항`)을 그대로 유지합니다.
3. **모달 상단 내 선박 GPS 즉시 설정 ([`PortSelectModal.tsx`](../src/components/navigation/PortSelectModal.tsx))**:
   - **`[📍 내 선박 현재 GPS 위치로 설정 — 즉시 적용]`** 버튼과 **`[거리순 / 항로주변 정렬]`** 칩을 제공하여 바다 위 현재 선박 위치를 원터치로 출발지·도착지·경유지에 주입합니다.

---

## 3. 단위 테스트 및 무결성 검증 계약

- **[`src/tests/coreServices.test.ts`](../src/tests/coreServices.test.ts)**:
  1. 항구 외곽 빈 바다 좌표에 대한 `resolveSmartWaypoint` 생성(`isCustomCoord: true`) 검증
  2. 378개 실측 해안선 폴리곤 내부 육지 좌표 입력 시 `snapLandPointToNearestSea` 자동 해상 투영(`isPointInAnyLandBarrier === false`) 검증
  3. 비항구 정박지 구간 `calculateRouteSummary`의 `leg.pathPositions` 해안선 비관통(`doesSegmentCrossLand === false`) 검증
  4. `appendSequentialRouteWaypoint` 연속 탭 순차 연결(`1 ➔ 2 ➔ 3`) 및 마지막 지점 `type === 'end'` 정규화 검증
- **[`scripts/verify-integrity.mjs`](../scripts/verify-integrity.mjs)**:
  - 초기 빈 경로(`useState<RouteWaypoint[]>([])`), 정박지 선택 서비스 바인딩, `leg.pathPositions` 곡선 렌더링, 요약 카드(`if (isCollapsed)`) 가드를 상시 검증합니다.
