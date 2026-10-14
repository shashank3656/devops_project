import { deskCanWrite, deskSubmitBlock, deskValueRejected, normalizeDeskState } from './deskRules';
import { workspaceScopeBlock } from './myWork';

export const READINESS_KINDS = ['api_error', 'queue_age', 'scan_coverage', 'sync_lag'] as const;
export const READINESS_COVERAGE = ['unknown', 'partial', 'empty', 'ready'] as const;
export const READINESS_SCOPES = ['database', 'evidence'] as const;
export const READINESS_DETAIL_MESSAGE = 'Free text is not accepted.';
export const READINESS_TARGET_MESSAGE = 'RPO, RTO, and an owner user id are required.';
export const READINESS_RESTORE_MESSAGE = 'A restore without elapsed time and loss stays Unknown.';
export const READINESS_NUMBER_MESSAGE = 'Queue age and sync lag record only numbers.';

export type ReadinessSignalView = {
  id: number;
  kind: string;
  count: number;
  ageSeconds: number;
  coverage: string;
  state: string;
};

export type ReadinessTargetView = {
  id: number;
  rpoSeconds: number;
  rtoSeconds: number;
  ownerUserId: number;
  state: string;
};

export type ReadinessBackupView = {
  id: number;
  scope: string;
  state: string;
};

export type ReadinessRestoreView = {
  id: number;
  backupId: number;
  elapsedSeconds: number;
  lossCount: number;
  state: string;
};

export type ReadinessJobView = {
  id: number;
  jobKey: string;
  state: string;
};

function whole(value: string, allowZero: boolean): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const number = Number(value);
  return Number.isInteger(number) && (allowZero || number > 0);
}

function token(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 128 || /[\s,*]/.test(text)) return false;
  return !deskValueRejected(text);
}

export function readinessSignalBlock(
  role: string,
  projectId: string,
  environment: string,
  kind: string,
  coverage: string,
  detail: string,
  count: string,
  age: string,
  observed: boolean,
): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (detail.trim() || deskValueRejected(detail) || deskValueRejected(coverage)) return READINESS_DETAIL_MESSAGE;
  if (!READINESS_KINDS.includes(kind as (typeof READINESS_KINDS)[number])) return 'That value is not accepted.';
  if (!observed) return '';
  if (!whole(count, true) || !whole(age, true)) return READINESS_NUMBER_MESSAGE;
  if (kind === 'scan_coverage') {
    if (!READINESS_COVERAGE.includes(coverage as (typeof READINESS_COVERAGE)[number])) return 'That value is not accepted.';
    return '';
  }
  if (coverage !== '' && coverage !== 'unknown') return 'That value is not accepted.';
  return '';
}

export function readinessTargetBlock(role: string, projectId: string, environment: string, rpo: string, rto: string, owner: string): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!whole(rpo, false) || !whole(rto, false) || !whole(owner, false)) return READINESS_TARGET_MESSAGE;
  return '';
}

export function readinessRestoreBlock(role: string, environment: string, elapsed: string, loss: string, elapsedSet: boolean, lossSet: boolean): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (elapsedSet && !whole(elapsed, true)) return 'That value is not accepted.';
  if (lossSet && !whole(loss, true)) return 'That value is not accepted.';
  if (!elapsedSet || !lossSet) return '';
  return '';
}

export function readinessJobBlock(role: string, projectId: string, environment: string, jobKey: string): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!token(jobKey)) return 'That value is not accepted.';
  return '';
}

export function parseReadinessSignal(value: unknown): ReadinessSignalView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const kind = typeof row.kind === 'string' ? row.kind : '';
  if (!Number.isInteger(id) || id <= 0 || !READINESS_KINDS.includes(kind as (typeof READINESS_KINDS)[number])) return null;
  const coverage = typeof row.coverage === 'string' ? row.coverage : 'unknown';
  return {
    id,
    kind,
    count: Number(row.count) || 0,
    ageSeconds: Number(row.age_seconds) || 0,
    coverage: coverage === 'partial' || coverage === 'empty' || coverage === 'ready' ? coverage : 'unknown',
    state: typeof row.state === 'string' && row.state === 'recorded' ? 'recorded' : 'unknown',
  };
}

export function parseReadinessTarget(value: unknown): ReadinessTargetView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    rpoSeconds: Number(row.rpo_seconds) || 0,
    rtoSeconds: Number(row.rto_seconds) || 0,
    ownerUserId: Number(row.owner_user_id) || 0,
    state: 'proposed',
  };
}

export function parseReadinessBackup(value: unknown): ReadinessBackupView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const scope = typeof row.scope === 'string' ? row.scope : '';
  if (!Number.isInteger(id) || id <= 0 || (scope !== 'database' && scope !== 'evidence')) return null;
  return { id, scope, state: typeof row.state === 'string' ? row.state : 'unknown' };
}

export function parseReadinessRestore(value: unknown): ReadinessRestoreView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const state = row.state === 'restored' ? 'restored' : 'unknown';
  return {
    id,
    backupId: Number(row.backup_id) || 0,
    elapsedSeconds: Number(row.elapsed_seconds) || 0,
    lossCount: Number(row.loss_count) || 0,
    state,
  };
}

export function parseReadinessJobs(value: unknown): ReadinessJobView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = Number(row.id);
    const jobKey = typeof row.job_key === 'string' ? row.job_key : '';
    if (!Number.isInteger(id) || id <= 0 || !token(jobKey)) return [];
    return [{ id, jobKey, state: row.state === 'queued' ? 'queued' : 'unknown' }];
  });
}

export function readinessObservedState(state: string): ReturnType<typeof normalizeDeskState> {
  return state === 'recorded' || state === 'restored' ? 'ready' : normalizeDeskState(state);
}
