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
