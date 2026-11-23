// Start Vite and set PLAYWRIGHT_MODULE. Uses isolated storage and mocks native sharing only.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { fixture as appFixture, service, loadMapViewFixture } from './mapWorkspaceFixtures.mjs';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
const key = 'bada_custom_admin_email';
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import '/src/index.css';
import {FieldReportModal} from '/src/components/notebook/FieldReportModal.tsx';
import {useAppConfig} from '/src/hooks/useAppConfig.ts';
function Fixture(){
 const {config,updateAdminEmail}=useAppConfig();
 const [open,setOpen]=React.useState(true);
 const [name,setName]=React.useState(localStorage.getItem('qa-reporter')??'');
 return React.createElement(React.Fragment,null,
 React.createElement('button',{onClick:()=>setOpen(true)},'제보 열기'),
 open&&React.createElement(FieldReportModal,{isOpen:true,onClose:()=>setOpen(false),initialLat:34.8195,initialLng:128.552,
 adminConfig:config.admin,onUpdateAdminEmail:updateAdminEmail,defaultReporterName:name,
 onChangeReporterName:v=>{setName(v);localStorage.setItem('qa-reporter',v);},onPickLocationOnMap:()=>{window.qaPicked=true;setOpen(false);}}));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 600, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.qaShares = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async data => {
        if (window.qaCancelShare) throw new DOMException('cancelled', 'AbortError');
        window.qaShares.push({ title: data.title, text: data.text, files: data.files?.map(f => f.name) });
      } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.dismiss());
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.goto(origin);
    await page.getByRole('heading', { name: '현장제보', exact: true }).waitFor();
    assert.equal(await page.getByRole('group', { name: '현장 상황 빠른 입력 태그' }).count(), 0);
    assert.ok(!(await page.getByRole('dialog').innerText()).includes('QGIS'));
    await page.getByLabel('제보자 이름 / 소속', { exact: false }).fill('홍길동 / 순찰대');
    await page.getByRole('button', { name: '변경', exact: true }).click();
    await page.getByLabel('수신 이메일', { exact: true }).fill('bad@');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(k => localStorage.getItem(k), key), null);
    await page.getByLabel('수신 이메일', { exact: true }).fill(' patrol@example.org ');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    assert.equal(await page.evaluate(k => localStorage.getItem(k), key), 'patrol@example.org');
    await page.getByRole('button', { name: '제보 창 닫기' }).click();
    await page.getByRole('button', { name: '제보 열기' }).click();
    assert.ok((await page.getByRole('dialog').innerText()).includes('patrol@example.org'));
    await page.reload();
    await page.getByRole('heading', { name: '현장제보', exact: true }).waitFor();
    assert.ok((await page.getByRole('dialog').innerText()).includes('patrol@example.org'));
    await page.getByRole('button', { name: '변경', exact: true }).click();
    assert.equal(await page.getByLabel('수신 이메일', { exact: true }).inputValue(), 'patrol@example.org');
    await page.getByRole('button', { name: '기본 주소로 복원' }).click();
    assert.equal(await page.evaluate(k => localStorage.getItem(k), key), null);
    assert.ok((await page.getByRole('dialog').innerText()).includes('marine_admin@knps.or.kr'));
    assert.equal(await page.getByLabel('제보자 이름 / 소속', { exact: false }).inputValue(), '홍길동 / 순찰대');
    await page.reload();
    await page.getByRole('heading', { name: '현장제보', exact: true }).waitFor();
    assert.ok((await page.getByRole('dialog').innerText()).includes('marine_admin@knps.or.kr'));
    const memo = page.getByLabel('현장 자유 메모', { exact: false });
    assert.equal(await memo.getAttribute('placeholder'), '예: 허가받지 않은 유어장 시설물 설치 의심. 현장 확인 및 관련 허가 여부 검토 필요.');
    await memo.fill('현장 확인 및 관련 허가 여부 검토 필요.');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    await page.getByLabel('현장 사진 추가').setInputFiles(Array.from({length:5}, (_,i) => ({ name:`photo${i}.png`, mimeType:'image/png', buffer:png })));
    await page.waitForFunction(() => document.querySelectorAll('img[alt^="첨부사진"]').length === 4);
    assert.equal(await page.getByLabel('현장 사진 추가').count(), 0);
    await page.getByRole('button', { name: '첨부사진 1 삭제', exact: true }).click();
    assert.equal(await page.getByRole('img', { name: /^첨부사진/ }).count(), 3);
    await page.getByLabel('현장 사진 추가').setInputFiles({ name:'again.png', mimeType:'image/png', buffer:png });
    await page.waitForFunction(() => document.querySelectorAll('img[alt^="첨부사진"]').length === 4);
    await page.getByRole('button', { name: '이메일로 제보하기', exact: true }).click();
    await page.getByRole('status').waitFor();
    const shared = await page.evaluate(() => window.qaShares[0]);
    assert.match(shared.title, /^\[바다꼼꼬미\] 현장제보 \(\d{4}\.\d{2}\.\d{2}\.\)$/);
    for (const text of ['현장 확인', '홍길동 / 순찰대', '34.81950', '128.55200', 'map.naver.com', 'www.google.com/maps']) assert.ok(shared.text.includes(text), text);
    assert.equal(shared.files.length, 4);
    assert.ok(shared.text.endsWith('첨부사진: 4장'));
    assert.ok((await page.getByRole('status').innerText()).includes('실제 발송 여부는 확인할 수 없습니다'));
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    const layout = await page.getByRole('dialog').evaluate(el => ({ fits:el.scrollWidth<=el.clientWidth+1, left:el.getBoundingClientRect().left, right:el.getBoundingClientRect().right, viewport:innerWidth }));
    assert.ok(layout.fits && layout.left >= 0 && layout.right <= layout.viewport, JSON.stringify(layout));
    assert.ok((await page.getByRole('button', { name: '이메일로 제보하기', exact: true }).boundingBox()).height >= 44);
    await page.screenshot({ path: `.dev/docs/field-report-${width}.png`, fullPage:true });
    await page.evaluate(() => { window.qaCancelShare=true; });
    await page.getByRole('button', { name: '이메일로 제보하기', exact: true }).click();
    assert.equal(await page.getByRole('status').count(), 0);
    await page.getByRole('button', { name: '지도에서 위치 선택', exact:true }).click();
    assert.equal(await page.evaluate(() => window.qaPicked), true);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Field report ${width}px: persistence, reset, photos, share, close and picker callback passed`);
  }

  // Real App + real Leaflet canvas: verify map coordinate selection reopens the report.
  const context = await browser.newContext({ viewport:{width:390,height:844}, serviceWorkers:'block' });
  const page = await context.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route('**/src/main.tsx*', route => route.fulfill({contentType:'application/javascript', body:appFixture}));
  await page.route('**/src/services/activityPermitService.ts*', route => route.fulfill({contentType:'application/javascript', body:service}));
  await page.route('**/src/components/MapView.tsx*', async route => route.fulfill({contentType:'application/javascript', body:await loadMapViewFixture(origin)}));
  await page.goto(origin+'/?screen=notebook');
  await page.getByRole('button', {name:'제보',exact:true}).click();
  await page.getByRole('heading', {name:'현장제보',exact:true}).waitFor();
  await page.getByLabel('제보자 이름 / 소속', {exact:false}).fill('홍길동 / 해상순찰대');
  await page.getByRole('button', {name:'변경',exact:true}).click();
  await page.getByLabel('수신 이메일', {exact:true}).fill('map-patrol@example.org');
  await page.getByRole('button', {name:'저장',exact:true}).click();
  await page.getByRole('button', {name:'지도에서 위치 선택',exact:true}).click();
  await page.waitForFunction(() => window.qaMapProps?.isReportPickMode && window.qaLeafletMap);
  await page.evaluate(() => window.qaLeafletMap.fire('click', {latlng:{lat:34.825,lng:128.56}}));
  await page.getByRole('heading', {name:'현장제보',exact:true}).waitFor();
  assert.ok((await page.getByRole('dialog').innerText()).includes('34.82500°N, 128.56000°E'));
  assert.ok((await page.getByRole('dialog').innerText()).includes('map-patrol@example.org'));
  assert.equal(await page.getByLabel('제보자 이름 / 소속', {exact:false}).inputValue(), '홍길동 / 해상순찰대');
  await page.reload();
  await page.getByRole('button', {name:'제보',exact:true}).click();
  await page.getByRole('heading', {name:'현장제보',exact:true}).waitFor();
  assert.ok((await page.getByRole('dialog').innerText()).includes('map-patrol@example.org'));
  assert.equal(await page.getByLabel('제보자 이름 / 소속', {exact:false}).inputValue(), '홍길동 / 해상순찰대');
  console.log('Real App: map selection and independent recipient/reporter persistence passed');
  await context.close();
} finally {
  await browser.close();
}
