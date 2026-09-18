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

const AUTH_INTENT_KEY = 'lifelink_auth_flow_intent';

export interface AuthFlowIntent {
  intent: 'login' | 'signup';
  requestedRole?: string;
}

export function saveAuthIntent(intent: 'login' | 'signup', requestedRole?: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(AUTH_INTENT_KEY, JSON.stringify({ intent, requestedRole }));
  } catch {
    // Storage quota fallback
  }
}

export function getAuthIntent(): AuthFlowIntent {
  if (typeof window === 'undefined') return { intent: 'login' };
  try {
    const raw = sessionStorage.getItem(AUTH_INTENT_KEY);
    if (!raw) return { intent: 'login' };
    return JSON.parse(raw);
  } catch {
    return { intent: 'login' };
  }
}

export function clearAuthIntent(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(AUTH_INTENT_KEY);
  } catch {
    // Storage access error fallback
  }
}

export function clearPendingEmail(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PENDING_EMAIL_KEY);
    sessionStorage.removeItem(AUTH_INTENT_KEY);
  } catch {
    // Storage access error fallback
  }
}
