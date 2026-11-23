// Local UI QA: start Vite, set PLAYWRIGHT_MODULE and optionally QA_ORIGIN/CHROME_EXECUTABLE.
// Firebase traffic is blocked. Only an isolated browser context receives synthetic records.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch(process.env.CHROME_EXECUTABLE
  ? { executablePath: process.env.CHROME_EXECUTABLE, headless: true }
  : { channel: 'msedge', headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
const storageKey = 'bada_finless_porpoise_records_v1';
const records = [
  { id: 'late', lat: 34.8, lng: 128.4, observedAt: '2026-11-20T23:55', count: 3, createdAt: 1 },
  { id: 'early', lat: 34.7, lng: 128.3, observedAt: '2025-12-31T00:05', count: 2, createdAt: 2 },
];
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
import '/src/index.css';
import {LayerControlModal} from '/src/components/notebook/LayerControlModal.tsx';
import {usePorpoiseStorage} from '/src/hooks/usePorpoiseStorage.ts';
import {FirebaseAuthContext} from '/src/hooks/useFirebaseAuth.ts';
function Fixture(){
 const storage=usePorpoiseStorage();
 const [status,setStatus]=React.useState('ready');
 const [visible,setVisible]=React.useState(true);
 window.qaSetAuth=setStatus;
 const auth={status,user:status==='signed-out'?null:{uid:'qa',displayName:'Wrong Google Name'},profile:status==='ready'?{uid:'qa',realName:'범진'}:null};
 return React.createElement(FirebaseAuthContext.Provider,{value:auth},React.createElement(LayerControlModal,{
  isOpen:true,onClose:()=>{},layers:[],geoJsonLayersData:{},onToggleLayer:()=>{},showHazardInformation:true,onToggleHazardInformation:()=>{},
  dockingCount:0,hazardCount:0,onFitProtectedAreas:()=>{},notebookDisplayControls:null,onSaveOperationalLayers:async()=>{},releaseId:'qa',lastSavedAt:'',remoteSyncStatus:'local_only',snapshots:[],
  showPorpoiseLayer:visible,onTogglePorpoiseLayer:()=>setVisible(v=>!v),porpoiseCount:storage.records.length,porpoiseRecords:storage.records
 }));
}
ReactDOMClient.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600, serviceWorkers: 'block', acceptDownloads: true });
    await context.addInitScript(({ storageKey, records }) => {
      localStorage.setItem(storageKey, JSON.stringify(records));
      window.qaWrites = [];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { window.qaWrites.push(key); return original.call(this, key, value); };
      window.qaMode = 'shared'; window.qaShares = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => {
        window.qaCanShareKeys = Object.keys(data);
        return window.qaMode !== 'unsupported';
      } });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async data => {
        window.qaShares.push({ title: data.title, text: data.text, name: data.files[0].name, active: navigator.userActivation.isActive, bytes: Array.from(new Uint8Array(await data.files[0].arrayBuffer())) });
        if (window.qaMode === 'cancelled') throw new DOMException('cancelled', 'AbortError');
        if (window.qaMode === 'failed') throw new DOMException('blocked', 'NotAllowedError');
      } });
    }, { storageKey, records });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: '관찰기록 내보내기', exact: true });
    await button.waitFor();
    const checkbox = page.getByRole('checkbox', { name: '상괭이 관찰 기록 표시', exact: true });
    assert.equal(await checkbox.isChecked(), true);
    await button.click();
    await page.waitForFunction(() => window.qaShares.length === 1);
    assert.equal(await checkbox.isChecked(), true, 'export must not toggle layer visibility');
    const first = await page.evaluate(() => window.qaShares[0]);
    assert.equal(first.active, true, 'share must retain the original user gesture');
    assert.deepEqual(first.bytes.slice(0, 3), [239, 187, 191]);
    assert.match(first.name, /^상괭이모니터링_\d{8}\.csv$/);
    const csv = new TextDecoder().decode(new Uint8Array(first.bytes));
    assert.ok(csv.includes(',2025,상괭이,Neophocaena asiaeorientalis,128.3,34.7,2025-12-31,00:05,범진,2,'));
    assert.ok(!csv.includes('Wrong Google Name'));
    assert.deepEqual(await page.evaluate(() => window.qaCanShareKeys), ['files']);
    assert.ok(!(await page.getByRole('dialog').innerText()).includes('발송 완료'));
    const layout = await button.evaluate(el => {
      const r = el.getBoundingClientRect(), dialog = el.closest('dialog');
      return { width: r.width, height: r.height, fits: r.x >= 0 && r.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth + 1 };
    });
    assert.ok(layout.height >= 44 && layout.fits, JSON.stringify(layout));

    await page.evaluate(() => { window.qaMode = 'cancelled'; });
    await button.click();
    await page.waitForFunction(() => window.qaShares.length === 2);
    await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
    assert.equal(await page.getByRole('button', { name: 'CSV 파일 다운로드', exact: true }).count(), 0);
    assert.ok(!(await page.getByRole('dialog').innerText()).includes('공유창을 열지 못했습니다'));

    await page.evaluate(() => { window.qaMode = 'unsupported'; });
    const pendingDownload = page.waitForEvent('download');
    await button.click();
    const download = await pendingDownload;
    assert.deepEqual(await readFile(await download.path()), Buffer.from(first.bytes));
    await page.getByText('CSV 파일 다운로드를 시작했습니다.', { exact: true }).waitFor();

    await page.evaluate(() => { window.qaMode = 'failed'; });
    await button.click();
    await page.getByText('공유창을 열지 못했습니다. CSV 파일 다운로드를 이용해 주세요.', { exact: true }).waitFor();
    const retryDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV 파일 다운로드', exact: true }).click();
    await retryDownload;

    const shareCount = await page.evaluate(() => window.qaShares.length);
    await page.evaluate(() => window.qaSetAuth('signed-out'));
    await button.click();
    await page.getByText('Google 로그인 후 실명 등록을 완료하면 관찰기록을 내보낼 수 있습니다.', { exact: true }).waitFor();
    await page.evaluate(() => window.qaSetAuth('needs-name'));
    await button.click();
    await page.getByText('로그인 프로필의 실명 등록을 완료한 뒤 다시 시도해 주세요.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.qaShares.length), shareCount);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), JSON.stringify(records));
    assert.ok(!(await page.evaluate(() => window.qaWrites)).includes(storageKey));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, layout, share: 'passed (mock)', cancellation: 'passed', download: 'passed', auth: 'passed', storageUnchanged: true }));
    if (process.env.QA_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/porpoise-export-${width}.png` });
    await context.close();
  }
  // Empty and malformed persisted data remain intact and never open a share dialog.
  for (const entries of [[], [{ ...records[0], count: 0 }]]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(({ key, entries }) => localStorage.setItem(key, JSON.stringify(entries)), { key: storageKey, entries });
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '관찰기록 내보내기', exact: true }).click();
    await page.getByText(entries.length ? /저장 정보가 올바르지 않은/ : '내보낼 상괭이 관찰기록이 없습니다.').waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), JSON.stringify(entries));
    assert.equal(await page.getByRole('button', { name: 'CSV 파일 다운로드', exact: true }).count(), 0);
    await context.close();
  }
} finally { await browser.close(); }
