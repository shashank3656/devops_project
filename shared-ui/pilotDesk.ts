import { deskCanWrite, deskSubmitBlock, deskValueRejected, singleDeskEnvironment } from './deskRules';
import { workspaceScopeBlock } from './myWork';

export const PILOT_STEPS = ['provisioning', 'deployment', 'scan', 'fix', 'incident', 'restore'] as const;
export const PILOT_ENVIRONMENTS = ['staging', 'production'] as const;
export const PILOT_PROVIDERS = ['azure', 'gcp', 'runtime'] as const;
export const PILOT_SCENARIOS = ['cross_project', 'webhook_replay', 'parser_abuse', 'worker_crash', 'cloud_throttle', 'credential_expiry', 'out_of_order'] as const;
export const PILOT_BLANK_MESSAGE = 'Blank evidence stays Unknown.';
export const PILOT_PUBLISH_MESSAGE = 'Both environments must be rehearsed before publish.';
export const PILOT_BLOCKER_MESSAGE = 'An open critical blocker blocks publish.';
export const PILOT_REVIEWER_MESSAGE = 'A different reviewer is required.';
export const PILOT_EXPANSION_MESSAGE = 'Accepting expansion creates no cloud resource.';
export const PILOT_RISK_MESSAGE = 'Residual risk stays open until a different reviewer accepts it.';
export const PILOT_FINDING_MESSAGE = 'Accepting a risk does not close the finding.';

export type PilotJourneyView = { id: number; service: string; account: string; teamId: number; ready: boolean };
export type PilotStepView = { id: number; environment: string; step: string; state: string };
export type AcceptanceCaseView = {
  id: number;
  scenario: string;
  subject: string;
  revision: number;
  partial: boolean;
  findingOpen: boolean;
  state: string;
  attempts: number;
  reason: string;
};

function token(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 128 || /[\s,*]/.test(text)) return false;
  return !deskValueRejected(text);
}

function reviewerBlock(reviewerId: string, actorId: number): string {
  const reviewer = Number(reviewerId);
  if (!Number.isInteger(reviewer) || reviewer <= 0 || reviewer === actorId) return PILOT_REVIEWER_MESSAGE;
  return '';
}

export function pilotJourneyBlock(role: string, projectId: string, environment: string, teamId: string, service: string, account: string): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!/^[1-9]\d*$/.test(teamId.trim()) || !token(service) || !token(account)) return 'That value is not accepted.';
  return '';
}

export function pilotStepBlock(role: string, environment: string, step: string, evidence: string): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (environment !== 'staging' && environment !== 'production') return 'One environment is required.';
  if (!PILOT_STEPS.includes(step as (typeof PILOT_STEPS)[number])) return 'That value is not accepted.';
  if (deskValueRejected(evidence)) return 'That value is not accepted.';
  return '';
}

export function pilotPublishBlock(
  role: string,
  environment: string,
  reviewerId: string,
  actorId: number,
  checklistReady: boolean,
  rollbackReady: boolean,
  criticalOpen: boolean,
): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  const reviewer = reviewerBlock(reviewerId, actorId);
  if (reviewer) return reviewer;
  if (!checklistReady || !rollbackReady) return PILOT_PUBLISH_MESSAGE;
  if (criticalOpen) return PILOT_BLOCKER_MESSAGE;
  return '';
}

export function pilotExpansionBlock(role: string, environment: string, provider: string, scope: string, ownerId: string): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!PILOT_PROVIDERS.includes(provider as (typeof PILOT_PROVIDERS)[number])) return 'That value is not accepted.';
  if (!singleDeskEnvironment(scope) || deskValueRejected(scope)) return 'One environment is required.';
  if (!/^[1-9]\d*$/.test(ownerId.trim())) return PILOT_REVIEWER_MESSAGE;
  return '';
}

export function acceptanceCaseBlock(role: string, projectId: string, environment: string, scenario: string, subject: string, revision: string, detail: string): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!PILOT_SCENARIOS.includes(scenario as (typeof PILOT_SCENARIOS)[number])) return 'That value is not accepted.';
  if (scenario === 'parser_abuse' || deskValueRejected(detail) || deskValueRejected(subject)) return 'That value is not accepted.';
  if (!token(subject)) return 'That value is not accepted.';
  if (!/^\d+$/.test(revision.trim())) return 'That value is not accepted.';
  return '';
}

export function acceptanceCloseBlock(partial: boolean, state: string, findingOpen: boolean): string {
  if (partial || state !== 'recorded' || !findingOpen) return 'A partial result does not close the finding.';
  return '';
}

export function acceptanceRiskBlock(role: string, environment: string, summary: string, reviewerId: string, actorId: number, accepting: boolean): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  const text = summary.trim();
  if (!accepting && (text === '' || text.length > 500 || deskValueRejected(text))) return 'That value is not accepted.';
  if (accepting) return reviewerBlock(reviewerId, actorId);
  return '';
}

export function parsePilotJourney(value: unknown): PilotJourneyView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const service = typeof row.service === 'string' ? row.service : '';
  const account = typeof row.account === 'string' ? row.account : '';
  if (!Number.isInteger(id) || id <= 0 || !token(service) || !token(account)) return null;
  return { id, service, account, teamId: Number(row.team_id) || 0, ready: row.ready === true };
}

export function parseAcceptanceCases(value: unknown): AcceptanceCaseView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = Number(row.id);
    const scenario = typeof row.scenario === 'string' ? row.scenario : '';
    const subject = typeof row.subject === 'string' ? row.subject : '';
    if (!Number.isInteger(id) || id <= 0 || !token(subject)) return [];
    const reason = typeof row.reason === 'string' && !deskValueRejected(row.reason) ? row.reason : '';
    return [{
      id,
      scenario,
      subject,
      revision: Number(row.revision) || 0,
      partial: row.partial === true,
      findingOpen: row.finding_open !== false,
      state: typeof row.state === 'string' && row.state ? row.state : 'unknown',
      attempts: Number(row.attempts) || 0,
      reason,
    }];
  });
}
