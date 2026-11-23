// Local integration QA: real App, layer menu, hooks, calendar and canvas code.
// Firebase and the Kakao SDK are in-memory doubles. Leaflet is real.
// Start Vite; supply PLAYWRIGHT_MODULE and CHROME_EXECUTABLE. No production writes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
import { fixture, service, loadMapViewFixture } from './mapWorkspaceFixtures.mjs';
const mapView = await loadMapViewFixture(origin);
try {
  for (const engine of (process.env.QA_ENGINES ?? 'leaflet,kakao').split(',')) for (const width of (process.env.QA_WIDTHS ?? '320,390,1280').split(',').map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
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
    await page.goto(origin + '/?screen=notebook');
    await page.waitForFunction(() => window.qaEmit && window.qaMapProps);
    const expectIds = async ids => page.waitForFunction(expected => JSON.stringify(window.qaMapProps.geoJsonLayersData.activity_permits.features.map(f => f.properties.permitId)) === JSON.stringify(expected), ids);
    const expectRendered = async count => {
      if (engine === 'leaflet') await page.waitForFunction(n => document.querySelectorAll('path[stroke="#eab308"]').length === n, count);
      else await page.waitForFunction(n => window.qaShapes.filter(p => p.map && p.options.strokeColor === '#eab308').length === n, count);
    };
    await expectIds([]);
    assert.equal(await page.evaluate(() => window.qaCamera.length), 0);
    await page.evaluate(() => window.qaEmit([window.qaFixtures[0], window.qaFixtures[1], window.qaFixtures[3], window.qaFixtures[4]]));
    await expectIds(['p1', 'p2']); await expectRendered(2);
    assert.equal(await page.evaluate(() => window.qaMapProps.permitFocus), null);
    assert.equal(await page.evaluate(() => window.qaCamera.length), 0);
    // Use the existing layer menu, rather than calling a test-only visibility setter.
    await page.getByRole('group', { name: '바다수첩 기능' }).getByRole('button').first().click();
    const toggle = page.getByRole('checkbox', { name: '행위허가 표시', exact: true });
    await toggle.uncheck(); await expectRendered(0);
    await page.evaluate(() => window.qaEmit(window.qaFixtures)); await expectIds(['p1', 'p2', 'p3']); await expectRendered(0);
    await toggle.check(); await expectRendered(3);
    await toggle.uncheck(); await expectRendered(0);
    await page.getByRole('button', { name: '레이어 창 닫기' }).click();
    await page.getByRole('button', { name: '행위허가', exact: true }).click();
    await page.getByRole('button', { name: /통영양식 제1531호-미역/ }).click();
    await page.waitForFunction(() => window.qaMapProps.layers.find(l => l.id === 'activity_permits').visible);
    await expectIds(['p1', 'p2', 'p3']); await expectRendered(3);
    await page.waitForFunction(() => window.qaCamera.length >= 1);
    assert.equal(await page.evaluate(() => window.qaCamera.length), 1, 'one camera move per explicit selection');
    if (engine === 'kakao') assert.ok(await page.evaluate(() => window.qaOverlays.some(o => o.map && o.options.content.textContent.includes('1531-미역'))));
    else await page.getByText('1531-미역', { exact: true }).waitFor();
    await page.evaluate(() => {
      const p = window.qaFixtures[0];
      window.qaUpdated = { ...p, revision: 2, vertices: p.vertices.map(v => ({ ...v, latDms: { ...v.latDms, minutes: v.latDms.minutes + 1 }, lat: v.lat + 1 / 60 })) };
      window.qaEmit([window.qaUpdated, ...window.qaFixtures.slice(1)]);
    });
    await page.waitForFunction(() => window.qaMapProps.geoJsonLayersData.activity_permits.features[0].geometry.coordinates[0][0][1] === window.qaUpdated.vertices[0].lat);
    await expectRendered(3);
    assert.equal(await page.evaluate(() => window.qaCamera.length), 1);
    await page.evaluate(() => window.qaEmit(window.qaFixtures.slice(1))); await expectIds(['p2', 'p3']); await expectRendered(2);
    assert.equal(await page.evaluate(() => window.qaCamera.length), 1);
    await page.clock.setFixedTime(new Date('2026-11-20T00:00:01+09:00'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expectIds(['future']); await expectRendered(1);
    await page.getByRole('button', { name: '행위허가 닫기' }).click(); await expectIds(['future']); await expectRendered(1);
    await page.getByRole('button', { name: '행위허가', exact: true }).click();
    await page.getByRole('button', { name: /통영양식 제1534호-미역/ }).click();
    await expectIds(['future']); await expectRendered(1);
    await page.waitForFunction(() => window.qaCamera.length === 2);
    // Calendar detail reuses App's permit subscription, and returning does not fit bounds.
    await page.evaluate(() => { history.pushState(null, '', '?screen=calendar'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('heading', { name: '꼬미의 달력', exact: true }).waitFor();
    await page.getByRole('button', { name: /^2026년 11월 20일/ }).click();
    await page.getByRole('heading', { name: '행위허가 조사', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.qaPermitSubscriptions), 1);
    await page.evaluate(() => { history.pushState(null, '', '?screen=notebook'); dispatchEvent(new PopStateEvent('popstate')); });
    await expectRendered(1);
    assert.equal(await page.evaluate(() => window.qaCamera.length), 2);
    assert.equal(await page.evaluate(() => window.qaPermitSubscriptions), 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine, width, initialDisplay: true, layerToggle: true, selectionEnablesAllValid: true, realtimeUpdates: true, expiryAndDeletion: true, noAutomaticFit: true, sharedSubscriptionCount: 1 }));
    await context.close();
  }
} finally { await browser.close(); }
