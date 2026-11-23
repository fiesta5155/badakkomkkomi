export const DEFAULT_REPORT_RECIPIENT = 'marine_admin@knps.or.kr';
export const REPORT_RECIPIENT_STORAGE_KEY = 'bada_custom_admin_email';

export function isValidReportRecipient(value: string): boolean {
  const local = value.split('@')[0];
  return value.length <= 254 && local.length <= 64 && !local.startsWith('.') &&
    !local.endsWith('.') && !local.includes('..') &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value);
}

export function loadReportRecipient(): string {
  try {
    const saved = localStorage.getItem(REPORT_RECIPIENT_STORAGE_KEY)?.trim();
    return saved && isValidReportRecipient(saved) ? saved : DEFAULT_REPORT_RECIPIENT;
  } catch {
    return DEFAULT_REPORT_RECIPIENT;
  }
}

export function saveReportRecipient(value: string): boolean {
  const email = value.trim();
  if (!isValidReportRecipient(email)) return false;
  try {
    if (email === DEFAULT_REPORT_RECIPIENT) {
      localStorage.removeItem(REPORT_RECIPIENT_STORAGE_KEY);
    } else {
      localStorage.setItem(REPORT_RECIPIENT_STORAGE_KEY, email);
    }
    return true;
  } catch {
    return false;
  }
}
