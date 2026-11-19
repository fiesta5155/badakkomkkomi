import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicSave, OUTPUT, readSnapshot } from './update-khoa-tides.mjs';
import { validTideSnapshot } from '../src/services/khoaTideSchema.ts';

// Artifact expiry/deletion is expected: the published JSON is a second recovery source.
// This stage has no API credential. A missing baseline requires successful bootstrap collection.
export async function recoverTides({ artifactFile, pagesUrl, output = OUTPUT, fetchImpl = fetch } = {}) {
  const candidates = [];
  for (const file of [output, artifactFile].filter(Boolean)) {
    const value = await readSnapshot(file);
    if (value) candidates.push(value);
  }
  if (pagesUrl) {
    try {
      const url = new URL(pagesUrl);
      if (url.protocol !== 'https:') throw new Error();
      url.searchParams.set('revalidate', String(Date.now()));
      const response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (response.ok) {
        const text = await response.text();
        if (text.length > 1024 * 1024) throw new Error();
        const value = JSON.parse(text);
        if (validTideSnapshot(value)) candidates.push(value);
      }
    } catch { /* Never trust an HTTP error, login page, malformed or unavailable backup. */ }
  }
  candidates.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  if (!candidates.length) return false;
  await atomicSave(candidates[0], output);
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const restored = await recoverTides({ artifactFile: process.env.KHOA_RECOVERY_FILE, pagesUrl: process.env.KHOA_PAGES_URL });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `restored=${restored}\n`);
    console.log(restored ? 'Verified tide baseline restored.' : 'No verified baseline: bootstrap collection is mandatory before deployment.');
  } catch { console.error('Tide recovery failed; deployment must stop.'); process.exitCode = 1; }
}
