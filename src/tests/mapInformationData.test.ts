import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PortsDataset } from '../types/port';
import { portNamePoints, hazardPointsFromGeoJson, pointsFromGeoJson, referenceLabelIds } from '../components/notebook/mapInformationData.ts';
import { loadMapInformationVisibility, DEFAULT_MAP_INFORMATION_VISIBILITY } from '../components/notebook/mapInformationVisibility.ts';
import { buildReferencePointSpec } from '../components/map/mapMarkerTemplates.ts';
import { PORT_NAME_LOCATION_CORRECTIONS, PORT_NAME_LOCATIONS } from '../data/portNameLocations.ts';
const read = (file: string) => JSON.parse(readFileSync(new URL('../../public/' + file, import.meta.url), 'utf8'));

test('operational docking and independent hazards are empty; archived originals remain available', () => {
  assert.equal(read('data/operational/docking_points.geojson').features.length, 0);
  assert.deepEqual(hazardPointsFromGeoJson(read('data/operational/hazards.geojson')), []);
  assert.equal(read('data/docking_points.geojson').features.length, 55);
  assert.equal(read('data/ports.json').ports.length, 136);
});
test('81 references apply only approved label positions and preserve the routing archive', () => {
  const dataset = read('data/ports.json') as PortsDataset;
  const original = structuredClone(dataset);
  const points = portNamePoints(dataset.ports);
  assert.equal(points.length, 81);
  for (const point of points) {
    const source = dataset.ports.find(port => port.id === point.id)!;
    const position = PORT_NAME_LOCATIONS.get(source.id) ?? { lat: source.lat, lng: source.lng };
    assert.deepEqual(point, { id: source.id, name: source.name, ...position });
    assert.equal(source.category, 'port');
  }
  assert.deepEqual(dataset, original);
});

test('approved label corrections retain provenance and leave unverified names and approaches untouched', () => {
  const dataset = read('data/ports.json') as PortsDataset;
  const points = portNamePoints(dataset.ports);
  assert.deepEqual(points.find(p => p.name === '연대항'), { id: 'KR-GN-TY-0038', name: '연대항', lat: 34.736514, lng: 128.393951 });
  assert.deepEqual(points.find(p => p.name === '학림항'), { id: 'KR-GN-TY-0004', name: '학림항', lat: 34.747986, lng: 128.407247 });
  for (const name of ['만지항', '좌이도선착장']) {
    const original = dataset.ports.find(p => p.name === name)!;
    assert.deepEqual(points.find(p => p.name === name), { id: original.id, name, lat: original.lat, lng: original.lng });
  }
  const approachChanged = dataset.ports.map(p => ({ ...p, seaApproachLat: 0, seaApproachLng: 0 }));
  assert.deepEqual(portNamePoints(approachChanged), points);
  for (const correction of PORT_NAME_LOCATION_CORRECTIONS) {
    assert.ok(correction.source.reference && correction.source.detail && correction.approvedOn);
    assert.ok(Number.isFinite(correction.position.lat) && Math.abs(correction.position.lat) <= 90);
    assert.ok(Number.isFinite(correction.position.lng) && Math.abs(correction.position.lng) <= 180);
  }
});
test('hazard parser accepts independent points and rejects malformed coordinates', () => {
  const fixture = { type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: [128.4, 34.8] }, properties: { id: 'test', name: '테스트 장애물' } }] };
  assert.deepEqual(hazardPointsFromGeoJson(fixture)[0], { id: 'test', name: '테스트 장애물', lng: 128.4, lat: 34.8, description: undefined });
  fixture.features[0].geometry.coordinates = [34.8, 128.4];
  assert.throws(() => hazardPointsFromGeoJson(fixture));
  assert.throws(() => hazardPointsFromGeoJson(null));
});
test('label decluttering changes labels only; both engines share a centered target and escaped names', () => {
  const points = [{ id: 'a', name: 'A', lat: 34.8, lng: 128.4 }, { id: 'b', name: 'B', lat: 34.800001, lng: 128.400001 }];
  const copy = structuredClone(points);
  assert.equal(referenceLabelIds(points, 11).size, 0);
  assert.deepEqual([...referenceLabelIds(points, 12)], ['a']);
  assert.deepEqual(points, copy);
  const spec = buildReferencePointSpec('<script>"', true);
  assert.deepEqual([spec.width, spec.height, spec.anchorX, spec.anchorY, spec.xAnchorRatio, spec.yAnchorRatio], [52, 52, 26, 26, 0.5, 0.5]);
  assert.ok(!spec.html.includes('<script>'));
  assert.match(spec.html, /&lt;script&gt;&quot;/);
});

test('port symbols persist with and without labels; attached tips and hazard marks stay distinct', () => {
  const label = buildReferencePointSpec('만지항', true);
  assert.match(label.html, /data-reference-tip/);
  assert.match(label.html, /data-reference-symbol/);
  const dot = buildReferencePointSpec('만지항', false);
  assert.doesNotMatch(dot.html, /data-reference-label|data-reference-tip/);
  assert.match(dot.html, /border-radius:50%/);
  assert.match(dot.html, /data-reference-symbol/);
  const hazard = buildReferencePointSpec('위험정보', true, true);
  assert.match(hazard.html, /data-reference-point="hazard"/);
  assert.doesNotMatch(hazard.html, /data-reference-tip/);
});

test('154 operational labels keep region counts, zoom threshold and 120 by 36 pixel collision spacing', () => {
  const dataset = JSON.parse(readFileSync(new URL('../../data/public-port-names.final-candidate.geojson', import.meta.url), 'utf8'));
  const points = pointsFromGeoJson(dataset, '항·포구 명칭');
  assert.equal(points.length, 154);
  assert.equal(dataset.features.filter((feature: { properties: { region: string } }) => feature.properties.region === '통영').length, 57);
  assert.equal(dataset.features.filter((feature: { properties: { region: string } }) => feature.properties.region === '거제').length, 97);
  for (const zoom of [11, 12, 13, 14, 15, 16, 18]) {
    const ids = referenceLabelIds(points, zoom);
    if (zoom < 12) { assert.equal(ids.size, 0); continue; }
    const scale = 256 * 2 ** zoom;
    const visible = points.filter(point => ids.has(point.id)).map(point => ({
      x: (point.lng + 180) / 360 * scale,
      y: (0.5 - Math.log((1 + Math.sin(point.lat * Math.PI / 180)) / (1 - Math.sin(point.lat * Math.PI / 180))) / (4 * Math.PI)) * scale,
    }));
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      assert.ok(Math.abs(visible[i].x - visible[j].x) >= 120 || Math.abs(visible[i].y - visible[j].y) >= 36);
    }
  }
});
test('saved false visibility survives new defaults; absent, corrupt and inaccessible preferences are safe', () => {
  for (const value of [null, '{bad', '[]', 'false']) assert.deepEqual(loadMapInformationVisibility({ getItem: () => value }), DEFAULT_MAP_INFORMATION_VISIBILITY);
  assert.deepEqual(loadMapInformationVisibility({ getItem: () => '{"hazard":false,"porpoise":false,"permits":false}' }), { hazard: false, porpoise: false, permits: false, port_names: true });
  assert.deepEqual(loadMapInformationVisibility({ getItem: () => { throw Error('blocked'); } }), DEFAULT_MAP_INFORMATION_VISIBILITY);
});
