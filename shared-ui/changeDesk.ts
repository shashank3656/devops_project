import { deskCanWrite, deskSubmitBlock, deskValueRejected, normalizeDeskState } from './deskRules';
import { workspaceScopeBlock } from './myWork';

export const CHANGE_AUTH_MESSAGE = 'An unauthenticated event is not recorded.';
export const CHANGE_SEEN_MESSAGE = 'A seen scan cannot invent an event.';
export const CHANGE_COVERAGE_MESSAGE = 'Verify needs partial scan coverage and a different reviewer.';
export const CHANGE_REVISION_MESSAGE = 'Revision must be greater than zero.';
export const CHANGE_REVIEWER_MESSAGE = 'A different reviewer is required.';

export type ChangeEventView = {
  id: number;
  eventKey: string;
  identity: string;
  resource: string;
  revision: number;
  state: string;
  observed: string;
  suspected: boolean;
  verified: boolean;
  workCount: number;
  applied: boolean;
  reason: string;
};

function token(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 128 || /[\s,*]/.test(text)) return false;
  return !deskValueRejected(text);
}

function reviewerBlock(reviewerId: string, actorId: number): string {
  const reviewer = Number(reviewerId);
  if (!Number.isInteger(reviewer) || reviewer <= 0 || reviewer === actorId) return CHANGE_REVIEWER_MESSAGE;
  return '';
}

export function changeEventBlock(
  role: string,
  projectId: string,
  environment: string,
  eventKey: string,
  identity: string,
  resource: string,
  revision: string,
  authenticated: boolean,
): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!authenticated) return CHANGE_AUTH_MESSAGE;
  if (!token(eventKey) || !token(identity) || !token(resource)) return 'That value is not accepted.';
  if (!/^[1-9]\d*$/.test(revision.trim())) return CHANGE_REVISION_MESSAGE;
  return '';
}

export function changeScanBlock(role: string, environment: string, eventKey: string, seen: boolean, knownState: string): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!token(eventKey)) return 'That value is not accepted.';
  if (seen && (knownState === '' || knownState === 'unknown')) return CHANGE_SEEN_MESSAGE;
  return '';
}

export function changeVerifyBlock(role: string, environment: string, coveragePartial: boolean, reviewerId: string, actorId: number): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!coveragePartial) return CHANGE_COVERAGE_MESSAGE;
  return reviewerBlock(reviewerId, actorId);
}

export function parseChangeEvent(value: unknown): ChangeEventView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const eventKey = typeof row.event_key === 'string' ? row.event_key : '';
  if (!Number.isInteger(id) || id <= 0 || !token(eventKey)) return null;
  const reason = typeof row.reason === 'string' && !deskValueRejected(row.reason) ? row.reason : '';
  return {
    id,
    eventKey,
    identity: typeof row.identity === 'string' && token(row.identity) ? row.identity : '',
    resource: typeof row.resource === 'string' && token(row.resource) ? row.resource : '',
    revision: Number(row.revision) || 0,
    state: typeof row.state === 'string' && row.state ? row.state : 'unknown',
    observed: normalizeDeskState(typeof row.observed === 'string' ? row.observed : ''),
    suspected: row.suspected === true,
    verified: row.verified === true,
    workCount: Number(row.work_count) || 0,
    applied: row.applied === true,
    reason,
  };
}

export function parseChangeEvents(value: unknown): ChangeEventView[] {
  return Array.isArray(value) ? value.map(parseChangeEvent).filter((item): item is ChangeEventView => Boolean(item)) : [];
}
