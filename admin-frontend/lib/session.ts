export function isSignedSessionToken(raw: string): boolean {
  const token = raw.trim();
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function readAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = (localStorage.getItem('admin_token') || '').trim();
  if (!raw || raw === 'undefined' || raw === 'null' || !isSignedSessionToken(raw)) {
    return null;
  }
  return raw;
}

export function clearAdminSession(): void {
  try {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
  } catch (_) {}
}
