import {
  addRecentRequestId as persistRecent,
  getRecentRequestIds as readRecent,
  ADMIN_RECENT_KEY,
} from '@infragate/ui';

export { ADMIN_RECENT_KEY };

export function getRecentRequestIds(): number[] {
  return readRecent(ADMIN_RECENT_KEY);
}

export function addRecentRequestId(id: number): void {
  persistRecent(id, ADMIN_RECENT_KEY);
}
