import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateWarningPair } from './prepare-navigational-warnings.mjs';

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file); else files.push(file);
  }
}
assert.ok(fs.existsSync('dist/index.html'), 'Build dist before checking preview exclusion.');
walk('dist');
const markers = ['bada-nav-warning-preview', 'navWarningPreview', '__dev/data/navigational-warnings', '과거 수집 자료 · 개발용 미리보기'];
const capture = '.dev/fixtures/navigational-warnings/latest.json';
const fixture = fs.existsSync(capture) ? JSON.parse(fs.readFileSync(capture, 'utf8')) : null;
const titles = fixture?.documents.map(d => d.observations[0].raw.title).filter(title => title.length > 10) ?? [];
const operational = new Set(['latest.json', 'status.json'].map(name => path.resolve('dist/data/navigational-warnings', name)));
for (const file of files) {
  assert.ok(!/(?:^|[/\\])(?:__dev|fixtures|\.dev)(?:[/\\])/.test(file), 'Development fixture directory found in dist.');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(markers.every(marker => !text.includes(marker)), `Preview switch found in ${file}`);
  // A genuine published collection may overlap the historical preview's warnings.
  // Only the exact, validated operational pair may contain those titles.
  if (!operational.has(path.resolve(file))) assert.ok(titles.every(title => !text.includes(title)), `Historical preview payload found in ${file}`);
}
for (const name of ['latest.json', 'status.json']) {
  assert.deepEqual(JSON.parse(fs.readFileSync(`dist/data/navigational-warnings/${name}`, 'utf8')),
    JSON.parse(fs.readFileSync(`public/data/navigational-warnings/${name}`, 'utf8')), 'Build must retain operational JSON.');
}
const pair = validateWarningPair(fs.readFileSync('dist/data/navigational-warnings/latest.json', 'utf8'), fs.readFileSync('dist/data/navigational-warnings/status.json', 'utf8'));
assert.ok(pair.snapshot.lastSuccessfulAt === null || pair.status.publication, 'Collected operational data must pass the publication preparation step.');
console.log('Preview excluded from production: no switch, dev route, banner or preview payload in app assets; operational JSON matches verified source.');
