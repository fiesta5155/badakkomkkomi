import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DockingFeatureCollection } from '../types/docking';
import { getNotebookDisplay } from '../components/notebook/notebookPresentation.ts';
import { buildDockingMarkerSpec } from '../components/map/mapMarkerTemplates.ts';

const collection = JSON.parse(readFileSync(new URL('../../public/data/docking_points.geojson', import.meta.url), 'utf8')) as DockingFeatureCollection;

test('independent hazard visibility never filters docking grades or derives hazards from them', () => {
  const records = collection.features, snapshot = structuredClone(records);
  const hazards = [{ id: 'test-obstacle', name: '테스트 장애물', lat: 34.8, lng: 128.4 }];
  assert.equal(getNotebookDisplay(records, true).hazardCount, 0);
  const enabled = getNotebookDisplay(records, true, hazards);
  assert.equal(enabled.visibleFeatures, records);
  assert.equal(enabled.hazardFeatures, hazards);
  assert.equal(enabled.hazardCount, 1);
  const disabled = getNotebookDisplay(records, false, hazards);
  assert.equal(disabled.visibleFeatures, records);
  assert.equal(disabled.hazardCount, 0);
  assert.deepEqual(records, snapshot);
  assert.equal(getNotebookDisplay([], true, hazards).hazardCount, 1);
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
