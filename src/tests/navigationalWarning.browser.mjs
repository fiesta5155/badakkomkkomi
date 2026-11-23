// Real panel with isolated static JSON responses. No official API or remote writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
const now = '2026-11-23T03:00:00Z';
const success = '2026-11-23T02:00:00Z';
const initial = JSON.parse(readFileSync(new URL('../../public/data/navigational-warnings/latest.json', import.meta.url), 'utf8'));
const seedStatus = JSON.parse(readFileSync(new URL('../../public/data/navigational-warnings/status.json', import.meta.url), 'utf8'));
const title = '긴경보제목'.repeat(45);
const content = '현장 원문 첫 줄\n둘째 줄: <script>원문 그대로</script>\n' + ('긴 원문 내용 '.repeat(20) + '\n').repeat(25);
const doc = id => ({ docNum: id, issuedAt: null, observations: [{ queryDate: '20261123', raw: { doc_num: id, title, content, basic: '공식 발행 근거\n두 번째 줄' } }],
  areas: Array.from({ length: 58 }, (_, i) => ({ raw: { doc_num: id, area: String(i + 1), position_nm: '공식 구역 이름'.repeat(10), position: '34-09-41N,128-00-00E\n34-18-01N,128-11-27E', position_desc: '해당 지점을 순차 연결한 선내 해역', alarm_date: '2026-11-23,2026-11-24,', alarm_time: '08:00 ~ 18:00,08:00 ~ 20:00,', sea_pos: '2200' }, coordinates: { geometry: null, datum: null } })) });
const snapshot = (documents, time = success) => ({ ...initial, lastSuccessfulAt: time, coverage: { ...initial.coverage, queryDates: ['20261122', '20261123', '20261124'] }, documents });
const status = (state = 'success', time = success) => ({ ...seedStatus, status: state, lastAttemptAt: success, lastSuccessfulAt: time });
const entry = `import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import Panel from '/src/components/notebook/NavigationalWarningPanel.tsx';
import {WeatherThresholdSettings} from '/src/components/navigation/WeatherThresholdSettings.tsx';
import {FirebaseAuthContext} from '/src/hooks/useFirebaseAuth.ts';
import {SAFE_DEFAULT_THRESHOLDS} from '/src/services/ecmwfWeatherService.ts';
import '/src/index.css';
const none=async()=>{};
const auth={status:'signed-out',user:null,profile:null,error:'',busy:false,editingName:false,login:none,logout:none,retryProfile:none,saveName:none,editName:none,cancelEditName:none};
function Harness(){const[open,setOpen]=React.useState(false);const[helm,setHelm]=React.useState(false);return React.createElement(FirebaseAuthContext.Provider,{value:auth},React.createElement(React.Fragment,null,React.createElement('button',{id:'trigger',onClick:()=>setOpen(true)},'항행경보 열기'),React.createElement('button',{onClick:()=>setHelm(true)},'조타실 열기'),open&&React.createElement(Panel,{onClose:()=>setOpen(false)}),helm&&React.createElement(WeatherThresholdSettings,{isOpen:true,onClose:()=>setHelm(false),thresholds:SAFE_DEFAULT_THRESHOLDS,onSave:()=>{},isStandalone:false,canInstall:false,onInstall:none})));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));`;
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 600, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], calls = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.clock.setFixedTime(new Date(now));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { calls.push(url.origin); return route.abort(); }
      return route.continue();
    });
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: entry }));
    let current = initial, currentStatus = seedStatus, failData = false, failStatus = false, delayData = false;
    await page.route('**/data/navigational-warnings/latest.json*', async route => {
      if (delayData) await new Promise(resolve => setTimeout(resolve, 250));
      return route.fulfill({ status: failData ? 503 : 200, contentType: 'application/json', body: JSON.stringify(current) });
    });
    await page.route('**/data/navigational-warnings/status.json*', route => route.fulfill({ status: failStatus ? 503 : 200, contentType: 'application/json', body: JSON.stringify(currentStatus) }));
    await page.goto(origin);
    let openCount = 0;
    const open = async () => {
      // Each fixture is an independent state; do not ask the real anti-rollback
      // cache to replace a newer scenario with an intentionally older one.
      if (openCount) await page.reload();
      await page.clock.setFixedTime(new Date(Date.parse(now) + openCount++ * 61000));
      await page.getByRole('button', { name: '항행경보 열기', exact: true }).click();
      await page.getByRole('heading', { name: '항행경보', exact: true }).waitFor();
    };
    const close = async () => { await page.getByRole('button', { name: '항행경보 닫기' }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => document.activeElement.id), 'trigger'); };
    const fits = async () => {
      const b = await page.getByRole('dialog').evaluate(dialog => { const s = dialog.querySelector('.overflow-y-auto'); const r = dialog.querySelector('header').parentElement.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, left: r.left, right: r.right, top: r.top, bottom: r.bottom, scroll: s.scrollWidth, client: s.clientWidth, outerScroll: dialog.scrollTop }; });
      assert.ok(b.left >= 0 && b.right <= b.width + 1 && b.top >= 0 && b.bottom <= b.height && b.scroll <= b.client + 1 && b.outerScroll === 0, JSON.stringify(b));
    };
    delayData = true; await open(); await page.getByRole('status').getByText('항행경보 자료를 불러오는 중입니다.', { exact: true }).waitFor();
    await page.getByText('아직 수집된 항행경보 자료가 없습니다.', { exact: true }).waitFor(); delayData = false; await fits(); await close();
    current = snapshot([]); currentStatus = status(); await open(); await page.getByRole('status').getByText(/정상 수집 0건 · 최종 갱신/).waitFor(); await close();
    current = snapshot([doc('26-2'), doc('26-1'), doc('26-2')]); await open();
    await page.getByRole('status').getByText('2건 · 최종 갱신 11.23. 11:00', { exact: true }).waitFor();
    const preview = page.locator('[data-warning-document]').first().locator('span').last();
    assert.equal(await preview.textContent(), content.replace(/\s+/g,' ').trim());
    assert.ok(await preview.evaluate(el=>el.clientHeight<=parseFloat(getComputedStyle(el).lineHeight)*2+1));
    assert.ok(await page.getByRole('status').evaluate(el=>el.clientHeight<=parseFloat(getComputedStyle(el).lineHeight)+1));
    const listText = await page.getByRole('dialog').innerText();
    assert.ok(!/조회 기준일|지정한 날짜 범위|모든 유효 경보|발령일 미제공/.test(listText));
    const tree = await page.getByRole('dialog').ariaSnapshot();
    assert.match(tree, /항행경보/); assert.match(tree, /항행경보 닫기/);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '항행경보 닫기');
    if (process.env.AXE_MODULE) {
      await page.addScriptTag({ path: process.env.AXE_MODULE });
      const audit = await page.evaluate(async () => window.axe.run(document.querySelector('dialog'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
      assert.deepEqual(audit.violations.map(v => ({ id: v.id, impact: v.impact })), []);
    }
    assert.deepEqual(await page.locator('[data-warning-document]').evaluateAll(nodes => nodes.map(n => n.dataset.warningDocument)), ['26-2', '26-1']);
    assert.equal(await page.getByRole('status').count(), 1);
    await fits();
    if (width === 390 && process.env.QA_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/warning-list.png` });
    await page.locator('[data-warning-document]').first().click();
    await page.getByRole('heading', { name: '항행경보', exact: true }).waitFor();
    assert.equal(await page.getByText(content, { exact: true }).textContent(), content);
    assert.equal(await page.locator('section[aria-label="구역별 원문"] > details').count(), 58);
    assert.equal(await page.locator('[data-warning-extra]').count(), 1);
    assert.equal(await page.locator('details[open]').count(), 0);
    const order = await page.locator('article').evaluate(article => [...article.children].map(node => node.tagName));
    assert.deepEqual(order, ['DIV', 'DL', 'SECTION', 'DETAILS']);
    const firstArea = page.locator('details').first(); await firstArea.locator(':scope > summary').click();
    assert.equal(await firstArea.locator('[data-warning-coordinates]').getAttribute('open'), null);
    await firstArea.getByText('2026.11.23.', { exact: true }).waitFor();
    await firstArea.getByText('08:00 ~ 18:00', { exact: true }).waitFor();
    await firstArea.getByText('2026.11.24.', { exact: true }).waitFor();
    await firstArea.getByText('08:00 ~ 20:00', { exact: true }).waitFor();
    await firstArea.locator('[data-warning-coordinates] > summary').click();
    await firstArea.getByText('34-09-41N,128-00-00E\n34-18-01N,128-11-27E', { exact: true }).waitFor();
    await page.locator('[data-warning-extra] > summary').click();
    await page.getByText('공식 발행 근거\n두 번째 줄', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-warning-chart="1"] span').textContent(), '2200');
    await fits();
    if (width === 390 && process.env.QA_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/warning-detail.png` });
    if (process.env.AXE_MODULE) {
      const audit = await page.evaluate(async () => window.axe.run(document.querySelector('dialog'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
      assert.deepEqual(audit.violations.map(v => ({ id: v.id, impact: v.impact })), []);
    }
    assert.equal(await page.getByRole('button', { name: /지도.*이동/ }).count(), 0);
    await page.getByRole('button', { name: '목록으로 돌아가기' }).click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.warningDocument), '26-2');
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trigger');
    current = snapshot([doc('26-2')], '2026-11-21T00:00:00Z'); currentStatus = status('failed', '2026-11-21T00:00:00Z');
    await open(); await page.getByRole('status').getByText(/이전 정상 자료/).waitFor(); await page.getByRole('status').getByText(/과거 자료/).waitFor(); await close();
    current = initial; currentStatus = status('failed', null); await open(); await page.getByText('수집 실패 · 정상 자료 없음', { exact: true }).waitFor(); await close();
    failData = true; await open(); await page.getByRole('alert').getByText('경보 자료를 불러오지 못했습니다.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-warning-document]').count(), 0);
    failData = false; current = snapshot([doc('26-2')]); currentStatus = status(); await page.getByRole('button', { name: '다시 불러오기' }).click(); await page.getByRole('status').getByText(/^1건 · 최종 갱신/).waitFor(); await close();
    const snapshotHash = createHash('sha256').update(JSON.stringify(current)).digest('hex');
    currentStatus = { ...status(), publication: { state: 'ready', preparedAt: success, snapshotSha256: snapshotHash, reason: 'collection_artifact' } };
    await open(); await page.getByRole('status').getByText(/^1건 · 최종 갱신/).waitFor(); assert.equal(await page.getByRole('alert').count(), 0); await close();
    currentStatus.publication.state = 'delayed';
    await open(); await page.getByRole('status').getByText(/갱신 지연/).waitFor(); assert.equal(await page.locator('[data-warning-document]').count(), 1); await close();
    failStatus = true; await open(); await page.getByRole('alert').getByText('수집 상태를 불러오지 못했습니다.', { exact: true }).waitFor(); assert.equal(await page.locator('[data-warning-document]').count(), 1); await close();
    failStatus = false; current = snapshot([doc('short')]); current.documents[0].observations[0].raw.content='짧은 내용'; currentStatus=status();
    await open();
    const short = page.locator('[data-warning-document]').first().locator('span').last();
    assert.equal(await short.innerText(), '짧은 내용');
    assert.ok(await short.evaluate(el=>el.scrollHeight<=el.clientHeight+1));
    await close();
    await page.getByRole('button', { name: '조타실 열기', exact: true }).click();
    await page.getByRole('heading', { name: '꼬미의 조타실', exact: true }).waitFor();
    await page.getByRole('button', { name: /이용 안내/ }).click();
    await page.getByRole('heading', { name: '이용 안내', exact: true }).waitFor();
    await page.getByRole('heading', { name: '항행경보 안내', exact: true }).scrollIntoViewIfNeeded();
    const guide = page.locator('section[aria-labelledby="navigational-warning-guide"]');
    const guideText = await guide.innerText();
    assert.match(guideText, /매시간 23분/); assert.match(guideText, /어제·오늘·내일/);
    assert.match(guideText, /모든 유효 경보의 포함 여부는 보장되지 않습니다/);
    assert.match(guideText, /공식 항행안전정보 확인을 대체하지 않습니다/);
    assert.ok(!/07:17|13:17/.test(guideText));
    assert.equal(await guide.getByRole('link').getAttribute('href'), 'https://www.khoa.go.kr/nwb/mainPage.do?lang=ko');
    await fits();
    if (width === 390 && process.env.QA_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/warning-guide.png` });
    await page.getByRole('button', { name: '조타실 메인으로 돌아가기' }).click();
    await page.getByRole('heading', { name: '꼬미의 조타실', exact: true }).waitFor();
    await page.getByRole('button', { name: '조타실 닫기' }).click();
    assert.deepEqual(errors, []); assert.deepEqual(calls, []);
    console.log(JSON.stringify({ width, uncollected:true, empty:true, documents:true, rawNewlines:true, areas58:true, failed:true, stale:true, staticOnly:true, layout:true, focusAndEscape:true }));
    await context.close();
  }
} finally { await browser.close(); }
