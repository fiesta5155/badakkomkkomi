import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicJson } from './collect-navigational-warnings.mjs';
import { isSnapshot } from './lib/navigational-warnings.mjs';
import { parseWarningSnapshot, parseWarningAttempt } from '../src/services/navigationalWarningService.ts';

const encode = value => JSON.stringify(value, null, 2) + '\n';
const digest = text => createHash('sha256').update(text).digest('hex');
const normalTime = pair => Date.parse(pair?.snapshot.lastSuccessfulAt ?? '') || 0;
const attemptTime = pair => Date.parse(pair?.status.lastAttemptAt ?? '') || 0;

export function validateWarningPair(latestText, statusText) {
  const snapshot = JSON.parse(latestText), status = JSON.parse(statusText);
  if (!isSnapshot(snapshot)) throw Error('Invalid warning snapshot');
  parseWarningSnapshot(snapshot); parseWarningAttempt(status);
  if (snapshot.lastSuccessfulAt !== status.lastSuccessfulAt) throw Error('Mismatched warning pair');
  if (status.publication?.snapshotSha256 && status.publication.snapshotSha256 !== digest(latestText)) throw Error('Mismatched warning hash');
  if (/[?&]servicekey=/i.test(latestText + statusText)) throw Error('Credential-bearing URL rejected');
  return { snapshot, status };
}

export async function readWarningArtifact(directory) {
  if (!directory) return null;
  try {
    const texts = await Promise.all(['latest.json', 'status.json'].map(name => readFile(path.join(directory, name), 'utf8')));
    if (texts[0].length > 5_000_000 || texts[1].length > 100_000) return null;
    return validateWarningPair(...texts);
  } catch { return null; }
}

export async function readPublishedWarnings(pagesUrl, fetcher = fetch) {
  try {
    const base = new URL(pagesUrl.endsWith('/') ? pagesUrl : pagesUrl + '/');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return { state: 'unavailable' };
    const nonce = String(Date.now());
    const responses = await Promise.all(['latest.json', 'status.json'].map(async name => {
      const url = new URL(`data/navigational-warnings/${name}`, base);
      url.searchParams.set('revalidate', nonce);
      const response = await fetcher(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (response.status === 404) return { absent: true };
      if (!response.ok || Number(response.headers.get('content-length')) > 5_000_000) throw Error();
      const text = await response.text();
      if (text.length > (name === 'status.json' ? 100_000 : 5_000_000)) throw Error();
      return { text };
    }));
    if (responses.every(r => r.absent)) return { state: 'absent' };
    if (responses.some(r => r.absent)) return { state: 'unavailable' };
    return { state: 'valid', pair: validateWarningPair(responses[0].text, responses[1].text) };
  } catch { return { state: 'unavailable' }; }
}

// New collection status and the newest good snapshot are selected independently.
// A successful empty snapshot is a real snapshot; null means never collected.
export function selectWarningPublication({ published, artifact, seed, now = new Date(), sourceRunId = null, sourceRunAttempt = null }) {
  if (!['valid', 'absent'].includes(published.state)) throw Error('Published warning baseline unavailable; stop deployment.');
  const baseline = published.state === 'valid' ? published.pair : seed;
  if (!baseline) throw Error('Warning bootstrap state missing.');
  let snapshot = baseline.snapshot, status = baseline.status, usedArtifact = false;
  if (artifact) {
    if (normalTime(artifact) > normalTime(baseline)) snapshot = artifact.snapshot;
    if (attemptTime(artifact) >= attemptTime(baseline)) { status = artifact.status; usedArtifact = true; }
    // A newer success cannot be paired with an older attempt status.
    if (snapshot === artifact.snapshot && status !== artifact.status) { status = artifact.status; usedArtifact = true; }
  }
  const reason = !artifact ? 'artifact_unavailable' : usedArtifact ? 'collection_artifact' : 'superseded_artifact';
  const previous = status.publication;
  const publication = {
    state: artifact ? 'ready' : 'delayed',
    preparedAt: now.toISOString(),
    snapshotSha256: digest(encode(snapshot)),
    reason,
    collectionRunId: usedArtifact && /^\d+$/.test(String(sourceRunId)) ? String(sourceRunId) : previous?.collectionRunId ?? null,
    collectionRunAttempt: usedArtifact && Number.isSafeInteger(Number(sourceRunAttempt)) && Number(sourceRunAttempt) > 0 ? Number(sourceRunAttempt) : previous?.collectionRunAttempt ?? null,
  };
  return { snapshot, status: { ...status, lastSuccessfulAt: snapshot.lastSuccessfulAt, publication } };
}

export async function prepareWarningPublication({ artifactDirectory, outputDirectory = 'public/data/navigational-warnings', pagesUrl,
  fetcher = fetch, now = new Date(), sourceRunId, sourceRunAttempt } = {}) {
  // A network error is NOT proof that no previous data exists. Never replace an
  // unreachable published baseline with the repository's empty bootstrap files.
  const published = await readPublishedWarnings(pagesUrl ?? '', fetcher);
  const [artifact, seed] = await Promise.all([readWarningArtifact(artifactDirectory), readWarningArtifact(outputDirectory)]);
  const result = selectWarningPublication({ published, artifact, seed, now, sourceRunId, sourceRunAttempt });
  const body = encode(result.snapshot);
  validateWarningPair(body, encode(result.status));
  await atomicJson(path.join(outputDirectory, 'latest.json'), result.snapshot);
  await atomicJson(path.join(outputDirectory, 'status.json'), result.status);
  return { status: result.status.status, publication: result.status.publication.state, lastSuccessfulAt: result.snapshot.lastSuccessfulAt,
    documents: result.snapshot.documents.length, artifactAccepted: !!artifact };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await prepareWarningPublication({ artifactDirectory: process.env.NAV_WARNING_ARTIFACT_DIR,
      pagesUrl: process.env.NAV_WARNING_PAGES_URL, sourceRunId: process.env.NAV_WARNING_SOURCE_RUN_ID,
      sourceRunAttempt: process.env.NAV_WARNING_SOURCE_RUN_ATTEMPT });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publication=${result.publication}\n`);
    console.log(JSON.stringify(result));
  } catch { console.error('Warning publication preparation failed; existing Pages data must remain unchanged.'); process.exitCode = 1; }
}
