// Production SW QA in an isolated browser; no official API/Firebase access or writes.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=path.resolve('dist'),manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.webmanifest'),'utf8')),base=manifest.scope;
const files=(await fs.readdir(path.join(root,'data/tide-series'))).filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();assert.equal(files.length,32);
const original=JSON.parse(await fs.readFile(path.join(root,'data/tide-series',files[0]),'utf8'));
const corrupt=new Set(),overrides=new Map(),requests=[];
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(!u.pathname.startsWith(base)){res.writeHead(404).end();return;}
 const relative=decodeURIComponent(u.pathname.slice(base.length))||'index.html';const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep)){res.writeHead(404).end();return;}
 const date=relative.match(/^data\/tide-series\/(\d{4}-\d{2}-\d{2})\.json$/)?.[1];if(date)requests.push(date);
 let body;if(date&&corrupt.has(date))body=Buffer.from('{}');else if(date&&overrides.has(date))body=Buffer.from(JSON.stringify(overrides.get(date)));else body=await fs.readFile(target);
 const ext=path.extname(target),type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'}[ext]??'application/octet-stream';
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);
 }catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'}),page=await context.newPage();
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
 assert.equal(requests.length,0,'home precache/startup must not fetch series');
 await page.goto(origin+base+'?screen=notebook',{waitUntil:'domcontentloaded'});await page.waitForTimeout(300);assert.equal(requests.length,0,'notebook entry must not fetch series');
 const fetchDay=async date=>page.evaluate(async url=>{try{const r=await fetch(url,{cache:'no-store'});const value=await r.json();return{ok:r.ok,value};}catch{return{ok:false};}},base+'data/tide-series/'+date+'.json');
 const cacheKeys=()=>page.evaluate(async()=>{const c=await caches.open('bada-khoa-tide-series-v1');return(await c.keys()).map(k=>k.url);});
 const date=original.date;assert.equal((await fetchDay(date)).value.stations[0].heightsCm.length,288);
 await page.waitForFunction(async()=>{const c=await caches.open('bada-khoa-tide-series-v1');return(await c.keys()).length===1;});
 await context.setOffline(true);assert.equal((await fetchDay(date)).value.generatedAt,original.generatedAt);await context.setOffline(false);
 corrupt.add(date);assert.equal((await fetchDay(date)).value.generatedAt,original.generatedAt);corrupt.delete(date);
 const second=files[1].slice(0,10);corrupt.add(second);assert.equal((await fetchDay(second)).ok,false);assert.ok(!(await cacheKeys()).some(x=>x.includes(second)));corrupt.delete(second);
 const older={...original,generatedAt:new Date(Date.parse(original.generatedAt)-3600000).toISOString()};overrides.set(date,older);assert.equal((await fetchDay(date)).value.generatedAt,original.generatedAt);overrides.delete(date);
 const synthetic=[];for(let i=0;i<36;i++){const d=new Date(Date.UTC(2025,9,1+i)).toISOString().slice(0,10);synthetic.push(d);overrides.set(d,{...original,date:d});assert.equal((await fetchDay(d)).ok,true);}
 await page.waitForFunction(async()=>{const c=await caches.open('bada-khoa-tide-series-v1');return(await c.keys()).length<=35;});
 const keys=await cacheKeys();assert.equal(keys.length,35);assert.ok(!keys.some(k=>k.includes(synthetic[0])));const last=synthetic.at(-1);assert.ok(keys.some(k=>k.includes(last)));
 // Age only this isolated test cache/expiration DB; never a user browser profile.
 await page.evaluate(async url=>{
  const cache=await caches.open('bada-khoa-tide-series-v1'),old=await cache.match(url),headers=new Headers(old.headers);headers.set('Date',new Date(Date.now()-73*3600000).toUTCString());await cache.put(url,new Response(await old.text(),{headers}));
  await new Promise((resolve,reject)=>{const open=indexedDB.open('workbox-expiration');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('cache-entries','readwrite'),store=tx.objectStore('cache-entries'),all=store.getAll();all.onsuccess=()=>{for(const entry of all.result)if(entry.cacheName==='bada-khoa-tide-series-v1')store.put({...entry,timestamp:Date.now()-73*3600000});};tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
 },origin+base+'data/tide-series/'+last+'.json');
 await context.setOffline(true);assert.equal((await fetchDay(last)).ok,false);await context.setOffline(false);
 console.log(JSON.stringify({initialDownloads:0,notebookDownloads:0,validNetwork:true,offlineFallback:true,invalidNeverCached:true,olderGenerationRejected:true,maxCacheEntries:35,expiredOfflineRejected:true,productionServiceWorker:true}));
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
