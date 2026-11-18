import test from 'node:test';
import assert from 'node:assert/strict';
import { guardMapInteraction, normalizeVisibleMapPreferences, TONGYEONG_GEOJE_OVERVIEW } from '../components/map/mapUiConfig.ts';
import { leafletZoomToKakaoLevel, kakaoLevelToLeafletZoom } from '../services/kakaoMapLoader.ts';

test('overview uses the measured common camera and round-trips through Kakao level conversion', () => {
  assert.deepEqual(TONGYEONG_GEOJE_OVERVIEW, { lat: 34.785221, lng: 128.437964, zoom: 11 });
  assert.equal(leafletZoomToKakaoLevel(TONGYEONG_GEOJE_OVERVIEW.zoom), 8);
  assert.equal(kakaoLevelToLeafletZoom(8), 11);
});

test('legacy hidden overlays are stripped while the selected base and cadastral overlay survive', () => {
  for (const baseMapType of ['roadmap', 'skyview', 'hybrid'] as const) {
    const legacy = { baseMapType, overlayMapTypes: ['terrain', 'roadview', 'traffic', 'bicycle', 'use_district', 'use_district'] };
    const snapshot = structuredClone(legacy);
    assert.deepEqual(normalizeVisibleMapPreferences(legacy), { baseMapType, overlayMapTypes: ['use_district'] });
    assert.deepEqual(legacy, snapshot);
    const cleaned = normalizeVisibleMapPreferences(legacy);
    assert.deepEqual(normalizeVisibleMapPreferences(JSON.parse(JSON.stringify(cleaned))), cleaned);
  }
});

test('missing and malformed preferences default safely with cadastral overlay off', () => {
  for (const value of [null, undefined, {}, [], 'hybrid', { baseMapType: 'terrain', overlayMapTypes: 'use_district' }, { baseMapType: 'roadmap', overlayMapTypes: ['terrain', 'traffic'] }]) {
    assert.deepEqual(normalizeVisibleMapPreferences(value), { baseMapType: 'roadmap', overlayMapTypes: [] });
  }
});

test('focus mode blocks route and field-data mutations and resumes the same draft after exit', () => {
  let focused = false;
  const draft = { points: [[34.7, 128.4]], reports: [] as string[], observations: [] as string[], weather: [34.8, 128.5] };
  const addPoint = guardMapInteraction(() => focused, (lat: number, lng: number) => { draft.points.push([lat, lng]); });
  const movePoint = guardMapInteraction(() => focused, (lat: number, lng: number) => { draft.points[0] = [lat, lng]; });
  const removePoint = guardMapInteraction(() => focused, () => { draft.points.pop(); });
  const report = guardMapInteraction(() => focused, () => { draft.reports.push('report'); });
  const observe = guardMapInteraction(() => focused, () => { draft.observations.push('porpoise'); });
  const weather = guardMapInteraction(() => focused, () => { draft.weather = [35, 129]; });
  const snapshot = structuredClone(draft);
  focused = true;
  for (const click of [() => addPoint(35, 129), () => movePoint(35, 129), removePoint, report, observe, weather]) click();
  assert.deepEqual(draft, snapshot);
  focused = false;
  addPoint(34.9, 128.6);
  movePoint(34.75, 128.45);
  report(); observe(); weather(); removePoint();
  assert.deepEqual(draft, { points: [[34.75, 128.45]], reports: ['report'], observations: ['porpoise'], weather: [35, 129] });
});

test('native overlays retaining an old callback still consult the latest focus state at dispatch', () => {
  let focused = false;
  const calls: string[] = [];
  const retainedCallback = guardMapInteraction(() => focused, (id: string) => { calls.push(id); });
  retainedCallback('before');
  focused = true;
  retainedCallback('blocked-click');
  retainedCallback('blocked-dragend');
  assert.deepEqual(calls, ['before']);
  focused = false;
  retainedCallback('after');
  assert.deepEqual(calls, ['before', 'after']);
});
