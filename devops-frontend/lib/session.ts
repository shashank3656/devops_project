export function isSignedSessionToken(raw: string): boolean {
  const token = raw.trim();
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function clearDevopsSession(): void {
  try {
    localStorage.removeItem('devops_token');
    localStorage.removeItem('devops_user');
  } catch (_) {}
}

export function purgeUnsignedDevopsSession(): void {
  if (typeof window === 'undefined') return;
  const raw = (localStorage.getItem('devops_token') || '').trim();
  if (!raw || raw === 'undefined' || raw === 'null' || !isSignedSessionToken(raw)) {
    clearDevopsSession();
  }
}
