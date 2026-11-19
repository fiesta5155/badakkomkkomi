import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dmsDecimal, permitExpiryDate, permitFeatureCollection, permitInterior, permitLabel, permitLayer, permitSnapshot, permitStatus, validPermitPolygon, validatePermit, type PermitInput } from '../services/activityPermitModel.ts';
import { buildDefaultLayerStyle } from '../types/spatialLayer.ts';
const vertex = (latMinutes: number, lngMinutes: number) => {
  const latDms = { degrees: 34, minutes: latMinutes, seconds: 0, hemisphere: 'N' }, lngDms = { degrees: 128, minutes: lngMinutes, seconds: 0, hemisphere: 'E' };
  return { latDms, lngDms, lat: dmsDecimal(latDms, 'lat'), lng: dmsDecimal(lngDms, 'lng') };
};
const points = [vertex(48, 24), vertex(48, 25), vertex(49, 25), vertex(49, 24)];
const input: PermitInput = { permitNumber: '통영양식 제1531호', target: '미역', sourceCrs: 'EPSG:4326', vertices: points, startDate: '2026-11-01', endDate: '2026-11-30', notes: '' };

test('DMS conversion is explicit, bounded and preserves original numeric DMS', () => {
  assert.equal(dmsDecimal({ degrees: 34, minutes: 30, seconds: 36, hemisphere: 'N' }, 'lat'), 34.51);
  assert.equal(dmsDecimal({ degrees: 128, minutes: 30, seconds: 0, hemisphere: 'W' }, 'lng'), -128.5);
  for (const bad of [{ degrees: 91, minutes: 0, seconds: 0, hemisphere: 'N' }, { degrees: 34, minutes: 60, seconds: 0, hemisphere: 'N' }, { degrees: 34, minutes: 0, seconds: NaN, hemisphere: 'N' }]) assert.throws(() => dmsDecimal(bad, 'lat'));
  assert.throws(() => validatePermit({ ...input, sourceCrs: '' }));
  assert.throws(() => validatePermit({ ...input, sourceCrs: 'EPSG:4162' }));
  assert.doesNotThrow(() => validatePermit(input));
});
test('polygon rejects duplicates, self-intersections, collinear and wrong-coordinate data', () => {
  assert.ok(validPermitPolygon(points));
  assert.equal(validPermitPolygon([points[0], points[2], points[1], points[3]]), false);
  assert.equal(validPermitPolygon([...points.slice(0, 3), points[0]]), false);
  assert.equal(validPermitPolygon([vertex(48,24),vertex(48,25),vertex(48,26),vertex(48,27)]), false);
  assert.equal(validPermitPolygon(points.map((p,i)=>i===0?{...p,lat:35}:p)), false);
  assert.equal(validPermitPolygon(points.slice(0,3)), false);
  assert.equal(validPermitPolygon([vertex(48,24),vertex(48,26),vertex(48,25),vertex(49,25),vertex(49,24)]), false);
});
test('calendar month expiry clamps month ends and uses KST, including leap years and extensions', () => {
  assert.equal(permitExpiryDate('2026-01-31').toISOString(), '2026-02-27T15:00:00.000Z');
  assert.equal(permitExpiryDate('2028-01-31').toISOString(), '2028-02-28T15:00:00.000Z');
  assert.equal(permitExpiryDate('2026-12-31').toISOString(), '2027-01-30T15:00:00.000Z');
  assert.ok(permitExpiryDate('2026-12-20') > permitExpiryDate('2026-11-20'));
  assert.equal(permitStatus(input, '2026-10-31'), '예정');
  assert.equal(permitStatus(input, '2026-11-30'), '조사 가능');
  assert.equal(permitStatus(input, '2026-12-01'), '만료');
});
test('yellow layer only changes polygon colors; WGS84 GeoJSON ring closes and label stays inside', () => {
  const style = buildDefaultLayerStyle('#a855f7', 'protected_area');
  const layer = permitLayer({id:'protected_area',name:'특별보호구역',description:'',visible:true,color:'#a855f7',url:'',style},true);
  assert.equal(layer.style?.strokeDash, style.strokeDash); assert.equal(layer.style?.fillOpacity, style.fillOpacity);
  assert.equal(layer.style?.strokeWidth, style.strokeWidth); assert.equal(layer.style?.strokeColor, '#eab308');
  const fc = permitFeatureCollection([{...input,id:'permit'}]);
  assert.deepEqual(fc.features[0].geometry.coordinates[0][0],[points[0].lng,points[0].lat]);
  assert.deepEqual(fc.features[0].geometry.coordinates[0].at(-1),fc.features[0].geometry.coordinates[0][0]);
  assert.equal(permitLabel(input),'1531-미역');
  const center = permitInterior(points); assert.ok(center.lat > points[0].lat && center.lat < points[2].lat && center.lng > points[0].lng && center.lng < points[2].lng);
  const snapshot = structuredClone(permitSnapshot(input)); input.vertices[0].latDms.seconds = 0;
  assert.equal(snapshot.vertices.length,4);
});
test('detail placement and index-only manifest preserve the manual-deletion policy', () => {
  const calendar = readFileSync('src/components/calendar/CalendarScreen.tsx','utf8');
  assert.ok(calendar.indexOf('<PermitInvestigationSection') > calendar.indexOf('>운항 상태</h3>'));
  assert.ok(calendar.indexOf('<PermitInvestigationSection') < calendar.indexOf('>메모 {day.memos.length'));
  const manifest = JSON.parse(readFileSync('firestore.permits.indexes.json','utf8'));
  assert.deepEqual(manifest.fieldOverrides,[], 'The manual-deletion policy must never enable TTL');
  assert.deepEqual(manifest.indexes,[{collectionGroup:'permitInvestigations',queryScope:'COLLECTION',fields:[{fieldPath:'vessel',order:'ASCENDING'},{fieldPath:'date',order:'ASCENDING'}]}]);
  assert.equal(JSON.parse(readFileSync('firebase.json','utf8')).firestore.indexes,undefined,'App publishing must not implicitly change Firebase indexes or field policies');
});
