import type { WorkboxPlugin } from 'workbox-core';
import { validTideSeriesDay } from '../src/services/khoaTideSeriesSchema.ts';

export function createTideSeriesCachePlugin():WorkboxPlugin {
  return new Function(`return {
    cacheKeyWillBeUsed: async ({request}) => {const url=new URL(request.url);url.search='';return url.href;},
    fetchDidSucceed: async ({response,request}) => {
      const valid=${validTideSeriesDay.toString()};
      const url=new URL(request.url);url.search='';
      const date=url.pathname.match(/(\\d{4}-\\d{2}-\\d{2})\\.json$/)?.[1];
      const next=await response.clone().json();
      if(response.status!==200 || !date || !valid(next,date))throw Error('Invalid tide series response');
      const previous=await (await caches.open('bada-khoa-tide-series-v1')).match(url.href);
      if(previous){try{const old=await previous.json();if(valid(old,date)&&Date.parse(old.generatedAt)>Date.parse(next.generatedAt))return new Response(JSON.stringify(old),{headers:{'Content-Type':'application/json'}});}catch{}}
      return response;
    },
    cacheWillUpdate: async ({response,request}) => {
      const valid=${validTideSeriesDay.toString()};
      const date=new URL(request.url).pathname.match(/(\\d{4}-\\d{2}-\\d{2})\\.json$/)?.[1];
      try{return response.status===200&&date&&valid(await response.clone().json(),date)?response:null;}catch{return null;}
    },
    cachedResponseWillBeUsed: async ({cachedResponse,request}) => {
      const valid=${validTideSeriesDay.toString()};
      const date=new URL(request.url).pathname.match(/(\\d{4}-\\d{2}-\\d{2})\\.json$/)?.[1];
      try{return cachedResponse&&date&&valid(await cachedResponse.clone().json(),date)?cachedResponse:null;}catch{return null;}
    }
  }`)() as WorkboxPlugin;
}
