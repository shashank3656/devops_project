import { deskCanWrite, deskSubmitBlock, deskValueRejected, normalizeDeskState } from './deskRules';
import { workspaceScopeBlock } from './myWork';

export const REPORT_METRICS = ['delivery', 'incident', 'remediation'] as const;
export const REPORT_TIMEZONE = 'UTC';
export const REPORT_DRAFT_MESSAGE = 'Drafts stay off until the gate is enabled.';
export const REPORT_REVIEWER_MESSAGE = 'A different reviewer is required.';
export const AUTOMATION_TRIGGERS = ['assignment', 'overdue', 'expiry', 'scan_health'] as const;
export const AUTOMATION_ACTION = 'notify';
export const AUTOMATION_SOURCES = ['finding', 'incident', 'exception', 'scan'] as const;
export const AUTOMATION_RESULTS = ['delivered', 'failed'] as const;
export const AUTOMATION_NOTIFY_MESSAGE = 'Automation can notify and cannot execute.';
export const AUTOMATION_DEPTH_MESSAGE = 'A nested automation writes nothing.';

export type ReportViewModel = {
  metric: string;
  numeratorName: string;
  denominatorName: string;
  numerator: number;
  denominator: number;
  coverage: string;
  timezone: string;
};

export type AutomationRuleView = {
  id: number;
  trigger: string;
  action: string;
  version: number;
  enabled: boolean;
};

const METRIC_NAMES: Record<string, [string, string]> = {
  delivery: ['delivered deployments', 'attempted deployments'],
  incident: ['opened incidents', 'services in the environment'],
  remediation: ['closed findings', 'findings with a recorded due date'],
};

function token(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 128 || /[\s,*]/.test(text)) return false;
  return !deskValueRejected(text);
}

export function reportDefinitionBlock(role: string, projectId: string, environment: string, metric: string): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (!REPORT_METRICS.includes(metric as (typeof REPORT_METRICS)[number])) return 'That value is not accepted.';
  return '';
}

export function reportDraftBlock(role: string, environment: string, text: string): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (deskValueRejected(text) || text.trim() === '') return 'That value is not accepted.';
  return REPORT_DRAFT_MESSAGE;
}

export function reportPublishBlock(role: string, environment: string, reviewerId: string, actorId: number, authorId: number): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  const reviewer = Number(reviewerId);
  if (!Number.isInteger(reviewer) || reviewer <= 0 || reviewer === actorId || reviewer === authorId) return REPORT_REVIEWER_MESSAGE;
  return '';
}

export function automationRuleBlock(role: string, projectId: string, environment: string, trigger: string, action: string): string {
  const scopeBlock = workspaceScopeBlock(projectId, environment);
  if (scopeBlock) return scopeBlock;
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (action !== AUTOMATION_ACTION) return AUTOMATION_NOTIFY_MESSAGE;
  if (!AUTOMATION_TRIGGERS.includes(trigger as (typeof AUTOMATION_TRIGGERS)[number])) return 'That value is not accepted.';
  return '';
}

export function automationRunBlock(role: string, environment: string, sourceKind: string, sourceId: string, depth: string): string {
  const guard = deskSubmitBlock(deskCanWrite(role), environment);
  if (guard) return guard;
  if (sourceKind === 'automation' || sourceKind === 'rule') return AUTOMATION_DEPTH_MESSAGE;
  if (!AUTOMATION_SOURCES.includes(sourceKind as (typeof AUTOMATION_SOURCES)[number]) || !token(sourceId)) return 'That value is not accepted.';
  if (depth.trim() !== '0' && depth.trim() !== '1') return AUTOMATION_DEPTH_MESSAGE;
  return '';
}

export function parseReportView(value: unknown): ReportViewModel | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const definition = row.definition && typeof row.definition === 'object' ? row.definition as Record<string, unknown> : row;
  const metric = typeof definition.metric === 'string' ? definition.metric : '';
  const names = METRIC_NAMES[metric];
  if (!names) return null;
  const coverage = typeof row.coverage === 'string' ? row.coverage : 'unknown';
  return {
    metric,
    numeratorName: names[0],
    denominatorName: names[1],
    numerator: Number(row.numerator) || 0,
    denominator: Number(row.denominator) || 0,
    coverage: coverage === 'partial' || coverage === 'empty' || coverage === 'ready' ? coverage : 'unknown',
    timezone: REPORT_TIMEZONE,
  };
}

export function parseAutomationRule(value: unknown): AutomationRuleView | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const trigger = typeof row.trigger === 'string' ? row.trigger : '';
  if (!Number.isInteger(id) || id <= 0 || !AUTOMATION_TRIGGERS.includes(trigger as (typeof AUTOMATION_TRIGGERS)[number])) return null;
  return {
    id,
    trigger,
    action: AUTOMATION_ACTION,
    version: Number(row.version) || 0,
    enabled: row.enabled !== false,
  };
}

export function reportCoverageState(coverage: string): ReturnType<typeof normalizeDeskState> {
  if (coverage === 'ready' || coverage === 'empty' || coverage === 'unknown') return coverage;
  return 'unknown';
}
