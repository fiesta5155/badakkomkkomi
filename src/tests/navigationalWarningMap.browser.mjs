// Local integration QA: real App, layer menu, hooks, calendar and canvas code.
// Firebase and the Kakao SDK are in-memory doubles. Leaflet is real.
// Start Vite; supply PLAYWRIGHT_MODULE and CHROME_EXECUTABLE. No production writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectCoordinates } from '../../scripts/lib/navigational-warnings.mjs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
import { fixture, service, loadMapViewFixture } from './mapWorkspaceFixtures.mjs';
const mapView = await loadMapViewFixture(origin);
const snapshot = JSON.parse(readFileSync('public/data/navigational-warnings/latest.json'));
const position='34-48-00N,128-32-00E\n34-48-00N,128-33-00E\n34-49-00N,128-33-00E\n34-49-00N,128-32-00E';
const areas=[{area:'1',position,position_desc:'해당 지점을 순차 연결한 선내 해역'},{area:'2',position:'34-48-00N,128-32-00E',position_desc:'단일 위치'},{area:'3',position:'',position_desc:'미확인'}].map(raw=>({raw:{doc_num:'qa-only',...raw},coordinates:inspectCoordinates(raw.position)}));
snapshot.lastSuccessfulAt='2026-11-19T02:00:00Z';snapshot.documents=[{docNum:'qa-only',issuedAt:null,observations:[{queryDate:'20261119',raw:{doc_num:'qa-only',title:'지도 연동 검증 전용',content:'첫 줄\n둘째 줄'}}],areas}];
const status={...JSON.parse(readFileSync('public/data/navigational-warnings/status.json')),status:'success',lastSuccessfulAt:snapshot.lastSuccessfulAt,lastAttemptAt:snapshot.lastSuccessfulAt};
const real = process.env.QA_REAL_WARNINGS === '1';
if (real) {
  Object.assign(snapshot, JSON.parse(readFileSync('.dev/fixtures/navigational-warnings/latest.json')));
  Object.assign(status, JSON.parse(readFileSync('.dev/fixtures/navigational-warnings/status.json')));
}
try {
  for (const engine of (process.env.QA_ENGINES ?? 'leaflet,kakao').split(',')) for (const width of (process.env.QA_WIDTHS ?? '320,390,1280').split(',').map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    await page.addInitScript(value => { window.qaEngine = value; }, engine);
    await page.clock.setFixedTime(new Date('2026-11-19T12:00:00+09:00'));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.route('**/src/components/MapView.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: mapView }));
    await page.route('**/src/services/activityPermitService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: service }));
    await page.route('**/src/services/announcementService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function subscribeAnnouncementAdmin(db,uid,next){queueMicrotask(()=>next(false));return()=>{};}export function subscribeAnnouncements(db,admin,next){queueMicrotask(()=>next([],false));return()=>{};}export const saveAnnouncement=async()=>{throw Error("No writes");};export const deleteAnnouncement=saveAnnouncement;' }));
    await page.route('**/src/services/firebaseClient.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const getFirebaseClient=()=>({db:{}});export const firebaseConfigurationError="";' }));
    await page.route('**/src/services/calendarFirestoreService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function subscribeCalendar(db,v,m,next){queueMicrotask(()=>next([],false));return()=>{};}export function subscribeCalendarAdmin(db,u,next){queueMicrotask(()=>next(false));return()=>{};}export const saveSharedEntry=async()=>{throw new Error("No writes");};export const deleteSharedEntry=saveSharedEntry;' }));

    await page.addInitScript(() => localStorage.setItem('bada_map_information_visibility_v1',JSON.stringify({hazard:false,port_names:true,permits:true,porpoise:true})));
    let calls=0;
    await page.route('**/data/navigational-warnings/latest.json*',route=>{calls++;return route.fulfill({json:snapshot});});
    await page.route('**/data/navigational-warnings/status.json*',route=>{calls++;return route.fulfill({json:status});});
    await page.goto(origin + '/?screen=notebook');
    await page.waitForFunction(()=>window.qaEmit && window.qaMapProps);
    assert.equal(calls,0,'disabled layer does not fetch');
    await page.evaluate(()=>window.qaEmit([window.qaFixtures[0]]));
    await page.getByRole('group',{name:'바다수첩 기능'}).getByRole('button').first().click();
    const toggle=page.getByRole('checkbox',{name:'항행경보 표시',exact:true});
    assert.equal(await page.getByText('항행경보 · 목록 보기',{exact:true}).count(),0);
    await page.getByRole('button',{name:'항행경보 목록',exact:true}).click();
    await page.getByRole('heading',{name:'항행경보',exact:true}).waitFor();
    await page.locator('[data-warning-document]').first().waitFor();
    assert.equal(await page.evaluate(()=>window.qaMapProps.layers.find(l=>l.id==='hazard').visible),false,'list does not enable map layer');
    await page.getByRole('button',{name:'항행경보 닫기'}).click();
    assert.equal(await toggle.isChecked(),false);
    await toggle.check();
    await page.waitForFunction(n=>window.qaMapProps.geoJsonLayersData.hazard.features.length===n,real?74:2);
    const rendered = async expected => {
      if(engine==='leaflet') await page.waitForFunction(n=>document.querySelectorAll('path[stroke="#e11d48"]').length===n,expected);
      else await page.waitForFunction(n=>window.qaShapes.filter(p=>p.map&&p.options.strokeColor==='#e11d48').length===n,expected?(real?74:1):0);
    };
    await rendered(real?74:2);
    await toggle.uncheck();await rendered(0);
    await toggle.check();await rendered(real?74:2);
    assert.equal(calls,2,'panel/layer share cached JSON');
    await page.getByRole('button',{name:'레이어 창 닫기'}).click();
    if (real) {
      const id = await page.evaluate(()=>window.qaMapProps.geoJsonLayersData.hazard.features[0].properties.warningId);
      const doc = snapshot.documents.find(d=>d.docNum===JSON.parse(id)[0]);
      if(engine==='leaflet') await page.locator('path[stroke="#e11d48"]').first().dispatchEvent('click');
      else await page.evaluate(()=>window.qaShapes.find(p=>p.map&&p.options.strokeColor==='#e11d48').qaListeners.click({}));
      await page.getByRole('heading',{name:doc.observations[0].raw.title,exact:true}).waitFor();
      await page.locator('details').first().locator(':scope > summary').click();
      await page.getByRole('button',{name:'지도에서 보기'}).first().click();
      await page.waitForFunction(()=>window.qaMapProps.warningFocus!==null);
      console.log(JSON.stringify({engine,width,actualDocuments:9,actualAreas:94,renderedPolygons:74,toggle:true,detailAndFocus:true}));
      assert.deepEqual(errors,[]);await context.close();continue;
    }
    if(engine==='leaflet') await page.locator('path[stroke="#e11d48"]').first().dispatchEvent('click');
    else await page.evaluate(()=>window.qaShapes.find(p=>p.map&&p.options.strokeColor==='#e11d48').qaListeners.click({}));
    await page.getByRole('heading',{name:'지도 연동 검증 전용'}).waitFor().catch(async e=>{console.log(await page.locator('body').innerText());throw e;});
    assert.equal(await page.getByRole('button',{name:'지도에서 보기',includeHidden:true}).count(),2);
    assert.ok(await page.locator('dialog section').first().evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.getByText('첫 줄\n둘째 줄',{exact:true}).waitFor();
    await page.getByText('구역 1',{exact:true}).click();
    await page.getByRole('button',{name:'지도에서 보기'}).first().click();
    await page.waitForFunction(()=>window.qaMapProps.warningFocus?.vertices.length===4);
    await page.waitForFunction(()=>window.qaCamera.length===1);
    if(engine==='leaflet')assert.equal(await page.locator('path[stroke="#e11d48"][stroke-width="5"]').count(),1);
    else assert.equal(await page.evaluate(()=>window.qaShapes.filter(p=>p.map&&p.options.strokeColor==='#e11d48'&&p.options.strokeWeight===5).length),1);
    // Point selects the same existing detail panel, not a second popup.
    if(engine==='leaflet') await page.locator('path[stroke="#e11d48"]').nth(1).dispatchEvent('click');
    else await page.evaluate(()=>{const o=window.qaOverlays.find(o=>o.map&&o.options.content.outerHTML.includes('#e11d48'));o.options.content.click();});
    await page.getByRole('heading',{name:'지도 연동 검증 전용'}).waitFor();
    await page.getByText('구역 2',{exact:true}).click();
    await page.getByRole('button',{name:'지도에서 보기'}).click();
    await page.waitForFunction(()=>window.qaMapProps.warningFocus?.vertices.length===1);
    // Selection never alters the permit collection or its yellow rendering.
    assert.deepEqual(await page.evaluate(()=>window.qaMapProps.geoJsonLayersData.activity_permits.features.map(f=>f.properties.permitId)),['p1']);
    if(engine==='leaflet')assert.equal(await page.locator('path[stroke="#eab308"]').count(),1);
    else assert.equal(await page.evaluate(()=>window.qaShapes.filter(p=>p.map&&p.options.strokeColor==='#eab308').length),1);
    assert.equal(calls,2);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({engine,width,polygon:true,point:true,toggle:true,detailAndFocus:true,permitCoexistence:true,noRepeatedRequests:true}));
    await context.close();
  }
} finally { await browser.close(); }
