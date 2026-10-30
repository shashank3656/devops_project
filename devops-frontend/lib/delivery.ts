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

function ciTone(failed: number, pending: number, passed: number, skipped: number) {
  if (failed > 0) return 'failed';
  if (pending > 0) return 'pending';
  if (passed > 0) return 'ok';
  if (skipped > 0) return 'skipped';
  return 'unknown';
}

export function formatCI(summary?: DeliveryCISummary | null, checks?: DeliveryCheck[] | null) {
  const list = Array.isArray(checks) ? checks : [];
  let failed = summary?.failed || 0;
  let pending = summary?.pending || 0;
  let passed = summary?.passed || 0;
  let skipped = summary?.skipped || 0;
  if (!failed && !pending && !passed && !skipped && list.length) {
    list.forEach((check) => {
      const status = (check.status || '').toLowerCase();
      if (status === 'failed' || status === 'missing') failed += 1;
      else if (status === 'pending') pending += 1;
      else if (status === 'ok' || status === 'passed') passed += 1;
      else if (status === 'skipped') skipped += 1;
    });
  }
  const parts: string[] = [];
  if (failed) parts.push(`${failed} failed`);
  if (pending) parts.push(`${pending} pending`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (passed) parts.push(`${passed} passed`);
  const countedLabel = parts.join(' · ');
  const rawLabel = (summary?.label || '').trim();
  const passingWithoutPassed = rawLabel.toLowerCase() === 'passing' && passed === 0;
  const label = countedLabel || (!passingWithoutPassed && rawLabel && rawLabel !== 'No checks yet' ? rawLabel : '—');
  return { label, tone: ciTone(failed, pending, passed, skipped) };
}

export function assignedReviewer(author?: string, assignees?: string[] | null, requested?: string[] | null) {
  const skip = (author || '').trim().toLowerCase();
  for (const login of [...(assignees || []), ...(requested || [])]) {
    const value = (login || '').trim();
    if (value && value.toLowerCase() !== skip) return value;
  }
  return '';
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

export function formatVerification(state?: string, label?: string) {
  const value = (state || '').toLowerCase();
  if (value === 'healthy' || value === 'passed') return { label: label || 'Healthy', tone: 'ok' as const };
  if (value === 'degraded' || value === 'failed') return { label: label || 'Degraded', tone: 'failed' as const };
  if (value === 'inconclusive' || value === 'unavailable' || value === 'pending') {
    return { label: label || 'Inconclusive', tone: 'pending' as const };
  }
  return { label: label || 'Unknown', tone: 'unknown' as const };
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

export function pipelinesHref(owner?: string, repo?: string, prNumber?: number) {
  const params = new URLSearchParams();
  const ownerName = (owner || '').trim();
  const repoName = (repo || '').trim();
  if (ownerName && repoName) params.set('repo', `${ownerName}/${repoName}`);
  else if (repoName) params.set('repo', repoName);
  if (prNumber && prNumber > 0) params.set('pr', String(prNumber));
  const query = params.toString();
  return query ? `/pipelines?${query}` : '/pipelines';
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
