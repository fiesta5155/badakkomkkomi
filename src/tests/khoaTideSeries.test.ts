import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';
import {readFileSync} from 'node:fs';
import {forecastDates} from '../../scripts/update-khoa-tides.mjs';
import {collectTideSeries,updateTideSeries,safeSeriesError} from '../../scripts/collect-khoa-tide-series.mjs';
import {makeSeriesBundle,publishSeriesBundle,readSeriesBundle,verifySeriesBundle,fetchSeriesBundle} from '../../scripts/lib/khoa-tide-series.mjs';
import {recoverTideSeries} from '../../scripts/prepare-khoa-tide-series.mjs';
import {validTideSeriesDay,tideSeriesBracket,tideSeriesFreshness} from '../services/khoaTideSeriesSchema.ts';
import {createTideSeriesReader} from '../services/khoaTideSeriesService.ts';
import {createTideSeriesCachePlugin} from '../../scripts/khoa-tide-series-cache.ts';
import {ROCK_DOCKING_TIDE_REFERENCE} from '../config/rockDocking.ts';
const now=new Date('2026-11-26T00:00:00.000Z');
function raw(url:URL){
 const compact=url.searchParams.get('reqDate')!,date=compact.slice(0,4)+'-'+compact.slice(4,6)+'-'+compact.slice(6),code=url.searchParams.get('obsCode'),count=Number(url.searchParams.get('numOfRows'));
 return {header:{resultCode:'00'},body:{type:'json',pageNo:1,numOfRows:count,totalCount:288,items:{item:Array.from({length:Math.min(count,288)},(_,i)=>({obsvtrNm:code==='DT_0014'?'통영':'고현항',lat:34.8,lot:128.5,predcDt:date+' '+String(Math.floor(i*5/60)).padStart(2,'0')+':'+String(i*5%60).padStart(2,'0'),tdlvHgt:-3.61+i*.25}))}}};
}
const good=async(url:URL)=>new Response(JSON.stringify(raw(url)));
const options={key:'private+key/=',now,sleep:async()=>{},fetchImpl:good};
const fixture=()=>collectTideSeries(options);
async function temporary(action:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'bada-series-test-'));try{await action(root);}finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});}}
test('collects one complete 32-day generation with 288x2 exact samples and 66 requests',async()=>{
 const bundle=await fixture();assert.equal(bundle.calls,66);assert.equal(bundle.days.length,32);assert.deepEqual(bundle.days.map(d=>d.date),forecastDates(now));
 for(const d of bundle.days){assert.ok(validTideSeriesDay(d));assert.equal(d.stations[0].heightsCm.length,288);assert.equal(d.stations[1].heightsCm[0],-3.61);assert.equal(d.stations[0].nextMidnightCm,-3.61);assert.equal(d.reference.timeZoneVerified,false);assert.equal(d.reference.verticalDatumVerified,false);}
 const last=tideSeriesBracket(bundle.days[0],'DT_0014',1439);assert.equal(last.throughMinute,1440);assert.equal(last.throughCm,-3.61);assert.equal(tideSeriesBracket(bundle.days[0],'DT_0014',0).fromMinute,0);assert.throws(()=>tideSeriesBracket(bundle.days[0],'DT_0014',1440));
 assert.equal(tideSeriesFreshness(bundle.days[0],now.getTime()+37*3600000).stale,true);
});
test('rejects missing/duplicate/reordered/wrong-date samples, bad metadata, string/null heights',async()=>{
 for(const mutate of [(p:any)=>p.body.items.item.pop(),(p:any)=>p.body.items.item[1].predcDt=p.body.items.item[0].predcDt,(p:any)=>p.body.items.item.reverse(),(p:any)=>p.body.items.item[0].predcDt='2026-11-25 00:00',(p:any)=>p.body.totalCount=287,(p:any)=>p.body.items.item[0].tdlvHgt='3',(p:any)=>p.body.items.item[0].tdlvHgt=null]){
  await assert.rejects(collectTideSeries({...options,fetchImpl:async(url:URL)=>{const p=raw(url);mutate(p);return new Response(JSON.stringify(p));}}));
 }
});
test('bounded transient retry, no auth/data retries, missing key and request budget',async()=>{
 let calls=0;const waits:number[]=[];const b=await collectTideSeries({...options,sleep:async(ms:number)=>{waits.push(ms);},fetchImpl:async(url:URL)=>++calls===1?new Response('',{status:503}):good(url)});assert.equal(b.calls,67);assert.ok(waits.includes(1000));
 calls=0;await assert.rejects(collectTideSeries({...options,fetchImpl:async()=>{calls++;return new Response('',{status:500});}}));assert.equal(calls,2);
 calls=0;await assert.rejects(collectTideSeries({...options,fetchImpl:async()=>{calls++;return new Response('private+key/=',{status:403});}}),e=>{assert.equal(JSON.stringify(safeSeriesError(e)).includes('private'),false);return true;});assert.equal(calls,1);
 calls=0;await assert.rejects(collectTideSeries({...options,maxCalls:0,fetchImpl:async()=>{calls++;throw Error();}}));assert.equal(calls,0);
 await assert.rejects(collectTideSeries({...options,key:''}),e=>safeSeriesError(e).reason==='KEY_MISSING');
 await assert.rejects(collectTideSeries({...options,fetchImpl:async()=>{throw Error('private+key/=');}}),e=>!JSON.stringify(safeSeriesError(e)).includes('private'));
});
test('date validator rejects sparse arrays, wrong station, false verification claims and extra fields',async()=>{
 const day=(await fixture()).days[0];
 for(const change of [(d:any)=>d.stations[0].heightsCm.pop(),(d:any)=>delete d.stations[0].heightsCm[4],(d:any)=>d.stations[1].code='DT_0014',(d:any)=>d.reference.verticalDatumVerified=true,(d:any)=>d.unit='m',(d:any)=>d.date='2026-02-30',(d:any)=>d.stations[0].nextMidnightCm=Infinity,(d:any)=>d.serviceKey='private']){const d=structuredClone(day);change(d);assert.equal(validTideSeriesDay(d),false);}
 assert.equal(validTideSeriesDay(day,'2026-11-27'),false);
});
test('whole-bundle hashes, generations, dates and midnight consistency prevent mixed publication',async()=>{
 const b=await fixture();const days=structuredClone(b.days);days[4].generatedAt='2026-11-25T00:00:00.000Z';assert.throws(()=>makeSeriesBundle(days));
 const edge=structuredClone(b.days);edge[4].stations[0].nextMidnightCm=999;assert.throws(()=>makeSeriesBundle(edge));
 const texts=new Map(b.texts);texts.delete(b.days[3].date);assert.equal(verifySeriesBundle(b.manifest,texts),null);
 const dates=structuredClone(b.days);[dates[0],dates[1]]=[dates[1],dates[0]];assert.throws(()=>makeSeriesBundle(dates));
});
test('a failed date collection never replaces existing normal files; swap failure restores directory',async()=>temporary(async root=>{
 const b=await fixture(),output=join(root,'data'),work=join(root,'work');await publishSeriesBundle(b,{output,work});const before=await readFile(join(output,'manifest.json'),'utf8');let calls=0;
 await assert.rejects(updateTideSeries({...options,output,work,fetchImpl:async(url:URL)=>++calls===12?new Response('broken') :good(url)}));assert.equal(await readFile(join(output,'manifest.json'),'utf8'),before);
 const newer=makeSeriesBundle(b.days.map(d=>({...d,generatedAt:'2026-11-26T00:01:00.000Z'})));let moves=0;
 const {rename}=await import('node:fs/promises');await assert.rejects(publishSeriesBundle(newer,{output,work,renameImpl:async(a:string,c:string)=>{if(++moves===2)throw Error('disk failure');await rename(a,c);}}));
 assert.equal((await readSeriesBundle(output))!.manifest.generatedAt,b.manifest.generatedAt);assert.equal((await readdir(output)).length,33);
}));
test('trusted artifact avoids Pages requests; finalization restores complete baseline after corruption',async()=>temporary(async root=>{
 const b=await fixture(),artifactDir=join(root,'artifact'),output=join(root,'out'),baselineDir=join(root,'baseline'),work=join(root,'work');await publishSeriesBundle(b,{output:artifactDir,work});
 await recoverTideSeries({artifactDir,output,baselineDir,work,pagesUrl:'https://example.test/app/',fetchImpl:async()=>{assert.fail('artifact fast path');}});
 await writeFile(join(output,b.days[0].date+'.json'),'{}');assert.equal(await readSeriesBundle(output),null);
 await recoverTideSeries({output,baselineDir,work,finalize:true});assert.ok(await readSeriesBundle(output));
}));
test('published fallback requires all 32 hashes; absent bootstrap differs from network/corrupt recovery',async()=>{
 const b=await fixture();let calls=0;
 const fetchImpl=async(url:URL)=>{calls++;const name=url.pathname.split('/').at(-1)!;return new Response(name==='manifest.json'?JSON.stringify(b.manifest):b.texts.get(name.slice(0,10)));};
 assert.ok(await fetchSeriesBundle('https://example.test/app/',fetchImpl));assert.equal(calls,33);
 await assert.rejects(fetchSeriesBundle('https://example.test/',async(url:URL)=>url.pathname.endsWith('manifest.json')?new Response(JSON.stringify(b.manifest)):new Response('{}')));
 assert.equal(await fetchSeriesBundle('https://example.test/',async()=>new Response('',{status:404})),null);
 await assert.rejects(fetchSeriesBundle('https://example.test/',async()=>{throw Error('offline');}));
});
test('reader performs no construction request, deduplicates, uses base path, retries invalid data and bounds memory',async()=>{
 const b=await fixture();let calls=0,clock=now.getTime();const seen:string[]=[];
 const reader=createTideSeriesReader({base:'/badakkomkkomi/',now:()=>clock,maxEntries:2,fetchImpl:async(url:any)=>{calls++;seen.push(String(url));await new Promise(r=>setTimeout(r,1));return new Response(b.texts.get(String(url).split('/').at(-1)!.slice(0,10)));}});
 assert.equal(calls,0);const date=b.days[0].date;const [a,c]=await Promise.all([reader.load(date),reader.load(date)]);assert.equal(a,c);assert.equal(calls,1);assert.ok(seen[0].startsWith('/badakkomkkomi/data/tide-series/'));await reader.load(date);assert.equal(calls,1);
 await reader.load(b.days[1].date);await reader.load(b.days[2].date);await reader.load(date);assert.equal(calls,4);clock+=3600001;await reader.load(date);assert.equal(calls,5);
 let invalid=0;const broken=createTideSeriesReader({fetchImpl:async()=>{invalid++;return new Response('{}');}});await assert.rejects(broken.load(date));await assert.rejects(broken.load(date));assert.equal(invalid,2);await assert.rejects(reader.load('../secret'));
});
test('serialized SW validates before caching and permits only validated offline/date responses',async()=>{
 const b=await fixture(),day=b.days[0],request=new Request('https://example.test/app/data/tide-series/'+day.date+'.json?v=1');
 const plugin=createTideSeriesCachePlugin() as any;const original=globalThis.caches;
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{open:async()=>({match:async()=>undefined})}});
 try{
  assert.ok(await plugin.fetchDidSucceed({request,response:new Response(JSON.stringify(day))}));
  await assert.rejects(plugin.fetchDidSucceed({request,response:new Response('{}')}));
  assert.equal(await plugin.cacheWillUpdate({request,response:new Response('{}')}),null);
  assert.equal(await plugin.cacheWillUpdate({request,response:new Response(JSON.stringify(day),{status:500})}),null);
  assert.ok(await plugin.cachedResponseWillBeUsed({request,cachedResponse:new Response(JSON.stringify(day))}));
  assert.equal(await plugin.cachedResponseWillBeUsed({request,cachedResponse:new Response(JSON.stringify(b.days[1]))}),null);
  assert.equal(await plugin.cachedResponseWillBeUsed({request,cachedResponse:new Response('broken')}),null);
  assert.equal(await plugin.cacheKeyWillBeUsed({request}),'https://example.test/app/data/tide-series/'+day.date+'.json');
 }finally{Object.defineProperty(globalThis,'caches',{configurable:true,value:original});}
});
test('verified comparison stays disabled, SW has separate bounded cache and schedule stays unchanged',()=>{
 assert.equal(ROCK_DOCKING_TIDE_REFERENCE,null);
 const vite=readFileSync('vite.config.ts','utf8');assert.ok(vite.includes('**/data/tide-series/**'));assert.ok(vite.includes('maxEntries:35,maxAgeSeconds:72*3600'));
 const workflow=readFileSync('.github/workflows/deploy-pages.yml','utf8');assert.ok(workflow.includes("cron: '17 19 * * *'"));assert.ok(workflow.includes("github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"));assert.ok(workflow.includes("steps.series-recovery.outputs.today != 'true'"));
});

test('successful series backup provenance excludes failed, expired, foreign and superseded attempts',async()=>{
 const lines=readFileSync('.github/workflows/deploy-pages.yml','utf8').split(/\r?\n/);let source='';
 for(let i=0;i<lines.length;i++){if(lines[i]!=='          script: |')continue;let candidate='';while(++i<lines.length&&(lines[i].startsWith('            ')||!lines[i].trim()))candidate+=lines[i].slice(12)+'\n';if(candidate.includes('khoa-tide-series-'))source=candidate;}
 assert.ok(source);const output:Record<string,string>={};
 const artifacts=Array.from({length:6},(_,i)=>({id:i+1,name:'khoa-tide-series-'+(i+1)+'-1',expired:i===0,workflow_run:{id:i+1,head_branch:i===1?'other':'main'}}));
 const github={rest:{actions:{listArtifactsForRepo:async()=>({data:{artifacts}}),getWorkflowRun:async({run_id}:{run_id:number})=>({data:{id:run_id,path:run_id===4?'foreign.yml':'.github/workflows/deploy-pages.yml',conclusion:run_id===3?'failure':'success',run_attempt:run_id===5?2:1,event:'schedule'}})}}};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;await new AsyncFunction('github','context','core',source)(github,{repo:{}},{setOutput:(k:string,v:string)=>{output[k]=v;}});assert.deepEqual(output,{id:'6',run:'6'});
});
test('memory reader clears a synchronous failure and never rolls back newer data',async()=>{
 const day=(await fixture()).days[0];let calls=0,clock=now.getTime();
 const reader=createTideSeriesReader({now:()=>clock,ttlMs:10,fetchImpl:((()=>{calls++;if(calls===1)throw Error('offline');return Promise.resolve(new Response(JSON.stringify(calls===2?day:{...day,generatedAt:'2026-11-25T00:00:00.000Z'})));}) as typeof fetch)});
 await assert.rejects(reader.load(day.date));const current=await reader.load(day.date);clock+=11;assert.equal(await reader.load(day.date),current);assert.equal(calls,3);
});
