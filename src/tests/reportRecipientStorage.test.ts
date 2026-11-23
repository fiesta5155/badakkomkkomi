import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REPORT_RECIPIENT, REPORT_RECIPIENT_STORAGE_KEY, isValidReportRecipient, loadReportRecipient, saveReportRecipient } from '../services/reportRecipientStorage.ts';

test('recipient persistence, invalid input and reset stay independent of reporter storage', () => {
  const values = new Map<string, string>([['bada_last_reporter_name_v1', '홍길동 / 순찰대']]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    assert.equal(loadReportRecipient(), DEFAULT_REPORT_RECIPIENT);
    assert.equal(saveReportRecipient(' patrol+east@example.org '), true);
    assert.equal(loadReportRecipient(), 'patrol+east@example.org');
    for (const invalid of ['', 'bad', '@example.org', 'a@', 'a@b', 'a b@example.org', 'a@example..org', 'a@-example.org', 'a\n@example.org', '.a@example.org', 'a..b@example.org']) {
      assert.equal(isValidReportRecipient(invalid), false, invalid);
      assert.equal(saveReportRecipient(invalid), false);
      assert.equal(loadReportRecipient(), 'patrol+east@example.org');
    }
    values.set(REPORT_RECIPIENT_STORAGE_KEY, 'invalid@');
    assert.equal(loadReportRecipient(), DEFAULT_REPORT_RECIPIENT);
    assert.equal(saveReportRecipient(DEFAULT_REPORT_RECIPIENT), true);
    assert.equal(values.has(REPORT_RECIPIENT_STORAGE_KEY), false);
    assert.equal(loadReportRecipient(), DEFAULT_REPORT_RECIPIENT);
    assert.equal(values.get('bada_last_reporter_name_v1'), '홍길동 / 순찰대');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage unavailable'); } });
    assert.equal(loadReportRecipient(), DEFAULT_REPORT_RECIPIENT);
    assert.equal(saveReportRecipient('a@example.org'), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
