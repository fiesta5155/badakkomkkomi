import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmailReportPayload, sendFieldReport } from '../services/emailReportService.ts';

const config = { report_recipient_email: 'patrol+east@example.org', report_cc_email: 'cc@example.org', department_name: '순찰대' };
const report = { pointId: 'QA-1', pointName: '제보 위치', lat: 34.8195123, lng: 128.5520456,
  reporterName: '홍길동 / 순찰대', memo: '  허가 여부 확인 & 검토 + 50%\r\n현장 사진 📷  ', photos: [], createdAt: '2026-11-20T22:51:00.000Z' };

test('output uses the Korean report date and minute, including midnight, year and leap-day boundaries', () => {
  for (const [createdAt, date, time] of [
    ['2026-11-20T22:51:00.000Z', '2026.11.21.', '07:51'],
    ['2026-11-21T14:59:00.000Z', '2026.11.21.', '23:59'],
    ['2026-11-21T15:00:00.000Z', '2026.11.22.', '00:00'],
    ['2026-12-31T15:00:00.000Z', '2027.01.01.', '00:00'],
    ['2024-02-28T15:00:00.000Z', '2024.02.29.', '00:00'],
    ['2026-11-21T07:51:00+09:00', '2026.11.21.', '07:51'],
  ]) {
    const data = { ...report, createdAt }, before = structuredClone(data);
    const payload = buildEmailReportPayload(data, config);
    assert.equal(payload.subject, `[바다꼼꼬미] 현장제보 (${date})`);
    assert.ok(payload.body.includes(`제보 일시: ${date} ${time}`));
    assert.deepEqual(data, before);
  }
});

test('plain-text sections preserve the original memo and full link coordinate precision', () => {
  const { body } = buildEmailReportPayload(report, config);
  assert.equal(body, `현장제보 내용
제보 대상: [QA-1] 제보 위치
제보 일시: 2026.11.21. 07:51
제보자: 홍길동 / 순찰대
GPS 좌표: 34.81951°N, 128.55205°E

현장 내용
${report.memo}

위치 확인
네이버 지도 바로가기:
https://map.naver.com/v5/?c=128.5520456,34.8195123,15,0,0,0,dh
구글 지도 바로가기:
https://www.google.com/maps/search/?api=1&query=34.8195123,128.5520456`);
  const urls = body.split('\n').filter(line => line.startsWith('https://')).map(line => new URL(line));
  assert.equal(urls[0].searchParams.get('c'), `${report.lng},${report.lat},15,0,0,0,dh`);
  assert.equal(urls[1].searchParams.get('query'), `${report.lat},${report.lng}`);
  assert.ok(!body.includes('PWA'));
  assert.ok(!body.includes('첨부사진'));
  assert.ok(!body.includes('-----'));
  assert.ok(!body.includes('<a'));
  const unnamed = buildEmailReportPayload({ ...report, pointName: undefined, reporterName: undefined }, config);
  assert.ok(unnamed.body.includes('제보 대상: 해상 일반 지점'));
  assert.ok(unnamed.body.includes('제보자: 현장 점검 요원'));
});

test('mailto keeps recipient, cc, title, memo, reporter and map links without claiming delivery', async () => {
  const data = { pointId: 'QA-1', pointName: '제보 위치', lat: 34.8195, lng: 128.552,
    reporterName: '홍길동 / 순찰대', memo: '현장 확인 & 허가 검토\n추가 내용', photos: [], createdAt: '2026-11-21T01:00:00.000Z' };
  const config = { report_recipient_email: 'patrol+east@example.org', report_cc_email: 'cc@example.org', department_name: '순찰대' };
  const snapshot = structuredClone(data);
  const payload = buildEmailReportPayload(data, config);
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const location = { href: '' };
  let copied = '';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied = text; } } } });
  try {
    assert.deepEqual(await sendFieldReport(data, config), { success: true, method: 'mailto' });
    const url = new URL(location.href);
    assert.equal(decodeURIComponent(url.pathname), config.report_recipient_email);
    assert.equal(url.searchParams.get('cc'), config.report_cc_email);
    assert.equal(url.searchParams.get('subject'), payload.subject);
    assert.equal(url.searchParams.get('body'), payload.body.replace(/\r?\n/g, '\r\n'));
    assert.ok(!location.href.includes('+'), 'mailto spaces must use %20, never form-encoded plus');
    assert.ok(location.href.includes('%20') && location.href.includes('%0D%0A'));
    assert.equal(url.searchParams.get('subject'), '[바다꼼꼬미] 현장제보 (2026.11.21.)');
    assert.equal(copied, payload.body);
    for (const text of [data.memo, data.reporterName, '34.81950', '128.55200', 'map.naver.com', 'www.google.com/maps']) assert.ok(payload.body.includes(text));
    assert.deepEqual(data, snapshot);
  } finally {
    for (const [key, descriptor] of [['window', savedWindow], ['navigator', savedNavigator]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('photo wording counts only files supplied to sharing, with no false count on text/mailto fallback', async (t) => {
  const photo = 'data:image/jpeg;base64,/9j/2Q==';
  for (const count of [1, 2, 3, 4]) {
    const data = { ...report, photos: Array(count).fill(photo) };
    assert.ok(!buildEmailReportPayload(data, config).body.includes('첨부사진'));
    assert.ok(buildEmailReportPayload(data, config, count).body.endsWith(`첨부사진: ${count}장`));
  }
  for (const mode of ['files', 'text-only', 'no-can-share', 'cancelled', 'failed', 'mailto'] as const) {
    await t.test(mode, async () => {
      const data = { ...report, photos: Array(4).fill(photo) }, before = structuredClone(data);
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
      const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      const location = { href: '' };
      let shared: ShareData | undefined;
      const navigatorMock: { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean } = {};
      if (mode !== 'mailto') navigatorMock.share = async payload => {
        shared = payload;
        if (mode === 'cancelled') throw new DOMException('cancelled', 'AbortError');
        if (mode === 'failed') throw new DOMException('failed', 'NotAllowedError');
      };
      if (mode !== 'no-can-share') navigatorMock.canShare = () => mode !== 'text-only';
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorMock });
      try {
        const result = await sendFieldReport(data, config);
        assert.deepEqual(data, before);
        if (shared) {
          assert.equal(shared.title, '[바다꼼꼬미] 현장제보 (2026.11.21.)');
          assert.ok(shared.text?.includes(report.memo));
          if (mode === 'text-only' || mode === 'no-can-share') {
            assert.equal(shared.files, undefined);
            assert.ok(!shared.text?.includes('첨부사진'));
          } else {
            assert.equal(shared.files?.length, 4);
            assert.ok(shared.text?.endsWith('첨부사진: 4장'));
            for (const file of shared.files ?? []) {
              assert.equal(file.type, 'image/jpeg');
              assert.equal(file.size, 4);
              assert.match(file.name, /^field_report_[1-4]\.jpg$/);
              assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [255, 216, 255, 217]);
            }
          }
        }
        if (mode === 'failed' || mode === 'mailto') {
          assert.deepEqual(result, { success: true, method: 'mailto' });
          const url = new URL(location.href);
          assert.equal(url.searchParams.get('subject'), '[바다꼼꼬미] 현장제보 (2026.11.21.)');
          assert.ok(!url.searchParams.get('body')?.includes('첨부사진'));
          assert.ok(url.searchParams.get('body')?.includes(report.memo));
          assert.equal(url.searchParams.get('cc'), config.report_cc_email);
          assert.equal(decodeURIComponent(url.pathname), config.report_recipient_email);
        } else if (mode === 'cancelled') {
          assert.equal(result.success, false);
          assert.equal(result.method, 'share');
          assert.equal(location.href, '');
        } else {
          assert.deepEqual(result, { success: true, method: 'share' });
          assert.equal(location.href, '');
        }
      } finally {
        for (const [key, descriptor] of [['window', originalWindow], ['navigator', originalNavigator]] as const) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    });
  }
});
