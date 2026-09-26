const MAX_RECENT = 10;

export const ADMIN_RECENT_KEY = 'admin-portal-recent-requests';
export const DEVOPS_RECENT_KEY = 'devops-portal-recent-requests';
export const USER_RECENT_KEY = 'user-portal-recent-requests';

/** Non-secret numeric ids only — stored in sessionStorage for UI shortcuts (not credentials). */
function readIds(key: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: number[]): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch {
    /* ignore quota errors */
  }
}

export function getRecentRequestIds(key: string = USER_RECENT_KEY): number[] {
  return readIds(key);
}

export function addRecentRequestId(id: number, key: string = USER_RECENT_KEY): void {
  if (!Number.isInteger(id) || id <= 0) return;
  const current = readIds(key);
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENT);
  writeIds(key, next);
}
