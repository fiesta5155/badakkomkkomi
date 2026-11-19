import type { WorkboxPlugin } from 'workbox-core';
import { validTideSnapshot } from '../src/services/khoaTideSchema.ts';

// Workbox serializes plugin functions; embed the self-contained validator instead
// of capturing an import that would be undefined inside the generated worker.
export function createTideCachePlugin(): WorkboxPlugin {
  return new Function(`return {
    cacheKeyWillBeUsed: async ({request}) => {
      const url = new URL(request.url); url.search = ''; return url.href;
    },
    fetchDidSucceed: async ({response, request}) => {
      const valid = ${validTideSnapshot.toString()};
      if (response.status !== 200 || !valid(await response.clone().json())) throw new Error('Invalid tide response');
      const cache = await caches.open('bada-khoa-tides-v1');
      const url = new URL(request.url); url.search = '';
      const previous = await cache.match(url.href);
      if (previous) {
        try {
          const old = await previous.json();
          const next = await response.clone().json();
          if (valid(old) && Date.parse(old.generatedAt) > Date.parse(next.generatedAt)) return new Response(JSON.stringify(old), {headers: {'Content-Type':'application/json'}});
        } catch { /* A damaged cache must not prevent a valid network update. */ }
      }
      return response;
    },
    cachedResponseWillBeUsed: async ({cachedResponse}) => {
      const valid = ${validTideSnapshot.toString()};
      try { return cachedResponse && valid(await cachedResponse.clone().json()) ? cachedResponse : null; }
      catch { return null; }
    }
  }`)() as WorkboxPlugin;
}
