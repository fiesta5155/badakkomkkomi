// Optional local UI QA. Start npm run dev, set PLAYWRIGHT_MODULE and CHROME_EXECUTABLE.
// All Firebase access is replaced in this isolated browser context; no production writes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
import '/src/index.css';
import {ActivityPermitPanel} from '/src/components/notebook/ActivityPermitPanel.tsx';
import {PermitInvestigationSection} from '/src/components/calendar/PermitInvestigationSection.tsx';
import {FirebaseAuthContext} from '/src/hooks/useFirebaseAuth.ts';
import {LegacyLeafletCanvas} from '/src/components/map/LegacyLeafletCanvas.tsx';
import {permitLayer,permitFeatureCollection} from '/src/services/activityPermitModel.ts';
const leafletStyles=document.createElement('link');leafletStyles.rel='stylesheet';leafletStyles.href='/node_modules/leaflet/dist/leaflet.css';document.head.append(leafletStyles);
const vertex=(a,b)=>({latDms:{degrees:34,minutes:a,seconds:0,hemisphere:'N'},lngDms:{degrees:128,minutes:b,seconds:0,hemisphere:'E'},lat:34+a/60,lng:128+b/60});
const p={id:'p1',permitNumber:'통영양식 제1531호',target:'미역',sourceCrs:'EPSG:4326',vertices:[vertex(48,24),vertex(48,25),vertex(49,25),vertex(49,24)],startDate:'2026-11-01',endDate:'2026-11-30',notes:'현장 비고',authorUid:'owner',authorName:'범진',revision:1};
window.qaWorkspace={profile:{uid:'owner',realName:'범진'},records:[p,{...p,id:'p2',target:'굴'},{...p,id:'old',endDate:'2026-10-31',startDate:'2026-10-01'}],ready:true,error:'',today:'2026-11-19',isAdmin:false,retry:()=>{}};
window.qaSchedules=[];window.qaListeners=new Set();window.qaNotify=()=>window.qaListeners.forEach(f=>f());
window.qaSaves=[];
function Fixture(){
 const [view,setView]=React.useState({mode:'list',selected:null,date:'2026-11-19',vessel:'101'});
 React.useEffect(()=>{window.qaView=(value)=>setView(v=>({...v,...value}));},[]);
 const focus=(p)=>{window.qaFocus=p;setView(v=>({...v,mode:'detail',selected:p}));};
 return React.createElement(FirebaseAuthContext.Provider,{value:{status:'ready',profile:window.qaWorkspace.profile}},
   view.mode==='calendar'?React.createElement('main',{className:'mx-auto max-w-lg p-3'},React.createElement(PermitInvestigationSection,{date:view.date,vessel:view.vessel,isAdmin:false,workspace:window.qaWorkspace,onOpenPermit:(id,p)=>focus({...p,id})})):
   React.createElement(React.Fragment,null,view.mode==='detail'&&React.createElement('div',{style:{height:'100dvh'}},React.createElement(LegacyLeafletCanvas,{
    baseMapType:'roadmap',overlayMapTypes:[],activeMainTab:'notebook',navSubTab:'route',features:[],selectedFeature:null,layers:[permitLayer(undefined,view.mapVisible!==false)],geoJsonLayersData:{activity_permits:permitFeatureCollection([view.selected])},
    showPorpoiseLayer:false,isPorpoiseAddMode:false,isReportPickMode:false,porpoiseRecords:[],routeWaypoints:[],routeLegs:[],portsList:[],showPortMarkersOnMap:false,weatherCoords:{lat:34.8,lng:128.4},weatherGrade:'unknown',userLocation:null,viewport:{lat:34.8,lng:128.4,zoom:11},flyTarget:null,zoomStepTrigger:null,
    permitFocus:{vertices:view.selected.vertices,nonce:1},onSelectPermit:id=>{window.qaPolygonClick=id;},onViewportChange:(lat,lng,zoom)=>{window.qaViewport={lat,lng,zoom};},onSelectFeature:()=>{},onSelectPorpoise:()=>{},onMapClickForPorpoise:()=>{},onMapClickForReport:()=>{},onUpdateWaypointPos:()=>{},onMapClickForRoute:()=>{},onUpdateWeatherCoords:()=>{}
   })),React.createElement(ActivityPermitPanel,{workspace:window.qaWorkspace,mode:view.mode,selected:view.selected,onClose:()=>setView(v=>({...v,mode:'list',selected:null})),onFocus:focus})));
}
ReactDOMClient.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const service = `
import {validatePermit} from '/src/services/activityPermitModel.ts';
export const savePermit=async(db,profile,input,existing)=>{validatePermit(input);const id=existing?.id??'new';window.qaSaves.push(input);window.qaWorkspace.records.push({...input,id,authorUid:profile.uid,authorName:profile.realName});return id;};
export const deletePermit=async()=>{};
export function subscribeInvestigations(db,vessel,month,next){const update=()=>next(window.qaSchedules.filter(s=>s.vessel===vessel&&s.date.startsWith(month)),false);window.qaListeners.add(update);queueMicrotask(update);return()=>window.qaListeners.delete(update);}
export async function addInvestigations(db,profile,ids,vessel,date){for(const id of ids){const p=window.qaWorkspace.records.find(p=>p.id===id);window.qaSchedules.push({id:'s'+id,permitId:id,permitSnapshot:p,date,vessel,status:'planned',authorUid:profile.uid,authorName:profile.realName});}window.qaNotify();}
export async function updateInvestigation(db,profile,s,input){Object.assign(window.qaSchedules.find(x=>x.id===s.id),input);window.qaNotify();}
export async function deleteInvestigation(db,s){window.qaSchedules=window.qaSchedules.filter(x=>x.id!==s.id);window.qaNotify();}
`;
try {
 for (const width of [320,390,1280]) {
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  const page=await context.newPage(), errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.stack));
  // Block every external origin so even an accidental integration cannot write to Firebase.
  await page.route('**/*',async route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.route('**/src/main.tsx*',route=>route.fulfill({contentType:'application/javascript',body:fixture}));
  await page.route('**/src/hooks/useActivityPermits.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const useActivityPermits=()=>window.qaWorkspace;'}));
  await page.route('**/src/services/firebaseClient.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const getFirebaseClient=()=>({db:{}});export const firebaseConfigurationError="";'}));
  await page.route('**/src/services/activityPermitService.ts*',route=>route.fulfill({contentType:'application/javascript',body:service}));
  await page.goto(origin);try {await page.getByRole('button',{name:'+ 신규 등록',exact:true}).waitFor({timeout:10000});} catch(e){console.log({errors,body:await page.locator('body').innerText()});throw e;}
  assert.equal(await page.getByText('2026-10-01 ~ 2026-10-31 · 만료').count(),1);
  await page.getByRole('button',{name:'+ 신규 등록',exact:true}).click();
  await page.getByRole('button',{name:'+ 지점 추가',exact:true}).click();
  assert.equal(await page.getByLabel('마 위도 도',{exact:true}).count(),1);
  await page.getByRole('button',{name:'삭제',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'삭제',exact:true}).count(),0);
  await page.getByLabel('허가번호',{exact:true}).fill('통영양식 제2041호');
  await page.getByLabel('조사 대상',{exact:true}).fill('미역 및 굴 장문 조사대상');
  await page.getByLabel('원본 좌표계').selectOption('EPSG:4326');
  for(const [i,[a,b]] of [[48,24],[48,25],[49,25],[49,24]].entries())for(const [axis,values] of [['위도',[34,a,0]],['경도',[128,b,0]]])for(let j=0;j<3;j++)await page.getByLabel([... '가나다라'][i]+' '+axis+' '+['도','분','초'][j],{exact:true}).fill(String(values[j]));
  await page.getByLabel('조사 가능 시작일',{exact:true}).fill('2026-11-01');
  await page.getByLabel('조사 가능 종료일',{exact:true}).fill('2026-11-30');
  const overflow=await page.locator('dialog').evaluate(d=>({width:d.getBoundingClientRect().width,scroll:d.scrollWidth,client:d.clientWidth}));
  assert.ok(overflow.width<=width&&overflow.scroll<=overflow.client+1,JSON.stringify(overflow));
  if(process.env.QA_SCREENSHOT_DIR){await page.locator('dialog').evaluate(el=>el.scrollTop=0);await page.screenshot({path:process.env.QA_SCREENSHOT_DIR+'/bada-permit-form-'+width+'.png'});}
  await page.getByRole('button',{name:'저장',exact:true}).click();await page.getByRole('complementary',{name:'행위허가 상세정보'}).waitFor();
  assert.equal(await page.evaluate(()=>window.qaFocus.vertices.length),4);
  await page.evaluate(()=>window.qaView({mode:'calendar'}));
  await page.getByRole('button',{name:'+ 조사 일정 추가',exact:true}).click();
  await page.getByRole('checkbox').nth(0).check();await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button',{name:'선택 일정 저장',exact:true}).click();
  await page.getByRole('button',{name:'일정 변경',exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'일정 변경',exact:true}).count(),2);
  await page.getByRole('button',{name:'일정 변경',exact:true}).first().click();
  await page.getByLabel('조사 날짜',{exact:true}).fill('2026-11-20');
  await page.getByLabel('선박').selectOption('103');
  await page.getByLabel('상태').selectOption('completed');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'일정 변경',exact:true}).count(),1);
  await page.evaluate(()=>window.qaView({date:'2026-11-20',vessel:'103'}));
  await page.getByText('조사 완료 · 범진',{exact:true}).waitFor();
  assert.ok(await page.locator('section').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.getByRole('button',{name:'통영양식 제1531호-미역',exact:true}).click();
  await page.getByRole('complementary',{name:'행위허가 상세정보'}).waitFor();
  assert.equal(await page.evaluate(()=>window.qaFocus.id),'p1');
  const polygon=page.locator('path.leaflet-interactive');await polygon.waitFor();
  await page.getByText('1531-미역',{exact:true}).waitFor();
  const bounds=await polygon.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=900,JSON.stringify(bounds));
  await polygon.click({position:{x:bounds.width*.25,y:bounds.height*.25}});assert.equal(await page.evaluate(()=>window.qaPolygonClick),'p1');
  if(process.env.QA_SCREENSHOT_DIR)await page.screenshot({path:process.env.QA_SCREENSHOT_DIR+'/bada-permit-map-'+width+'.png'});
  await page.evaluate(()=>window.qaView({mapVisible:false}));await polygon.waitFor({state:'detached'});
  await page.evaluate(()=>window.qaView({mapVisible:true}));await polygon.waitFor();
  await page.evaluate(()=>window.qaView({selected:{...window.qaFocus,target:'<img src=x onerror="window.qaInjected=true">'}}));
  await page.locator('.leaflet-tooltip').getByText('1531-<img src=x onerror="window.qaInjected=true">',{exact:true}).waitFor();
  assert.equal(await page.locator('.leaflet-tooltip img').count(),0);assert.equal(await page.evaluate(()=>window.qaInjected),undefined);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,form:'pass',noHorizontalOverflow:true,expiredList:true,multiSchedule:true,dateVesselStatusMove:true,mapFocusPayload:true,leafletFitClickVisibility:true,errors}));
  await context.close();
 }
} finally {await browser.close();}
