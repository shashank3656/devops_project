import { rememberReturn } from './returnPath';

const NOTICE_KEY = 'opstrellis-auth-notice';
const ACCESS_KEY = 'opstrellis-access-notice';

/** Clears the portal session, remembers the current page, and opens login with an expiry notice. */
export function expireSession(returnTo?: string) {
  if (typeof window === 'undefined') return;
  const path = returnTo || `${window.location.pathname}${window.location.search}`;
  rememberReturn(path);
  sessionStorage.setItem(NOTICE_KEY, 'expired');
  localStorage.removeItem('devops_token');
  localStorage.removeItem('devops_user');
  window.location.assign('/login');
}

export function readAuthNotice(): 'expired' | '' {
  if (typeof window === 'undefined') return '';
  const value = sessionStorage.getItem(NOTICE_KEY) === 'expired' ? 'expired' : '';
  sessionStorage.removeItem(NOTICE_KEY);
  return value;
}

/** Reads the expiry notice without removing it, so a development remount can still show it. */
export function peekAuthNotice(): 'expired' | '' {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(NOTICE_KEY) === 'expired' ? 'expired' : '';
}

export function clearAuthNotice() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(NOTICE_KEY);
}

export function rememberAccessDenied(page: string) {
  if (typeof window === 'undefined' || !page.trim()) return;
  sessionStorage.setItem(ACCESS_KEY, page.trim());
}

export function readAccessDenied(): string {
  if (typeof window === 'undefined') return '';
  const value = sessionStorage.getItem(ACCESS_KEY) || '';
  sessionStorage.removeItem(ACCESS_KEY);
  return value;
}
