import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPorpoiseLocationPicker, PORPOISE_GPS_TIMEOUT } from '../services/porpoiseLocationPicker.ts';

function setup() {
  const requests: { success: PositionCallback; fail: PositionErrorCallback | null; options: PositionOptions | undefined }[] = [];
  const picks: { point: {lat: number; lng: number}; source: string }[] = [];
  let timeout: (() => void) | undefined;
  let allowed = true;
  const picker = createPorpoiseLocationPicker({
    geolocation: () => ({ getCurrentPosition(success, fail, options) { requests.push({ success, fail: fail ?? null, options }); } }),
    onPick: (point, source) => picks.push({ point, source }),
    isAllowed: () => allowed,
    schedule(callback, ms) { assert.equal(ms, PORPOISE_GPS_TIMEOUT); timeout = callback; return () => { timeout = undefined; }; },
  });
  const position = (lat: number, lng: number) => ({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition);
  return { picker, requests, picks, position, expire: () => timeout?.(), leave: () => { allowed = false; } };
}

test('first press only enables manual selection; a later press obtains fresh GPS without cache', () => {
  const s = setup();
  s.picker.press();
  assert.deepEqual(s.picker.getSnapshot(), { active: true, pending: false });
  assert.equal(s.requests.length, 0);
  s.picker.press();
  assert.deepEqual(s.requests[0].options, { maximumAge: 0, enableHighAccuracy: true, timeout: 10000 });
  assert.deepEqual(s.picker.getSnapshot(), { active: true, pending: true });
  s.requests[0].success(s.position(34.9, 128.6));
  assert.deepEqual(s.picks, [{ point: { lat: 34.9, lng: 128.6 }, source: 'gps' }]);
  assert.deepEqual(s.picker.getSnapshot(), { active: false, pending: false });
});

test('pending clicks cannot start duplicate GPS requests, and a later observation requires a new fix', () => {
  const s = setup();
  for (let i = 0; i < 8; i++) s.picker.press();
  assert.equal(s.requests.length, 1);
  s.requests[0].success(s.position(34.1, 128.1));
  s.picker.press(); s.picker.press();
  assert.equal(s.requests.length, 2);
  s.requests[1].success(s.position(34.2, 128.2));
  assert.equal(s.picks[1].point.lat, 34.2);
});

test('denied/unavailable/timed-out GPS silently keeps manual selection, with no fallback coordinates', () => {
  for (const code of [1, 2, 3]) {
    const s = setup(); s.picker.press(); s.picker.press();
    s.requests[0].fail!({ code } as GeolocationPositionError);
    assert.deepEqual(s.picker.getSnapshot(), { active: true, pending: false });
    assert.equal(s.picks.length, 0);
    s.requests[0].success(s.position(34.5, 128.5)); // late result after failure
    assert.equal(s.picks.length, 0);
    s.picker.select(34.7, 128.7);
    assert.deepEqual(s.picks, [{ point: { lat: 34.7, lng: 128.7 }, source: 'map' }]);
  }
});

test('watchdog handles a provider that never responds and cannot affect a later request', () => {
  const s = setup(); s.picker.press(); s.picker.press(); s.expire();
  assert.deepEqual(s.picker.getSnapshot(), { active: true, pending: false });
  s.picker.press();
  s.requests[0].success(s.position(34, 128));
  s.requests[0].fail!({ code: 3 } as GeolocationPositionError);
  assert.deepEqual(s.picker.getSnapshot(), { active: true, pending: true });
  s.requests[1].success(s.position(35, 129));
  assert.deepEqual(s.picks, [{ point: { lat: 35, lng: 129 }, source: 'gps' }]);
});

test('manual map selection wins while GPS is pending', () => {
  const s = setup(); s.picker.press(); s.picker.press();
  s.picker.select(34.1234567, 128.7654321);
  s.requests[0].success(s.position(35, 129)); s.expire();
  assert.deepEqual(s.picks, [{ point: { lat: 34.1234567, lng: 128.7654321 }, source: 'map' }]);
  assert.equal(s.picker.getSnapshot().active, false);
});

test('mode exit, screen exit and exit/re-entry invalidate late GPS results', () => {
  for (const exit of ['mode', 'screen', 'reentry']) {
    const s = setup(); s.picker.press(); s.picker.press();
    if (exit === 'screen') s.leave(); else s.picker.setActive(false);
    if (exit === 'reentry') s.picker.press();
    s.requests[0].success(s.position(34, 128));
    assert.equal(s.picks.length, 0);
    if (exit === 'reentry') {
      assert.deepEqual(s.picker.getSnapshot(), { active: true, pending: false });
      s.picker.press(); s.requests[1].success(s.position(35, 129)); assert.equal(s.picks.length, 1);
    }
  }
});

test('invalid WGS84 values are ignored, and valid zero coordinates are not fabricated fallback values', () => {
  for (const [lat, lng] of [[NaN, 128], [34, Infinity], [91, 128], [34, 181]]) {
    const s = setup(); s.picker.press(); s.picker.press(); s.requests[0].success(s.position(lat, lng));
    assert.equal(s.picks.length, 0); assert.equal(s.picker.getSnapshot().active, true);
  }
  const s = setup(); s.picker.press(); s.picker.select(NaN, 128); assert.equal(s.picks.length, 0);
  s.picker.select(0, 0); assert.deepEqual(s.picks[0].point, { lat: 0, lng: 0 });
});

test('unsupported or throwing geolocation remains quiet and usable without notifications', () => {
  for (const geolocation of [() => undefined, () => { throw new Error('blocked'); },
    () => ({ getCurrentPosition() { throw new Error('blocked'); } })]) {
    const picker = createPorpoiseLocationPicker({ geolocation, onPick: () => assert.fail('No automatic fallback'), schedule: () => () => {} });
    picker.press(); picker.press();
    assert.deepEqual(picker.getSnapshot(), { active: true, pending: false });
  }
});
