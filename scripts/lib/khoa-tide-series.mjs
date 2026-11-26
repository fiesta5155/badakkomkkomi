import { mkdir, mkdtemp, readFile, writeFile, readdir, rename, rm, lstat } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validTideSeriesDay, validTideSeriesDate } from '../../src/services/khoaTideSeriesSchema.ts';
import { forecastDates } from '../update-khoa-tides.mjs';

export const SERIES_OUTPUT = 'public/data/tide-series';
export const SERIES_WORK = '.dev/tide-series-transactions';
export const hashSeries = text => createHash('sha256').update(text).digest('hex');
export const nextSeriesDate = date => new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);

export function validSeriesManifest(m) {
  return m && Object.keys(m).sort().join() === ['schemaVersion','generatedAt','files'].sort().join()
    && m.schemaVersion === 1 && typeof m.generatedAt === 'string'
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.generatedAt)
    && Number.isFinite(Date.parse(m.generatedAt)) && new Date(m.generatedAt).toISOString() === m.generatedAt
    && Date.parse(m.generatedAt) <= Date.now()+300000 && Array.isArray(m.files) && m.files.length === 32
    && m.files.every((f,i) => f && Object.keys(f).sort().join() === 'date,sha256'
      && validTideSeriesDate(f.date) && /^[a-f0-9]{64}$/.test(f.sha256)
      && (i === 0 || f.date === nextSeriesDate(m.files[i-1].date)))
    && m.files[0].date === forecastDates(new Date(m.generatedAt))[0];
}

export function verifySeriesBundle(manifest, texts) {
  if (!validSeriesManifest(manifest)) return null;
  const days = [];
  for (const f of manifest.files) {
    const text = texts.get(f.date);
    if (typeof text !== 'string' || text.length > 65536 || hashSeries(text) !== f.sha256) return null;
    let day; try { day=JSON.parse(text); } catch { return null; }
    if (!validTideSeriesDay(day,f.date) || day.generatedAt !== manifest.generatedAt) return null;
    days.push(day);
  }
  for (let i=0;i<days.length-1;i++) for(let s=0;s<2;s++) {
    if (days[i].stations[s].nextMidnightCm !== days[i+1].stations[s].heightsCm[0]) return null;
  }
  return { manifest, days, texts };
}

export async function readSeriesBundle(directory) {
  if (!directory) return null;
  try {
    const raw = await readFile(join(directory,'manifest.json'),'utf8'); if(raw.length>65536)return null;
    const manifest=JSON.parse(raw); if(!validSeriesManifest(manifest))return null;
    const names=await readdir(directory);
    if(names.length!==33 || names.some(name=>name!=='manifest.json'&&!manifest.files.some(f=>name===f.date+'.json')))return null;
    const texts=new Map(await Promise.all(manifest.files.map(async f=>[f.date,await readFile(join(directory,f.date+'.json'),'utf8')])));
    return verifySeriesBundle(manifest,texts);
  } catch { return null; }
}

export function makeSeriesBundle(days) {
  const texts=new Map(days.map(day=>[day.date,JSON.stringify(day)+'\n']));
  const manifest={schemaVersion:1,generatedAt:days[0]?.generatedAt,files:days.map(day=>({date:day.date,sha256:hashSeries(texts.get(day.date))}))};
  const verified=verifySeriesBundle(manifest,texts);
  if(!verified)throw Error('Invalid complete tide series bundle');
  return verified;
}

async function removeWork(path,root) {
  const target=resolve(path),base=resolve(root);
  if(!target.startsWith(base+sep))throw Error('Invalid transaction cleanup path');
  await rm(target,{recursive:true,force:true});
}

// A complete generation is staged outside public/. Pages builds only after this
// swap finishes and a second full verification succeeds. Never replace 32 files in place.
export async function publishSeriesBundle(bundle,{output=SERIES_OUTPUT,work=SERIES_WORK,renameImpl=rename}={}) {
  const verified=verifySeriesBundle(bundle.manifest,bundle.texts); if(!verified)throw Error('Invalid bundle');
  const target=resolve(output),root=resolve(work);
  if(target===root || root.startsWith(target+sep))throw Error('Transactions must stay outside the published directory');
  const old=await readSeriesBundle(target);
  if(old && Date.parse(old.manifest.generatedAt)>Date.parse(bundle.manifest.generatedAt))throw Error('Older generation refused');
  await mkdir(root,{recursive:true}); await mkdir(dirname(target),{recursive:true});
  const stage=await mkdtemp(join(root,'stage-')),backup=join(root,'previous-'+randomUUID());
  let moved=false,installed=false;
  try {
    for(const f of bundle.manifest.files)await writeFile(join(stage,f.date+'.json'),bundle.texts.get(f.date),{flag:'wx'});
    await writeFile(join(stage,'manifest.json'),JSON.stringify(bundle.manifest)+'\n',{flag:'wx'});
    if(!await readSeriesBundle(stage))throw Error('Staged generation invalid');
    let existing;try{existing=await lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(existing){if(!existing.isDirectory()||existing.isSymbolicLink())throw Error('Invalid output directory');await renameImpl(target,backup);moved=true;}
    try{await renameImpl(stage,target);installed=true;}
    catch(e){if(moved){await renameImpl(backup,target);moved=false;}throw e;}
    // Unknown/corrupt prior files are retained in the private transaction backup.
    if(moved && old)await removeWork(backup,root).catch(()=>{});
  } finally {if(!installed)await removeWork(stage,root);}
  return verified;
}

export async function fetchSeriesBundle(baseUrl,fetchImpl=fetch) {
    const base=new URL(baseUrl);if(base.protocol!=='https:')throw Error('Invalid recovery origin');
    const read=async name=>{const url=new URL('data/tide-series/'+name,base.href.replace(/\/?$/,'/'));url.searchParams.set('revalidate',String(Date.now()));
      const r=await fetchImpl(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(name==='manifest.json'&&r.status===404)return null;
      if(!r.ok)throw Error('Recovery unavailable');
      const text=await r.text();if(text.length>65536)throw Error('Recovery response too large');return text;};
    const raw=await read('manifest.json');if(raw===null)return null; // Verified bootstrap absence only.
    const manifest=JSON.parse(raw);if(!validSeriesManifest(manifest))throw Error('Invalid recovery manifest');
    const texts=new Map();
    // Bound static Pages requests to four concurrent reads; no official API calls here.
    let cursor=0;
    await Promise.all(Array.from({length:4},async()=>{while(cursor<manifest.files.length){const f=manifest.files[cursor++];texts.set(f.date,await read(f.date+'.json'));}}));
    const verified=verifySeriesBundle(manifest,texts);
    if(!verified)throw Error('Incomplete published tide series generation');
    return verified;
}
