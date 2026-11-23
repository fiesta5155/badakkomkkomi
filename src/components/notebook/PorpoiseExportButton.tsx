import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useFirebaseAuth } from '../../hooks/useFirebaseAuth';
import { isValidRealName } from '../../services/userProfileService';
import { createPorpoiseCsvFile, downloadPorpoiseCsv, sharePorpoiseCsv } from '../../services/porpoiseExportService';
import type { PorpoiseRecord } from '../../types/porpoise';

export function PorpoiseExportButton({ records, compact = false }: { records: readonly PorpoiseRecord[]; compact?: boolean }) {
  const auth = useFirebaseAuth();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [downloadAvailable, setDownloadAvailable] = useState(false);
  const exportRecords = async (download = false) => {
    if (lock.current) return;
    setMessage('');
    setDownloadAvailable(false);
    if (!auth.user) { setMessage('Google 로그인 후 실명 등록을 완료하면 관찰기록을 내보낼 수 있습니다.'); return; }
    if (auth.status !== 'ready' || auth.profile?.uid !== auth.user.uid || !isValidRealName(auth.profile?.realName)) {
      setMessage('로그인 프로필의 실명 등록을 완료한 뒤 다시 시도해 주세요.'); return;
    }
    lock.current = true;
    setBusy(true);
    let fileCreated = false;
    try {
      // Synchronous generation keeps navigator.share within the original button gesture.
      const file = createPorpoiseCsvFile(records, auth.profile.realName);
      fileCreated = true;
      if (download || await sharePorpoiseCsv(file) === 'unsupported') {
        downloadPorpoiseCsv(file);
        setMessage('CSV 파일 다운로드를 시작했습니다.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '관찰기록을 내보내지 못했습니다. 다시 시도해 주세요.');
      setDownloadAvailable(fileCreated);
    } finally { lock.current = false; setBusy(false); }
  };
  return <div className={compact ? 'contents' : 'mt-2'}>
    <button type="button" disabled={busy} aria-busy={busy} onClick={() => void exportRecords()}
      aria-label="관찰기록 내보내기" title="관찰기록 내보내기"
      className={compact ? 'col-start-2 row-start-1 flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg text-[#00846c] hover:bg-teal-50 active:bg-teal-100 disabled:opacity-50' : 'flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-teal-300 bg-white px-3 py-2 text-sm font-extrabold text-[#00846c] active:bg-teal-100 disabled:opacity-50'}>
      <Download className="h-4 w-4 shrink-0" aria-hidden="true" />{!compact && '관찰기록 내보내기'}
    </button>
    <p role="status" className={compact ? (message ? 'col-span-full row-start-2 mt-1 px-1.5 text-xs font-semibold leading-relaxed text-[#484843]' : 'sr-only') : 'mt-1 text-xs font-semibold leading-relaxed text-[#484843]'}>{message}</p>
    {downloadAvailable && <button type="button" disabled={busy} onClick={() => void exportRecords(true)}
      className={`${compact ? 'col-span-full row-start-3' : ''} min-h-11 rounded-xl px-3 text-sm font-bold text-[#00846c] underline disabled:opacity-50`}>CSV 파일 다운로드</button>}
  </div>;
}
