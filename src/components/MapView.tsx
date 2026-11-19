import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Eye,
  Layers,
  LocateFixed,
  Maximize,
  Minus,
  Mountain,
  Plus,
  Satellite,
  X,
} from 'lucide-react';
import type { DockingFeature } from '../types/docking';
import type { PorpoiseRecord } from '../types/porpoise';
import type { MarinePort } from '../types/port';
import type { RouteLeg, RouteWaypoint } from '../types/route';
import type { MapLayerConfig } from '../types/config';
import type {
  KakaoBaseMapType,
  KakaoMapTypePreferences,
  KakaoMapsNamespace,
  KakaoOverlayMapType,
  RoadviewTargetLocation,
} from '../types/kakao';
import { loadKakaoMapSdk } from '../services/kakaoMapLoader';
import { KakaoMapCanvas } from './map/KakaoMapCanvas';
import { MapControls } from './map/MapControls';
import { guardMapInteraction, normalizeVisibleMapPreferences, TONGYEONG_GEOJE_OVERVIEW } from './map/mapUiConfig';

const LegacyLeafletCanvas = lazy(() =>
  import('./map/LegacyLeafletCanvas').then((m) => ({
    default: m.LegacyLeafletCanvas,
  })),
);
const Roadview3DModal = lazy(() =>
  import('./map/Roadview3DModal').then((m) => ({
    default: m.Roadview3DModal,
  })),
);

const MAP_TYPE_PREFS_STORAGE_KEY = 'bada_kkomkkomi_map_type_prefs_v1';

const VALID_BASE_MAP_TYPES: KakaoBaseMapType[] = ['roadmap', 'skyview', 'hybrid'];
const VALID_OVERLAY_MAP_TYPES: KakaoOverlayMapType[] = [
  'terrain',
  'use_district',
  'roadview',
  'traffic',
  'bicycle',
];

function loadSavedMapTypePreferences(): KakaoMapTypePreferences {
  if (typeof window === 'undefined') {
    return { baseMapType: 'roadmap', overlayMapTypes: [] };
  }
  try {
    const raw = window.localStorage.getItem(MAP_TYPE_PREFS_STORAGE_KEY);
    if (!raw) return { baseMapType: 'roadmap', overlayMapTypes: [] };
    return normalizeVisibleMapPreferences(JSON.parse(raw));
  } catch {
    return { baseMapType: 'roadmap', overlayMapTypes: [] };
  }
}

interface UserGpsLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  isSimulated?: boolean;
}

export interface MapViewProps {
  permitFocus?: import('../services/activityPermitModel').PermitMapFocus | null;
  onSelectPermit?: (id: string) => void;
  isMapFocused: boolean;
  onMapFocusChange: (focused: boolean) => void;
  activeMainTab: 'notebook' | 'navigation';
  navSubTab: 'route' | 'weather';

  // 3.1 꼬미의 바다수첩
  features: DockingFeature[];
  selectedFeature: DockingFeature | null;
  onSelectFeature: (feature: DockingFeature) => void;
  layers: MapLayerConfig[];
  geoJsonLayersData?: Record<string, any>;
  layerLoadErrorIds?: string[];
  onRetryGeoJsonLayers?: () => void;
  showPorpoiseLayer: boolean;
  isPorpoiseAddMode: boolean;
  isReportPickMode: boolean;
  porpoiseRecords: PorpoiseRecord[];
  onSelectPorpoise: (record: PorpoiseRecord) => void;
  onMapClickForPorpoise: (lat: number, lng: number) => void;
  onMapClickForReport: (lat: number, lng: number) => void;

  // 3.2 바닷길 콕콕 (경로 계산 & 소규모 선착장/항포구 마커)
  routeWaypoints: RouteWaypoint[];
  routeLegs: RouteLeg[];
  portsList?: MarinePort[];
  showPortMarkersOnMap?: boolean;
  selectedLegIndex?: number | null;
  onSelectLeg?: (legIndex: number | null) => void;
  showDirectionArrows?: boolean;
  showLegDurationOnMap?: boolean;
  showLegDistanceOnMap?: boolean;
  routeDistanceUnit?: 'NM' | 'km';
  fitRouteBoundsTrigger?: number;
  candidatePortId?: string | null;
  onSelectRoutePort?: (portId: string) => void;
  onUpdateWaypointPos: (id: string, lat: number, lng: number) => void;
  onRemoveWaypoint?: (id: string) => void;
  onMapClickForRoute: (lat: number, lng: number) => void;

  // 3.2 바닷길 콕콕 (해상기상)
  weatherCoords: { lat: number; lng: number };
  weatherGrade: 'good' | 'moderate' | 'bad' | 'unknown';
  onUpdateWeatherCoords: (lat: number, lng: number) => void;

  // 공통
  userLocation: UserGpsLocation | null;
  onRequestGps: () => void;
  onSimulateFieldGps: () => void;
  flyTarget: { lat: number; lng: number; zoom: number; nonce: number } | null;
  onResetBounds: () => void;
  externalRoadviewTarget?: RoadviewTargetLocation | null;
  onClearExternalRoadviewTarget?: () => void;
}

export function MapView({
  permitFocus,
  onSelectPermit,
  isMapFocused,
  onMapFocusChange,
  activeMainTab,
  navSubTab,
  features,
  selectedFeature,
  onSelectFeature,
  layers,
  geoJsonLayersData: externalGeoJsonLayersData,
  layerLoadErrorIds: externalLayerLoadErrorIds,
  onRetryGeoJsonLayers,
  showPorpoiseLayer,
  isPorpoiseAddMode,
  isReportPickMode,
  porpoiseRecords,
  onSelectPorpoise,
  onMapClickForPorpoise,
  onMapClickForReport,
  routeWaypoints,
  routeLegs,
  portsList = [],
  showPortMarkersOnMap = true,
  selectedLegIndex = null,
  onSelectLeg,
  showDirectionArrows = true,
  showLegDurationOnMap = true,
  showLegDistanceOnMap = true,
  routeDistanceUnit = 'NM',
  fitRouteBoundsTrigger = 0,
  candidatePortId = null,
  onSelectRoutePort,
  onUpdateWaypointPos,
  onRemoveWaypoint,
  onMapClickForRoute,
  weatherCoords,
  weatherGrade,
  onUpdateWeatherCoords,
  userLocation,
  onRequestGps,
  onSimulateFieldGps,
  flyTarget,
  onResetBounds,
  externalRoadviewTarget,
  onClearExternalRoadviewTarget,
}: MapViewProps) {
  const focusedRef = useRef(isMapFocused);
  useLayoutEffect(() => { focusedRef.current = isMapFocused; }, [isMapFocused]);
  const mapActions = useMemo(() => {
    const guard = <Args extends unknown[]>(action: (...args: Args) => void) =>
      guardMapInteraction(() => focusedRef.current, action);
    return {
      onSelectFeature: guard(onSelectFeature),
      onSelectPorpoise: guard(onSelectPorpoise),
      onMapClickForPorpoise: guard(onMapClickForPorpoise),
      onMapClickForReport: guard(onMapClickForReport),
      onSelectLeg: onSelectLeg ? guard(onSelectLeg) : undefined,
      onSelectRoutePort: onSelectRoutePort ? guard(onSelectRoutePort) : undefined,
      onUpdateWaypointPos: guard(onUpdateWaypointPos),
      onRemoveWaypoint: onRemoveWaypoint ? guard(onRemoveWaypoint) : undefined,
      onMapClickForRoute: guard(onMapClickForRoute),
      onUpdateWeatherCoords: guard(onUpdateWeatherCoords),
    };
  }, [onSelectFeature, onSelectPorpoise, onMapClickForPorpoise, onMapClickForReport, onSelectLeg, onSelectRoutePort, onUpdateWaypointPos, onRemoveWaypoint, onMapClickForRoute, onUpdateWeatherCoords]);

  // 1. GIS 엔진 상태 ('kakao' 기본, Kakao SDK 차단/오프라인 시 'leaflet' 자동 폴백) 및 다중 맵/3D 설정
  const [mapPrefs, setMapPrefs] = useState<KakaoMapTypePreferences>(() =>
    loadSavedMapTypePreferences(),
  );
  const [isMapTypePopoverOpen, setIsMapTypePopoverOpen] = useState<boolean>(false);
  const [internalRoadviewTarget, setInternalRoadviewTarget] =
    useState<RoadviewTargetLocation | null>(null);
  const [internalFlyOverride, setInternalFlyOverride] = useState<{
    lat: number;
    lng: number;
    zoom: number;
    nonce: number;
  } | null>(null);

  const visibleMapPrefs = useMemo(() => normalizeVisibleMapPreferences(mapPrefs), [mapPrefs]);
  const baseMapType = visibleMapPrefs.baseMapType;
  const overlayMapTypes = visibleMapPrefs.overlayMapTypes;

  useEffect(() => {
    try {
      window.localStorage.setItem(MAP_TYPE_PREFS_STORAGE_KEY, JSON.stringify(normalizeVisibleMapPreferences(mapPrefs)));
    } catch {
      // ignore storage quota errors
    }
  }, [mapPrefs]);

  const handleSetBaseMapType = useCallback((nextBase: KakaoBaseMapType) => {
    if (!VALID_BASE_MAP_TYPES.includes(nextBase)) return;
    setMapPrefs((prev) => ({
      ...prev,
      baseMapType: nextBase,
    }));
  }, []);

  const handleToggleOverlayMapType = useCallback((key: KakaoOverlayMapType) => {
    if (!VALID_OVERLAY_MAP_TYPES.includes(key)) return;
    setMapPrefs((prev) => {
      const exists = prev.overlayMapTypes.includes(key);
      return {
        ...prev,
        overlayMapTypes: exists
          ? prev.overlayMapTypes.filter((item) => item !== key)
          : [...prev.overlayMapTypes, key],
      };
    });
  }, []);

  const handleApplyMapPreset = useCallback(
    (presetBase: KakaoBaseMapType, presetOverlays: KakaoOverlayMapType[]) => {
      setMapPrefs({
        baseMapType: presetBase,
        overlayMapTypes: presetOverlays,
      });
    },
    [],
  );

  const handleMapClickForRoadview = useCallback((lat: number, lng: number) => {
    setInternalRoadviewTarget({
      lat,
      lng,
      title: `해안·선착장 3D 로드뷰 (${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E)`,
    });
  }, []);

  const activeRoadviewTarget = externalRoadviewTarget ?? internalRoadviewTarget;

  const handleCloseRoadviewModal = useCallback(() => {
    setInternalRoadviewTarget(null);
    if (onClearExternalRoadviewTarget) {
      onClearExternalRoadviewTarget();
    }
  }, [onClearExternalRoadviewTarget]);

  const handleFallbackToSatelliteTerrain = useCallback((lat: number, lng: number) => {
    setMapPrefs((prev) => ({
      baseMapType: 'skyview',
      overlayMapTypes: prev.overlayMapTypes.includes('terrain')
        ? prev.overlayMapTypes.filter((item) => item !== 'roadview')
        : [...prev.overlayMapTypes.filter((item) => item !== 'roadview'), 'terrain'],
    }));
    setInternalFlyOverride({
      lat,
      lng,
      zoom: 16,
      nonce: Date.now(),
    });
  }, []);

  const effectiveFlyTarget = internalFlyOverride && (!flyTarget || internalFlyOverride.nonce >= flyTarget.nonce)
    ? internalFlyOverride : flyTarget;
  const [viewport, setViewport] = useState<{ lat: number; lng: number; zoom: number }>({
    lat: 34.8195,
    lng: 128.552,
    zoom: 11,
  });
  const [kakaoNamespace, setKakaoNamespace] = useState<KakaoMapsNamespace | null>(null);
  const [zoomStepTrigger, setZoomStepTrigger] = useState<{
    delta: number;
    nonce: number;
  } | null>(null);

  // 2. QGIS 공간정보 레이어 GeoJSON 단일 정본(SSOT) 연동 (두 지도 탭 100% 동일한 검증 데이터 보장)
  const geoJsonLayersData = externalGeoJsonLayersData ?? {};
  const layerLoadErrorIds = externalLayerLoadErrorIds ?? [];

  const handleRetryGeoJsonLayers = useCallback(() => {
    if (onRetryGeoJsonLayers) {
      onRetryGeoJsonLayers();
    }
  }, [onRetryGeoJsonLayers]);

  const handleViewportChange = useCallback((lat: number, lng: number, zoom: number) => {
    setViewport({ lat, lng, zoom });
  }, []);

  // Kakao SDK를 한 번 자동 연결하고 실패하면 현재 뷰포트에서 Leaflet으로 전환한다.
  useEffect(() => {
    let active = true;
    loadKakaoMapSdk(false)
      .then((ns) => {
        if (!active) return;
        setKakaoNamespace(ns);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setKakaoNamespace(null);
        console.error('Kakao Maps SDK connection failed; using Leaflet', err);
      });
    return () => { active = false; };
  }, []);

  const focusButtonRef = useRef<HTMLButtonElement | null>(null);
  const mapRegionRef = useRef<HTMLElement | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showFocusExit, setShowFocusExit] = useState(false);
  const revealFocusExit = useCallback(() => {
    if (!isMapFocused) return;
    setShowFocusExit(true);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => setShowFocusExit(false), 3000);
  }, [isMapFocused]);
  const exitFocus = useCallback(() => {
    onMapFocusChange(false);
    requestAnimationFrame(() => focusButtonRef.current?.focus({ preventScroll: true }));
  }, [onMapFocusChange]);
  useEffect(() => {
    if (!isMapFocused) return;
    mapRegionRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); exitFocus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [isMapFocused, exitFocus]);

  const activeEngine: 'kakao' | 'leaflet' =
    kakaoNamespace ? 'kakao' : 'leaflet';

  return (
    <main
      ref={mapRegionRef}
      onPointerUpCapture={revealFocusExit}
      className="bada-map-viewport relative h-dvh w-full"
      tabIndex={0}
      role="region"
      aria-label="통영·거제 해역 인터랙티브 지도"
    >
      {/* 1. 메인 지도 캔버스 (Kakao Map Primary vs Legacy Leaflet Fallback) */}
      {activeEngine === 'kakao' && kakaoNamespace ? (
        <KakaoMapCanvas
          permitFocus={permitFocus}
          onSelectPermit={isMapFocused ? undefined : onSelectPermit}
          kakaoMaps={kakaoNamespace}
          baseMapType={baseMapType}
          overlayMapTypes={overlayMapTypes}
          activeMainTab={activeMainTab}
          navSubTab={navSubTab}
          features={features}
          selectedFeature={selectedFeature}
          onSelectFeature={mapActions.onSelectFeature}
          layers={layers}
          geoJsonLayersData={geoJsonLayersData}
          showPorpoiseLayer={showPorpoiseLayer}
          isPorpoiseAddMode={isPorpoiseAddMode}
          isReportPickMode={isReportPickMode}
          porpoiseRecords={porpoiseRecords}
          onSelectPorpoise={mapActions.onSelectPorpoise}
          onMapClickForPorpoise={mapActions.onMapClickForPorpoise}
          onMapClickForReport={mapActions.onMapClickForReport}
          onMapClickForRoadview={handleMapClickForRoadview}
          routeWaypoints={routeWaypoints}
          routeLegs={routeLegs}
          portsList={portsList}
          showPortMarkersOnMap={showPortMarkersOnMap}
          selectedLegIndex={selectedLegIndex}
          onSelectLeg={mapActions.onSelectLeg}
          showDirectionArrows={showDirectionArrows}
          showLegDurationOnMap={showLegDurationOnMap}
          showLegDistanceOnMap={showLegDistanceOnMap}
          routeDistanceUnit={routeDistanceUnit}
          fitRouteBoundsTrigger={fitRouteBoundsTrigger}
          candidatePortId={candidatePortId}
          onSelectRoutePort={mapActions.onSelectRoutePort}
          onUpdateWaypointPos={mapActions.onUpdateWaypointPos}
          onRemoveWaypoint={mapActions.onRemoveWaypoint}
          onMapClickForRoute={mapActions.onMapClickForRoute}
          weatherCoords={weatherCoords}
          weatherGrade={weatherGrade}
          onUpdateWeatherCoords={mapActions.onUpdateWeatherCoords}
          userLocation={userLocation}
          viewport={viewport}
          onViewportChange={handleViewportChange}

          flyTarget={effectiveFlyTarget}
          zoomStepTrigger={zoomStepTrigger}
          isMapFocused={isMapFocused}
        />
      ) : (
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-[#e0f2fe] text-xs font-bold text-[#003360]">
              해양 보조 지도 엔진 불러오는 중...
            </div>
          }
        >
          <LegacyLeafletCanvas
            permitFocus={permitFocus}
            onSelectPermit={isMapFocused ? undefined : onSelectPermit}
            baseMapType={baseMapType}
            overlayMapTypes={overlayMapTypes}
            activeMainTab={activeMainTab}
            navSubTab={navSubTab}
            features={features}
            selectedFeature={selectedFeature}
            onSelectFeature={mapActions.onSelectFeature}
            layers={layers}
            geoJsonLayersData={geoJsonLayersData}
            showPorpoiseLayer={showPorpoiseLayer}
            isPorpoiseAddMode={isPorpoiseAddMode}
            isReportPickMode={isReportPickMode}
            porpoiseRecords={porpoiseRecords}
            onSelectPorpoise={mapActions.onSelectPorpoise}
            onMapClickForPorpoise={mapActions.onMapClickForPorpoise}
            onMapClickForReport={mapActions.onMapClickForReport}
            routeWaypoints={routeWaypoints}
            routeLegs={routeLegs}
            portsList={portsList}
            showPortMarkersOnMap={showPortMarkersOnMap}
            selectedLegIndex={selectedLegIndex}
            onSelectLeg={mapActions.onSelectLeg}
            showDirectionArrows={showDirectionArrows}
            showLegDurationOnMap={showLegDurationOnMap}
            showLegDistanceOnMap={showLegDistanceOnMap}
            routeDistanceUnit={routeDistanceUnit}
            fitRouteBoundsTrigger={fitRouteBoundsTrigger}
            candidatePortId={candidatePortId}
            onSelectRoutePort={mapActions.onSelectRoutePort}
            onUpdateWaypointPos={mapActions.onUpdateWaypointPos}
            onRemoveWaypoint={mapActions.onRemoveWaypoint}
            onMapClickForRoute={mapActions.onMapClickForRoute}
            weatherCoords={weatherCoords}
            weatherGrade={weatherGrade}
            onUpdateWeatherCoords={mapActions.onUpdateWeatherCoords}
            userLocation={userLocation}
            viewport={viewport}
            onViewportChange={handleViewportChange}

            flyTarget={effectiveFlyTarget}
            zoomStepTrigger={zoomStepTrigger}
            isMapFocused={isMapFocused}
          />
        </Suspense>
      )}

      <div hidden={isMapFocused}>
      {/* 1-B. 공간정보 GeoJSON 레이어 로드 오류 발생 시 재시도 배너 */}
      {layerLoadErrorIds.length > 0 && (
        <div
          role="status"
          className="fixed bottom-24 left-2.5 z-[900] flex items-center gap-2 rounded-xl border border-[#b2415f] bg-rose-50/98 px-3 py-1.5 text-[11px] font-bold text-[#870b41] shadow-lg"
        >
          <span>공간레이어 일부 로드 실패 ({layerLoadErrorIds.length}건)</span>
          <button
            type="button"
            onClick={handleRetryGeoJsonLayers}
            className="rounded-lg bg-[#870b41] px-2 py-0.5 font-black text-white hover:bg-[#b2415f]"
          >
            재시도
          </button>
        </div>
      )}

      <MapControls onGps={onRequestGps} onBackground={() => setIsMapTypePopoverOpen((open) => !open)}
        onOverview={() => setInternalFlyOverride({ ...TONGYEONG_GEOJE_OVERVIEW, nonce: Date.now() })}
        onFocus={() => { setShowFocusExit(false); setIsMapTypePopoverOpen(false); onMapFocusChange(true); }}
        backgroundOpen={isMapTypePopoverOpen} focusButtonRef={focusButtonRef} />
      {/* Retained legacy controls for future recovery; not part of the public map UI. */}
      <div hidden>{/* legacy */}
      {/* 우측 상단(헤더 바로 아래) 도킹형 한 손 컨트롤러 */}
      <div
        className="fixed top-[6.25rem] right-2.5 z-[850] flex flex-col gap-1.5 sm:top-[7.25rem] sm:right-3 sm:gap-2"
        aria-label="지도 확대·축소, 배경지도 및 GPS 위치 컨트롤"
      >
        <button
          type="button"
          onClick={onRequestGps}
          aria-label="내 GPS 위치 찾기"
          title="실제 GPS 위치 조회"
          className={`flex h-9 w-9 items-center justify-center rounded-xl border-2 shadow-xl transition active:scale-95 sm:h-11 sm:w-11 sm:rounded-2xl ${
            userLocation
              ? 'border-[#0284c7] bg-[#0284c7] text-white'
              : 'border-[#00a79d]/60 bg-white/96 text-[#0284c7] hover:bg-sky-50'
          }`}
        >
          <LocateFixed className="h-4 w-4 stroke-[2.4] sm:h-5 sm:w-5" />
        </button>

        {/* 바닷길 콕콕에서는 버튼만 숨김. 내부 핸들러와 바다수첩 버튼은 유지. */}
        {activeMainTab !== 'navigation' && (
        <button
          type="button"
          onClick={onSimulateFieldGps}
          aria-label="통영·거제 해상 선박 GPS 시뮬레이션"
          title="통영·거제 해역 가상 선박 GPS 시뮬레이션"
          className="flex h-9 w-9 flex-col items-center justify-center rounded-xl border-2 border-amber-500 bg-white/96 text-amber-900 shadow-xl transition hover:bg-amber-50 active:scale-95 sm:h-11 sm:w-11 sm:rounded-2xl"
        >
          <Compass className="h-3.5 w-3.5 stroke-[2.3] text-amber-700 sm:h-4 sm:w-4" />
          <span className="text-[8px] leading-none font-black sm:text-[9px]">현장GPS</span>
        </button>
        )}

        <button
          type="button"
          onClick={() => setIsMapTypePopoverOpen((prev) => !prev)}
          aria-label="배경지도 및 3D·중첩 레이어 선택"
          aria-expanded={isMapTypePopoverOpen}
          title="일반/순수위성/하이브리드 및 2.5D 지형·지적편집도·3D 로드뷰 선택"
          className={`relative flex h-9 w-9 flex-col items-center justify-center rounded-xl border-2 shadow-xl transition active:scale-95 sm:h-11 sm:w-11 sm:rounded-2xl ${
            isMapTypePopoverOpen || baseMapType !== 'roadmap' || overlayMapTypes.length > 0
              ? 'border-[#00846c] bg-[#00846c] text-white'
              : 'border-[#00a79d]/60 bg-white/96 text-[#00846c] hover:bg-emerald-50'
          }`}
        >
          <Satellite className="h-3.5 w-3.5 stroke-[2.3] sm:h-4 sm:w-4" />
          <span className="text-[8px] leading-none font-black sm:text-[9px]">
            {baseMapType === 'skyview'
              ? '순수위성'
              : baseMapType === 'hybrid'
                ? '하이브리드'
                : '지도·3D'}
          </span>
          {overlayMapTypes.length > 0 && (
            <span className="absolute -top-1.5 -left-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-amber-400 px-1 text-[9px] font-black text-slate-950 shadow">
              {overlayMapTypes.length}
            </span>
          )}
        </button>

        {/* 바닷길 콕콕에서는 버튼만 숨김. 내부 핸들러와 바다수첩 버튼은 유지. */}
        {activeMainTab !== 'navigation' && (
        <button
          type="button"
          onClick={onResetBounds}
          aria-label="전체 해역 보기"
          title="통영·거제 전체 해역 보기"
          className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-[#00a79d]/60 bg-white/96 text-[#003360] shadow-xl transition hover:bg-sky-50 active:scale-95 sm:h-11 sm:w-11 sm:rounded-2xl"
        >
          <Maximize className="h-4 w-4 stroke-[2.3] sm:h-5 sm:w-5" />
        </button>
        )}

        {activeMainTab !== 'navigation' && (
        <div className="flex flex-col overflow-hidden rounded-xl border-2 border-[#00a79d]/60 bg-white/96 shadow-xl sm:rounded-2xl">
          <button
            type="button"
            onClick={() => setZoomStepTrigger({ delta: 1, nonce: Date.now() })}
            aria-label="지도 확대"
            className="flex h-8 w-9 items-center justify-center border-b border-sky-200 text-[#003360] hover:bg-sky-50 active:bg-sky-100 sm:h-11 sm:w-11"
          >
            <Plus className="h-4 w-4 stroke-[2.6] sm:h-5 sm:w-5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomStepTrigger({ delta: -1, nonce: Date.now() })}
            aria-label="지도 축소"
            className="flex h-8 w-9 items-center justify-center text-[#003360] hover:bg-sky-50 active:bg-sky-100 sm:h-11 sm:w-11"
          >
            <Minus className="h-4 w-4 stroke-[2.6] sm:h-5 sm:w-5" />
          </button>
        </div>
        )}
      </div>

      </div>
      {isMapTypePopoverOpen && <section id="map-background-options" role="dialog" aria-label="배경지도"
        className="fixed top-[6.25rem] right-16 z-[920] w-[min(18rem,calc(100vw-5rem))] rounded-2xl border-2 border-[#00a79d]/70 bg-white p-3 text-[#003360] shadow-xl sm:top-[7.25rem]">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black">배경지도</h2>
          <button type="button" aria-label="배경지도 닫기" title="배경지도 닫기" onClick={() => setIsMapTypePopoverOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl active:bg-sky-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {([{ id: 'roadmap', label: '일반지도' }, { id: 'skyview', label: '순수위성' }, { id: 'hybrid', label: '하이브리드' }] as const).map((item) =>
            <button key={item.id} type="button" aria-pressed={baseMapType === item.id} onClick={() => handleSetBaseMapType(item.id)}
              className={`min-h-11 rounded-xl border px-1 text-xs font-bold active:bg-sky-100 ${baseMapType === item.id ? 'border-[#003360] bg-[#003360] text-white' : 'border-slate-200 bg-white'}`}>{item.label}</button>)}
        </div>
        <h3 className="mt-4 text-xs font-bold">추가 지도</h3>
        <button type="button" role="switch" aria-checked={overlayMapTypes.includes('use_district')} onClick={() => handleToggleOverlayMapType('use_district')}
          className="mt-1 flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 px-3 text-xs font-bold active:bg-sky-50">지적편집도<span>{overlayMapTypes.includes('use_district') ? '켜짐' : '꺼짐'}</span></button>
        <p className="mt-3 text-[10px] leading-relaxed text-slate-600">지도: 카카오맵 / 보조 지도: OpenStreetMap(ODbL)</p>
      </section>}
      <div hidden>
      {/* 3-B. 우측 독에서 펼쳐지는 지도유형 · 2.5D 지형 · 3D 로드뷰 선택 팝오버 카드 */}
      {isMapTypePopoverOpen && (
        <div
          role="dialog"
          aria-label="배경지도 및 2.5D 지형·3D 로드뷰 레이어 설정"
          className="knps-modal-surface fixed top-[6.25rem] right-13 z-[920] w-[17.5rem] rounded-2xl border-2 border-[#00a79d]/70 bg-white/98 p-3 text-[#003360] shadow-2xl backdrop-blur-md sm:top-[7.25rem] sm:right-16 sm:w-80 sm:p-3.5"
        >
          <div className="flex items-center justify-between border-b border-sky-200 pb-2">
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-[#00846c]" />
              <h3 className="text-xs font-black text-[#003360] sm:text-sm">
                배경지도 · 2.5D 지형 · 3D 뷰
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setIsMapTypePopoverOpen(false)}
              aria-label="지도유형 선택창 닫기"
              className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 섹션 1: 현장 실무 원터치 프리셋 */}
          <div className="mt-2.5">
            <p className="text-[10px] font-extrabold text-[#00846c]">
              현장 실무 원터치 프리셋
            </p>
            <div className="mt-1 grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => handleApplyMapPreset('skyview', ['terrain'])}
                className={`rounded-xl border px-1.5 py-1.5 text-[10px] leading-tight font-black transition active:scale-95 ${
                  baseMapType === 'skyview' &&
                  overlayMapTypes.length === 1 &&
                  overlayMapTypes[0] === 'terrain'
                    ? 'border-[#00846c] bg-[#00846c] text-white'
                    : 'border-slate-300 bg-sky-50/70 text-[#003360] hover:bg-emerald-50'
                }`}
              >
                암초·선착장
                <span className="mt-0.5 block text-[9px] font-bold opacity-85">
                  순수위성+2.5D
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleApplyMapPreset('hybrid', ['use_district'])}
                className={`rounded-xl border px-1.5 py-1.5 text-[10px] leading-tight font-black transition active:scale-95 ${
                  baseMapType === 'hybrid' &&
                  overlayMapTypes.length === 1 &&
                  overlayMapTypes[0] === 'use_district'
                    ? 'border-amber-500 bg-amber-400 text-slate-950'
                    : 'border-slate-300 bg-sky-50/70 text-[#003360] hover:bg-amber-50'
                }`}
              >
                관할·지적도
                <span className="mt-0.5 block text-[9px] font-bold opacity-85">
                  하이브리드+지적
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleApplyMapPreset('hybrid', ['roadview'])}
                className={`rounded-xl border px-1.5 py-1.5 text-[10px] leading-tight font-black transition active:scale-95 ${
                  baseMapType === 'hybrid' &&
                  overlayMapTypes.length === 1 &&
                  overlayMapTypes[0] === 'roadview'
                    ? 'border-[#0284c7] bg-[#0284c7] text-white'
                    : 'border-slate-300 bg-sky-50/70 text-[#003360] hover:bg-sky-100'
                }`}
              >
                3D 로드뷰
                <span className="mt-0.5 block text-[9px] font-bold opacity-85">
                  파란선 탭→3D
                </span>
              </button>
            </div>
          </div>

          {/* 섹션 2: 기본 배경지도 (Base MapTypeId 3종) */}
          <div className="mt-2.5">
            <p className="text-[10px] font-extrabold text-[#484843]">
              1. 기본 배경지도 (MapTypeId 베이스 3종)
            </p>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'roadmap', label: '일반지도', desc: 'ROADMAP' },
                  { id: 'skyview', label: '순수위성', desc: '무라벨 원판' },
                  { id: 'hybrid', label: '하이브리드', desc: '위성+지명' },
                ] as const
              ).map((item) => {
                const isSelected = baseMapType === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSetBaseMapType(item.id)}
                    aria-pressed={isSelected}
                    className={`rounded-xl border px-2 py-1.5 text-center transition active:scale-95 ${
                      isSelected
                        ? 'border-[#003360] bg-[#003360] font-black text-white shadow-xs'
                        : 'border-slate-300 bg-white font-bold text-[#003360] hover:bg-sky-50'
                    }`}
                  >
                    <span className="block text-[11px] leading-none font-black">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-[9px] opacity-80">
                      {item.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 섹션 3: 중첩 오버레이 레이어 (Overlay MapTypeId 5종 다중 선택) */}
          <div className="mt-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-extrabold text-[#484843]">
                2. 중첩 레이어 (다중 선택 가능)
              </p>
              {overlayMapTypes.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setMapPrefs((prev) => ({ ...prev, overlayMapTypes: [] }))
                  }
                  className="text-[10px] font-black text-[#b2415f] underline hover:text-[#870b41]"
                >
                  오버레이 모두 끄기
                </button>
              )}
            </div>

            <div className="mt-1 grid grid-cols-2 gap-1">
              {(
                [
                  {
                    id: 'terrain',
                    label: '2.5D 입체지형도',
                    sub: 'TERRAIN · 등고선/음영',
                  },
                  {
                    id: 'use_district',
                    label: '지적편집도',
                    sub: 'USE_DISTRICT · 필지',
                  },
                  {
                    id: 'roadview',
                    label: '3D 로드뷰 구간',
                    sub: 'ROADVIEW · 파란선',
                  },
                  {
                    id: 'traffic',
                    label: '실시간 교통정보',
                    sub: 'TRAFFIC · 소통현황',
                  },
                  {
                    id: 'bicycle',
                    label: '자전거·탐방길',
                    sub:
                      baseMapType === 'roadmap'
                        ? 'BICYCLE · 일반배경'
                        : 'BICYCLE_HYBRID · 위성용',
                  },
                ] as const
              ).map((ovl) => {
                const isChecked = overlayMapTypes.includes(ovl.id);
                return (
                  <button
                    key={ovl.id}
                    type="button"
                    onClick={() => handleToggleOverlayMapType(ovl.id)}
                    aria-pressed={isChecked}
                    className={`flex flex-col items-start rounded-xl border px-2 py-1.5 text-left transition active:scale-95 ${
                      isChecked
                        ? 'border-[#00846c] bg-emerald-50 text-[#00846c] shadow-xs'
                        : 'border-slate-300 bg-white text-[#003360] hover:bg-sky-50'
                    }`}
                  >
                    <span className="flex w-full items-center justify-between text-[11px] font-black">
                      <span>{ovl.label}</span>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isChecked ? 'bg-[#00846c]' : 'bg-slate-300'
                        }`}
                      />
                    </span>
                    <span className="mt-0.5 text-[9px] text-slate-600">
                      {ovl.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 섹션 4: 현재 화면 중심 좌표 360° 3D 현장 로드뷰 바로 실행 */}
          <div className="mt-2.5 border-t border-sky-200 pt-2">
            <button
              type="button"
              onClick={() => {
                setIsMapTypePopoverOpen(false);
                setInternalRoadviewTarget({
                  lat: viewport.lat,
                  lng: viewport.lng,
                  title: `현재 지도 중심 3D 현장뷰 (${viewport.lat.toFixed(4)}°N, ${viewport.lng.toFixed(4)}°E)`,
                });
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#003360] px-3 py-2 text-xs font-black text-white shadow-xs hover:bg-[#0284c7] active:scale-95"
            >
              <Eye className="h-4 w-4 stroke-[2.5]" />
              <span>현재 화면 중심 360° 3D 로드뷰 열기</span>
            </button>
            <p className="mt-2 text-[10px] leading-snug font-semibold text-slate-600">
              지도·위성·3D 로드뷰 원천: <strong className="font-extrabold text-[#003360]">카카오맵</strong> (국토교통부 국토지리정보원 항공·수치지도 기반) / 비상 폴백: OpenStreetMap(ODbL)
            </p>
          </div>
        </div>
      )}

      </div>
      {/* 3-C. 3D 로드뷰 구간(ROADVIEW) 오버레이 활성 시 상단 인터랙션 안내 배너 */}
      {overlayMapTypes.includes('roadview') && (
        <div
          role="status"
          className="fixed inset-x-3 top-[8.6rem] z-[880] mx-auto flex max-w-md items-center justify-between gap-2 rounded-2xl border-2 border-[#0284c7] bg-white/96 px-3 py-2 text-xs text-[#003360] shadow-2xl backdrop-blur-md sm:top-[10.3rem]"
        >
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 shrink-0 text-[#0284c7]" />
            <span className="text-[11px] leading-snug font-extrabold">
              <strong className="text-[#0284c7]">3D 로드뷰 탐색 켜짐:</strong> 파란색 해안도로·선착장 구간을 탭하면 360° 3D 현장뷰가 열립니다.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleToggleOverlayMapType('roadview')}
            className="shrink-0 rounded-lg border border-sky-400 bg-sky-100 px-2 py-1 text-[10px] font-black text-[#003360] active:scale-95"
          >
            로드뷰 선 끄기
          </button>
        </div>
      )}

      {/* 3-D. 지적편집도(USE_DISTRICT) 활성 시 공식 법적 고지 배지 */}
      {overlayMapTypes.includes('use_district') && (
        <div
          role="note"
          className="pointer-events-none fixed bottom-20 left-2.5 z-[840] max-w-xs rounded-xl border border-[#d6c6b2] bg-[#f7f4ee]/96 px-2.5 py-1 text-[10px] leading-tight font-bold text-[#484843] shadow-lg backdrop-blur-sm"
        >
          <Mountain className="mr-1 inline h-3 w-3 text-[#00846c]" />
          지적편집도는 현행 지적 정보와 일치하지 않을 수 있으며 참고 이외의 용도로 사용할 수 없습니다.
        </div>
      )}

      {/* 3-E. 360° 3D 구면 현장 로드뷰 모달 */}
      {!isMapFocused && activeRoadviewTarget && (
        <Suspense fallback={null}>
          <Roadview3DModal
            key={`${activeRoadviewTarget.lat.toFixed(5)}:${activeRoadviewTarget.lng.toFixed(5)}:${activeRoadviewTarget.pointId ?? ''}`}
            kakaoMaps={kakaoNamespace}
            target={activeRoadviewTarget}
            onClose={handleCloseRoadviewModal}
            onFallbackToSatelliteTerrain={handleFallbackToSatelliteTerrain}
          />
        </Suspense>
      )}

      </div>
      {isMapFocused && showFocusExit && <button type="button" onClick={exitFocus}
        onFocus={() => { if (exitTimerRef.current) clearTimeout(exitTimerRef.current); }}
        aria-label="집중 모드 종료" title="집중 모드 종료 (Esc)"
        className="fixed top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-[1200] min-h-11 touch-manipulation rounded-xl border border-slate-200 bg-white/95 px-3 text-xs font-bold text-[#003360] shadow-lg">집중 모드 종료</button>}
    </main>
  );
}
