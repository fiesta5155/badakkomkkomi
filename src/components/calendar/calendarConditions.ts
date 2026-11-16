import { buildEcmwfWeatherUrls } from '../../services/ecmwfWeatherService.ts';

export type CalendarRegion = 'tongyeong' | 'geoje';

// Coordinates of Tongyeong and Geoje (Gohyeon) tide-table reference locations.
const REGION_COORDINATES: Record<CalendarRegion, { lat: number; lng: number }> = {
  tongyeong: { lat: 34.8333, lng: 128.4333 },
  geoje: { lat: 34.9, lng: 128.6167 },
};

const EIGHT_TIDE_NAMES = ['8물', '9물', '10물', '11물', '12물', '13물', '14물', '조금', '1물', '2물', '3물', '4물', '5물', '6물', '7물'];

// BadaTime's published South Sea eight-tide table uses the lunar day (1–15, repeated at 16–30).
export function tideNameForDate(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-dangi', { day: 'numeric', timeZone: 'Asia/Seoul' }).formatToParts(date);
    const lunarDay = Number(parts.find((part) => part.type === 'day')?.value);
    return Number.isInteger(lunarDay) && lunarDay >= 1 && lunarDay <= 30
      ? EIGHT_TIDE_NAMES[(lunarDay - 1) % 15]
      : null;
  } catch {
    return null;
  }
}

export function weatherDescription(code: number): string | null {
  if (code === 0 || code === 1) return '맑음';
  if (code === 2) return '구름';
  if (code === 3 || code === 45 || code === 48) return '흐림';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return '비';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '눈';
  return null;
}

export async function fetchCalendarWeather(region: CalendarRegion, signal?: AbortSignal): Promise<Record<string, number>> {
  const { lat, lng } = REGION_COORDINATES[region];
  const { windForecastUrl } = buildEcmwfWeatherUrls(lat, lng);
  const url = new URL(windForecastUrl);
  url.searchParams.delete('hourly');
  url.searchParams.delete('wind_speed_unit');
  url.searchParams.set('daily', 'weather_code');
  url.searchParams.set('forecast_days', '16');
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Calendar weather request failed');
  const payload: unknown = await response.json();
  const daily = (payload as { daily?: { time?: unknown; weather_code?: unknown } })?.daily;
  if (!Array.isArray(daily?.time) || !Array.isArray(daily.weather_code)) throw new Error('Invalid calendar weather response');
  const dates: unknown[] = daily.time;
  const codes: unknown[] = daily.weather_code;
  const result: Record<string, number> = {};
  dates.forEach((day, index) => {
    const code = codes[index];
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && typeof code === 'number' && weatherDescription(code)) result[day] = code;
  });
  return result;
}
