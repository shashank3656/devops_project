import {
  DESK_REJECTED_MESSAGE,
  DESK_VIEWER_MESSAGE,
  deskCanWrite,
  deskValueRejected,
} from './deskRules';
import { workspaceScopeBlock } from './myWork';

export const ACCESS_DENIED_MESSAGE = 'Denied approval creates no grant.';
export const ACCESS_APPROVER_MESSAGE = 'A different approver is required.';
export const ACCESS_REVIEWER_MESSAGE = 'A different reviewer is required.';
export const ACCESS_DURATION_MESSAGE = 'Duration must be 1 to 60 minutes.';
export const ACCESS_PROVIDER = 'sandbox';

export type AccessGrantView = {
  id: number;
  target: string;
  state: string;
  entitled: boolean;
  residual: boolean;
  observed: string;
  duration: number;
  executor: string;
};

export function accessToken(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.length <= 128 && !/[ \n,*]/.test(trimmed) && trimmed.toLowerCase() !== 'healthy' && !deskValueRejected(trimmed);
}

export function accessGrantBlock(input: {
  role: string;
  projectId: string;
  environment: string;
  target: string;
  reason: string;
  executor: string;
  decision: string;
  duration: number;
  approverId: number;
  actorId: number;
}): string {
  const scope = workspaceScopeBlock(input.projectId, input.environment);
  if (scope) return scope;
  if (!deskCanWrite(input.role)) return DESK_VIEWER_MESSAGE;
  if (input.decision.trim().toLowerCase() !== 'approved') return ACCESS_DENIED_MESSAGE;
  if (!accessToken(input.target) || !accessToken(input.executor)) return DESK_REJECTED_MESSAGE;
  const reason = input.reason.trim();
  if (reason === '' || reason.length > 500 || deskValueRejected(reason)) return DESK_REJECTED_MESSAGE;
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 60) return ACCESS_DURATION_MESSAGE;
  if (input.approverId <= 0 || input.approverId === input.actorId) return ACCESS_APPROVER_MESSAGE;
  return '';
}

export function accessActionBlock(role: string, state: string, action: 'expire' | 'revoke' | 'verify', reviewerId = 0, actorId = 0): string {
  if (!deskCanWrite(role)) return DESK_VIEWER_MESSAGE;
  if (action === 'verify') {
    if (state !== 'revocation_failed') return ACCESS_REVIEWER_MESSAGE;
    if (reviewerId <= 0 || reviewerId === actorId) return ACCESS_REVIEWER_MESSAGE;
    return '';
  }
  if (state !== 'approved') return 'That grant cannot be changed.';
  return '';
}

export function accessStateLabel(state: string): string {
  switch (state) {
    case 'approved':
      return 'Approved';
    case 'expired':
      return 'Expired';
    case 'revocation_failed':
      return 'Revocation failed';
    case 'revoked':
      return 'Revoked';
    default:
      return 'Unknown';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function parseAccessGrant(body: unknown): AccessGrantView | null {
  const item = asRecord(body);
  const id = typeof item.id === 'number' ? item.id : 0;
  const target = typeof item.target === 'string' ? item.target.trim() : '';
  const executor = typeof item.executor === 'string' ? item.executor.trim() : '';
  const state = typeof item.state === 'string' ? item.state : '';
  if (id <= 0 || !accessToken(target) || (executor !== '' && !accessToken(executor))) return null;
  return {
    id,
    target,
    state,
    entitled: item.entitled === true,
    residual: item.residual_session === true,
    observed: typeof item.observed === 'string' ? item.observed : 'unknown',
    duration: typeof item.duration_minutes === 'number' ? item.duration_minutes : 0,
    executor,
  };
}

export function parseAccessGrants(body: unknown): AccessGrantView[] {
  if (!Array.isArray(body)) return [];
  return body.map(parseAccessGrant).filter((item): item is AccessGrantView => item !== null);
}
