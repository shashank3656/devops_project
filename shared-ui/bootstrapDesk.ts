import { deskCanWrite, deskSubmitBlock, deskValueRejected, normalizeDeskState } from './deskRules';
import { workspaceScopeBlock } from './myWork';

export const BOOTSTRAP_LANGUAGE = 'go';
export const BOOTSTRAP_MAX_ATTEMPTS = 3;
export const BOOTSTRAP_STEPS = ['catalog', 'telemetry', 'security'] as const;
export const BOOTSTRAP_PRODUCTION_MESSAGE = 'Production is not accepted.';
export const BOOTSTRAP_VERSION_MESSAGE = 'Version must be recorded.';
export const BOOTSTRAP_ORDER_MESSAGE = 'Catalog, telemetry, and security pass in order.';
export const BOOTSTRAP_REVIEWER_MESSAGE = 'A different reviewer is required.';
export const BOOTSTRAP_PIPELINE_MESSAGE = 'Generated CI validates only after catalog, telemetry, and security.';

export type BootstrapView = {
  id: number;
  service: string;
  language: string;
  version: number;
  state: string;
  observed: string;
  ciValid: boolean;
  canApply: boolean;
  applied: boolean;
  reason: string;
};

export type BootstrapStepView = {
  id: number;
  bootstrapId: number;
  name: string;
  state: string;
  attempts: number;
  applied: boolean;
  reason: string;
};

function serviceToken(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 128 || /[\s,*]/.test(text)) return false;
  return !deskValueRejected(text);
}

export function bootstrapProduction(environment: string): boolean {
  const value = environment.trim().toLowerCase();
  return value === 'production' || value === 'prod';
}

export function bootstrapRecordBlock(role: string, projectId: string, environment: string, service: string, version: string): string {
  if (bootstrapProduction(environment)) return BOOTSTRAP_PRODUCTION_MESSAGE;
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!serviceToken(service)) return 'That value is not accepted.';
  if (!/^[1-9]\d*$/.test(version.trim())) return BOOTSTRAP_VERSION_MESSAGE;
  return '';
}

export function bootstrapStepBlock(role: string, environment: string, name: string, priorPassed: boolean): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (name !== 'catalog' && name !== 'telemetry' && name !== 'security') return BOOTSTRAP_ORDER_MESSAGE;
  if (name !== 'catalog' && !priorPassed) return BOOTSTRAP_ORDER_MESSAGE;
  return '';
}

export function bootstrapReviewBlock(role: string, environment: string, ciValid: boolean, reviewerId: string, actorId: number): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!ciValid) return BOOTSTRAP_PIPELINE_MESSAGE;
  const reviewer = Number(reviewerId);
  if (!Number.isInteger(reviewer) || reviewer <= 0 || reviewer === actorId) return BOOTSTRAP_REVIEWER_MESSAGE;
  return '';
}

export function parseBootstrap(value: unknown): BootstrapView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const service = typeof row.service === 'string' ? row.service : '';
  if (!Number.isInteger(id) || id <= 0 || !serviceToken(service)) return null;
  const reason = typeof row.reason === 'string' && !deskValueRejected(row.reason) ? row.reason : '';
  return {
    id,
    service,
    language: BOOTSTRAP_LANGUAGE,
    version: Number(row.version) || 0,
    state: typeof row.state === 'string' && row.state ? row.state : 'unknown',
    observed: normalizeDeskState(typeof row.observed === 'string' ? row.observed : ''),
    ciValid: row.ci_valid === true,
    canApply: false,
    applied: row.applied === true,
    reason,
  };
}

export function parseBootstraps(value: unknown): BootstrapView[] {
  return Array.isArray(value) ? value.map(parseBootstrap).filter((item): item is BootstrapView => Boolean(item)) : [];
}

export function parseBootstrapStep(value: unknown): BootstrapStepView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const name = typeof row.name === 'string' ? row.name : '';
  if (!Number.isInteger(id) || id <= 0 || (name !== 'catalog' && name !== 'telemetry' && name !== 'security')) return null;
  const reason = typeof row.reason === 'string' && !deskValueRejected(row.reason) ? row.reason : '';
  return {
    id,
    bootstrapId: Number(row.bootstrap_id) || 0,
    name,
    state: typeof row.state === 'string' && row.state ? row.state : 'unknown',
    attempts: Number(row.attempts) || 0,
    applied: row.applied === true,
    reason,
  };
}
