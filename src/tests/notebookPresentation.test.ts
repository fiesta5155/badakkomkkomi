import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DockingFeatureCollection } from '../types/docking';
import { getNotebookDisplay } from '../components/notebook/notebookPresentation.ts';
import { buildDockingMarkerSpec } from '../components/map/mapMarkerTemplates.ts';

const collection = JSON.parse(readFileSync(new URL('../../public/data/docking_points.geojson', import.meta.url), 'utf8')) as DockingFeatureCollection;

test('hazard visibility filters display only and restores the same source records and counts', () => {
  const records = collection.features;
  const snapshot = structuredClone(records);
  const enabled = getNotebookDisplay(records, true);
  assert.equal(enabled.visibleFeatures, records);
  assert.deepEqual(enabled.hazardFeatures.map((feature) => feature.properties.id), records.filter((feature) => feature.properties.color === 'red').map((feature) => feature.properties.id));
  assert.equal(enabled.hazardCount, enabled.hazardFeatures.length);
  const disabled = getNotebookDisplay(records, false);
  assert.equal(disabled.hazardCount, 0);
  assert.equal(disabled.hazardFeatures.length, 0);
  assert.deepEqual(disabled.visibleFeatures, records.filter((feature) => feature.properties.color !== 'red'));
  assert.deepEqual(records, snapshot);
  assert.equal(getNotebookDisplay(records, true).visibleFeatures, records);
  for (const feature of disabled.visibleFeatures) assert.ok(records.includes(feature));
});

test('existing color, region and search results survive hazard OFF and ON unchanged', () => {
  const filtered = collection.features.filter((feature) => ['red', 'green'].includes(feature.properties.color)).slice(0, 7);
  const snapshot = structuredClone(filtered);
  getNotebookDisplay(filtered, false);
  assert.deepEqual(filtered, snapshot);
  assert.equal(getNotebookDisplay(filtered, true).visibleFeatures, filtered);
  assert.equal(getNotebookDisplay([], true).hazardCount, 0);
  assert.deepEqual(getNotebookDisplay([], false).visibleFeatures, []);
});

test('hazard markers hide code badges while retaining their pin, warning and geographic anchor', () => {
  for (const selected of [false, true]) {
    const hazard = buildDockingMarkerSpec('red', 'KR-GN-TY-BERTH-0017', selected);
    const standard = buildDockingMarkerSpec('green', 'TY-001', selected);
    assert.match(hazard.html, /data-docking-code[^>]*visibility: hidden/s);
    assert.match(hazard.html, /aria-hidden="true"/);
    assert.match(standard.html, /data-docking-code[^>]*visibility: visible/s);
    assert.match(hazard.html, /<svg width="44" height="44"/);
    assert.match(hazard.html, /fill="#ef4444"/);
    assert.deepEqual([hazard.width, hazard.height, hazard.anchorX, hazard.anchorY, hazard.xAnchorRatio, hazard.yAnchorRatio], [52, 58, 26, 54, 0.5, 54 / 58]);
  }
});
