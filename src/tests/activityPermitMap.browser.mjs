// Local integration QA: real App, layer menu, hooks, calendar and canvas code.
// Firebase and the Kakao SDK are in-memory doubles. Leaflet is real.
// Start Vite; supply PLAYWRIGHT_MODULE and CHROME_EXECUTABLE. No production writes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import '/src/index.css';
import {App} from '/src/App.tsx';
import {FirebaseAuthContext} from '/src/hooks/useFirebaseAuth.ts';
const vertex=(a,b)=>({latDms:{degrees:34,minutes:a,seconds:0,hemisphere:'N'},lngDms:{degrees:128,minutes:b,seconds:0,hemisphere:'E'},lat:34+a/60,lng:128+b/60});
const make=(id,number,b,start='2026-11-19',end='2026-11-19')=>({id,permitNumber:'통영양식 제'+number+'호',target:'미역',sourceCrs:'EPSG:4326',vertices:[vertex(48,b),vertex(48,b+1),vertex(49,b+1),vertex(49,b)],startDate:start,endDate:end,notes:'',schemaVersion:1,authorUid:'owner',authorName:'범진',revision:1});
window.qaFixtures=[make('p1',1531,32),make('p2',1532,34),make('p3',1533,36),make('expired',1534,38,'2026-11-01','2026-11-18'),make('future',1535,40,'2026-11-20','2026-11-20')];
window.qaPermitSubscriptions=0;window.qaCamera=[];window.qaShapes=[];window.qaOverlays=[];
const none=async()=>{};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FirebaseAuthContext.Provider,{value:{status:'ready',user:{uid:'owner'},profile:{uid:'owner',realName:'범진'},error:'',busy:false,editingName:false,login:none,logout:none,retryProfile:none,saveName:none,editName:none,cancelEditName:none}},React.createElement(App)));
`;
const service = `
export function subscribePermits(db,next){window.qaPermitSubscriptions++;window.qaEmit=records=>next(records,false);queueMicrotask(()=>next([],false));return()=>{window.qaEmit=undefined;};}
export function subscribeInvestigations(db,vessel,month,next){queueMicrotask(()=>next([],false));return()=>{};}
export const savePermit=async()=>{throw new Error('No writes in map QA');};
export const deletePermit=savePermit,addInvestigations=savePermit,updateInvestigation=savePermit,deleteInvestigation=savePermit;
`;
const mapView = `
import React from '/node_modules/.vite/deps/react.js';
import L from '/node_modules/.vite/deps/leaflet.js';
import '/node_modules/leaflet/dist/leaflet.css';
import {LegacyLeafletCanvas} from '/src/components/map/LegacyLeafletCanvas.tsx';
import {KakaoMapCanvas} from '/src/components/map/KakaoMapCanvas.tsx';
const fit=L.Map.prototype.fitBounds;L.Map.prototype.fitBounds=function(...args){window.qaCamera.push('fitBounds');return fit.apply(this,args);};
class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}}
class Bounds{constructor(){this.points=[];}extend(p){this.points.push(p);}}
class Map{constructor(el,o){this.center=o.center;this.level=o.level;}getCenter(){return this.center;}setCenter(p){this.center=p;}getLevel(){return this.level;}setLevel(v){this.level=v;}setBounds(b){window.qaCamera.push('setBounds');this.center=b.points[0];}relayout(){}setMapTypeId(){}addOverlayMapTypeId(){}removeOverlayMapTypeId(){}}
class Shape{constructor(o){this.options=o;this.map=o.map;window.qaShapes.push(this);}setMap(m){this.map=m;}}
class Overlay{constructor(o){this.options=o;this.map=o.map;window.qaOverlays.push(this);}setMap(m){this.map=m;}getPosition(){return this.options.position;}setPosition(p){this.options.position=p;}}
const sdk={LatLng,LatLngBounds:Bounds,Map,Polygon:Shape,Polyline:Shape,Circle:Shape,CustomOverlay:Overlay,MapTypeId:{ROADMAP:1,SKYVIEW:2,HYBRID:3},event:{addListener(){},removeListener(){},preventMap(){}}};
const viewport={lat:34.8195,lng:128.552,zoom:11},overlays=[];
export function MapView(props){window.qaMapProps=props;const Canvas=window.qaEngine==='kakao'?KakaoMapCanvas:LegacyLeafletCanvas;return React.createElement('div',{style:{height:'100dvh'}},React.createElement(Canvas,{...props,kakaoMaps:sdk,baseMapType:'roadmap',overlayMapTypes:overlays,viewport,onViewportChange:()=>{},zoomStepTrigger:null,onMapClickForRoadview:()=>{}}));}
`;
try {
  for (const engine of ['leaflet', 'kakao']) for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(value => { window.qaEngine = value; }, engine);
    await page.clock.install({ time: new Date('2026-11-19T12:00:00+09:00') });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.route('**/src/components/MapView.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: mapView }));
    await page.route('**/src/services/activityPermitService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: service }));
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
    const toggle = page.getByRole('checkbox', { name: '행위허가', exact: true });
    await toggle.uncheck(); await expectRendered(0);
    await page.evaluate(() => window.qaEmit(window.qaFixtures)); await expectIds(['p1', 'p2', 'p3']); await expectRendered(0);
    await toggle.check(); await expectRendered(3);
    await toggle.uncheck(); await expectRendered(0);
    await page.getByRole('button', { name: '레이어 창 닫기' }).click();
    await page.getByRole('button', { name: '행위허가', exact: true }).click();
    await page.getByRole('button', { name: /통영양식 제1531호-미역/ }).click();
    await page.waitForFunction(() => window.qaMapProps.layers.find(l => l.id === 'activity_permits').visible);
    await expectIds(['p1', 'p2', 'p3']); await expectRendered(3);
    await page.waitForFunction(() => window.qaCamera.length === 1);
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
