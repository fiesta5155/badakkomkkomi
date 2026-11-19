import { koreaToday, validCalendarDate, type EntryTimestamp } from './sharedCalendarModel.ts';
import { buildDefaultLayerStyle } from '../types/spatialLayer.ts';
import type { MapLayerConfig } from '../types/config.ts';

export const PERMIT_LAYER_ID = 'activity_permits';
export const MAX_PERMIT_SELECTION = 5;
export const PERMIT_POINT_LABELS = [...'가나다라마바사아자차카타파하거너더러머버'];
export interface Dms { degrees: number; minutes: number; seconds: number; hemisphere: string }
export interface PermitVertex { latDms: Dms; lngDms: Dms; lat: number; lng: number }
export interface PermitInput { permitNumber: string; target: string; sourceCrs: string; vertices: PermitVertex[]; startDate: string; endDate: string; notes: string }
export interface ActivityPermit extends PermitInput {
  id: string; schemaVersion: 1; authorUid: string; authorName: string; createdAt: EntryTimestamp; updatedAt: EntryTimestamp; revision: number; expiresAt: EntryTimestamp;
}
export type PermitSnapshot = Pick<PermitInput, 'permitNumber' | 'target' | 'sourceCrs' | 'vertices' | 'startDate' | 'endDate'>;
export interface PermitInvestigation {
  id: string; schemaVersion: 1; permitId: string; permitSnapshot: PermitSnapshot;
  date: string; vessel: '101' | '103'; status: 'planned' | 'completed';
  authorUid: string; authorName: string; createdAt: EntryTimestamp; updatedAt: EntryTimestamp; revision: number;
}
export interface PermitMapFocus { vertices: PermitVertex[]; nonce: number }
export function dmsDecimal(dms: Dms, axis: 'lat' | 'lng') {
  const max = axis === 'lat' ? 90 : 180;
  if (!dms || !Number.isInteger(dms.degrees) || dms.degrees < 0 || dms.degrees > max
    || !Number.isInteger(dms.minutes) || dms.minutes < 0 || dms.minutes >= 60
    || !Number.isFinite(dms.seconds) || dms.seconds < 0 || dms.seconds >= 60
    || !(axis === 'lat' ? ['N', 'S'] : ['E', 'W']).includes(dms.hemisphere)
    || (dms.degrees === max && (dms.minutes !== 0 || dms.seconds !== 0))) throw new Error('도·분·초와 방위를 확인해 주세요.');
  return (dms.degrees + dms.minutes / 60 + dms.seconds / 3600) * (['S', 'W'].includes(dms.hemisphere) ? -1 : 1);
}
type XY = { lat: number; lng: number };
function cross(a: XY, b: XY, c: XY) { return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng); }
function onSegment(a: XY, b: XY, c: XY) {
  return Math.abs(cross(a, b, c)) < 1e-12 && c.lng >= Math.min(a.lng, b.lng) - 1e-12 && c.lng <= Math.max(a.lng, b.lng) + 1e-12
    && c.lat >= Math.min(a.lat, b.lat) - 1e-12 && c.lat <= Math.max(a.lat, b.lat) + 1e-12;
}
function intersects(a: XY, b: XY, c: XY, d: XY) {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
export function validPermitPolygon(vertices: PermitVertex[]) {
  if (!Array.isArray(vertices) || vertices.length < 4 || vertices.length > PERMIT_POINT_LABELS.length) return false;
  try { for (const p of vertices) if (!p || p.lat !== dmsDecimal(p.latDms, 'lat') || p.lng !== dmsDecimal(p.lngDms, 'lng')) return false; }
  catch { return false; }
  if (new Set(vertices.map(p => `${p.lng},${p.lat}`)).size !== vertices.length) return false;
  if (Math.max(...vertices.map(p => p.lng)) - Math.min(...vertices.map(p => p.lng)) > 180) return false;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    if (onSegment(a, b, c) || onSegment(b, c, a)) return false;
    area += (a.lng - vertices[0].lng) * (b.lat - vertices[0].lat) - (b.lng - vertices[0].lng) * (a.lat - vertices[0].lat);
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      if (intersects(a, b, vertices[j], vertices[(j + 1) % vertices.length])) return false;
    }
  }
  return Math.abs(area) > 1e-12;
}
export function permitExpiryDate(endDate: string) {
  if (!validCalendarDate(endDate)) throw new Error('종료일을 확인해 주세요.');
  const [y, m, d] = endDate.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0));
  const day = new Date(Date.UTC(y, m, Math.min(d, last.getUTCDate()))).toISOString().slice(0, 10);
  if (!validCalendarDate(day)) throw new Error('지원하지 않는 종료일입니다.');
  return new Date(`${day}T00:00:00+09:00`);
}
export function validatePermit(input: PermitInput) {
  if (input.sourceCrs !== 'EPSG:4326') throw new Error('원본 좌표계가 WGS84인지 확인한 뒤 선택해 주세요. 다른 좌표계는 원본 확인·변환이 필요합니다.');
  if (!input.permitNumber.trim() || input.permitNumber.trim().length > 120 || !input.target.trim() || input.target.trim().length > 80 || input.notes.length > 2000) throw new Error('허가번호·조사 대상·비고를 확인해 주세요.');
  if (!validCalendarDate(input.startDate) || !validCalendarDate(input.endDate) || input.startDate > input.endDate) throw new Error('조사 가능 기간을 확인해 주세요.');
  if (!validPermitPolygon(input.vertices)) throw new Error('서로 다른 4~20개 지점을 경계 순서대로 입력해 주세요. 교차하거나 면적이 없는 다각형은 저장할 수 없습니다.');
  permitExpiryDate(input.endDate);
}
export function permitStatus(p: Pick<PermitInput, 'startDate' | 'endDate'>, today = koreaToday()) { return today < p.startDate ? '예정' : today > p.endDate ? '만료' : '조사 가능'; }
export function permitLabel(p: Pick<PermitInput, 'permitNumber' | 'target'>) { return `${p.permitNumber.match(/\d+/g)?.join('') || p.permitNumber}-${p.target}`; }
export function permitSnapshot(p: PermitInput): PermitSnapshot { return { permitNumber: p.permitNumber, target: p.target, sourceCrs: p.sourceCrs, vertices: p.vertices, startDate: p.startDate, endDate: p.endDate }; }
export function permitInterior(vertices: XY[]): XY {
  const min = Math.min(...vertices.map(p => p.lat)), max = Math.max(...vertices.map(p => p.lat));
  let best = { lat: vertices[0].lat, lng: vertices[0].lng }, width = -1;
  for (const fraction of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875]) {
    const lat = min + (max - min) * fraction, crossings: number[] = [];
    vertices.forEach((a, i) => { const b = vertices[(i + 1) % vertices.length]; if ((a.lat > lat) !== (b.lat > lat)) crossings.push(a.lng + (lat - a.lat) * (b.lng - a.lng) / (b.lat - a.lat)); });
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) if (crossings[i + 1] - crossings[i] > width) {
      width = crossings[i + 1] - crossings[i]; best = { lat, lng: (crossings[i] + crossings[i + 1]) / 2 };
    }
  }
  return best;
}
export function permitLayer(template: MapLayerConfig | undefined, visible: boolean): MapLayerConfig {
  const color = '#eab308';
  return { id: PERMIT_LAYER_ID, name: '행위허가', description: '로그인 직원 공유 행위허가 조사구역', visible, color, url: '',
    style: { ...(template?.style ?? buildDefaultLayerStyle(color, 'protected_area', 'name')), strokeColor: color, fillColor: color, labelField: 'name', showLabels: true } };
}
export function permitFeatureCollection(records: (PermitSnapshot & { id: string })[]) {
  return { type: 'FeatureCollection' as const, features: records.map(p => ({ type: 'Feature' as const,
    properties: { name: permitLabel(p), permitId: p.id, labelPoint: permitInterior(p.vertices) },
    geometry: { type: 'Polygon' as const, coordinates: [[...p.vertices.map(v => [v.lng, v.lat]), [p.vertices[0].lng, p.vertices[0].lat]]] },
  })) };
}
