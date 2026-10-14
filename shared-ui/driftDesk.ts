import {
  DESK_REJECTED_MESSAGE,
  DESK_VIEWER_MESSAGE,
  deskCanWrite,
  deskValueRejected,
} from './deskRules';
import { accessToken } from './accessDesk';
import { workspaceScopeBlock } from './myWork';

export const DRIFT_REFRESH_MESSAGE = 'A refresh cannot open a review.';
export const DRIFT_REVIEWER_MESSAGE = 'A different reviewer is required.';
export const DRIFT_PLAN_MESSAGE = 'A review needs a drifted configuration plan.';

export type DriftPlanView = {
  id: number;
  workspace: string;
  kind: 'configuration' | 'refresh';
  state: string;
  observed: string;
  readOnly: boolean;
  canApply: boolean;
  reason: string;
};

export type DriftReviewView = {
  id: number;
  planId: number;
  reviewerId: number;
  state: string;
  applied: boolean;
};

export function driftPlanBlock(input: {
  role: string;
  projectId: string;
  environment: string;
  workspace: string;
  kind: string;
  detail: string;
}): string {
  const scope = workspaceScopeBlock(input.projectId, input.environment);
  if (scope) return scope;
  if (!deskCanWrite(input.role)) return DESK_VIEWER_MESSAGE;
  const kind = input.kind.trim().toLowerCase();
  if (kind !== 'configuration' && kind !== 'refresh') return DESK_REJECTED_MESSAGE;
  if (!accessToken(input.workspace)) return DESK_REJECTED_MESSAGE;
  if (deskValueRejected(input.detail)) return DESK_REJECTED_MESSAGE;
  return '';
}

export function driftLockBlock(role: string, projectId: string, environment: string, workspace: string): string {
  const scope = workspaceScopeBlock(projectId, environment);
  if (scope) return scope;
  if (!deskCanWrite(role)) return DESK_VIEWER_MESSAGE;
  if (!accessToken(workspace)) return DESK_REJECTED_MESSAGE;
  return '';
}

export function driftReviewBlock(input: {
  role: string;
  kind: string;
  state: string;
  reviewerId: number;
  actorId: number;
}): string {
  if (!deskCanWrite(input.role)) return DESK_VIEWER_MESSAGE;
  if (input.kind === 'refresh') return DRIFT_REFRESH_MESSAGE;
  if (input.kind !== 'configuration' || input.state !== 'drifted') return DRIFT_PLAN_MESSAGE;
  if (input.reviewerId <= 0 || input.reviewerId === input.actorId) return DRIFT_REVIEWER_MESSAGE;
  return '';
}

export function driftStateLabel(state: string): string {
  switch (state) {
    case 'drifted':
      return 'Drifted';
    case 'refresh':
      return 'Refresh';
    case 'unchanged':
      return 'Unchanged';
    case 'blocked':
      return 'Blocked';
    case 'unknown':
      return 'Unknown';
    default:
      return 'Unknown';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function parseDriftPlan(body: unknown): DriftPlanView | null {
  const item = asRecord(body);
  const id = typeof item.id === 'number' ? item.id : 0;
  const workspace = typeof item.workspace === 'string' ? item.workspace.trim() : '';
  const kind = item.kind === 'refresh' ? 'refresh' : item.kind === 'configuration' ? 'configuration' : '';
  if (id <= 0 || !kind || !accessToken(workspace)) return null;
  const reason = typeof item.reason === 'string' && !deskValueRejected(item.reason) ? item.reason : '';
  return {
    id,
    workspace,
    kind,
    state: typeof item.state === 'string' ? item.state : 'unknown',
    observed: typeof item.observed === 'string' ? item.observed : 'unknown',
    readOnly: item.read_only !== false,
    canApply: item.can_apply === true,
    reason,
  };
}

export function parseDriftPlans(body: unknown): DriftPlanView[] {
  if (!Array.isArray(body)) return [];
  return body.map(parseDriftPlan).filter((item): item is DriftPlanView => item !== null);
}

export function parseDriftReview(body: unknown): DriftReviewView | null {
  const item = asRecord(body);
  const id = typeof item.id === 'number' ? item.id : 0;
  const planId = typeof item.plan_id === 'number' ? item.plan_id : 0;
  if (id <= 0 || planId <= 0) return null;
  return {
    id,
    planId,
    reviewerId: typeof item.reviewer_id === 'number' ? item.reviewer_id : 0,
    state: item.state === 'proposed' ? 'proposed' : 'unknown',
    applied: item.applied === true,
  };
}
