import type { RouteWaypoint } from '../types/route.ts';

type Position = readonly [lng: number, lat: number];
type Polygon = Position[][];
type Point = { x: number; y: number };

export interface RouteIsland {
  id: string;
  name: string;
  polygons: Polygon[];
  bbox: readonly [minLng: number, minLat: number, maxLng: number, maxLat: number];
}

const KM_PER_DEGREE = 111.195;
const MAX_NEARBY_KM = 0.6 * 1.852;
const LAT_PADDING = MAX_NEARBY_KM / KM_PER_DEGREE;
const LNG_PADDING = MAX_NEARBY_KM / (KM_PER_DEGREE * Math.cos((35.1 * Math.PI) / 180));

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('섬 GeoJSON 형식이 올바르지 않습니다.');
  }
  return value as Record<string, unknown>;
}

function readPosition(value: unknown): Position {
  if (!Array.isArray(value) || value.length < 2 ||
    typeof value[0] !== 'number' || typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) || !Number.isFinite(value[1]) ||
    value[0] < 120 || value[0] > 135 || value[1] < 30 || value[1] > 40) {
    throw new Error('섬 GeoJSON의 EPSG:4326 좌표가 올바르지 않습니다.');
  }
  return [value[0], value[1]];
}

function readPolygon(value: unknown): Polygon {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('섬 GeoJSON에 폴리곤 경계가 없습니다.');
  }
  return value.map((rawRing: unknown) => {
    if (!Array.isArray(rawRing) || rawRing.length < 4) {
      throw new Error('섬 GeoJSON의 폴리곤 고리가 올바르지 않습니다.');
    }
    const ring = rawRing.map(readPosition);
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      throw new Error('섬 GeoJSON의 폴리곤 고리가 닫혀 있지 않습니다.');
    }
    return ring;
  });
}

/** WFS islnds_nm과 ag_geom에서 변환된 GeoJSON만 이동경로 후보로 사용한다. */
export function parseRouteIslandGeoJson(input: unknown): RouteIsland[] {
  const collection = asRecord(input);
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) ||
    collection.features.length === 0) {
    throw new Error('섬 GeoJSON FeatureCollection이 비어 있거나 올바르지 않습니다.');
  }

  const islands: RouteIsland[] = [];
  const ids = new Set<string>();
  for (const rawFeature of collection.features) {
    const feature = asRecord(rawFeature);
    const properties = asRecord(feature.properties);
    const name = properties.islnds_nm;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('섬 GeoJSON에 islnds_nm 이름이 없습니다.');
    }
    if (name.trim().startsWith('무명섬')) continue;
    if (typeof feature.id !== 'string' || !feature.id) {
      throw new Error('섬 GeoJSON에 섬 식별자가 없습니다.');
    }
    if (ids.has(feature.id)) continue;

    const geometry = asRecord(feature.geometry);
    const coordinates = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      throw new Error('섬 GeoJSON의 Polygon/MultiPolygon 경계가 없습니다.');
    }
    const polygons = coordinates.map(readPolygon);
    const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          bbox[0] = Math.min(bbox[0], lng);
          bbox[1] = Math.min(bbox[1], lat);
          bbox[2] = Math.max(bbox[2], lng);
          bbox[3] = Math.max(bbox[3], lat);
        }
      }
    }
    ids.add(feature.id);
    islands.push({ id: feature.id, name: name.trim(), polygons, bbox });
  }
  if (islands.length === 0) throw new Error('표시 가능한 섬 경계가 없습니다.');
  return islands;
}

export async function loadRouteIslands(
  url: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<RouteIsland[]> {
  const response = await fetcher(url, { cache: 'no-cache', signal });
  if (!response.ok) throw new Error(`섬 GeoJSON을 불러오지 못했습니다. (HTTP ${response.status})`);
  return parseRouteIslandGeoJson(await response.json());
}

function project(lng: number, lat: number, originLng: number, originLat: number, kmPerLng: number): Point {
  return { x: (lng - originLng) * kmPerLng, y: (lat - originLat) * KM_PER_DEGREE };
}

function pointToSegment(p: Point, a: Point, b: Point): { distance: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return { distance: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
}

function edgeToSegment(a: Point, b: Point, c: Point, d: Point): { distance: number; t: number } {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) > 1e-12) {
    const qx = c.x - a.x;
    const qy = c.y - a.y;
    const t = (qx * sy - qy * sx) / cross;
    const u = (qx * ry - qy * rx) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { distance: 0, t };
  }
  return [
    pointToSegment(c, a, b),
    pointToSegment(d, a, b),
    { ...pointToSegment(a, c, d), t: 0 },
    { ...pointToSegment(b, c, d), t: 1 },
  ].reduce((nearest, current) => current.distance < nearest.distance ? current : nearest);
}

/** 각 직선 구간에서 0.6NM 이내의 가장 가까운 WFS 섬 경계를 고른다. */
export function getRouteIslandNames(waypoints: RouteWaypoint[], islands: readonly RouteIsland[]): string[] {
  if (waypoints.length < 2 || islands.length === 0) return [];
  const names: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const kmPerLng = KM_PER_DEGREE * Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180);
    const a = project(from.lng, from.lat, from.lng, from.lat, kmPerLng);
    const b = project(to.lng, to.lat, from.lng, from.lat, kmPerLng);
    const minLng = Math.min(from.lng, to.lng) - LNG_PADDING;
    const maxLng = Math.max(from.lng, to.lng) + LNG_PADDING;
    const minLat = Math.min(from.lat, to.lat) - LAT_PADDING;
    const maxLat = Math.max(from.lat, to.lat) + LAT_PADDING;
    let closest: { name: string; distance: number; t: number } | null = null;

    for (const island of islands) {
      const [west, south, east, north] = island.bbox;
      if (east < minLng || west > maxLng || north < minLat || south > maxLat) continue;
      let nearest = { distance: Infinity, t: 0 };
      for (const polygon of island.polygons) {
        for (const ring of polygon) {
          let c = project(ring[0][0], ring[0][1], from.lng, from.lat, kmPerLng);
          for (let j = 1; j < ring.length; j++) {
            const d = project(ring[j][0], ring[j][1], from.lng, from.lat, kmPerLng);
            const current = edgeToSegment(a, b, c, d);
            if (current.distance < nearest.distance ||
              (current.distance === nearest.distance && current.t < nearest.t)) nearest = current;
            c = d;
          }
        }
      }
      if (nearest.distance <= MAX_NEARBY_KM &&
        (closest === null || nearest.distance < closest.distance ||
          (nearest.distance === closest.distance && nearest.t < closest.t))) {
        closest = { name: island.name, ...nearest };
      }
    }
    if (closest && !seen.has(closest.name)) {
      names.push(closest.name);
      seen.add(closest.name);
    }
  }
  return names;
}
