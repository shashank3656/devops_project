import { deskCanWrite, deskSubmitBlock, deskValueRejected, normalizeDeskState } from './deskRules';
import { workspaceScopeBlock } from './myWork';

export const BACKUP_PROVIDER = 'sandbox';
export const BACKUP_SELF_MESSAGE = 'The backup service cannot link itself.';
export const BACKUP_ISOLATED_MESSAGE = 'An isolated drill is required.';
export const BACKUP_REVIEWER_MESSAGE = 'A different reviewer is required.';
export const BACKUP_SCOPE_MESSAGE = 'Scope is database or evidence.';
export const BACKUP_RETENTION_MESSAGE = 'Retention days must be greater than zero.';
export const BACKUP_OUTCOME_MESSAGE = 'The drill outcome is succeeded or failed.';
export const BACKUP_SCOPES = ['database', 'evidence'] as const;
export const BACKUP_OUTCOMES = ['succeeded', 'failed'] as const;

export type BackupRecordView = {
  id: number;
  service: string;
  scope: string;
  provider: string;
  retentionDays: number;
  state: string;
  verified: boolean;
  observed: string;
  applied: boolean;
};

export type BackupDrillView = {
  id: number;
  backupId: number;
  state: string;
  followUp: boolean;
  assigneeId: number;
  canLaunch: boolean;
  applied: boolean;
  sampleValid: boolean;
};

function serviceToken(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 128 || /[\s,*]/.test(text)) return false;
  return !deskValueRejected(text);
}

function wholeNumber(value: string, allowZero: boolean): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || (!allowZero && number === 0)) return null;
  return number;
}

export function backupRecordBlock(
  role: string,
  projectId: string,
  environment: string,
  service: string,
  scope: string,
  retention: string,
): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!serviceToken(service)) return 'That value is not accepted.';
  if (scope !== 'database' && scope !== 'evidence') return BACKUP_SCOPE_MESSAGE;
  if (wholeNumber(retention, false) == null) return BACKUP_RETENTION_MESSAGE;
  return '';
}

export function backupDependencyBlock(role: string, environment: string, backupService: string, dependency: string): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!serviceToken(backupService) || !serviceToken(dependency)) return 'That value is not accepted.';
  if (dependency.trim() === backupService.trim()) return BACKUP_SELF_MESSAGE;
  return '';
}

export function backupDrillBlock(
  role: string,
  environment: string,
  isolated: boolean,
  reviewerId: string,
  actorId: number,
  outcome: string,
  duration: string,
  gap: string,
): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!isolated) return BACKUP_ISOLATED_MESSAGE;
  if (outcome !== 'succeeded' && outcome !== 'failed') return BACKUP_OUTCOME_MESSAGE;
  const reviewer = Number(reviewerId);
  if (!Number.isInteger(reviewer) || reviewer <= 0 || reviewer === actorId) return BACKUP_REVIEWER_MESSAGE;
  if (duration.trim() && wholeNumber(duration, true) == null) return 'That value is not accepted.';
  if (gap.trim() && wholeNumber(gap, true) == null) return 'That value is not accepted.';
  return '';
}

export function parseBackupRecord(value: unknown): BackupRecordView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const service = typeof row.service === 'string' ? row.service : '';
  const scope = typeof row.scope === 'string' ? row.scope : '';
  if (!Number.isInteger(id) || id <= 0 || !serviceToken(service)) return null;
  if (scope !== 'database' && scope !== 'evidence') return null;
  return {
    id,
    service,
    scope,
    provider: BACKUP_PROVIDER,
    retentionDays: Number(row.retention_days) || 0,
    state: typeof row.state === 'string' && row.state ? row.state : 'unknown',
    verified: row.verified === true,
    observed: normalizeDeskState(typeof row.observed === 'string' ? row.observed : ''),
    applied: row.applied === true,
  };
}

export function parseBackupRecords(value: unknown): BackupRecordView[] {
  return Array.isArray(value) ? value.map(parseBackupRecord).filter((item): item is BackupRecordView => Boolean(item)) : [];
}

export function parseBackupDrill(value: unknown): BackupDrillView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const backupId = Number(row.backup_id);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(backupId) || backupId <= 0) return null;
  return {
    id,
    backupId,
    state: typeof row.state === 'string' && row.state ? row.state : 'unknown',
    followUp: row.follow_up === true,
    assigneeId: Number(row.assignee_id) || 0,
    canLaunch: false,
    applied: row.applied === true,
    sampleValid: row.sample_valid === true,
  };
}
