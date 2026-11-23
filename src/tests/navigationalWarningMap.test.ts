import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCoordinates } from '../../scripts/lib/navigational-warnings.mjs';
import { buildWarningMap, warningDmsPairs, warningMapFeatures, warningMapLayer } from '../services/navigationalWarningMap.ts';
import type { WarningSnapshot } from '../services/navigationalWarningService.ts';

const position = '34-48-00N,128-32-00E\n34-48-00N,128-33-00E\n34-49-00N,128-33-00E\n34-49-00N,128-32-00E';
const makeArea = (area = '1', text = position, desc = '해당 지점을 순차 연결한 선내 해역') => ({ raw: { doc_num: 'test-only', area, position: text, position_desc: desc }, coordinates: inspectCoordinates(text) });
const snapshot = (areas = [makeArea()]): WarningSnapshot => ({ lastSuccessfulAt: '2026-11-23T00:00:00Z', coverage: { queryDates: [] }, documents: [{ docNum: 'test-only', issuedAt: null, observations: [{ queryDate: '20261123', raw: { doc_num: 'test-only' } }], areas }] });
test('DMS validates latitude-first axes, ranges, seconds and all coordinate pairs', () => {
  assert.deepEqual(warningDmsPairs('34-00-00N,128-00-00E'), [{ lat: 34, lng: 128 }]);
  assert.deepEqual(warningDmsPairs('34-00-00S,128-00-00W'), [{ lat: -34, lng: -128 }]);
  for (const bad of ['', '128-00-00E,34-00-00N', '34-00-60N,128-00-00E', '90-00-01N,128-00-00E', '34-60-00N,128-00-00E', position + '\n불명확']) assert.equal(warningDmsPairs(bad), null);
});
test('unknown datum or area meaning cannot produce geometry', () => {
  assert.equal(buildWarningMap(snapshot(), null).areas.length, 0);
  assert.equal(buildWarningMap(snapshot(), 'EPSG:5186').areas.length, 0);
  assert.equal(buildWarningMap(snapshot([makeArea('1', position, '구역 의미 미확인')])).areas.length, 0);
});
test('reviewed boundaries preserve order and lng,lat; no original text or collector geometry is changed', () => {
  const input = snapshot(), before = JSON.stringify(input);
  const model = buildWarningMap(input);
  assert.equal(model.areas.length, 1);
  const collection = warningMapFeatures(model.areas);
  assert.equal(collection.features[0].geometry.type, 'Polygon');
  assert.deepEqual(collection.features[0].geometry.coordinates[0][0], [128 + 32 / 60, 34 + 48 / 60]);
  assert.deepEqual(collection.features[0].geometry.coordinates[0].at(-1), collection.features[0].geometry.coordinates[0][0]);
  assert.equal(JSON.stringify(input), before);
});
test('reviewed single positions work; radius areas and multiple positions never collapse into a Point', () => {
  const point = makeArea('2', '34-48-00N,128-32-00E', '단일 위치');
  assert.equal(buildWarningMap(snapshot([point])).areas[0].geometry.type, 'Point');
  assert.equal(buildWarningMap(snapshot([makeArea('1', position, '단일 위치')])).areas.length, 0);
  const radial = makeArea('2', point.raw.position, '좌표를 중심으로 반경 4NM');
  assert.equal(buildWarningMap(snapshot([radial])).omitted[0].reason, 'radius_area_unsupported');
});
test('missing, invalid, mismatched and crossed boundaries are omitted independently', () => {
  const missing = makeArea('2', ''), invalid = makeArea('3', '34-00-70N,128-00-00E');
  const input = snapshot([makeArea(), missing, invalid]);
  assert.equal(buildWarningMap(input).areas.length, 1);
  input.documents[0].areas[0].coordinates!.pairs![0].latitude = 0;
  assert.equal(buildWarningMap(input).areas.length, 0);
  const crossed = makeArea('4', '34-00-00N,128-00-00E\n35-00-00N,129-00-00E\n35-00-00N,128-00-00E\n34-00-00N,129-00-00E');
  assert.equal(buildWarningMap(snapshot([crossed])).omitted[0].reason, 'invalid_polygon');
});
test('existing hazard identity uses a different color from permit yellow; no extra user layer', () => {
  assert.equal(warningMapLayer(false).visible, false);
  assert.equal(warningMapLayer(true).id, 'hazard');
  assert.notEqual(warningMapLayer(true).color, '#eab308');
  assert.equal(buildWarningMap(null).areas.length, 0);
});
