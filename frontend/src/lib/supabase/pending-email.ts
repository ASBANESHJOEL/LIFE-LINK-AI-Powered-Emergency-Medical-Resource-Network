/**
 * Client-side persistence for pending OTP verification email.
 * Strictly persists ONLY the normalized email address in sessionStorage.
 * Never stores OTP codes, tokens, or credentials.
 */

const PENDING_EMAIL_KEY = 'lifelink_pending_otp_email';

export function normalizeEmail(email: string): string {
  return email ? email.trim().toLowerCase() : '';
}

export function savePendingEmail(email: string): void {
  if (typeof window === 'undefined') return;
  const clean = normalizeEmail(email);
  if (clean) {
    try {
      sessionStorage.setItem(PENDING_EMAIL_KEY, clean);
    } catch {
      // Storage quota or privacy mode fallback
    }
  }
}

export function getPendingEmail(): string {
  if (typeof window === 'undefined') return '';
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

export function clearPendingEmail(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    // Storage access error fallback
  }
}
