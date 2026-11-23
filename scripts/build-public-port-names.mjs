import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PORT_NAME_LOCATIONS } from '../src/data/portNameLocations.ts';

const sourceRoot = 'data/sources/port-names/2026-11-20';
const manifest = JSON.parse(readFileSync(sourceRoot + '/manifest.json', 'utf8'));
const cityCodes = { 통영: '48220', 거제: '48310' };
const datasetDate = '2026-11-20';
const cityOf = address => /(?:^|\s)(통영|거제)시(?=\s|$)/.exec(address ?? '')?.[1];
const nameKey = name => name.normalize('NFKC').replace(/\s+/g, '');
const oldPorts = JSON.parse(readFileSync('public/data/ports.json', 'utf8')).ports.filter(p => p.category === 'port');

function sourceBytes(id) {
  const entry = manifest.find(source => source.id === id);
  if (!entry) throw new Error('Missing source ' + id);
  const bytes = readFileSync(entry.file);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Source changed: ' + id);
  return bytes;
}

function readCsv(id, expectedColumns) {
  const input = new TextDecoder('euc-kr', { fatal: true }).decode(sourceBytes(id));
  const rows = input.trimEnd().split(/\r?\n/).map(line => {
    const fields = line.match(/(?:^|,)(?:"(?:[^"]|"")*"|[^,"]*)/g) ?? [];
    if (fields.join('') !== line) throw new Error('Unrecognized CSV row in ' + id);
    return fields.map((field, index) => {
      const value = index === 0 ? field : field.slice(1);
      return value.startsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value;
    });
  });
  const columns = rows.shift();
  if (expectedColumns.some(c => !columns.includes(c))) throw new Error('Unexpected CSV header in ' + id);
  return {
    columns,
    rows: rows.map((values, index) => {
      if (values.length !== columns.length) throw new Error('Unexpected CSV column count in ' + id + ':' + (index + 2));
      return { csvLine: index + 2, ...Object.fromEntries(columns.map((column, i) => [column, values[i]])) };
    }),
  };
}

const application = readCsv('15148195', ['사업년도', '시도시군구코드', '항코드', '위도', '경도', '항명', '항주소', '삭제여부']);
const piers = readCsv('15061884', ['번호', '관리기관', '용도구분', '선착장명', '주소']);
const applicationLocal = application.rows.filter(r => cityOf(r.항주소) || Object.values(cityCodes).includes(r.시도시군구코드));
const pierLocal = piers.rows.filter(r => /통영|거제/.test(r.주소 + ' ' + r.관리기관));
const coordinateStatus = (lat, lng) => {
  if (lat == null || lng == null || lat === '' || lng === '' || (Number(lat) === 0 && Number(lng) === 0)) return 'missing-coordinate';
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || Number(lat) < 34.5 || Number(lat) > 35.15 || Number(lng) < 128 || Number(lng) > 128.85) return 'outside-study-area';
  return 'regional-range-ok';
};
const applications = applicationLocal.map(r => ({
  sourceId: '15148195', row: r.csvLine, code: r.항코드, name: r.항명, address: r.항주소,
  region: cityOf(r.항주소), cityCode: r.시도시군구코드, referenceYear: Number(r.사업년도),
  originalCoordinate: { lat: r.위도, lng: r.경도 },
  verification: r.삭제여부 === 'Y' ? 'deleted' : coordinateStatus(r.위도, r.경도),
  coordinateUse: 'project-application-port',
}));
const officialRows = ['CP', 'NP', 'FP'].flatMap(kind => JSON.parse(sourceBytes('naraport-' + kind)).gisPortListJson.map(r => ({
  id: 'naraport:' + r.FST_SN, name: r.FST_NM?.trim(), address: r.ADRES?.trim(), region: cityOf(r.ADRES),
  cityCode: r.GUGUN_CD, lat: r.LA, lng: r.LO, kind, sourceId: 'naraport-' + kind,
  referenceYear: null, coordinateUse: 'fishing-port-map-point',
  verification: 'source-map-point',
}))).filter(r => r.region || Object.values(cityCodes).includes(r.cityCode));

const accepted = [];
const held = [];
const seen = new Map();
for (const row of officialRows) {
  const status = coordinateStatus(row.lat, row.lng);
  const identity = row.region === undefined || cityCodes[row.region] !== row.cityCode;
  const facility = nameKey(row.name ?? '') + '|' + nameKey(row.address ?? '');
  const reason = identity ? 'city-code-address-conflict'
    : status !== 'regional-range-ok' ? status
      : typeof row.lat !== 'number' || typeof row.lng !== 'number' || !row.name || !row.address ? 'incomplete-source-record'
        : seen.has(row.id) || seen.has(facility) ? 'duplicate-facility' : null;
  if (reason) { held.push({ ...row, verification: reason }); continue; }
  seen.set(row.id, row);
  seen.set(facility, row);
  accepted.push(row);
}

// Crosswalk for comparison only. The candidate dataset is built solely from official records.
const sameFacilityNames = {
  영운항: '영운(이운)항',
  '사량 대항': '대항항(사량도)',
};
const possibleNames = {
  삼덕항: ['당포항'],
  궁항: ['궁항항'],
  좌이도선착장: ['동좌항', '서좌항'],
  '용남 화삼항': ['삼화항'],
  '한산 제승당항': ['소고포항'],
  해금강항: ['갈곶항'],
};
const distanceMeters = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return Math.round(12742000 * Math.asin(Math.sqrt(h)));
};
const locality = address => address?.match(/(?:^|\s)([가-힣]+[읍면동])(?=\s|$)/)?.[1];
const comparison = oldPorts.map(old => {
  const baseName = old.name.split(' ').at(-1);
  const names = [old.name, baseName, sameFacilityNames[old.name]].filter(Boolean).map(nameKey);
  const sourceNames = new Set([...names, ...(possibleNames[old.name] ?? []).map(nameKey)]);
  const options = officialRows.filter(row => sourceNames.has(nameKey(row.name ?? '')));
  const sameCity = options.filter(row => row.region === old.region && accepted.includes(row) && names.includes(nameKey(row.name)));
  const eligible = sameCity.filter(row => {
    const district = locality(row.address);
    // A road-only address is weaker evidence than an explicitly conflicting 읍/면.
    return !district || !old.eupmyeondong || district === old.eupmyeondong ||
      (district.endsWith('동') && old.eupmyeondong.endsWith('동'));
  });
  const localExact = eligible.filter(row => locality(row.address) === old.eupmyeondong);
  const match = (localExact.length === 1 ? localExact[0] : eligible.length === 1 ? eligible[0] : null);
  const projectNames = new Set([...sourceNames, ...(old.name.endsWith('대항') ? ['대항항'] : [])]);
  const projectEvidence = applications.filter(row => row.region === old.region && projectNames.has(nameKey(row.name)));
  const archive = { lat: old.lat, lng: old.lng };
  const currentDisplay = PORT_NAME_LOCATIONS.get(old.id) ?? archive;
  return {
    id: old.id, name: old.name, region: old.region, locality: old.eupmyeondong, archive, currentDisplay,
    status: match ? 'name-region-match' : options.length ? 'identity-review' : projectEvidence.length ? 'official-name-without-position' : 'legacy-only',
    matchId: match?.id ?? null,
    distanceFromArchiveMeters: match ? distanceMeters(archive, match) : null,
    distanceFromCurrentDisplayMeters: match ? distanceMeters(currentDisplay, match) : null,
    alternatives: options.filter(row => row !== match).map(row => ({ id: row.id, name: row.name, address: row.address, region: row.region ?? null, lat: row.lat, lng: row.lng })),
    applicationRows: projectEvidence.map(row => row.row),
  };
});
const matchedIds = new Set(comparison.map(row => row.matchId));
const uncertainIds = new Set(comparison.filter(row => row.status === 'identity-review').flatMap(row => row.alternatives.map(option => option.id)));
const officialComparison = accepted.map(row => ({
  id: row.id, name: row.name, region: row.region, address: row.address,
  status: matchedIds.has(row.id) ? 'matched' : uncertainIds.has(row.id) ? 'identity-review' : 'official-only',
}));

const candidate = {
  type: 'FeatureCollection', datasetDate, status: 'review-candidate',
  coordinateReferenceSystem: 'EPSG:4326', coordinateUse: 'place-name-reference',
  sources: ['CP', 'NP', 'FP'].map(kind => ({
    id: 'naraport-' + kind, provider: '해양수산부', url: 'https://naraport.mof.go.kr/info/port.do',
    retrievedOn: datasetDate, referenceYear: null,
  })),
  features: accepted.map(({ id, lat, lng, ...properties }) => ({
    type: 'Feature', id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties,
  })),
};
const report = {
  datasetDate, largeDifferenceThresholdMeters: 1000,
  sources: {
    '15148195': { columns: application.columns, totalRows: application.rows.length, regionalRows: applications },
    '15061884': { columns: piers.columns, totalRows: piers.rows.length, regionalRows: pierLocal, coordinateColumns: false },
    naraport: { regionalRows: officialRows.length, excluded: held },
  },
  legacy: comparison,
  official: officialComparison,
};
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
writeJson('data/public-port-names.candidate.geojson', candidate);
writeJson('docs/data/public-port-names-comparison.json', report);
console.log({
  candidate: candidate.features.length,
  byRegion: Object.fromEntries([...Map.groupBy(accepted, row => row.region)].map(([key, rows]) => [key, rows.length])),
  legacy: Object.fromEntries([...Map.groupBy(comparison, row => row.status)].map(([key, rows]) => [key, rows.length])),
  official: Object.fromEntries([...Map.groupBy(officialComparison, row => row.status)].map(([key, rows]) => [key, rows.length])),
  held: held.length,
});
