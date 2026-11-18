import type { WeatherThresholds } from '../types/weather';
import { isLegacyDefaultThresholds, isValidWeatherThresholds } from './ecmwfWeatherService.ts';

export const STORAGE_KEY_THRESHOLDS = 'bada_weather_thresholds_v1';
type ThresholdStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Read both legacy plain values and explicitly saved current criteria. */
export function readSavedUserThresholds(storage?: ThresholdStorage): WeatherThresholds | null {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY_THRESHOLDS);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidWeatherThresholds(parsed)) return null;
    const version = (parsed as WeatherThresholds & { criteriaVersion?: unknown }).criteriaVersion;
    if (version !== 2 && isLegacyDefaultThresholds(parsed)) return null;
    return { windKnot: { ...parsed.windKnot }, waveMeter: { ...parsed.waveMeter } };
  } catch {
    return null;
  }
}

export function saveUserThresholds(storage: ThresholdStorage, thresholds: WeatherThresholds): void {
  if (!isValidWeatherThresholds(thresholds)) throw new Error('유효하지 않은 기상 기준입니다.');
  storage.setItem(STORAGE_KEY_THRESHOLDS, JSON.stringify({ ...thresholds, criteriaVersion: 2 }));
}

export function resetSavedUserThresholds(storage: ThresholdStorage): void {
  storage.removeItem(STORAGE_KEY_THRESHOLDS);
}
