import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { forecastDates, STATIONS } from './update-khoa-tides.mjs';
import { nextSeriesDate, makeSeriesBundle, publishSeriesBundle } from './lib/khoa-tide-series.mjs';

export class TideSeriesError extends Error {
  constructor(reason,context={}) {super('Tide series collection failed');this.reason=reason;this.context=context;}
}
export function safeSeriesError(error) {
  const reasons=['KEY_MISSING','KEY_ENCODING','BUDGET','NETWORK','HTTP','AUTH','UPSTREAM','FORMAT','GRID','VALUE','PUBLISH'];
  const result={reason:reasons.includes(error?.reason)?error.reason:'PUBLISH'};
  const c=error?.context??{};
  if(STATIONS.some(s=>s.code===c.station))result.station=c.station;
  if(typeof c.date==='string'&&/^\d{4}-\d\d-\d\d$/.test(c.date))result.date=c.date;
  if(Number.isInteger(c.http)&&c.http>=100&&c.http<=599)result.http=c.http;
  if(typeof c.apiCode==='string'&&/^\d{1,3}$/.test(c.apiCode))result.apiCode=c.apiCode;
  return result;
}

export async function collectTideSeries({key=process.env.KHOA_SERVICE_KEY,now=new Date(),fetchImpl=fetch,
  sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxCalls=132}={}) {
  if(typeof key!=='string'||!key.trim())throw new TideSeriesError('KEY_MISSING');
  let credential;try{credential=decodeURIComponent(key.trim());}catch{throw new TideSeriesError('KEY_ENCODING');}
  const dates=forecastDates(now),generatedAt=now.toISOString();let calls=0;
  const started=Date.now();
  async function request(station,date,boundary=false) {
    const context={station:station.code,date};let response;
    for(let attempt=0;attempt<2;attempt++) {
      if(calls>=maxCalls)throw new TideSeriesError('BUDGET',context);
      calls++;await sleep(150);
      const url=new URL('https://apis.data.go.kr/1192136/tideFcstTime/GetTideFcstTimeApiService');
      for(const[k,v]of Object.entries({serviceKey:credential,obsCode:station.code,reqDate:date.replaceAll('-',''),min:5,type:'json',pageNo:1,numOfRows:boundary?1:300}))url.searchParams.set(k,String(v));
      try{response=await fetchImpl(url,{signal:AbortSignal.timeout(15000),redirect:'error'});}catch{response=null;}
      if(response && response.status!==429 && response.status<500)break;
      if(attempt===0){await response?.body?.cancel();await sleep(1000);}
    }
    if(!response)throw new TideSeriesError('NETWORK',context);
    context.http=response.status;
    if(!response.ok){await response.body?.cancel();throw new TideSeriesError(response.status===401||response.status===403?'AUTH':'HTTP',context);}
    let data;
    try{const text=await response.text();if(text.length>262144)throw Error();data=JSON.parse(text);}catch{throw new TideSeriesError('FORMAT',context);}
    const code=data?.header?.resultCode;if(typeof code==='string'&&/^\d{1,3}$/.test(code))context.apiCode=code;
    if(code!=='00')throw new TideSeriesError(['20','30','31'].includes(code)?'AUTH':'UPSTREAM',context);
    const body=data.body,raw=body?.items?.item,rows=Array.isArray(raw)?raw:raw?[raw]:[];
    const count=boundary?1:288;
    if(body?.type!=='json'||body.pageNo!==1||body.numOfRows!==(boundary?1:300)||body.totalCount!==288||rows.length!==count)throw new TideSeriesError('GRID',context);
    const values=[];
    for(let i=0;i<rows.length;i++) {
      const row=rows[i],minutes=i*5,clock=String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
      if(row.obsvtrNm!==station.name||row.predcDt!==date+' '+clock)throw new TideSeriesError('GRID',context);
      if(typeof row.tdlvHgt!=='number'||!Number.isFinite(row.tdlvHgt)
        ||typeof row.lat!=='number'||!Number.isFinite(row.lat)||Math.abs(row.lat)>90
        ||typeof row.lot!=='number'||!Number.isFinite(row.lot)||Math.abs(row.lot)>180)throw new TideSeriesError('VALUE',context);
      values.push(row.tdlvHgt);
    }
    return values;
  }
  const values=new Map();
  for(const date of dates){const pair=[];for(const station of STATIONS)pair.push(await request(station,date));values.set(date,pair);}
  const boundary=[];for(const station of STATIONS)boundary.push((await request(station,nextSeriesDate(dates.at(-1)),true))[0]);
  const days=dates.map((date,index)=>({schemaVersion:1,date,generatedAt,unit:'cm',intervalMinutes:5,
    reference:{verticalDatumVerified:false,timeZoneVerified:false},stations:STATIONS.map((s,i)=>({code:s.code,
      heightsCm:values.get(date)[i],nextMidnightCm:index<31?values.get(dates[index+1])[i][0]:boundary[i]}))}));
  return {...makeSeriesBundle(days),calls,elapsedMs:Date.now()-started};
}

export async function updateTideSeries(options={}) {
  const bundle=await collectTideSeries(options);
  try{await publishSeriesBundle(bundle,options);}catch{throw new TideSeriesError('PUBLISH');}
  return bundle;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const result=await updateTideSeries();console.log(JSON.stringify({status:'success',dates:32,requests:result.calls,elapsedMs:result.elapsedMs,
    bytes:[...result.texts.values()].reduce((sum,text)=>sum+Buffer.byteLength(text),0)}));}
  catch(error){console.error(JSON.stringify({status:'failed',partialGenerationPublished:false,...safeSeriesError(error)}));process.exitCode=1;}
}
