// Frontend client for the /api/devops/idle backend. Wraps fetch with auth.

export type CloudKind = 'aws' | 'azure' | 'gcp';

export interface CloudAccount {
  id: number;
  name: string;
  cloud: CloudKind;
  auth_method: string;
  default_regions: string[];
  default_currency: string;
  retention_days?: number;
  ai_provider?: string;
  ai_model?: string;
  status: string;
  last_test_at?: string;
  last_test_status?: string;
  last_test_message?: string;
  last_scan_id?: number;
  last_scan_at?: string;
  created_by?: number;
  created_by_username?: string;
  created_at: string;
  updated_at: string;
}

export interface IdleScan {
  id: number;
  account_id: number;
  account_name?: string;
  cloud: CloudKind;
  regions: string[];
  scope: string[];
  thresholds?: unknown;
  ai_provider?: string;
  ai_model?: string;
  status: string;
  progress?: Record<string, number>;
  totals?: Record<string, unknown>;
  error_log?: Array<{ region: string; service: string; message: string }>;
  error_message?: string;
  raw_artifact_url?: string;
  triggered_by?: number;
  triggered_by_username?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  updated_at: string;
}

export interface IdleResource {
  id: number;
  scan_id: number;
  account_id: number;
  cloud: CloudKind;
  service: string;
  region: string;
  resource_id: string;
  name: string;
  tags: Record<string, string>;
  state: string;
  created_at_remote?: string;
  metrics: Record<string, unknown>;
  cost_estimate_usd: number;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  console_url?: string;
  ai_rank?: number;
  ai_recommendation?: string;
  ai_confidence?: number;
  created_at: string;
}

export interface IdleSettings {
  retention_days: number;
  purge_raw_artifacts: boolean;
  purge_resources: boolean;
  default_ai_provider: string;
  default_ai_model: string;
}

export interface IdleOptions {
  clouds: CloudKind[];
  auth_methods: Record<CloudKind, string[]>;
  ai_providers: string[];
  scan_scopes: Record<CloudKind, string[]>;
}

export interface IdleSummary {
  accounts: number;
  recent_scans: number;
  monthly_waste: number;
  high_severity: number;
}

const TOKEN_KEY = 'devops_token';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

async function api<T>(apiUrl: string, path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const url = `${apiUrl.replace(/\/$/, '')}/api/devops/idle${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data) ? String((data as Record<string, unknown>).error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const idle = {
  options: (apiUrl: string) => api<{ status: string } & IdleOptions>(apiUrl, '/options'),
  summary: (apiUrl: string) => api<{ status: string } & IdleSummary>(apiUrl, '/summary'),
  listAccounts: (apiUrl: string) => api<{ status: string; accounts: CloudAccount[] }>(apiUrl, '/accounts'),
  getAccount: (apiUrl: string, id: number) => api<{ status: string; account: CloudAccount }>(apiUrl, `/accounts/${id}`),
  createAccount: (apiUrl: string, body: unknown) => api<{ status: string; account: CloudAccount }>(apiUrl, '/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (apiUrl: string, id: number, body: unknown) => api<{ status: string; account: CloudAccount }>(apiUrl, `/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAccount: (apiUrl: string, id: number) => api<{ status: string }>(apiUrl, `/accounts/${id}`, { method: 'DELETE' }),
  testAccount: (apiUrl: string, id: number) => api<{ status: string; info: string }>(apiUrl, `/accounts/${id}/test`, { method: 'POST' }),
  rotateCredentials: (apiUrl: string, id: number, body: unknown) => api<{ status: string }>(apiUrl, `/accounts/${id}/rotate`, { method: 'POST', body: JSON.stringify(body) }),

  listScans: (apiUrl: string, accountId?: number) => api<{ status: string; scans: IdleScan[] }>(apiUrl, accountId ? `/scans?account_id=${accountId}` : '/scans'),
  getScan: (apiUrl: string, id: number) => api<{ status: string; scan: IdleScan }>(apiUrl, `/scans/${id}`),
  createScan: (apiUrl: string, body: unknown) => api<{ status: string; scan: IdleScan }>(apiUrl, '/scans', { method: 'POST', body: JSON.stringify(body) }),
  cancelScan: (apiUrl: string, id: number) => api<{ status: string }>(apiUrl, `/scans/${id}/cancel`, { method: 'POST' }),
  rerankScan: (apiUrl: string, id: number, body: { provider?: string; model?: string }) => api<{ status: string; provider: string; model: string; ranked_count: number; error?: string }>(apiUrl, `/scans/${id}/rerank`, { method: 'POST', body: JSON.stringify(body) }),
  listResources: (apiUrl: string, scanId: number, params: { service?: string; severity?: string; region?: string; q?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== null) q.append(k, String(v));
    });
    const qs = q.toString();
    return api<{ status: string; resources: IdleResource[] }>(apiUrl, `/scans/${scanId}/resources${qs ? `?${qs}` : ''}`);
  },
  exportCsvUrl: (apiUrl: string, scanId: number) => `${apiUrl.replace(/\/$/, '')}/api/devops/idle/scans/${scanId}/resources.csv`,
  exportXlsxUrl: (apiUrl: string, scanId: number) => `${apiUrl.replace(/\/$/, '')}/api/devops/idle/scans/${scanId}/resources.xlsx`,

  getSettings: (apiUrl: string) => api<{ status: string; settings: IdleSettings }>(apiUrl, '/settings'),
  updateSettings: (apiUrl: string, body: IdleSettings) => api<{ status: string; settings: IdleSettings }>(apiUrl, '/settings', { method: 'PATCH', body: JSON.stringify(body) }),

  listSchedules: (apiUrl: string, accountId: number) => api<{ status: string; schedules: IdleSchedule[] }>(apiUrl, `/accounts/${accountId}/schedules`),
  createSchedule: (apiUrl: string, accountId: number, body: Partial<IdleSchedule>) => api<{ status: string; schedule: IdleSchedule }>(apiUrl, `/accounts/${accountId}/schedules`, { method: 'POST', body: JSON.stringify(body) }),
  updateSchedule: (apiUrl: string, accountId: number, id: number, body: Partial<IdleSchedule>) => api<{ status: string }>(apiUrl, `/accounts/${accountId}/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSchedule: (apiUrl: string, accountId: number, id: number) => api<{ status: string }>(apiUrl, `/accounts/${accountId}/schedules/${id}`, { method: 'DELETE' }),

  listExceptions: (apiUrl: string, accountId: number) => api<{ status: string; exceptions: IdleException[] }>(apiUrl, `/accounts/${accountId}/exceptions`),
  createException: (apiUrl: string, accountId: number, body: { resource_id: string; reason?: string; expires_at?: string }) => api<{ status: string; exception: IdleException }>(apiUrl, `/accounts/${accountId}/exceptions`, { method: 'POST', body: JSON.stringify(body) }),
  deleteException: (apiUrl: string, accountId: number, id: number) => api<{ status: string }>(apiUrl, `/accounts/${accountId}/exceptions/${id}`, { method: 'DELETE' }),

  listRemediations: (apiUrl: string, scanId: number) => api<{ status: string; remediations: IdleRemediation[] }>(apiUrl, `/scans/${scanId}/remediations`),
  createRemediation: (apiUrl: string, scanId: number, body: { target: 'download' | 'github_pr' | 'jira_ticket'; resource_ids: string[]; notes?: string; issue_type?: string; branch_name?: string }) => api<{ status: string; remediation: IdleRemediation }>(apiUrl, `/scans/${scanId}/remediations`, { method: 'POST', body: JSON.stringify(body) }),
  cleanupTfPreviewUrl: (apiUrl: string, scanId: number, resourceIds?: string[]) => {
    const base = `${apiUrl.replace(/\/$/, '')}/api/devops/idle/scans/${scanId}/cleanup.tf`;
    if (!resourceIds || resourceIds.length === 0) return base;
    return `${base}?resource_ids=${encodeURIComponent(resourceIds.join(','))}`;
  },

  listAudit: (apiUrl: string, params: { account_id?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== null) q.append(k, String(v));
    });
    const qs = q.toString();
    return api<{ status: string; entries: IdleAuditEntry[] }>(apiUrl, `/audit${qs ? `?${qs}` : ''}`);
  },
};

export interface IdleSchedule {
  id: number;
  account_id: number;
  name: string;
  cadence: 'hourly' | 'daily' | 'weekly';
  hour_utc: number;
  regions: string[];
  scope: string[];
  ai_provider?: string;
  ai_model?: string;
  enabled: boolean;
  last_run_at?: string;
  last_scan_id?: number;
  last_run_status?: string;
  created_by?: number;
  created_at: string;
  updated_at: string;
}

export interface IdleException {
  id: number;
  account_id: number;
  resource_id: string;
  reason: string;
  expires_at?: string;
  created_by?: number;
  created_at: string;
}

export interface IdleRemediation {
  id: number;
  scan_id: number;
  account_id: number;
  target: 'download' | 'github_pr' | 'jira_ticket';
  resource_ids: string[];
  estimated_savings_usd: number;
  cleanup_tf_url?: string;
  pr_url?: string;
  ticket_url?: string;
  ticket_key?: string;
  status: string;
  error_message?: string;
  notes?: string;
  created_by?: number;
  created_at: string;
  completed_at?: string;
}

export interface IdleAuditEntry {
  id: number;
  account_id?: number;
  scan_id?: number;
  actor_id?: number;
  actor_username?: string;
  account_name?: string;
  action: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export function severityColor(level: string): string {
  switch (level) {
    case 'high': return '#ef4444';
    case 'medium': return '#f59e0b';
    default: return '#10b981';
  }
}

export function fmtUSD(value: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '$0.00';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export const cloudLabels: Record<CloudKind, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
};
