import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const draft = read('data/public-port-names.candidate.geojson');
const audit = read('docs/data/public-port-names-location-verification.json');
assert.equal(draft.coordinateReferenceSystem, 'EPSG:4326');
assert.equal(draft.coordinateReferenceSystem, audit.coordinateReferenceSystem);

const candidateCases = audit.cases.filter(row => row.scope === 'candidate');
const byId = new Map(candidateCases.map(row => [row.id, row]));
assert.equal(candidateCases.length, 166);
assert.equal(byId.size, 166);
const excludedSource = new Set(audit.cases.filter(row => row.scope === 'excluded-source-row').map(row => row.id));
assert.equal(excludedSource.size, 8);
const selectionCounts = new Map([
  ['일치 확인', 83],
  ['검증 보류', 71],
  ['명칭·중복 확인 필요', 10],
  ['위치 불일치 의심', 2],
]);
const include = new Set(['일치 확인', '검증 보류']);
const seen = new Set();
const facilityKeys = new Set();
const positions = new Set();
const tallies = new Map();
const sources = new Set(draft.sources.map(source => source.id));
const normalize = value => value.normalize('NFKC').replace(/\s+/g, '');

const features = draft.features.flatMap(feature => {
  const { id, properties, geometry } = feature;
  const review = byId.get(id);
  assert.ok(review && !seen.has(id) && !excludedSource.has(id), id);
  seen.add(id);
  assert.ok(review.sourceValuesMatchCandidate && selectionCounts.has(review.status), id);
  tallies.set(review.status, (tallies.get(review.status) ?? 0) + 1);
  assert.equal(properties.name, review.name, id);
  assert.equal(normalize(properties.address), normalize(review.address), id);
  assert.equal(properties.cityCode, review.cityCode, id);
  assert.equal(properties.sourceId, review.sourceId, id);
  assert.ok(sources.has(properties.sourceId), id);
  assert.equal(geometry.type, 'Point', id);
  assert.deepEqual(geometry.coordinates, [review.longitude, review.latitude], id);
  const [lng, lat] = geometry.coordinates;
  assert.ok(Number.isFinite(lng) && lng >= 128 && lng <= 128.85, id);
  assert.ok(Number.isFinite(lat) && lat >= 34.5 && lat <= 35.15, id);
  const region = { '48220': '통영', '48310': '거제' }[properties.cityCode];
  assert.ok(region && properties.region === region && properties.address.includes(region + '시'), id);
  assert.equal(properties.coordinateUse, 'fishing-port-map-point', id);
  if (!include.has(review.status)) return [];

  const facility = normalize(properties.name) + '|' + normalize(properties.address);
  const position = lng + ',' + lat;
  assert.ok(!facilityKeys.has(facility) && !positions.has(position), id);
  facilityKeys.add(facility);
  positions.add(position);
  return [{
    ...feature,
    properties: {
      ...properties,
      sourceVerification: properties.verification,
      verification: review.status,
      verificationDate: audit.reviewDate,
    },
  }];
});
assert.equal(seen.size, byId.size);
assert.deepEqual(tallies, selectionCounts);
assert.equal(features.length, 154);

const result = {
  ...draft,
  status: 'pending-operational-approval',
  verificationDate: audit.reviewDate,
  features,
};
const output = new URL('data/public-port-names.final-candidate.geojson', root);
const serialized = JSON.stringify(result, null, 2) + '\n';
if (process.argv.includes('--check')) {
  assert.equal(readFileSync(output, 'utf8').replace(/\r\n/g, '\n'), serialized, 'Regenerate the final candidate');
} else {
  writeFileSync(output, serialized);
}
for (const [region, rows] of Map.groupBy(features, feature => feature.properties.region)) {
  console.log(region, rows.length, Object.fromEntries(
    [...Map.groupBy(rows, feature => feature.properties.verification)].map(([status, group]) => [status, group.length]),
  ));
}
