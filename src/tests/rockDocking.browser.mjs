// Local integration QA: real App, layer menu, hooks, calendar and canvas code.
// Firebase and the Kakao SDK are in-memory doubles. Leaflet is real.
// Start Vite; supply PLAYWRIGHT_MODULE and CHROME_EXECUTABLE. No production writes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
console.log('QA launching');
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
import { fixture, service, loadMapViewFixture } from './mapWorkspaceFixtures.mjs';
console.log('QA loading canvas');
const mapView = await loadMapViewFixture(origin);
console.log('QA fixture ready');
let rockService="\nconst p={id:'rock1',islandId:'소매물도',name:'남측 테스트 지점',lat:34.8195,lng:128.552,stationCode:'DT_0014',datum:'unverified',ranges:{101:{min:50,max:150},103:null},confirmedOn:'2026-11-23',photos:[],schemaVersion:1,authorUid:'owner',authorName:'범진',updatedBy:'범진',createdAt:{seconds:1795392000},updatedAt:{seconds:1795392000},revision:1,deleted:false};\nexport function subscribeRockPoints(db,next){queueMicrotask(()=>next([p],false));return()=>{};}\nexport function subscribeRockIslands(db,next){queueMicrotask(()=>next([{id:'소매물도',name:'소매물도'}],false));return()=>{};}\nexport function subscribeRockNotes(db,id,next){queueMicrotask(()=>next([],false));return()=>{};}\nexport const getRockPoint=async()=>p;\nexport const saveRockPoint=async()=>{throw Error('No writes in UI QA');};\nexport const deleteRockPoint=saveRockPoint,saveRockNote=saveRockPoint,deleteRockNote=saveRockPoint,ensureRockIsland=saveRockPoint;\n";
rockService=rockService.replace('const p=', 'let p=').replace('queueMicrotask(()=>next([p],false))','window.qaRockNext=next;queueMicrotask(()=>next([p],false))').replace("export const saveRockPoint=async()=>{throw Error('No writes in UI QA');};","export const saveRockPoint=async(db,profile,input,expected,memo)=>{p={...p,...input,revision:p.revision+1};window.qaSavedRock=p;window.qaRockNext([p],false);return p.id;};");
try {
  for (const engine of (process.env.QA_ENGINES ?? 'leaflet,kakao').split(',')) for (const width of (process.env.QA_WIDTHS ?? '320,390,1280').split(',').map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(45000);
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    await page.addInitScript(value => { window.qaEngine = value; }, engine);

    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.route('**/src/components/MapView.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: mapView }));
    await page.route('**/src/services/activityPermitService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: service }));
    await page.route('**/src/services/announcementService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function subscribeAnnouncementAdmin(db,uid,next){queueMicrotask(()=>next(false));return()=>{};}export function subscribeAnnouncements(db,admin,next){queueMicrotask(()=>next([],false));return()=>{};}export const saveAnnouncement=async()=>{throw Error("No writes");};export const deleteAnnouncement=saveAnnouncement;' }));
    await page.route('**/src/services/firebaseClient.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const getFirebaseClient=()=>({db:{}});export const firebaseConfigurationError="";' }));
    await page.route('**/src/services/calendarFirestoreService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function subscribeCalendar(db,v,m,next){queueMicrotask(()=>next([],false));return()=>{};}export function subscribeCalendarAdmin(db,u,next){queueMicrotask(()=>next(false));return()=>{};}export const saveSharedEntry=async()=>{throw new Error("No writes");};export const deleteSharedEntry=saveSharedEntry;' }));

    await page.route('**/src/services/rockDockingService.ts*',route=>route.fulfill({contentType:'application/javascript',body:rockService}));
    console.log('QA page',engine,width);
    await page.route('**/src/services/rockDockingPhotos.ts*',async route=>{
      const response=await route.fetch();let source=await response.text();
      for(const name of ['rockStorageReady','uploadRockPhoto','loadRockPhoto','removeRockPhoto','rockPhotoStore'])source=source.replace('function '+name+'(', 'function actual'+name+'(');
      source+=`
export function rockStorageReady(){return true;}
export async function uploadRockPhoto(id,owner,role,data){const photoId=crypto.randomUUID(),path='rockDocking/'+id+'/'+owner+'/'+photoId+'.webp';(window.qaPhotoBlobs??=new Map()).set(path,data.blob);return{id:photoId,path,role,size:data.blob.size,width:data.width,height:data.height};}
export async function loadRockPhoto(photo){window.qaPhotoReads=(window.qaPhotoReads??0)+1;return window.qaPhotoBlobs.get(photo.path);}
export async function removeRockPhoto(photo){window.qaPhotoBlobs?.delete(photo.path);}
export function rockPhotoStore(unchanged){window.qaPhotoBlobs??=new Map();return{read:async p=>window.qaPhotoBlobs.get(p.path)??null,write:async(p,d)=>{window.qaPhotoBlobs.set(p.path,d.blob);},restore:async(p,b)=>{window.qaPhotoBlobs.set(p.path,b);},remove:async p=>{window.qaPhotoBlobs.delete(p.path);},unchanged};}
`;
      await route.fulfill({contentType:'application/javascript',body:source});
    });
    await page.goto(origin+'/?screen=notebook',{waitUntil:'commit',timeout:90000});
    console.log('QA loaded');
    await page.waitForFunction(()=>window.qaMapProps);
    const layers=async()=>page.getByRole('group',{name:'바다수첩 기능'}).getByRole('button').first().click();
    await layers();await page.getByRole('checkbox',{name:'갯바위 접안정보 표시',exact:true}).check();
    await page.waitForFunction(()=>window.qaMapProps?.rockPoints.length===1).catch(async e=>{console.log(await page.evaluate(()=>({ready:!!window.qaMapProps,points:window.qaMapProps?.rockPoints,body:document.body.innerText.slice(0,2000)})));throw e;});
    console.log('QA points ready');
    assert.equal(await page.locator('[data-rock-docking]').count(),0,'hidden below zoom threshold');
    await page.getByRole('button',{name:'갯바위 접안정보 목록',exact:true}).click();
    await page.getByText('소매물도',{exact:true}).click();
    await page.screenshot({path:'.dev/docs/rock-docking/list-'+engine+'-'+width+'.png'});
    await page.getByRole('button',{name:'남측 테스트 지점',exact:true}).click();
    await page.getByRole('complementary',{name:'갯바위 접안 간략정보'}).waitFor();
    if(engine==='leaflet'){await page.locator('[data-rock-docking]').waitFor();assert.equal(await page.locator('[data-rock-state="unknown"]').count(),1);}
    else await page.waitForFunction(()=>window.qaOverlays.some(o=>o.map&&(o.options.content.matches('[data-rock-docking]')||o.options.content.querySelector('[data-rock-docking]'))));
    await page.getByRole('button',{name:'상세 보기',exact:true}).click();
    await page.getByRole('heading',{name:'남측 테스트 지점'}).waitFor();
    if(engine==='leaflet' && width===390){
      const compressed=await page.evaluate(async()=>{const {compressRockPhoto}=await import('/src/services/rockDockingPhotos.ts');const c=document.createElement('canvas');c.width=2000;c.height=1000;c.getContext('2d').fillRect(0,0,2000,1000);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const result=await compressRockPhoto(new File([blob],'test.png',{type:'image/png'}));return{type:result.blob.type,size:result.blob.size,width:result.width,height:result.height};});
      assert.equal(compressed.type,'image/webp');assert.equal(compressed.width,1600);assert.equal(compressed.height,800);assert.ok(compressed.size<=512000);
    }

    await page.getByRole('button',{name:'지점 수정'}).click();
    await page.getByLabel('접안 지점명',{exact:true}).fill('입력 유지 테스트');
    await page.getByRole('button',{name:'지도에서 위치 선택',exact:true}).click();
    await page.waitForFunction(()=>window.qaMapProps.isReportPickMode);
    await page.evaluate(()=>window.qaMapProps.onMapClickForReport(34.8,128.5));
    assert.equal(await page.getByLabel('접안 지점명',{exact:true}).inputValue(),'입력 유지 테스트');
    await page.getByText('34.80000°N, 128.50000°E',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('원경',{exact:false}).count()>0,true);
    if(engine==='leaflet'&&width===390){
      const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2000;c.height=1000;c.getContext('2d').fillRect(0,0,2000,1000);return c.toDataURL('image/png').split(',')[1];});
      const file={name:'qa.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
      await page.getByLabel('원경',{exact:true}).setInputFiles(file);await page.getByRole('button',{name:'+ 사진 추가'}).click();await page.getByRole('button',{name:'+ 사진 추가'}).click();assert.equal(await page.locator('input[type=file]').count(),4);assert.equal(await page.getByRole('button',{name:'+ 사진 추가'}).count(),0);
      await page.getByLabel('근경',{exact:true}).setInputFiles(file);await page.getByRole('button',{name:'사진 2 앞으로'}).click();await page.getByRole('button',{name:'사진 4 삭제'}).click();
      await page.getByRole('button',{name:'저장',exact:true}).click();await page.getByRole('heading',{name:'입력 유지 테스트',exact:true}).waitFor();
      await page.waitForFunction(()=>window.qaPhotoReads===2);assert.equal(await page.evaluate(()=>window.qaSavedRock.photos.length),2);assert.equal(await page.evaluate(()=>window.qaSavedRock.photos[0].role),'close');assert.equal(await page.evaluate(()=>Object.hasOwn(window.qaSavedRock,'nonce')),false);
      await page.getByRole('button',{name:'원경 사진 1 확대'}).click();await page.getByRole('dialog',{name:'접안지 사진 확대'}).waitFor();await page.getByRole('button',{name:'다음 사진'}).click();await page.getByText(/^2 \/ 2/).waitFor();await page.keyboard.press('Escape');await page.getByRole('heading',{name:'입력 유지 테스트',exact:true}).waitFor();
    }
    await page.getByRole('button',{name:'접안정보 닫기'}).click();
    await layers();const toggle=page.getByRole('checkbox',{name:'갯바위 접안정보 표시',exact:true});await toggle.uncheck();
    await page.waitForFunction(()=>window.qaMapProps.rockPoints.length===0);
    if(engine==='leaflet')assert.equal(await page.locator('[data-rock-docking]').count(),0);
    else assert.equal(await page.evaluate(()=>window.qaOverlays.filter(o=>o.map&&(o.options.content.matches('[data-rock-docking]')||o.options.content.querySelector('[data-rock-docking]'))).length),0);
    await toggle.check();await page.getByRole('button',{name:'갯바위 접안정보 목록',exact:true}).click();
    await page.getByRole('button',{name:'+ 접안 지점 등록'}).click();
    assert.equal(await page.getByLabel('원경',{exact:false}).count(),1);assert.equal(await page.getByLabel('근경',{exact:false}).count(),1);
    assert.equal(await page.evaluate(()=>document.querySelector('dialog[open] section').scrollWidth<=document.querySelector('dialog[open] section').clientWidth),true);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,width,list:true,marker:true,toggle:true,detail:true,pickerPreservesDraft:true,noOverflow:true}));await context.close();
  }
}finally{await browser.close();}
