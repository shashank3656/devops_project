import { addCalendarDays, formatCompactDay, nextDateKeys, weekdayLong } from './onCallMonth';

export type PreviewKind = 'covered' | 'uncovered' | 'missing_backup' | 'overlapping';

export interface PreviewPerson {
  user_id: number;
  name: string;
}

export interface OccupiedShift {
  date: string;
  userId: number;
  team?: string;
}

export interface PreviewDay {
  date: string;
  label: string;
  weekday: string;
  primaryId: number;
  primaryName: string;
  backupId: number;
  backupName: string;
  kinds: PreviewKind[];
}

function knownName(members: PreviewPerson[], userId: number): string {
  if (userId <= 0) return '';
  const match = members.find((item) => item.user_id === userId);
  return (match?.name || '').trim() || 'Unknown';
}

export function previewRotation(input: {
  fromDate: string;
  days: Record<string, string>;
  backupDays: Record<string, string>;
  members: PreviewPerson[];
  missionCritical?: boolean;
  occupied?: OccupiedShift[];
  horizon?: number;
}): PreviewDay[] {
  const horizon = input.horizon && input.horizon > 0 ? input.horizon : 30;
  const occupied = new Map<string, OccupiedShift[]>();
  (input.occupied || []).forEach((item) => {
    if (!item.date || item.userId <= 0) return;
    const list = occupied.get(item.date) || [];
    list.push(item);
    occupied.set(item.date, list);
  });
  return nextDateKeys(input.fromDate, horizon).map((date) => {
    const weekday = weekdayLong(date);
    const primaryId = Number(input.days[weekday] || 0) || 0;
    const backupId = Number(input.backupDays[weekday] || 0) || 0;
    const kinds: PreviewKind[] = [];
    if (!primaryId) kinds.push('uncovered');
    else if (input.missionCritical && (!backupId || backupId === primaryId)) kinds.push('missing_backup');
    else if (!backupId) kinds.push('missing_backup');
    if (primaryId && backupId && primaryId === backupId) kinds.push('overlapping');
    const others = occupied.get(date) || [];
    const clash = others.some((item) => item.userId === primaryId || (backupId > 0 && item.userId === backupId));
    if (clash && !kinds.includes('overlapping')) kinds.push('overlapping');
    if (!kinds.length) kinds.push('covered');
    return {
      date,
      label: formatCompactDay(date),
      weekday,
      primaryId,
      primaryName: knownName(input.members, primaryId),
      backupId,
      backupName: knownName(input.members, backupId),
      kinds,
    };
  });
}

export function previewKindLabel(kind: PreviewKind): string {
  if (kind === 'uncovered') return 'Uncovered';
  if (kind === 'missing_backup') return 'Missing backup';
  if (kind === 'overlapping') return 'Overlapping';
  return 'Covered';
}

export function previewSummary(days: PreviewDay[]): string {
  const uncovered = days.filter((item) => item.kinds.includes('uncovered')).length;
  const backups = days.filter((item) => item.kinds.includes('missing_backup')).length;
  const overlapping = days.filter((item) => item.kinds.includes('overlapping')).length;
  return `${uncovered} uncovered · ${backups} missing backups · ${overlapping} overlapping`;
}

export function weekdayCoverageIssue(primaryId: number, backupId: number, missionCritical: boolean): string {
  if (!primaryId) return 'Uncovered';
  if (backupId && backupId === primaryId) return 'Primary and backup must be different people';
  if (missionCritical && !backupId) return 'Backup required';
  return '';
}

export function rotationCanPublish(days: Record<string, string>, backupDays: Record<string, string>, weekdays: string[], missionCritical: boolean): boolean {
  return weekdays.every((day) => !weekdayCoverageIssue(Number(days[day] || 0), Number(backupDays[day] || 0), missionCritical));
}

export { addCalendarDays };
