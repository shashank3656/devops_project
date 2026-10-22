const RETURN_KEY = 'opstrellis-return';
const DRAFT_KEY = 'opstrellis-change-draft';

export function safeReturnPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return '';
  return value;
}

export function rememberReturn(path: string) {
  if (typeof window === 'undefined') return;
  const safe = safeReturnPath(path);
  if (!safe) return;
  sessionStorage.setItem(RETURN_KEY, safe);
}

export function consumeReturn(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const saved = safeReturnPath(sessionStorage.getItem(RETURN_KEY) || '');
  sessionStorage.removeItem(RETURN_KEY);
  return saved || '/dashboard';
}

export function readChangeDraft(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(sessionStorage.getItem(DRAFT_KEY));
}

export const CHANGE_DRAFT_KEY = DRAFT_KEY;
