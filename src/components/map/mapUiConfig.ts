import type { KakaoMapTypePreferences } from '../../types/kakao';

/** User-measured overview; deliberately separate from the initial map camera. */
export const TONGYEONG_GEOJE_OVERVIEW = { lat: 34.785221, lng: 128.437964, zoom: 11 } as const;

export function normalizeVisibleMapPreferences(value: unknown): KakaoMapTypePreferences {
  const saved = value as Partial<KakaoMapTypePreferences> | null;
  const baseMapType = saved?.baseMapType;
  return {
    baseMapType: baseMapType === 'skyview' || baseMapType === 'hybrid' ? baseMapType : 'roadmap',
    overlayMapTypes: Array.isArray(saved?.overlayMapTypes) && saved.overlayMapTypes.includes('use_district') ? ['use_district'] : [],
  };
}

/** Check at dispatch time, including callbacks retained by native map overlays. */
export function guardMapInteraction<Args extends unknown[]>(
  isReadOnly: () => boolean,
  action: (...args: Args) => void,
): (...args: Args) => void {
  return (...args) => { if (!isReadOnly()) action(...args); };
}
