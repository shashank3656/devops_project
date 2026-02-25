const MAX_RECENT = 10;

export function getRecentRequestIds(key = 'user-portal-recent-requests'): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === 'number').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function addRecentRequestId(id: number, key = 'user-portal-recent-requests'): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getRecentRequestIds(key);
    const filtered = current.filter((x) => x !== id);
    const next = [id, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(key, JSON.stringify(next));
  } catch (_) {}
}

export const ADMIN_RECENT_KEY = 'admin-portal-recent-requests';
export const DEVOPS_RECENT_KEY = 'devops-portal-recent-requests';
