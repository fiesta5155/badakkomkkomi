import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Mail,
  Camera,
  X,
  Send,
  Compass,
  MapPin,
  Settings2,
} from 'lucide-react';
import type { FieldReportData } from '../../types/report';
import type { AdminConfig } from '../../types/config';
import { sendFieldReport } from '../../services/emailReportService';
import { DEFAULT_REPORT_RECIPIENT, isValidReportRecipient } from '../../services/reportRecipientStorage';

interface FieldReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  pointId?: string;
  pointName?: string;
  initialLat: number;
  initialLng: number;
  adminConfig: AdminConfig;
  onUpdateAdminEmail: (newEmail: string) => boolean;
  onPickLocationOnMap: () => void;
  defaultReporterName?: string;
  onChangeReporterName?: (name: string) => void;
}

export function FieldReportModal({
  isOpen,
  onClose,
  pointId,
  pointName,
  initialLat,
  initialLng,
  adminConfig,
  onUpdateAdminEmail,
  onPickLocationOnMap,
  defaultReporterName = '',
  onChangeReporterName,
}: FieldReportModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [memo, setMemo] = useState('');
  const [reporterName, setReporterName] = useState(defaultReporterName);
  const [photos, setPhotos] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [recipientEmailInput, setRecipientEmailInput] = useState(
    adminConfig.report_recipient_email,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 사진 업로드 및 Canvas 압축 (최대 1200px)
  const handlePhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 1200;

          if (width > height && width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          const compressed = canvas.toDataURL('image/jpeg', 0.82);
          setPhotos((prev) => [...prev, compressed].slice(0, 4));
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveRecipientEmail = () => {
    const trimmed = recipientEmailInput.trim();
    if (!isValidReportRecipient(trimmed)) {
      setEmailError('유효한 이메일 주소를 입력해주세요.');
      return;
    }
    if (!onUpdateAdminEmail(trimmed)) {
      setEmailError('이 기기에 주소를 저장하지 못했습니다. 저장소 설정을 확인해주세요.');
      return;
    }
    setEmailError(null);
    setIsEditingEmail(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!memo.trim()) {
      alert('현장 메모 내용을 입력해주세요.');
      return;
    }

    setIsSending(true);
    setSendResult(null);

    const reportData: FieldReportData = {
      pointId,
      pointName,
      lat: initialLat,
      lng: initialLng,
      reporterName,
      memo,
      photos,
      createdAt: new Date().toISOString(),
    };

    const res = await sendFieldReport(reportData, adminConfig);
    setIsSending(false);

    if (res.success) {
      setSendResult(res.method === 'share'
        ? '공유창 처리를 마쳤습니다. 실제 발송 여부는 확인할 수 없습니다.'
        : '메일 앱 실행을 요청했습니다. 실제 발송 여부는 확인할 수 없습니다.');
    } else {
      alert(res.error || '메일 앱 또는 공유창을 열지 못했습니다.');
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      aria-labelledby="report-modal-title"
      className="bada-modal-dialog knps-modal-surface fixed inset-0 z-[1300] m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto overscroll-contain rounded-3xl border border-slate-300 bg-white p-5 text-[#003360] shadow-2xl"
    >
      <div>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <h2 id="report-modal-title" className="flex items-center gap-2 text-base font-black tracking-tight text-[#003360]">
            <Mail className="h-5 w-5" />
            현장제보
          </h2>
          <button type="button" onClick={onClose} aria-label="제보 창 닫기"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#003360]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs font-bold text-slate-600">
          <span className="shrink-0">수신</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[#0066b3]" title={adminConfig.report_recipient_email}>
            {adminConfig.report_recipient_email}
          </span>
          <button type="button" aria-expanded={isEditingEmail} aria-controls="report-email-settings"
            onClick={() => {
              setRecipientEmailInput(adminConfig.report_recipient_email);
              setEmailError(null);
              setIsEditingEmail((v) => !v);
            }}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-bold text-[#0066b3]">
            <Settings2 className="h-3.5 w-3.5" />변경
          </button>
        </div>
        {isEditingEmail && (
          <div id="report-email-settings" className="mt-2 space-y-2">
            <label htmlFor="report-recipient-email-input" className="block text-xs font-extrabold text-[#003360]">
              수신 이메일
            </label>
            <div className="flex gap-2">
              <input id="report-recipient-email-input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                value={recipientEmailInput} onChange={(e) => { setRecipientEmailInput(e.target.value); setEmailError(null); }}
                aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'report-email-error' : undefined}
                placeholder={DEFAULT_REPORT_RECIPIENT}
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-400 bg-white px-3 py-2 font-mono text-base text-[#003360] focus:border-[#0066b3] focus:outline-none" />
              <button type="button" onClick={handleSaveRecipientEmail}
                className="min-h-11 shrink-0 rounded-xl bg-[#00846c] px-3 py-2 text-xs font-bold text-white">저장</button>
            </div>
            {emailError && <p id="report-email-error" role="alert" className="text-xs text-red-700">{emailError}</p>}
            <button type="button" onClick={() => {
              if (onUpdateAdminEmail(DEFAULT_REPORT_RECIPIENT)) {
                setRecipientEmailInput(DEFAULT_REPORT_RECIPIENT);
                setEmailError(null);
                setIsEditingEmail(false);
              } else {
                setEmailError('기본 주소를 저장하지 못했습니다. 저장소 설정을 확인해주세요.');
              }
            }} className="min-h-11 rounded-xl px-2 text-xs font-bold text-[#0066b3]">기본 주소로 복원</button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* 1. 제보 위치 정보 및 지도 위치 재지정 버튼 */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold text-slate-600">제보 위치 좌표</span>
                <p className="mt-0.5 flex items-center gap-1 font-mono text-xs font-black text-[#0066b3]">
                  <Compass className="h-3.5 w-3.5 text-[#0066b3]" />
                  {initialLat.toFixed(5)}°N, {initialLng.toFixed(5)}°E
                </p>
              </div>
              <button
                type="button"
                onClick={onPickLocationOnMap}
                className="flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-black text-[#0066b3] shadow-2xs enabled:active:scale-[0.96]"
              >
                <MapPin className="h-3.5 w-3.5" />
                <span>지도에서 위치 선택</span>
              </button>
            </div>
            {pointName ? (
              <p className="mt-1.5 text-sm font-extrabold text-[#003360]">
                {pointId ? `[${pointId}] ` : ''}
                {pointName}
              </p>
            ) : null}
          </div>

          {/* 2. 제보자 이름 (선택 · 한 번 입력 시 기기에 기억) */}
          <div>
            <label
              htmlFor="report-reporter-name-input"
              className="mb-1 block text-xs font-extrabold text-[#003360]"
            >
              제보자 이름 / 소속 (선택 · 자동 기억)
            </label>
            <input
              id="report-reporter-name-input"
              type="text"
              value={reporterName}
              onChange={(e) => {
                const next = e.target.value;
                setReporterName(next);
                onChangeReporterName?.(next);
              }}
              placeholder="예: 홍길동 주무관"
              className="w-full rounded-xl border border-slate-400 bg-white px-3.5 py-2.5 text-base font-bold text-[#003360] placeholder-slate-400 shadow-2xs focus:border-[#0066b3] focus:outline-none"
            />
          </div>

          {/* 3. 현장 메모 (필수) */}
          <div>
            <label
              htmlFor="report-memo-textarea"
              className="mb-1 block text-xs font-extrabold text-[#003360]"
            >
              현장 자유 메모 및 위험/특이사항 (필수)
            </label>
            <textarea
              id="report-memo-textarea"
              required
              rows={4}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 허가받지 않은 유어장 시설물 설치 의심. 현장 확인 및 관련 허가 여부 검토 필요."
              className="w-full resize-y rounded-xl border border-slate-400 bg-white p-3.5 text-base font-bold text-[#003360] placeholder-slate-400 shadow-2xs focus:border-[#0066b3] focus:outline-none"
            />
          </div>

          {/* 4. 현장 사진 첨부 */}
          <div>
            <label className="mb-1.5 block text-xs font-extrabold text-[#003360]">
              현장 사진 첨부 (최대 4장)
            </label>
            <div className="flex flex-wrap gap-2.5">
              {photos.map((src, i) => (
                <div
                  key={i}
                  className="relative h-16 w-16 overflow-hidden rounded-xl border border-slate-300 bg-slate-100"
                >
                  <img src={src} alt={`첨부사진 ${i + 1}`} className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    aria-label={`첨부사진 ${i + 1} 삭제`}
                    className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center text-white"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600"><X className="h-3 w-3" /></span>
                  </button>
                </div>
              ))}

              {photos.length < 4 && (
                <label className="relative flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-400 text-slate-600 focus-within:outline-2 focus-within:outline-[#0066b3]">
                  <Camera className="h-5 w-5" />
                  <span className="mt-1 text-[10px] font-black">사진 추가</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    onChange={handlePhotoUpload}
                    aria-label="현장 사진 추가"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
              )}
            </div>
          </div>

          {sendResult && (
            <p role="status" className="text-xs leading-relaxed text-slate-600">{sendResult}</p>
          )}

          {/* 제출 버튼 */}
          <button
            type="submit"
            disabled={isSending}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#00854a] via-[#00846c] to-[#0066b3] py-3.5 text-sm font-black text-white shadow-md transition enabled:active:scale-[0.96] disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            <span>{isSending ? '이메일 준비 중...' : '이메일로 제보하기'}</span>
          </button>
          <p className="text-center text-xs leading-relaxed text-slate-600">메일 앱에서 내용을 확인한 후 최종 전송해주세요.</p>
        </form>
      </div>
    </dialog>
  );
}
