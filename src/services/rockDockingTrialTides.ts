import { tideSeriesBracket, tideSeriesFreshness, validTideSeriesDay } from './khoaTideSeriesSchema.ts';
import type { RockInput } from './rockDockingModel.ts';

export type TrialRockHeights = Partial<Record<RockInput['stationCode'], number>>;
export const ROCK_TRIAL_NOTICE = '예보 조위와 경험상 접안 범위의 참고 비교이며, 실제 접안 가능 여부를 보장하지 않습니다.';

// Trial clock interpretation only. Does not verify the API's time zone or datum,
// change source metadata, or call the officially verified estimateRockTide path.
export function rockTrialDate(now: number) {
  return Number.isFinite(now) ? new Date(now + 9 * 3600000).toISOString().slice(0, 10) : '';
}
export function trialRockTides(day: unknown, now = Date.now()): TrialRockHeights {
  if (!Number.isFinite(now) || !validTideSeriesDay(day, rockTrialDate(now)) || tideSeriesFreshness(day, now).stale) return {};
  const clock = new Date(now + 9 * 3600000);
  const minute = clock.getUTCHours() * 60 + clock.getUTCMinutes() + clock.getUTCSeconds() / 60 + clock.getUTCMilliseconds() / 60000;
  const result: TrialRockHeights = {};
  for (const code of ['DT_0014', 'SO_0552'] as const) {
    const pair = tideSeriesBracket(day, code, minute);
    result[code] = pair.fromCm + (pair.throughCm - pair.fromCm) * (minute - pair.fromMinute) / 5;
  }
  return result;
}
export function trialRockHeight(heights: TrialRockHeights, point: Pick<RockInput, 'stationCode'>): number | null {
  const height = heights[point.stationCode];
  return typeof height === 'number' && Number.isFinite(height) ? height : null;
}
