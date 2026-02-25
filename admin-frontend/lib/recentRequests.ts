const ADMIN_RECENT_KEY = 'admin-portal-recent-requests';
const MAX_RECENT = 10;

export function getRecentRequestIds(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ADMIN_RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === 'number').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function addRecentRequestId(id: number): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getRecentRequestIds();
    const filtered = current.filter((x) => x !== id);
    const next = [id, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(ADMIN_RECENT_KEY, JSON.stringify(next));
  } catch (_) {}
}
