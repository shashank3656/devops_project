export const DESK_STATES = ['empty', 'error', 'stale', 'unknown', 'ready'] as const;

export type DeskState = (typeof DESK_STATES)[number];

export const DESK_ENVIRONMENT_MESSAGE = 'One environment is required.';
export const DESK_VIEWER_MESSAGE = 'A viewer can read this desk.';
export const DESK_REJECTED_MESSAGE = 'That value is not accepted.';
export const DESK_FALLBACK_ERROR = 'request failed';

const SENSITIVE_WORDS = ['password', 'secret', 'token', 'execute', 'approve'] as const;
const DEMO_RESOURCE_MARKERS = [
  'i-0a1b2c3d4e5f67890',
  'db-platform-prod',
  'setuops-artifacts-uat',
  'setuops-terraform-dev',
  'arn:aws:eks',
  'arn:aws:lambda',
] as const;

const STATIC_ERRORS = [
  'entitlement request failed',
  'drift request failed',
  'backup request failed',
  'bootstrap request failed',
  'monitor request failed',
  'readiness request failed',
  'acceptance request failed',
  'pilot request failed',
  'lifecycle request failed',
  'automation request failed',
  'report request failed',
  'sync request failed',
  'workspace request failed',
] as const;

export function deskStateLabel(state: DeskState): string {
  switch (state) {
    case 'empty':
      return 'Empty';
    case 'error':
      return 'Error';
    case 'stale':
      return 'Stale';
    case 'ready':
      return 'Ready';
    default:
      return 'Unknown';
  }
}

export function normalizeDeskState(value: unknown): DeskState {
  if (typeof value !== 'string') return 'unknown';
  const folded = value.trim().toLowerCase();
  if (folded === 'empty' || folded === 'error' || folded === 'stale' || folded === 'ready') return folded;
  return 'unknown';
}

export function singleDeskEnvironment(environment: string): boolean {
  if (environment === '' || environment === '*' || environment === 'all') return false;
  if (/[ \n,]/.test(environment) || environment.length > 64) return false;
  return true;
}

export function deskCanWrite(role: string): boolean {
  return role.trim().toLowerCase() !== 'viewer';
}

export function deskValueRejected(value: string): boolean {
  if (value.trim().toLowerCase() === 'healthy') return true;
  const lower = value.toLowerCase();
  if (SENSITIVE_WORDS.some((word) => lower.includes(word))) return true;
  return DEMO_RESOURCE_MARKERS.some((marker) => lower.includes(marker));
}

export function deskErrorText(body: unknown): string {
  if (!body || typeof body !== 'object') return DESK_FALLBACK_ERROR;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'string') return DESK_FALLBACK_ERROR;
  const folded = error.trim().toLowerCase();
  if ((STATIC_ERRORS as readonly string[]).includes(folded)) return folded;
  return DESK_FALLBACK_ERROR;
}

export function visibleDeskRecords<T>(projectHidden: boolean, records: readonly T[]): T[] {
  if (projectHidden) return [];
  return records.slice();
}

export function deskSubmitBlock(canWrite: boolean, environment: string): string {
  if (!canWrite) return DESK_VIEWER_MESSAGE;
  if (!singleDeskEnvironment(environment)) return DESK_ENVIRONMENT_MESSAGE;
  if (deskValueRejected(environment)) return DESK_REJECTED_MESSAGE;
  return '';
}
