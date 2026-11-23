// Real historical fixture, served by Vite dev middleware; never replaces public JSON.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const enabledOrigin = process.env.QA_PREVIEW_ORIGIN ?? 'http://127.0.0.1:5174';
const disabledOrigin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
const snapshot = JSON.parse(readFileSync('.dev/fixtures/navigational-warnings/latest.json', 'utf8'));
assert.equal(snapshot.documents.length, 9);
assert.equal(snapshot.documents.reduce((n, d) => n + d.areas.length, 0), 94);
const entry = `import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import Panel from '/src/components/notebook/NavigationalWarningPanel.tsx';
import '/src/index.css';
function Harness(){const[open,setOpen]=React.useState(false);return React.createElement(React.Fragment,null,React.createElement('button',{id:'trigger',onClick:()=>setOpen(true)},'항행경보 열기'),open&&React.createElement(Panel,{onClose:()=>setOpen(false)}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));`;
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', hasTouch: width < 600 });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    await page.clock.setFixedTime(new Date('2026-11-23T03:00:00Z'));
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('navigational-warnings/')) requests.push(new URL(request.url()).pathname); });
    await page.route('**/*', route => new URL(route.request().url()).origin === enabledOrigin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: entry }));
    await page.goto(enabledOrigin + '/?navWarningPreview=1', { waitUntil: 'domcontentloaded' });
    const open = () => page.getByRole('button', { name: '항행경보 열기', exact: true }).click();
    await open();
    await page.getByRole('heading', { name: '항행경보', exact: true }).waitFor();
    await page.getByText('과거 수집 자료 · 개발용 미리보기', { exact: true }).waitFor();
    await page.getByRole('status').getByText(/9건.*과거 자료/).waitFor();
    assert.deepEqual(await page.locator('[data-warning-document]').evaluateAll(nodes => nodes.map(n => n.dataset.warningDocument)), snapshot.documents.map(d => d.docNum));
    let totalAreas = 0;
    for (const document of snapshot.documents) {
      await page.locator(`[data-warning-document="${document.docNum}"]`).click();
      await page.locator('article').waitFor();
      assert.equal(await page.locator('article h3').first().textContent(), document.observations[0].raw.title);
      const content = document.observations[0].raw.content;
      if (content) assert.equal(await page.locator('article').getByText(content, { exact: true }).textContent(), content);
      const areas = page.locator('section[aria-label="구역별 원문"] > details');
      assert.equal(await areas.count(), document.areas.length); totalAreas += await areas.count();
      assert.equal(await areas.evaluateAll(nodes => nodes.filter(node => node.open).length), 0);
      const area = document.areas[0].raw;
      await areas.first().locator(':scope > summary').click();
      const coordinates = areas.first().locator('[data-warning-coordinates]');
      assert.equal(await coordinates.getAttribute('open'), null);
      // Every date/time remains in its original index order; no range inferred.
      const rows = await areas.first().locator('div.flex.flex-wrap').evaluateAll(nodes=>nodes.map(node=>({date:node.querySelector('dt').textContent,time:node.querySelector('dd').textContent})));
      const dates = area.alarm_date.replace(/,+$/, '').split(',');
      const times = area.alarm_time.replace(/,+$/, '').split(',');
      assert.deepEqual(rows, dates.map((date,i)=>({date:date.replaceAll('-', '.')+'.',time:times[i]})));
      await coordinates.locator('summary').click();
      if(area.position)assert.equal(await coordinates.getByText(area.position,{exact:true}).textContent(),area.position);
      if(area.position_desc)assert.equal(await coordinates.getByText(area.position_desc,{exact:true}).textContent(),area.position_desc);
      const extra = page.locator('[data-warning-extra]');
      assert.equal(await extra.getAttribute('open'), null);
      await extra.locator('summary').first().click();
      if (document.observations[0].raw.basic) assert.equal(await extra.getByText(document.observations[0].raw.basic, { exact: true }).textContent(), document.observations[0].raw.basic);
      if (area.sea_pos) assert.equal(await extra.locator(`[data-warning-chart="${area.area}"] span`).textContent(), area.sea_pos);
      const bounds = await page.getByRole('dialog').evaluate(dialog => { const s = dialog.querySelector('.overflow-y-auto'); const r = dialog.querySelector('section').getBoundingClientRect(); return { fits: s.scrollWidth <= s.clientWidth + 1, right: r.right, top: r.top, width: innerWidth }; });
      assert.ok(bounds.fits && bounds.right <= bounds.width + 1 && bounds.top >= 0);
      assert.equal(await page.getByRole('button', { name: /지도.*이동/ }).count(), 0);
      await page.getByRole('button', { name: '목록으로 돌아가기' }).click();
      assert.equal(await page.evaluate(() => document.activeElement.dataset.warningDocument), document.docNum);
    }
    assert.equal(totalAreas, 94);
    await page.getByRole('button', { name: '항행경보 닫기' }).click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trigger');
    assert.ok(requests.every(url => url.startsWith('/__dev/')));
    assert.equal((await page.request.get(enabledOrigin + '/data/navigational-warnings/latest.json')).status(), 200);
    assert.equal((await (await page.request.get(enabledOrigin + '/data/navigational-warnings/latest.json')).json()).lastSuccessfulAt, null);
    assert.equal((await page.request.get(disabledOrigin + '/__dev/data/navigational-warnings/latest.json')).status(), 404);
    await page.goto(enabledOrigin + '/'); await open();
    await page.getByText('아직 수집된 항행경보 자료가 없습니다.', { exact: true }).waitFor();
    assert.equal(await page.getByText('과거 수집 자료 · 개발용 미리보기', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, realDocuments: 9, realAreas: totalAreas, rawFieldsAndNewlines: true, backAndClose: true, doubleOptIn: true, publicUntouched: true }));
    await context.close();
  }
  if (process.env.QA_PRODUCTION_ORIGIN) {
    const origin = process.env.QA_PRODUCTION_ORIGIN;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const requests = [];
    page.on('request', request => { if (request.url().includes('navigational-warnings/')) requests.push(new URL(request.url()).pathname); });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/?screen=notebook&navWarningPreview=1');
    // Even forged development metadata cannot activate the compiled production branch.
    await page.evaluate(() => { const meta = document.createElement('meta'); meta.name = 'bada-nav-warning-preview'; meta.content = '1'; document.head.append(meta); });
    await page.getByRole('group', { name: '바다수첩 기능' }).getByRole('button').first().click();
    await page.getByRole('button', { name: '항행경보 목록', exact: true }).click();
    await page.getByText('아직 수집된 항행경보 자료가 없습니다.', { exact: true }).waitFor();
    assert.equal(await page.getByText('과거 수집 자료 · 개발용 미리보기', { exact: true }).count(), 0);
    assert.ok(requests.length > 0 && requests.every(url => !url.includes('__dev')));
    const response = await page.request.get(origin + '/__dev/data/navigational-warnings/latest.json');
    assert.ok(!response.headers()['content-type']?.includes('application/json'));
    console.log(JSON.stringify({ productionPreviewDisabled: true, queryAndForgedMetaIgnored: true, staticUncollectedJson: true }));
    await context.close();
  }
} finally { await browser.close(); }
