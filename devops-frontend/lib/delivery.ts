export type GitHubAccess = 'connected' | 'failed' | 'paused' | string;
export type MergeTracking = 'configured' | 'needs_setup' | string;

export type DeliveryCISummary = {
  passed?: number;
  failed?: number;
  pending?: number;
  skipped?: number;
  label?: string;
};

export type DeliveryCheck = {
  key?: string;
  label?: string;
  required?: boolean;
  present?: boolean;
  status?: string;
  detail?: string;
};

export function formatRisk(score?: number, level?: string) {
  const value = typeof score === 'number' ? score : 0;
  const band = (level || (value >= 65 ? 'high' : value >= 35 ? 'medium' : 'low')).toLowerCase();
  return {
    band,
    label: `${band} · ${value}/100`,
    scale: 'Low 0–34 · Medium 35–64 · High 65–100',
    note: 'Risk is an impact score, not release approval.',
  };
}

export function formatCI(summary?: DeliveryCISummary | null, checks?: DeliveryCheck[] | null) {
  if (summary?.label && summary.label !== 'No checks yet') {
    const failed = summary.failed || 0;
    const pending = summary.pending || 0;
    const passed = summary.passed || 0;
    const tone = failed > 0 ? 'failed' : pending > 0 ? 'pending' : passed > 0 ? 'ok' : 'unknown';
    return { label: summary.label, tone };
  }
  const list = Array.isArray(checks) ? checks : [];
  if (!list.length) return { label: '—', tone: 'unknown' };
  let failed = 0;
  let pending = 0;
  let passed = 0;
  let skipped = 0;
  list.forEach((check) => {
    const status = (check.status || '').toLowerCase();
    if (status === 'failed' || status === 'missing') failed += 1;
    else if (status === 'pending') pending += 1;
    else if (status === 'ok' || status === 'passed') passed += 1;
    else if (status === 'skipped') skipped += 1;
  });
  const parts: string[] = [];
  if (failed) parts.push(`${failed} failed`);
  if (pending) parts.push(`${pending} pending`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (passed) parts.push(`${passed} passed`);
  return {
    label: parts.join(' · ') || 'Checks unknown',
    tone: failed ? 'failed' : pending ? 'pending' : passed ? 'ok' : 'unknown',
  };
}

export function formatReviewAge(ageDays?: number, sla?: string) {
  const days = typeof ageDays === 'number' ? ageDays : 0;
  const overdue = sla === 'breach';
  const warning = sla === 'warning';
  return {
    label: days <= 0 ? 'Today' : `${days}d`,
    overdue,
    warning,
    hint: overdue ? 'Review overdue' : warning ? 'Review aging' : 'Within review window',
  };
}

export function githubAccessLabel(access?: GitHubAccess) {
  if (access === 'connected') return { label: 'GitHub connected', tone: 'ok' as const };
  if (access === 'paused') return { label: 'GitHub paused', tone: 'unknown' as const };
  if (access === 'failed') return { label: 'GitHub failed', tone: 'failed' as const };
  return { label: 'GitHub unknown', tone: 'unknown' as const };
}

export function mergeTrackingLabel(tracking?: MergeTracking) {
  if (tracking === 'configured') return { label: 'Merge tracking configured', tone: 'ok' as const };
  return { label: 'Merge tracking needs setup', tone: 'setup' as const };
}

export function formatWhen(value?: string) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDurationMinutes(minutes?: number, known?: boolean) {
  if (known === false || typeof minutes !== 'number' || minutes < 0) return 'Unknown';
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function canManageDeliveryRepos(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('devops_user');
    const user = raw ? (JSON.parse(raw) as { role?: string; devops_profile?: { is_manager?: boolean } }) : null;
    return user?.role === 'admin' || Boolean(user?.devops_profile?.is_manager);
  } catch {
    return false;
  }
}
