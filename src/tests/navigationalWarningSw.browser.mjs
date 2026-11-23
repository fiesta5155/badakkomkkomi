// Serve the real production SW under the Pages subpath. All data is an isolated
// in-memory test response; public files and external APIs are never changed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const prefix = '/badakkomkkomi/';
const root = path.resolve('dist');
const seed = JSON.parse(await fs.readFile('public/data/navigational-warnings/latest.json', 'utf8'));
let generation = 1, requests = 0;
const pair = () => {
  const latest = { ...seed, lastSuccessfulAt: `2026-11-23T0${generation}:00:00Z`, documents: [] };
  const text = JSON.stringify(latest);
  return { latest: text, status: JSON.stringify({ schemaVersion: 1, status: 'success', lastAttemptAt: latest.lastSuccessfulAt, lastSuccessfulAt: latest.lastSuccessfulAt,
    publication: { state: 'ready', preparedAt: latest.lastSuccessfulAt, snapshotSha256: createHash('sha256').update(text).digest('hex'), reason: 'collection_artifact' } }) };
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
    if (pathname === prefix + 'qa.html') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html lang="ko"><title>Warning SW regression</title><body>Local SW test</body></html>'); return;
    }
    if (/\/data\/navigational-warnings\/(latest|status)\.json$/.test(pathname)) {
      requests++;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' });
      response.end(pathname.endsWith('latest.json') ? pair().latest : pair().status); return;
    }
    const file = path.resolve(root, decodeURIComponent(pathname.slice(prefix.length)));
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403); response.end(); return; }
    const data = await fs.readFile(file);
    const ext = path.extname(file);
    response.writeHead(200, { 'Content-Type': ({ '.js': 'application/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css' })[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  await page.goto(origin + prefix + 'qa.html');
  await page.evaluate(async prefix => {
    const old = await caches.open('bada-geojson-and-config-v2.4');
    await old.put(prefix + 'data/navigational-warnings/latest.json', new Response(JSON.stringify({ oldPinnedResponse: true })));
    await old.put(prefix + 'data/navigational-warnings/status.json', new Response(JSON.stringify({ oldPinnedResponse: true })));
    await navigator.serviceWorker.register(prefix + 'sw.js', { scope: prefix });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  }, prefix);
  const read = () => page.evaluate(async prefix => {
    const [latest, status] = await Promise.all(['latest', 'status'].map(async file => (await fetch(prefix + `data/navigational-warnings/${file}.json`)).json()));
    return { latest, status };
  }, prefix);
  const first = await read(); assert.equal(first.latest.lastSuccessfulAt, '2026-11-23T01:00:00Z');
  generation = 2;
  const second = await read();
  assert.equal(second.latest.lastSuccessfulAt, '2026-11-23T02:00:00Z'); assert.equal(second.status.lastSuccessfulAt, second.latest.lastSuccessfulAt);
  assert.ok(requests >= 4, 'Same URLs must reach the network despite HTTP and old SW caches.');
  await context.setOffline(true);
  assert.equal(await page.evaluate(async prefix => { try { await fetch(prefix + 'data/navigational-warnings/latest.json'); return false; } catch { return true; } }, prefix), true);
  await context.setOffline(false);
  assert.equal((await read()).latest.lastSuccessfulAt, '2026-11-23T02:00:00Z');
  console.log(JSON.stringify({ pagesBase: prefix, realServiceWorker: true, oldCachedJsonBypassed: true, sameUrlRefresh: true, offlineDoesNotMasqueradeAsSuccess: true }));
  await context.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
