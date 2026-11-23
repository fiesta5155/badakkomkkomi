import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MAP_INFORMATION_ORDER, loadMapInformationOrder, MAP_INFORMATION_ORDER_KEY, moveMapInformationItem, normalizeMapInformationOrder } from '../components/notebook/mapInformationOrder.ts';

test('basic map information defaults to the requested six cards, excluding the national park data layer', () => {
  assert.deepEqual(normalizeMapInformationOrder(null), ['docking', 'protected_area', 'hazard', 'port_names', 'permits', 'porpoise']);
  for (const value of [null, {}, '', false, 9, []]) assert.deepEqual(normalizeMapInformationOrder(value), DEFAULT_MAP_INFORMATION_ORDER);
});

test('UI order repairs partial, duplicate and unknown preferences without changing any map data', () => {
  const stored = Object.freeze(['porpoise', 'national_park', 'porpoise', 'docking', 'custom', null]);
  assert.deepEqual(normalizeMapInformationOrder(stored), ['porpoise', 'docking', 'protected_area', 'hazard', 'port_names', 'permits']);
  assert.equal(stored.length, 6);
  assert.deepEqual(loadMapInformationOrder({ getItem: key => {
    assert.equal(key, MAP_INFORMATION_ORDER_KEY);
    return JSON.stringify(stored);
  } }), ['porpoise', 'docking', 'protected_area', 'hazard', 'port_names', 'permits']);
});

test('reordering moves only the UI ID list and persists independently from operational storage', () => {
  const original = Object.freeze([...DEFAULT_MAP_INFORMATION_ORDER]);
  const next = moveMapInformationItem(original, 'hazard', -1);
  assert.deepEqual(next, ['docking', 'hazard', 'protected_area', 'port_names', 'permits', 'porpoise']);
  assert.deepEqual(original, DEFAULT_MAP_INFORMATION_ORDER);
  assert.deepEqual(moveMapInformationItem(original, 'docking', -1), original);
  assert.deepEqual(moveMapInformationItem(original, 'porpoise', 1), original);
  assert.deepEqual(moveMapInformationItem(next, 'hazard', 1), original);
  const values = new Map([[MAP_INFORMATION_ORDER_KEY, JSON.stringify(next)], ['bada_finless_porpoise_records_v1', 'original-records']]);
  assert.deepEqual(loadMapInformationOrder({ getItem: key => values.get(key) ?? null }), next);
  assert.equal(values.get('bada_finless_porpoise_records_v1'), 'original-records');
});

test('missing, malformed and inaccessible UI preference storage use a safe default', () => {
  for (const value of [null, '{bad', '{}', 'false', '123']) {
    assert.deepEqual(loadMapInformationOrder({ getItem: () => value }), DEFAULT_MAP_INFORMATION_ORDER);
  }
  assert.deepEqual(loadMapInformationOrder({ getItem: () => { throw Error('blocked'); } }), DEFAULT_MAP_INFORMATION_ORDER);
});

test('adding port names preserves every previously saved card relation', () => {
  const old = ['porpoise', 'hazard', 'protected_area', 'docking', 'permits'];
  const updated = normalizeMapInformationOrder(old);
  assert.equal(updated.indexOf('port_names'), updated.indexOf('hazard') + 1);
  assert.deepEqual(updated.filter(id => id !== 'port_names'), old);
});
