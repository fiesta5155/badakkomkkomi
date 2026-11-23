import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectWarnings, createRequester, defaultDates, isSnapshot, safeDiagnostic } from './lib/navigational-warnings.mjs';

export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, file);
}

export async function runCollection({ key = process.env.KHOA_NAV_WARNING_SERVICE_KEY, dates = defaultDates(),
  directory = 'public/data/navigational-warnings', request, now = new Date(), clock = () => new Date(), log = console.log } = {}) {
  const lastAttemptAt = now.toISOString();
  const started = performance.now();
  const latest = path.join(directory, 'latest.json');
  const statusFile = path.join(directory, 'status.json');
  // A failed/missing-key attempt never replaces a previous good snapshot.
  let lastSuccessfulAt = null;
  try { lastSuccessfulAt = JSON.parse(await readFile(latest, 'utf8')).lastSuccessfulAt ?? null; } catch { /* first run */ }
  if (!key?.trim()) {
    await atomicJson(statusFile, { schemaVersion: 1, status: 'not_configured', lastAttemptAt, lastSuccessfulAt, generatedAt: clock().toISOString() });
    log('항행경보 수집 건너뜀: 서버 환경변수 KHOA_NAV_WARNING_SERVICE_KEY를 설정하세요. 기존 데이터는 보존합니다.');
    return 0;
  }
  try {
    request ??= createRequester(key.trim());
    const snapshot = await collectWarnings(request, dates, lastAttemptAt);
    snapshot.collectionStartedAt = lastAttemptAt;
    snapshot.lastSuccessfulAt = clock().toISOString();
    snapshot.generatedAt = clock().toISOString();
    if (!isSnapshot(snapshot)) throw new Error('invalid_snapshot');
    await atomicJson(latest, snapshot);
    lastSuccessfulAt = snapshot.lastSuccessfulAt;
    const metrics = { ...(request.stats ?? {}), elapsedMs: Math.round(performance.now() - started) };
    await atomicJson(statusFile, { schemaVersion: 1, status: 'success', lastAttemptAt, lastSuccessfulAt,
      generatedAt: clock().toISOString(), metrics });
    log(`항행경보 수집 완료: 문서 ${snapshot.documents.length}건. 유효 경보 전체 및 좌표계 검증은 별도 필요합니다.`);
    log(JSON.stringify({ metrics }));
    return 0;
  } catch (error) {
    // Fixed diagnostic only: external exceptions may contain credential-bearing URLs.
    const diagnostic = safeDiagnostic(error);
    const metrics = { ...(request?.stats ?? {}), elapsedMs: Math.round(performance.now() - started) };
    await atomicJson(statusFile, { schemaVersion: 1, status: 'failed', lastAttemptAt, lastSuccessfulAt,
      generatedAt: clock().toISOString(), error: diagnostic, metrics });
    log('항행경보 수집 실패: 인증·API 응답·페이지/구역 누락을 확인하세요. 이전 정상 자료를 보존합니다.');
    log(JSON.stringify({ error: diagnostic, metrics }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--dates')) {
    console.error('사용법: node scripts/collect-navigational-warnings.mjs [--dates YYYYMMDD,YYYYMMDD]');
    process.exitCode = 1;
  } else {
    try { process.exitCode = await runCollection(args.length ? { dates: args[1].split(',') } : {}); }
    catch { console.error('항행경보 파일 저장 실패: 경로 및 권한을 확인하세요.'); process.exitCode = 1; }
  }
}
