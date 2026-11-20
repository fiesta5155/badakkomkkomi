// Local reference-label QA; real Leaflet, synthetic Kakao SDK, no external writes.
// Start Vite and set PLAYWRIGHT_MODULE, CHROME_EXECUTABLE (local Chromium).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fixture, service, loadMapViewFixture } from './mapWorkspaceFixtures.mjs';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
const mapView = await loadMapViewFixture(origin);
const { features } = JSON.parse(readFileSync(new URL('../../data/public-port-names.final-candidate.geojson', import.meta.url), 'utf8'));
const count = 154;
const names = ['연대항', '학림항', '어의항', '연명항'];
const stored = features.map(({ properties, geometry }) => ({
  name: properties.name, lng: geometry.coordinates[0], lat: geometry.coordinates[1],
}));
assert.equal(stored.length, count);
try {
  for (const engine of ['leaflet', 'kakao']) for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 600, serviceWorkers: 'block' });
    await context.addInitScript(engine => { window.qaEngine = engine; }, engine);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.route('**/src/components/MapView.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: mapView }));
    await page.route('**/src/services/activityPermitService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: service }));
    await page.route('**/src/services/firebaseClient.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const getFirebaseClient=()=>({db:{}});export const firebaseConfigurationError="";' }));
    await page.route('**/src/services/announcementService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function subscribeAnnouncementAdmin(db,u,next){queueMicrotask(()=>next(false));return()=>{};}export function subscribeAnnouncements(db,a,next){queueMicrotask(()=>next([],false));return()=>{};}export const saveAnnouncement=async()=>{throw Error("No writes");};export const deleteAnnouncement=saveAnnouncement;' }));
    await page.route('**/src/services/calendarFirestoreService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function subscribeCalendar(db,v,m,next){queueMicrotask(()=>next([],false));return()=>{};}export function subscribeCalendarAdmin(db,u,next){queueMicrotask(()=>next(false));return()=>{};}export const saveSharedEntry=async()=>{throw Error("No writes");};export const deleteSharedEntry=saveSharedEntry;' }));
    await page.goto(origin + '/?screen=notebook', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(count => window.qaMapProps?.portNamePoints.length === count, count);
    await page.waitForFunction(({engine,count}) => engine === 'leaflet'
      ? (window.qaReferenceMarkers ?? []).filter(m => m._map).length === count
      : window.qaOverlays.filter(o => o.map && o.options.content?.matches?.('[data-reference-point="port_names"]')).length === count, {engine,count});
    const positions = () => page.evaluate(engine => engine === 'leaflet'
      ? (window.qaReferenceMarkers ?? []).filter(m => m._map).map(m => ({ name: m.getElement().querySelector('button').getAttribute('aria-label'), lat: m.getLatLng().lat, lng: m.getLatLng().lng }))
      : window.qaOverlays.filter(o => o.map && o.options.content?.matches?.('[data-reference-point="port_names"]')).map(o => ({ name: o.options.content.getAttribute('aria-label'), lat: o.options.position.getLat(), lng: o.options.position.getLng() })), engine);
    assert.deepEqual(await positions(), stored);
    const unchanged = await page.evaluate(() => JSON.stringify({ routes: window.qaMapProps.routeWaypoints, layers: window.qaMapProps.layers, data: window.qaMapProps.geoJsonLayersData }));
    for (const zoom of [10, 11, 12, 14, 16, 11]) {
      await page.evaluate(({ engine, zoom }) => {
        if (engine === 'leaflet') window.qaLeafletMap.setZoom(zoom, { animate: false });
        else { window.qaKakaoMap.setLevel(19 - zoom); window.qaKakaoMap.qaListeners.zoom_changed(); }
      }, { engine, zoom });
      await page.waitForFunction(({ engine, zoom, count }) => {
        const buttons = engine === 'leaflet' ? [...document.querySelectorAll('[data-reference-point="port_names"]')]
          : window.qaOverlays.filter(o => o.map && o.options.content?.matches?.('[data-reference-point="port_names"]')).map(o => o.options.content);
        const labelCount = buttons.filter(b => b.querySelector('[data-reference-label]')).length;
        return buttons.length === count && buttons.every(b => b.querySelector('[data-reference-symbol]')) && (zoom < 12 ? labelCount === 0 : labelCount > 0);
      }, { engine, zoom, count });
      assert.deepEqual(await positions(), stored);
    }
    for (const name of names) {
      await page.evaluate(({ engine, name }) => {
        const button = engine === 'leaflet'
          ? document.querySelector(`[data-reference-point="port_names"][aria-label="${name}"]`)
          : window.qaOverlays.find(o => o.map && o.options.content?.getAttribute('aria-label') === name).options.content;
        button.click();
      }, { engine, name });
      await page.waitForFunction(({ engine, name }) => engine === 'leaflet'
        ? document.querySelector(`[aria-label="${name}"] [data-reference-tip]`)
        : window.qaOverlays.some(o => o.map && o.options.content?.getAttribute('aria-label') === name && o.options.content.querySelector('[data-reference-tip]')), { engine, name });
      const geometry = await page.evaluate(({ engine, name }) => {
        const button = engine === 'leaflet' ? document.querySelector(`[data-reference-point="port_names"][aria-label="${name}"]`)
          : window.qaOverlays.find(o => o.map && o.options.content?.getAttribute('aria-label') === name).options.content.cloneNode(true);
        if (engine === 'kakao') document.body.append(button);
        const target = button.getBoundingClientRect(), tip = button.querySelector('[data-reference-tip]').getBoundingClientRect();
        const symbol = button.querySelector('[data-reference-symbol]').getBoundingClientRect();
        const result = { width: target.width, height: target.height, tipX: (tip.left + tip.right) / 2 - target.left, tipY: tip.bottom - target.top,
          symbolX: (symbol.left + symbol.right) / 2 - target.left, symbolY: (symbol.top + symbol.bottom) / 2 - target.top };
        if (engine === 'kakao') button.remove();
        return result;
      }, { engine, name });
      assert.equal(geometry.width, 52); assert.equal(geometry.height, 52);
      assert.ok(Math.abs(geometry.tipX - 26) < 0.1 && Math.abs(geometry.tipY - 26) < 0.1, JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.symbolX - 26) < 0.1 && Math.abs(geometry.symbolY - 26) < 0.1, JSON.stringify(geometry));
    }
    assert.equal(await page.evaluate(() => JSON.stringify({ routes: window.qaMapProps.routeWaypoints, layers: window.qaMapProps.layers, data: window.qaMapProps.geoJsonLayersData })), unchanged);
    await page.getByRole('button', { name: /^(공간 )?레이어$/ }).click();
    const toggle = page.getByRole('switch', { name: /^항·포구 명칭/ });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true'); await toggle.click(); await page.waitForFunction(() => window.qaMapProps.portNamePoints.length === 0);
    assert.deepEqual(await positions(), []);
    assert.equal(await toggle.getAttribute('aria-checked'), 'false'); await toggle.click(); await page.waitForFunction(count => window.qaMapProps.portNamePoints.length === count, count);
    await page.waitForFunction(({engine,count}) => engine === 'leaflet'
      ? (window.qaReferenceMarkers ?? []).filter(m => m._map).length === count
      : window.qaOverlays.filter(o => o.map && o.options.content?.matches?.('[data-reference-point="port_names"]')).length === count, {engine,count});
    assert.deepEqual(await positions(), stored);
    assert.equal(await page.evaluate(() => JSON.stringify({ routes: window.qaMapProps.routeWaypoints, layers: window.qaMapProps.layers, data: window.qaMapProps.geoJsonLayersData })), unchanged);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine, width, positions: count, persistentSymbolsAtZoom: [10,11,12,14,16,11], alignedNames: 4, toggles: true, otherLayersAndRoutesUnchanged: true }));
    await context.close();
  }
} finally { await browser.close(); }
