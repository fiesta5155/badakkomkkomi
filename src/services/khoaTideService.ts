import { validTideSnapshot, tideFreshness } from './khoaTideSchema.ts';

// No UI connection in this stage. Freshness is distinct from transport success:
// an offline SW can return an old, validated snapshot with its original timestamp.
export async function fetchKhoaTides(base = import.meta.env.BASE_URL, signal?: AbortSignal) {
  const response = await fetch(`${base}data/tides/latest.json`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('조석예보 파일을 조회하지 못했습니다.');
  const snapshot: unknown = await response.json();
  if (!validTideSnapshot(snapshot)) throw new Error('조석예보 파일 검증에 실패했습니다.');
  return { snapshot, freshness: tideFreshness(snapshot) };
}
