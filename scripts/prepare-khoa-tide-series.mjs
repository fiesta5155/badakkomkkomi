import { appendFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { forecastDates } from './update-khoa-tides.mjs';
import { SERIES_OUTPUT, SERIES_WORK, readSeriesBundle, fetchSeriesBundle, publishSeriesBundle } from './lib/khoa-tide-series.mjs';

export async function recoverTideSeries({artifactDir,pagesUrl,baselineDir,output=SERIES_OUTPUT,work=SERIES_WORK,fetchImpl=fetch,finalize=false}={}) {
  const current=await readSeriesBundle(output);
  const candidates=[current,await readSeriesBundle(finalize?baselineDir:artifactDir)].filter(Boolean);
  // Trusted successful Pages artifacts are the fast path, including hourly warning runs.
  if(!candidates.length&&!finalize&&pagesUrl){const remote=await fetchSeriesBundle(pagesUrl,fetchImpl);if(remote)candidates.push(remote);}
  candidates.sort((a,b)=>Date.parse(b.manifest.generatedAt)-Date.parse(a.manifest.generatedAt));
  if(!candidates.length){
    let exists=false;try{await lstat(output);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(exists)throw Error('Unverified tide series directory: deployment blocked');
    return null; // Explicitly unavailable, never a fake successful empty generation.
  }
  const best=candidates[0];
  if(best!==current)await publishSeriesBundle(best,{output,work});
  if(!await readSeriesBundle(output))throw Error('Tide series output verification failed');
  if(!finalize&&baselineDir)await publishSeriesBundle(best,{output:baselineDir,work});
  return best;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const bundle=await recoverTideSeries({artifactDir:process.env.TIDE_SERIES_ARTIFACT_DIR,pagesUrl:process.env.TIDE_SERIES_PAGES_URL,
      baselineDir:process.env.TIDE_SERIES_BASELINE_DIR,finalize:process.argv.includes('--finalize')});
    const today=Boolean(bundle&&bundle.manifest.files[0].date===forecastDates()[0]);
    if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`available=${Boolean(bundle)}\ntoday=${today}\ngeneratedAt=${bundle?.manifest.generatedAt??''}\n`);
    console.log(bundle?JSON.stringify({available:true,generatedAt:bundle.manifest.generatedAt,from:bundle.manifest.files[0].date,through:bundle.manifest.files.at(-1).date})
      :'No verified tide series generation; future readers will report unavailable.');
  }catch{console.error('Tide series recovery/verification failed; deployment blocked.');process.exitCode=1;}
}
