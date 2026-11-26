import fs from 'node:fs';import path from 'node:path';
// Isolated UI QA; in-memory photo/note fixtures, no production access.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);

const origin=process.env.QA_ORIGIN??'http://127.0.0.1:5186';
const fixture=`
import React from '/node_modules/.vite/deps/react.js';import {createRoot} from '/node_modules/.vite/deps/react-dom_client.js';import '/src/index.css';import Panel from '/src/components/notebook/RockDockingPanel.tsx';
const c=document.createElement('canvas');c.width=1200;c.height=800;c.getContext('2d').fillRect(0,0,1200,800);window.qaBlob=await new Promise(r=>c.toBlob(r,'image/webp'));window.qaReads=0;window.qaClosed=0;window.qaFocus=0;
const photos=Array.from({length:4},(_,i)=>({id:'photo'+i,path:'test/'+i,role:i===0?'wide':i===1?'close':'extra',size:100,width:1200,height:800}));
const base={id:'p',name:'소매물도 남측 접안지점 긴 이름 모바일 확인',islandId:'island',stationCode:'DT_0014',photos:[],ranges:{101:{min:50,max:150},103:{min:120,max:180}},confirmedOn:'2026-11-26',authorUid:'owner',authorName:'범진',updatedBy:'범진',updatedAt:{seconds:1795660000},revision:1};
function Fixture(){const[count,setCount]=React.useState(0),[mode,setMode]=React.useState('brief'),[open,setOpen]=React.useState(true);window.qaCount=n=>{setCount(n);setMode('brief');setOpen(true);};return open?React.createElement(Panel,{workspace:{profile:{uid:'owner'},points:[{...base,photos:photos.slice(0,count),revision:count+1}],islands:[],ready:true},mode,pointId:'p',hidden:false,picked:null,onPick:()=>{},onNew:()=>{},onFocus:()=>{window.qaFocus++;},onSaved:()=>{},onClose:()=>{window.qaClosed++;setOpen(false);},onMode:setMode,vessel:'101',onVessel:()=>{},time:'2026-11-26T12:00',onTime:()=>{},height:100,state:'inside'}):null;}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));`;
if(process.env.QA_STATIC==='1'){
 const dir='.dev/docs/rock-marker-panel';fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(dir+'/fixture.js',fixture.replace('/node_modules/.vite/deps/react.js','react').replace('/node_modules/.vite/deps/react-dom_client.js','react-dom/client'));
 fs.writeFileSync(dir+'/fixture.html','<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>');
 const mocks={firebaseClient:'export const getFirebaseClient=()=>({db:{}});',rockDockingService:'export function subscribeRockNotes(db,id,next){queueMicrotask(()=>next(Array.from({length:3},(_,i)=>({id:i,text:String(i),authorUid:String(i),authorName:String(i),updatedAt:{seconds:1795660000}}))));return()=>{};}export const deleteRockNote=()=>{},deleteRockPoint=()=>{},ensureRockIsland=()=>{},getRockPoint=()=>{},saveRockNote=()=>{},saveRockPoint=()=>{};',rockDockingPhotos:'export const rockStorageReady=()=>true,compressRockPhoto=()=>{},removeRockPhoto=()=>{},rockPhotoStore=()=>{};export async function loadRockPhoto(){window.qaReads++;await new Promise(r=>setTimeout(r,100));return window.qaBlob;}'};
 const {build}=await import('vite'),{default:react}=await import('@vitejs/plugin-react'),{default:tailwind}=await import('@tailwindcss/vite');
 await build({configFile:false,root:process.cwd(),plugins:[{name:'isolated-panel-fixture',enforce:'pre',load(id){for(const [name,source]of Object.entries(mocks))if(id.replaceAll('\\','/').endsWith('/services/'+name+'.ts'))return source;}},react(),tailwind()],build:{outDir:dir+'/static',emptyOutDir:false,rollupOptions:{input:dir+'/fixture.html'}}});
}
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,headless:true});
try{for(const width of [320,390,1280]){
 const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await page.route('**/src/main.tsx*',r=>r.fulfill({contentType:'application/javascript',body:fixture}));
 await page.route('**/src/services/firebaseClient.ts*',r=>r.fulfill({contentType:'application/javascript',body:'export const getFirebaseClient=()=>({db:{}});'}));
 await page.route('**/src/services/rockDockingService.ts*',r=>r.fulfill({contentType:'application/javascript',body:'export function subscribeRockNotes(db,id,next){queueMicrotask(()=>next(Array.from({length:3},(_,i)=>({id:i,text:String(i),authorUid:String(i),authorName:String(i),updatedAt:{seconds:1795660000}}))));return()=>{};}export const deleteRockNote=()=>{},deleteRockPoint=()=>{},ensureRockIsland=()=>{},getRockPoint=()=>{},saveRockNote=()=>{},saveRockPoint=()=>{};'}));
 await page.route('**/src/services/rockDockingPhotos.ts*',r=>r.fulfill({contentType:'application/javascript',body:'export const rockStorageReady=()=>true,compressRockPhoto=()=>{},removeRockPhoto=()=>{},rockPhotoStore=()=>{};export async function loadRockPhoto(){window.qaReads++;await new Promise(r=>setTimeout(r,100));return window.qaBlob;}'}));
 if(process.env.QA_STATIC==='1')await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();const root=path.resolve('.dev/docs/rock-marker-panel/static'),file=path.resolve(root,'.'+(u.pathname==='/'?'/.dev/docs/rock-marker-panel/fixture.html':u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return r.abort();let body=fs.readFileSync(file);return r.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 page.setDefaultTimeout(45000);await page.goto(origin,{waitUntil:'commit',timeout:60000});const panel=page.getByRole('complementary',{name:'갯바위 접안 간략정보'});await panel.waitFor();
 for(const count of [0,1,2,4]){
  await page.evaluate(n=>window.qaCount(n),count);await page.waitForFunction(n=>document.querySelectorAll('aside figure').length===n,count);
  if(count)await page.waitForFunction(n=>[...document.querySelectorAll('aside figure img')].filter(i=>i.complete&&i.naturalWidth).length===n,count);
  assert.equal(await panel.locator('figure').count(),count);await panel.getByText('현장 메모 3건',{exact:true}).waitFor();assert.match(await panel.innerText(),/101호: 범위 내/);assert.match(await panel.innerText(),/103호: 범위 밖/);await panel.getByText('현재 예보 조위 100cm · 통영 기준',{exact:true}).waitFor();
  const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+.5);assert.ok(box.height<=844*.58+1);if(count)assert.ok(box.height>=844*.55);else assert.ok(box.height<360);
  assert.equal(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  if(count){const reads=await page.evaluate(()=>window.qaReads);assert.ok(await panel.locator('figure img').first().evaluate(e=>e.naturalWidth<=480));
   await panel.getByRole('button',{name:'원경 사진 1 확대'}).click();const viewer=page.getByRole('dialog',{name:'접안지 사진 확대'});await viewer.waitFor();await viewer.locator('img').waitFor();assert.equal(await viewer.locator('img').evaluate(e=>e.naturalWidth),1200);
   if(count>1){await viewer.getByRole('button',{name:'다음 사진'}).click();await viewer.getByText(new RegExp('^2 / '+count)).waitFor();
    await viewer.locator('img').dispatchEvent('touchstart',{touches:[{identifier:0,clientX:220,clientY:220}]});await viewer.locator('img').dispatchEvent('touchend',{changedTouches:[{identifier:0,clientX:300,clientY:222}]});await viewer.getByText(new RegExp('^1 / '+count)).waitFor();}
   await viewer.getByRole('button',{name:'사진 확대 닫기'}).click();await viewer.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.qaReads),reads);
  }
  await page.screenshot({path:'.dev/docs/rock-marker-panel/panel-'+width+'-'+count+'.png'});
 }
 await panel.getByRole('button',{name:'상세 보기'}).click();await page.getByRole('heading',{name:'소매물도 남측 접안지점 긴 이름 모바일 확인',exact:true}).waitFor();await page.getByRole('button',{name:'접안정보 닫기',exact:true}).click();assert.equal(await page.evaluate(()=>window.qaFocus),0);assert.equal(await page.evaluate(()=>window.qaClosed),1);assert.deepEqual(errors,[]);console.log(JSON.stringify({width,photos:[0,1,2,4],viewer:true,swipe:true,noOverflow:true,noCameraChange:true}));await context.close();
}}finally{await browser.close();}
