/** Geographic references only: no approach coordinates or route-selection metadata. */
export interface ReferenceMapPoint { id: string; name: string; lat: number; lng: number }
export const EMPTY_REFERENCE_POINTS: readonly ReferenceMapPoint[] = [];
export function portNamePointsFromGeoJson(value: unknown): ReferenceMapPoint[] {
  const data = value as { type?: string; features?: { id?: string; geometry?: { type?: string; coordinates?: number[] }; properties?: { id?: string; name?: string } }[] };
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('항·포구 명칭 자료 형식이 올바르지 않습니다.');
  return data.features.map(({ id, geometry, properties }) => {
    const [lng, lat] = geometry?.coordinates ?? [];
    const pointId = properties?.id ?? id;
    if (geometry?.type !== 'Point' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !pointId || !properties?.name) throw new Error('항·포구 명칭 위치가 올바르지 않습니다.');
    return { id: pointId, name: properties.name, lat, lng };
  });
}

/** Declutter in projected pixels without moving a single geographic point. */
export function referenceLabelIds(points: readonly ReferenceMapPoint[], zoom: number): Set<string> {
  const labels = new Set<string>();
  if (zoom < 12) return labels;
  const accepted: { x: number; y: number }[] = [];
  const scale = 256 * 2 ** zoom;
  for (const point of points) {
    const sin = Math.sin(Math.max(-85, Math.min(85, point.lat)) * Math.PI / 180);
    const x = (point.lng + 180) / 360 * scale;
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    if (accepted.some(other => Math.abs(x - other.x) < 120 && Math.abs(y - other.y) < 36)) continue;
    accepted.push({ x, y }); labels.add(point.id);
  }
  return labels;
}
