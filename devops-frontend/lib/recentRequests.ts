import {
  addRecentRequestId as persistRecent,
  getRecentRequestIds as readRecent,
  DEVOPS_RECENT_KEY,
} from '@infragate/ui';

export { DEVOPS_RECENT_KEY };

export function getRecentRequestIds(): number[] {
  return readRecent(DEVOPS_RECENT_KEY);
}

export function addRecentRequestId(id: number): void {
  persistRecent(id, DEVOPS_RECENT_KEY);
}
