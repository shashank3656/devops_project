import type { ConfirmOptions } from './ConfirmDialog';

export type GuardedActionKind =
  | 'restart'
  | 'scale'
  | 'resume'
  | 'promote'
  | 'rollback'
  | 'disable_cloud_account';

export type GuardedIncidentBrief = {
  reference: string;
  summary: string;
  severity: string;
  blocks_promotion: boolean;
};

export type GuardedActionContext = {
  action: string;
  can_act: boolean;
  block_reason?: string;
  resource_label?: string;
  environment?: string;
  target_environment?: string;
  image?: string;
  commit_sha?: string;
  freeze?: { active: boolean; reason?: string; ends_at?: string };
  open_incidents?: GuardedIncidentBrief[];
  warnings?: string[];
};

export function guardedContextDetailLines(ctx: GuardedActionContext): string[] {
  const lines: string[] = [];
  if (ctx.resource_label?.trim()) {
    lines.push(`Resource: ${ctx.resource_label.trim()}`);
  }
  if (ctx.environment?.trim()) {
    lines.push(`Environment: ${ctx.environment.trim()}`);
  }
  if (ctx.target_environment?.trim()) {
    lines.push(`Target environment: ${ctx.target_environment.trim()}`);
  }
  if (ctx.image?.trim()) {
    lines.push(`Image: ${ctx.image.trim()}`);
  }
  if (ctx.commit_sha?.trim()) {
    lines.push(`Commit / SHA: ${ctx.commit_sha.trim()}`);
  }
  if (ctx.freeze?.active) {
    const freezeLine = ctx.freeze.reason?.trim()
      ? `Deployment freeze: ${ctx.freeze.reason.trim()}`
      : 'Deployment freeze is active for this scope.';
    lines.push(freezeLine);
  }
  const incidents = ctx.open_incidents || [];
  if (incidents.length > 0) {
    lines.push(
      `Open incidents (${incidents.length}): ${incidents
        .slice(0, 3)
        .map((item) => item.reference || item.summary)
        .join(', ')}`,
    );
  }
  for (const warning of ctx.warnings || []) {
    if (warning.trim()) lines.push(warning.trim());
  }
  return lines;
}

export function buildGuardedConfirmOptions(
  title: string,
  ctx: GuardedActionContext,
  message: string,
  confirmLabel: string,
  destructive?: boolean,
): ConfirmOptions {
  return {
    title,
    message,
    detailLines: guardedContextDetailLines(ctx),
    confirmLabel,
    destructive,
  };
}
