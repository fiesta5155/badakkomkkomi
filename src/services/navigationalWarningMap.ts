import { NAV_WARNING_MAP_CRS } from '../config/navigationalWarningMap.ts';
import { dmsDecimal, validSimplePolygon } from './activityPermitModel.ts';
import type { WarningSnapshot } from './navigationalWarningService.ts';
import { buildDefaultLayerStyle, type SpatialFeatureCollection } from '../types/spatialLayer.ts';
import type { MapLayerConfig } from '../types/config.ts';

// Reuse the existing hazard identity; this is not an additional user layer.
export const WARNING_LAYER_ID = 'hazard';
export interface WarningMapArea {
  id: string; docNum: string; area: string;
  vertices: { lat: number; lng: number }[];
  geometry: { type: 'Polygon' | 'Point'; coordinates: number[] | number[][][] };
}
export interface WarningMapFocus { id: string; vertices: { lat: number; lng: number }[]; nonce: number }
export const warningAreaId = (docNum: string, area: string) => JSON.stringify([docNum, area]);

// Intentionally limited to the collector's ordinary latitude,longitude DMS form.
// Recheck its pairs against the original text; never correct or partly accept it.
export function warningDmsPairs(position: string) {
  const pattern = /(\d{1,2})-(\d{1,2})-(\d{1,2}(?:\.\d+)?)([NS])\s*,\s*(\d{1,3})-(\d{1,2})-(\d{1,2}(?:\.\d+)?)([EW])/g;
  const matches = [...position.matchAll(pattern)];
  if (!matches.length || position.replace(pattern, '').trim()) return null;
  try { return matches.map(m => ({
    lat: dmsDecimal({ degrees: +m[1], minutes: +m[2], seconds: +m[3], hemisphere: m[4] }, 'lat'),
    lng: dmsDecimal({ degrees: +m[5], minutes: +m[6], seconds: +m[7], hemisphere: m[8] }, 'lng'),
  })); } catch { return null; }
}
export function buildWarningMap(snapshot: WarningSnapshot | null, crs: string | null = NAV_WARNING_MAP_CRS) {
  const areas: WarningMapArea[] = [];
  const omitted: { docNum: string; area: string; reason: string }[] = [];
  for (const doc of snapshot?.documents ?? []) for (const area of doc.areas) {
    const raw = area.raw;
    const skip = (reason: string) => omitted.push({ docNum: doc.docNum, area: raw.area, reason });
    if (!raw.position?.trim()) { skip('missing_coordinates'); continue; }
    const vertices = warningDmsPairs(raw.position);
    if (!vertices) { skip('invalid_or_unsupported_dms'); continue; }
    const pairs = area.coordinates?.pairs;
    if (!Array.isArray(pairs) || pairs.length !== vertices.length || !vertices.every((p, i) => p.lat === pairs[i]?.latitude && p.lng === pairs[i]?.longitude)) {
      skip('collector_coordinates_mismatch'); continue;
    }
    if (/반경/.test(raw.position_desc ?? '')) { skip('radius_area_unsupported'); continue; }
    if (crs !== 'EPSG:4326') { skip('datum_unverified'); continue; }
    const kind = raw.position_desc === '해당 지점을 순차 연결한 선내 해역' ? 'Polygon'
      : ['단일 위치', '해당 지점', '해당 위치'].includes(raw.position_desc) ? 'Point' : null;
    if (!kind) { skip('area_meaning_unverified'); continue; }
    if (kind === 'Point' && vertices.length !== 1) { skip('not_a_single_position'); continue; }
    const boundary = vertices.length > 1 && vertices[0].lat === vertices.at(-1)!.lat && vertices[0].lng === vertices.at(-1)!.lng ? vertices.slice(0, -1) : vertices;
    if (kind === 'Polygon' && !validSimplePolygon(boundary)) { skip('invalid_polygon'); continue; }
    const coordinates = kind === 'Point' ? [vertices[0].lng, vertices[0].lat]
      : [[...boundary.map(p => [p.lng, p.lat]), [boundary[0].lng, boundary[0].lat]]];
    areas.push({ id: warningAreaId(doc.docNum, raw.area), docNum: doc.docNum, area: raw.area, vertices: boundary, geometry: { type: kind, coordinates } });
  }
  return { areas, omitted };
}
export function warningMapLayer(visible: boolean): MapLayerConfig {
  const color = '#e11d48';
  return { id: WARNING_LAYER_ID, name: '항행경보', description: '구역 경계 또는 단일 위치가 명확한 공식 항행경보', visible, color, url: '',
    // Same short dashes and 3px boundary as permits; lighter fill for overlaps.
    style: { ...buildDefaultLayerStyle(color, 'protected_area', 'name'), strokeColor: color, fillColor: color, fillOpacity: 0.08, showLabels: false } };
}
export function warningMapFeatures(areas: readonly WarningMapArea[]): SpatialFeatureCollection {
  return { type: 'FeatureCollection', features: areas.map(a => ({ type: 'Feature', properties: { warningId: a.id }, geometry: a.geometry })) };
}
