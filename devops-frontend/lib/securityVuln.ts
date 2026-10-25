import { buildPortalApiUrl, portalFetch } from '@infragate/ui';

export type VulnTab = 'services' | 'advisories' | 'findings' | 'remediation' | 'campaigns' | 'history' | 'sources' | 'configuration' | 'comparisons' | 'new-deps';

export const VULN_TABS: { id: VulnTab; label: string }[] = [
  { id: 'services', label: 'Services' },
  { id: 'advisories', label: 'Advisories' },
  { id: 'findings', label: 'Findings' },
  { id: 'remediation', label: 'Remediation' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'history', label: 'History' },
  { id: 'comparisons', label: 'PR diffs' },
  { id: 'new-deps', label: 'New deps' },
  { id: 'sources', label: 'Sources' },
  { id: 'configuration', label: 'Config' },
];

export function vulnTab(value: string | string[] | undefined): VulnTab {
  const text = Array.isArray(value) ? value[0] : value;
  const allowed: VulnTab[] = ['services', 'advisories', 'findings', 'remediation', 'campaigns', 'history', 'sources', 'configuration', 'comparisons', 'new-deps'];
  return allowed.includes(text as VulnTab) ? (text as VulnTab) : 'services';
}

export function queryText(value: string | string[] | undefined): string {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' ? text : '';
}

export function severityBadge(value: string): string {
  switch ((value || '').toLowerCase()) {
    case 'critical':
      return 'sec-sev sec-sev--critical';
    case 'high':
    case 'important':
      return 'sec-sev sec-sev--high';
    case 'medium':
    case 'moderate':
      return 'sec-sev sec-sev--medium';
    case 'low':
    case 'minor':
      return 'sec-sev sec-sev--low';
    default:
      return 'sec-sev';
  }
}

export function severityLabel(value: string): string {
  switch ((value || '').toLowerCase()) {
    case 'critical':
      return 'Critical';
    case 'high':
    case 'important':
      return 'High';
    case 'medium':
    case 'moderate':
      return 'Medium';
    case 'low':
    case 'minor':
      return 'Low';
    case 'unknown':
      return 'Unknown';
    default:
      return 'Unknown';
  }
}

export function patchLabel(value: string): string {
  switch ((value || '').toLowerCase()) {
    case 'no_known_fix':
      return 'No known fix';
    case 'fix_available':
      return 'Fix available';
    case 'pr_linked':
      return 'PR linked';
    case 'merged_awaiting_scan':
      return 'Merged · awaiting scan';
    case 'repository_verified':
      return 'Repository verified';
    case 'deployment_verification_pending':
      return 'Deployment verification pending';
    case 'deployment_verified':
      return 'Deployment verified';
    case 'tests_required':
      return 'Tests required';
    default:
      return value ? value.replace(/_/g, ' ') : 'Unknown';
  }
}

export function collectionModeLabel(value?: string): string {
  switch ((value || '').toLowerCase()) {
    case 'agent':
      return 'Private outbound agent';
    case 'ci':
      return 'CI inventory / SBOM upload';
    default:
      return 'Hosted collector';
  }
}

export function accessLabel(value?: string): string {
  switch ((value || '').toLowerCase()) {
    case 'reachable':
      return 'Found';
    case 'not_found':
    case 'denied':
      return 'Private / no access';
    case 'no_token':
      return 'Missing';
    case 'not_hosted':
      return 'Agent / CI';
    default:
      return 'Unknown';
  }
}

export function isInternetAdvisoryMatch(value?: string): boolean {
  const source = (value || 'scan').toLowerCase();
  return source === 'intel' || source === 'scan';
}

export function matchSourceLabel(value?: string): string {
  switch ((value || '').toLowerCase()) {
    case 'intel':
      return 'Internet advisory';
    case 'scan':
      return 'Repository scan';
    default:
      return 'Unknown';
  }
}

export function usageLabel(item: { direct?: boolean; dev?: boolean; parent_package?: string }): string {
  const kind = item.direct === false
    ? (item.parent_package ? `Transitive via ${item.parent_package}` : 'Transitive')
    : 'Direct';
  return item.dev ? `${kind} · dev` : kind;
}

export function reachabilityLabel(value?: string): string {
  switch ((value || '').toLowerCase()) {
    case 'imported':
      return 'Imported';
    case 'not_imported':
      return 'Not imported';
    default:
      return 'Unknown';
  }
}

export function findingIsClosed(value?: string): boolean {
  switch ((value || '').toLowerCase()) {
    case 'fixed':
    case 'false_positive':
    case 'withdrawn':
      return true;
    default:
      return false;
  }
}

export function scanJobIds(body: Record<string, unknown>): number[] {
  const ids: number[] = [];
  if (Array.isArray(body.job_ids)) {
    body.job_ids.forEach((value) => {
      const id = Number(value);
      if (id > 0 && !ids.includes(id)) ids.push(id);
    });
  }
  const first = Number(body.job_id) || 0;
  if (first > 0 && !ids.includes(first)) ids.unshift(first);
  return ids;
}

export function lifecycleLabel(value: string): string {
  switch ((value || '').toLowerCase()) {
    case 'open':
      return 'Open';
    case 'acknowledged':
      return 'Acknowledged';
    case 'in_remediation':
      return 'In remediation';
    case 'pending_verification':
      return 'Pending verification';
    case 'fixed':
      return 'Fixed';
    case 'risk_accepted':
      return 'Risk accepted';
    case 'false_positive':
      return 'False positive';
    case 'mitigated':
      return 'Mitigated';
    case 'withdrawn':
      return 'Withdrawn';
    default:
      return 'Unknown';
  }
}

export async function vulnRequest(apiUrl: string, path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('devops_token') : '';
  if (!token) {
    if (typeof window !== 'undefined') window.location.assign('/login');
    return { status: 401, body: {} };
  }
  const response = await portalFetch(buildPortalApiUrl(apiUrl, path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && typeof window !== 'undefined') window.location.assign('/login');
  return { status: response.status, body: payload && typeof payload === 'object' ? payload as Record<string, unknown> : {} };
}

export function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function canManageVulnWorkspace(payload: Record<string, unknown> | null | undefined): boolean {
  const root = payload || {};
  const nested = asRecord(root.user);
  const account = Object.keys(nested).length ? nested : root;
  const role = String(account.role || root.role || '').toLowerCase();
  if (role === 'admin') return true;
  const grants = asRecord(account.grants || root.grants);
  if (grants.manager === true) return true;
  const profile = asRecord(account.devops_profile || root.devops_profile);
  return profile.is_manager === true;
}

export function sessionCanManageVulnWorkspace(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('devops_user');
    if (!raw) return false;
    return canManageVulnWorkspace(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return false;
  }
}
