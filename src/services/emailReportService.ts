import type { FieldReportData, EmailReportPayload } from '../types/report';
import type { AdminConfig } from '../types/config';

/**
 * 현장제보 이메일 출력 양식. attachedPhotoCount는 선택한 사진 수가 아니라
 * 해당 전송 경로에 실제로 포함한 파일 수이며, mailto/텍스트 공유에서는 0이다.
 */
export function buildEmailReportPayload(
  data: FieldReportData,
  adminConfig: AdminConfig,
  attachedPhotoCount = 0,
): EmailReportPayload {
  const targetName = data.pointName ? `[${data.pointId || '포인트'}] ${data.pointName}` : '해상 일반 지점';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(data.createdAt));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value;
  const date = `${part('year')}.${part('month')}.${part('day')}.`;
  const reportTime = `${date} ${part('hour')}:${part('minute')}`;
  const subject = `[바다꼼꼬미] 현장제보 (${date})`;

  const mapLinkNaver = `https://map.naver.com/v5/?c=${data.lng},${data.lat},15,0,0,0,dh`;
  const mapLinkGoogle = `https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}`;

  const body = `현장제보 내용
제보 대상: ${targetName}
제보 일시: ${reportTime}
제보자: ${data.reporterName?.trim() || '현장 점검 요원'}
GPS 좌표: ${data.lat.toFixed(5)}°N, ${data.lng.toFixed(5)}°E

현장 내용
${data.memo}

위치 확인
네이버 지도 바로가기:
${mapLinkNaver}
구글 지도 바로가기:
${mapLinkGoogle}${attachedPhotoCount > 0 ? `\n\n첨부사진: ${attachedPhotoCount}장` : ''}`;

  return {
    to: adminConfig.report_recipient_email,
    cc: adminConfig.report_cc_email,
    subject,
    body,
  };
}

/**
 * 모바일 Web Share API 또는 메일 클라이언트(mailto:) 호출
 */
export async function sendFieldReport(
  data: FieldReportData,
  adminConfig: AdminConfig
): Promise<{ success: boolean; method: 'share' | 'mailto'; error?: string }> {
  const payload = buildEmailReportPayload(data, adminConfig);

  // 1. Web Share API로 파일 첨부 및 메신저/메일 앱 직접 전송 시도
  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      const shareFiles: File[] = [];

      // Base64 사진을 File 객체로 변환
      for (let i = 0; i < data.photos.length; i++) {
        const photoDataUrl = data.photos[i];
        const res = await fetch(photoDataUrl);
        const blob = await res.blob();
        const file = new File([blob], `field_report_${i + 1}.jpg`, { type: 'image/jpeg' });
        shareFiles.push(file);
      }

      const shareData: ShareData = {
        title: payload.subject,
        text: payload.body,
      };

      if (shareFiles.length > 0 && navigator.canShare && navigator.canShare({ files: shareFiles })) {
        shareData.files = shareFiles;
        shareData.text = buildEmailReportPayload(data, adminConfig, shareFiles.length).body;
      }

      await navigator.share(shareData);
      return { success: true, method: 'share' };
    } catch (err: unknown) {
      // 사용자가 공유 취소를 눌렀을 경우
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { success: false, method: 'share', error: '공유가 취소되었습니다.' };
      }
      // Web Share 실패 시 mailto 폴백 진행
    }
  }

  // 2. 표준 mailto 프로토콜 폴백
  try {
    // mailto uses percent-encoded spaces and CRLF, not form-style '+' encoding.
    const params = [
      `subject=${encodeURIComponent(payload.subject)}`,
      `body=${encodeURIComponent(payload.body.replace(/\r?\n/g, '\r\n'))}`,
    ];
    if (payload.cc) {
      params.push(`cc=${encodeURIComponent(payload.cc)}`);
    }

    const mailtoUrl = `mailto:${encodeURIComponent(payload.to)}?${params.join('&')}`;
    window.location.href = mailtoUrl;

    // 클립보드에도 메모와 좌표 자동 복사 (메일 본문 길이 제한 대비)
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(payload.body).catch(() => {});
    }

    return { success: true, method: 'mailto' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '이메일 클라이언트를 실행할 수 없습니다.';
    return { success: false, method: 'mailto', error: message };
  }
}
