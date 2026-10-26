export const COST_TOKEN_KEY = 'devops_token';

export type CostCoverage = 'none' | 'incomplete' | 'complete' | 'separate';

export type CostMoney = {
  coverage: CostCoverage;
  currency: string;
  basis: string;
  display: string;
  amount?: string | null;
};

export type CostImportable = {
  id: string;
  label: string;
  status: 'ready' | 'not_imported' | 'unknown' | string;
  href?: string;
  note?: string;
};

export type CostGraphBar = {
  label: string;
  display: string;
  percent: number;
  date?: string;
};

export type CostStaleHint = {
  status?: string;
  note?: string;
  href?: string;
};

export type CostTreeAccount = {
  id: number;
  cloud_account_id: number;
  display_name: string;
  account_id?: string;
  provider: string;
  href: string;
  spend?: CostMoney;
  freshness?: string;
  billing_readiness?: string;
  inventory_readiness?: string;
  metrics_readiness?: string;
  import_status?: string;
  environment?: string;
  stale_hint?: CostStaleHint | null;
  importable?: CostImportable[];
  suggestion_href?: string;
};

export type CostTreeCloud = {
  provider: string;
  account_count?: number;
  spend?: CostMoney;
  accounts: CostTreeAccount[];
};

export type CostTreeProject = {
  id: number;
  name: string;
  code?: string;
  href?: string;
  cloud_count?: number;
  spend?: CostMoney;
  cost_role?: string;
  can_operate?: boolean;
  clouds: CostTreeCloud[];
};

export type CostConnection = {
  id: number;
  cloud_account_id: number;
  account_id: string;
  display_name: string;
  provider: string;
  team_slug: string;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  billing_source: string;
  status: string;
  billing_readiness: string;
  inventory_readiness: string;
  metrics_readiness: string;
  latest_revision?: string;
  window_start?: string;
  window_end?: string;
  window_complete?: boolean | null;
  last_ingested_at?: string | null;
  freshness?: string;
};

export type CostBatch = {
  id: number;
  connection_id: number;
  account_id?: string;
  display_name?: string;
  source: string;
  kind: string;
  label: string;
  window_start: string;
  window_end: string;
  complete: boolean;
  revision: string;
  supersedes_revision_id?: number;
  imported_at: string;
};

export type CostLine = {
  service: string;
  region: string;
  account_id: string;
  resource_id: string;
  team_slug: string;
  project_code: string;
  usage_date: string;
  actual_amount: string;
  amortized_amount: string;
  currency: string;
  amount: string;
  allocated_service?: string;
};

export type CostOwnership = {
  coverage: CostCoverage | string;
  currency: string;
  display: string;
  percent?: string | null;
  allocated?: string;
};

export type CostBudgetStatus = {
  id: number;
  name: string;
  scope_type: string;
  scope_value: string;
  amount: string;
  currency: string;
  basis: string;
  period?: string;
  owner_slug?: string;
  warn_percent?: number;
  over_percent?: number;
  destination?: string;
  period_start?: string;
  period_end?: string;
  spent: CostMoney;
  remaining: CostMoney;
  alert: string;
  pauses_workloads: boolean;
  note?: string;
};

export type CostAllocationRule = {
  id: number;
  match_type: string;
  match_value: string;
  team_slug: string;
  service_name: string;
  priority: number;
  version?: number;
  effective_from?: string;
  effective_to?: string;
};

export type CostFreshnessDetail = {
  billed_through?: string | null;
  last_successful_ingestion?: string | null;
  last_dashboard_refresh?: string;
  page_refresh_is_not_new_billing?: boolean;
  note?: string;
};

export type CostAlertStatus = {
  alerts_enabled?: boolean;
  monitoring_ready?: boolean;
  delivery_verified?: boolean;
  evaluation_blocked?: boolean;
  blocked_reason?: string;
  note?: string;
};

export type CostCollection = {
  connection_id?: number;
  source?: string;
  configuration?: string;
  mode?: string;
  schedule?: string;
  next_run?: string;
  retry_status?: string;
  last_success?: string | null;
  connection_test?: {
    status?: string;
    tested_at?: string | null;
    note?: string;
  };
  note?: string;
};

export type CostPilotScope = {
  label?: string;
  mode?: string;
  note?: string;
  stores_billing_credentials?: boolean;
  automated_collection?: boolean;
};

export type CostOverview = {
  basis: string;
  currency: string;
  window_start?: string;
  window_end?: string;
  coverage?: CostCoverage;
  operating_bill: CostMoney;
  unallocated: CostMoney;
  service_mix?: CostGraphBar[];
  daily?: CostGraphBar[];
  request_estimates: {
    label: string;
    note: string;
    coverage: string;
    display: string;
    summary: string;
    alert_count?: number;
    idle_count?: number;
  };
  connections: CostConnection[];
  line_count?: number;
  freshness?: string;
  freshness_detail?: CostFreshnessDetail;
  ownership?: CostOwnership;
  forecast?: {
    method?: string;
    coverage?: string;
    display?: string;
    note?: string;
  };
  nonoverlapping_savings?: CostMoney;
  anomaly_count?: number;
  recommendation_count?: number;
  waiting_count?: number;
  budgets?: CostBudgetStatus[];
  pauses_workloads?: boolean;
  kubernetes?: {
    cluster_count?: number;
    spend?: CostMoney;
    added_to_cloud_total?: boolean;
    installs_opencost?: boolean;
    worker_can_edit?: boolean;
    note?: string;
  };
  projects?: CostTreeProject[];
  rbac?: string;
  can_operate?: boolean;
  ai?: {
    shares?: string[];
    never_shares?: string[];
    note?: string;
  };
  note?: string;
};

export type CostAccountDashboard = {
  basis: string;
  currency: string;
  window_start?: string;
  window_end?: string;
  coverage?: CostCoverage;
  freshness?: string;
  freshness_detail?: CostFreshnessDetail;
  rbac?: string;
  cost_role?: string;
  can_operate?: boolean;
  import_status?: string;
  environment?: string;
  stale_hint?: CostStaleHint | null;
  export_href?: string;
  project?: { id?: number; name?: string; code?: string };
  cloud?: string;
  connection?: CostConnection;
  spend?: CostMoney;
  service_mix?: CostGraphBar[];
  daily?: CostGraphBar[];
  compare?: {
    current?: CostMoney;
    prior?: CostMoney;
    delta?: CostMoney;
    prior_window_start?: string;
    prior_window_end?: string;
    prior_coverage?: string;
    like_for_like?: boolean;
    note?: string;
  };
  budgets?: CostBudgetStatus[];
  importable?: CostImportable[];
  suggestions?: {
    calc_id: string;
    finding_type: string;
    family?: string;
    status?: string;
    lifecycle?: string;
    savings_low?: CostMoney;
    savings_high?: CostMoney;
    blocked_reason?: string;
    proposed_action?: string;
    executes?: boolean;
    href?: string;
  }[];
  kubernetes?: {
    bound?: boolean;
    added_to_cloud_total?: boolean;
    href?: string;
    note?: string;
  };
  ai?: {
    shares?: string[];
    never_shares?: string[];
    note?: string;
  };
  note?: string;
};

export type CostProjectDashboard = {
  basis: string;
  currency: string;
  window_start?: string;
  window_end?: string;
  coverage?: CostCoverage;
  freshness?: string;
  rbac?: string;
  cost_role?: string;
  can_operate?: boolean;
  project?: CostTreeProject;
  spend?: CostMoney;
  service_mix?: CostGraphBar[];
  daily?: CostGraphBar[];
  suggestions?: CostAccountDashboard['suggestions'];
  waiting_count?: number;
  budgets?: CostBudgetStatus[];
  ai?: CostAccountDashboard['ai'];
  note?: string;
};

export type CostK8sBinding = {
  id: number;
  k8s_connection_id: number;
  cost_connection_id?: number;
  cluster_name: string;
  environment: string;
  cloud: string;
  auth_mode: string;
  project_id: number;
  project_name?: string;
  project_code?: string;
  status: string;
  inventory_readiness: string;
  metrics_readiness: string;
  allocation_readiness: string;
  billing_reconciled: string;
  collector_health: string;
  collector_install?: string;
  worker_can_edit: boolean;
  installs_opencost: boolean;
  added_to_cloud_total: boolean;
  has_collector_token?: boolean;
  capability_gaps?: string[];
  rbac_yaml?: string;
  note?: string;
};

export type CostK8sCatalog = {
  clusters: CostK8sBinding[];
  eligible: {
    id: number;
    project_id: number;
    project_name: string;
    project_code: string;
    cloud: string;
    cluster_name: string;
    environment: string;
    auth_mode: string;
    has_auth_credential: boolean;
  }[];
  cost_connections?: CostConnection[];
  collector_contract?: {
    direction?: string;
    public_scrape?: boolean;
    installs_opencost?: boolean;
    worker_can_edit?: boolean;
    docker_socket?: boolean;
    token_stored_as?: string;
    sources?: string[];
    metrics_server_role?: string;
    note?: string;
  };
  rbac_yaml?: string;
  installs_opencost?: boolean;
  worker_can_edit?: boolean;
  added_to_cloud_total?: boolean;
  can_operate?: boolean;
  pilot?: CostK8sPilot;
  note?: string;
};

export type CostK8sMetric = {
  coverage?: string;
  display?: string;
  amount?: string | null;
  estimated?: boolean;
  billed?: boolean;
  added_to_cloud_total?: boolean;
};

export type CostK8sWorkload = {
  workload_key: string;
  namespace: string;
  controller_kind: string;
  controller_name: string;
  pod_count: number;
  deleted_count: number;
  cpu_request?: string;
  memory_request?: string;
  cpu_usage?: CostK8sMetric;
  memory_usage?: CostK8sMetric;
  allocation_total?: CostK8sMetric;
  managed_by?: string;
  hpa?: string;
  vpa?: string;
  pdb?: string;
  owner?: string;
  estimated?: boolean;
  added_to_cloud_total?: boolean;
};

export type CostK8sPod = {
  pod_uid: string;
  pod_name: string;
  namespace: string;
  controller_kind: string;
  controller_name: string;
  deleted: boolean;
  cpu_usage?: CostK8sMetric;
  allocation_total?: CostK8sMetric;
  managed_by?: string;
  hpa?: string;
  vpa?: string;
  pdb?: string;
  owner?: string;
};

export type CostK8sAllocationGroup = {
  group_key: string;
  group_by: string;
  namespace: string;
  controller_kind?: string;
  controller_name?: string;
  owner?: string;
  missing_ownership?: boolean;
  pod_count: number;
  workload_count: number;
  managed_by?: string;
  hpa?: string;
  vpa?: string;
  pdb?: string;
  allocation_total?: CostK8sMetric;
};

export type CostK8sCapacity = {
  display?: string;
  cpu?: string;
  memory?: string;
  coverage?: string;
};

export type CostK8sRecommendation = {
  calc_id: string;
  workload_key: string;
  namespace: string;
  controller_name: string;
  finding_type: string;
  change_kind?: string;
  status: string;
  lifecycle: string;
  evidence: string;
  proposed_action: string;
  calculation?: string;
  blocked_reason?: string;
  managed_by?: string;
  hpa?: string;
  vpa?: string;
  pdb?: string;
  cpu_usage?: CostK8sMetric;
  allocation_total?: CostK8sMetric;
  allocation_reduction?: CostK8sMetric;
  bill_reduction?: CostMoney;
  capacity_released?: CostK8sCapacity;
  savings?: CostK8sMetric | CostMoney;
  invents_sku?: boolean;
  candidate_sku?: string;
  executes: boolean;
  worker_can_edit: boolean;
  estimated?: boolean;
  note?: string;
};

export type CostK8sSnapshot = {
  id: number;
  window_start: string;
  window_end: string;
  complete: boolean;
  duplicate?: boolean;
  correction?: boolean;
  ignored_stale?: boolean;
  undercoverage?: string;
  note?: string;
};

export type CostK8sWorkloads = {
  workloads?: CostK8sWorkload[];
  pods?: CostK8sPod[];
  allocations?: CostK8sAllocationGroup[];
  missing_ownership?: { workload_key: string; namespace: string; controller_name: string; owner?: string }[];
  group_by?: string;
  coverage?: string;
  note?: string;
  snapshot?: CostK8sSnapshot;
  list_price_labelled?: boolean;
};

export type CostK8sOptimization = {
  recommendations?: CostK8sRecommendation[];
  allocated_reduction?: CostK8sMetric;
  bill_reduction?: CostMoney;
  capacity_released?: CostK8sCapacity;
  invents_sku?: boolean;
  executes?: boolean;
  worker_can_edit?: boolean;
  estimated?: boolean;
  list_price_labelled?: boolean;
  note?: string;
};

export type CostK8sPilotCheck = {
  status?: string;
  display?: string;
  collector_health?: string;
  workloads_restarted?: boolean;
  worker_can_edit?: boolean;
  installs_opencost?: boolean;
  page_grant?: string;
  section?: string;
  note?: string;
};

export type CostK8sPilot = {
  scope?: string;
  max_clusters?: number;
  read_only?: boolean;
  environment_ok?: boolean;
  worker_can_edit?: boolean;
  installs_opencost?: boolean;
  overhead?: CostK8sPilotCheck;
  restart?: CostK8sPilotCheck;
  access?: CostK8sPilotCheck;
  note?: string;
};

export type CostK8sCollectionHealth = {
  collector_health?: string;
  last_ingested_at?: string | null;
  inventory_readiness?: string;
  metrics_readiness?: string;
  allocation_readiness?: string;
  billing_reconciled?: string;
  capability_gaps?: string[];
  public_scrape?: boolean;
  installs_opencost?: boolean;
  worker_can_edit?: boolean;
  pilot?: CostK8sPilot;
  note?: string;
};

export type CostK8sReconciliation = {
  billing_reconciled?: string;
  like_for_like?: boolean;
  distribute_idle?: boolean;
  added_to_cloud_total?: boolean;
  billed_mapped?: CostMoney;
  billed_unmapped?: CostMoney;
  estimated_workload?: CostK8sMetric;
  estimated_idle?: CostK8sMetric;
  estimated_shared?: CostK8sMetric;
  estimated_unallocated?: CostK8sMetric;
  estimated_total?: CostK8sMetric;
  idle_share?: CostK8sMetric & { percent?: string | null };
  residual?: CostMoney;
  unsupported_gaps?: string[];
  mapped_resource_count?: number;
  node_count?: number;
  currency?: string;
  basis?: string;
  list_price_labelled?: boolean;
  note?: string;
};

export type CostExplorer = {
  basis: string;
  currency: string;
  coverage: CostCoverage;
  freshness_detail?: CostFreshnessDetail;
  total: CostMoney;
  unallocated: CostMoney;
  lines: CostLine[];
  empty: boolean;
  window_start?: string;
  window_end?: string;
  ownership?: CostOwnership;
  pauses_workloads?: boolean;
  note?: string;
};

export type CostConfiguration = {
  connections: CostConnection[];
  eligible: {
    id: number;
    account_id: string;
    display_name: string;
    provider: string;
    team_slug: string;
    project_id?: number;
    project_name?: string;
    project_code?: string;
    status: string;
  }[];
  batches?: CostBatch[];
  rules?: CostAllocationRule[];
  collection?: CostCollection[];
  pilot?: CostPilotScope | string;
  freshness_detail?: CostFreshnessDetail;
  allocation_note?: string;
  can_operate?: boolean;
  ai_proof?: {
    safe?: number;
    blocked?: number;
    dropped_key_count?: number;
    note?: string;
  };
  note?: string;
};

export type CostBudgets = {
  basis: string;
  currency: string;
  coverage?: CostCoverage;
  window_start?: string;
  window_end?: string;
  period?: string;
  period_start?: string;
  period_end?: string;
  report_filter?: { from?: string; to?: string; note?: string };
  budgets: CostBudgetStatus[];
  pauses_workloads: boolean;
  can_operate?: boolean;
  note?: string;
};

export type CostAnomaly = {
  calc_id: string;
  kind: string;
  resource_id?: string;
  service?: string;
  account_id?: string;
  current: CostMoney;
  baseline: CostMoney;
  delta: CostMoney;
  like_for_like: boolean;
  coverage: string;
  note?: string;
};

export type CostRecommendation = {
  calc_id: string;
  group_id: string;
  resource_id: string;
  service: string;
  finding_type: string;
  status: string;
  impact: string;
  risk: string;
  effort: string;
  confidence: string;
  savings_low: CostMoney;
  savings_high: CostMoney;
  metrics_ready: boolean;
  has_utilization: boolean;
  blocked_reason?: string;
  evidence: string;
  calculation: string;
  proposed_action: string;
  verification: string;
  executes: boolean;
  pauses_workloads: boolean;
  lifecycle?: string;
  change_id?: number;
  change_number?: string;
  change_href?: string;
  dismiss_reason?: string;
  review_by?: string;
  allocation_reduction?: CostMoney;
  bill_reduction?: CostMoney;
  cost_avoidance?: CostMoney;
  confounders?: string;
  waiting_for?: string;
  note?: string;
};

export type CostOpportunityGroup = {
  group_id: string;
  resource_id: string;
  calc_ids: string[];
  savings: CostMoney;
  note?: string;
};

export type CostAnomalies = {
  basis: string;
  currency: string;
  anomalies: CostAnomaly[];
  insufficient_data?: boolean;
  prior_window_start?: string;
  prior_window_end?: string;
  prior_coverage?: string;
  notify_cost?: boolean;
  alerts?: CostAlertStatus;
  note?: string;
};

export type CostOptimization = {
  basis: string;
  currency: string;
  recommendations: CostRecommendation[];
  opportunity_groups: CostOpportunityGroup[];
  nonoverlapping_savings: CostMoney;
  metrics_ready: boolean;
  can_operate?: boolean;
  note?: string;
};

export type CostSavings = {
  basis: string;
  currency: string;
  waiting: CostRecommendation[];
  outcomes: CostRecommendation[];
  estimated_savings?: CostMoney;
  verified_bill_reduction: CostMoney;
  released_capacity?: CostMoney & { note?: string };
  executes: boolean;
  pauses_workloads: boolean;
  note?: string;
};

export type CostServiceStrip = {
  service: string;
  basis: string;
  currency: string;
  coverage: CostCoverage;
  operating_cost: CostMoney;
  window_start?: string;
  window_end?: string;
  empty?: boolean;
  pauses_workloads?: boolean;
  note?: string;
};

export const COST_COPILOT_CHIPS = [
  'Why is spend Unknown?',
  'Why is coverage incomplete?',
];

export function formatCostDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function costThisMonth(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    from: formatCostDate(new Date(Date.UTC(year, month, 1))),
    to: formatCostDate(new Date(Date.UTC(year, month, now.getUTCDate()))),
  };
}

export function costLastMonth(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    from: formatCostDate(new Date(Date.UTC(year, month - 1, 1))),
    to: formatCostDate(new Date(Date.UTC(year, month, 0))),
  };
}

export type CostAnalysisFilters = {
  project: string;
  cloud: string;
  environment: string;
  freshness: string;
  importStatus: string;
};

export type CostFilterOptions = {
  projects: { id: number; name: string }[];
  clouds: string[];
  environments: string[];
  freshness: string[];
  imports: string[];
};

export function emptyCostAnalysisFilters(): CostAnalysisFilters {
  return { project: '', cloud: '', environment: '', freshness: '', importStatus: '' };
}

export function costAnalysisFiltersActive(filters: CostAnalysisFilters) {
  return Boolean(filters.project || filters.cloud || filters.environment || filters.freshness || filters.importStatus);
}

export function uniqueCostFilterOptions(projects: CostTreeProject[]): CostFilterOptions {
  const clouds = new Set<string>();
  const environments = new Set<string>();
  const freshness = new Set<string>();
  const imports = new Set<string>();
  (projects || []).forEach((project) => {
    (project.clouds || []).forEach((cloud) => {
      if (cloud.provider) clouds.add(cloud.provider);
      (cloud.accounts || []).forEach((account) => {
        environments.add(account.environment || 'Unknown');
        freshness.add((account.freshness || 'unknown').toLowerCase());
        imports.add((account.import_status || 'unknown').toLowerCase());
      });
    });
  });
  return {
    projects: (projects || []).map((project) => ({ id: project.id, name: project.name })),
    clouds: [...clouds].sort(),
    environments: [...environments].sort(),
    freshness: [...freshness].sort(),
    imports: [...imports].sort(),
  };
}

export function applyCostAnalysisFilters(projects: CostTreeProject[], filters: CostAnalysisFilters): CostTreeProject[] {
  return (projects || [])
    .filter((project) => !filters.project || String(project.id) === filters.project)
    .map((project) => ({
      ...project,
      clouds: (project.clouds || [])
        .filter((cloud) => !filters.cloud || cloud.provider === filters.cloud)
        .map((cloud) => ({
          ...cloud,
          accounts: (cloud.accounts || []).filter((account) => {
            if (filters.environment && (account.environment || 'Unknown') !== filters.environment) return false;
            if (filters.freshness && (account.freshness || 'unknown').toLowerCase() !== filters.freshness) return false;
            if (filters.importStatus && (account.import_status || 'unknown').toLowerCase() !== filters.importStatus) return false;
            return true;
          }),
        }))
        .filter((cloud) => cloud.accounts.length),
    }))
    .filter((project) => project.clouds.length);
}

export function countCostAccounts(projects: CostTreeProject[]) {
  return (projects || []).reduce((sum, project) => (
    sum + (project.clouds || []).reduce((cloudSum, cloud) => cloudSum + (cloud.accounts || []).length, 0)
  ), 0);
}

export function costToneForDisplay(display?: string | null): 'billed' | 'unknown' {
  return display && display !== 'Unknown' ? 'billed' : 'unknown';
}

export function costFamilyTone(label: string) {
  const key = (label || '').toLowerCase();
  if (key === 'compute') return 'compute';
  if (key === 'database') return 'database';
  if (key === 'storage') return 'storage';
  return 'other';
}

export function costWindowPreset(from: string, to: string) {
  if (!from && !to) return 'all';
  const thisMonth = costThisMonth();
  if (from === thisMonth.from && to === thisMonth.to) return 'this';
  const lastMonth = costLastMonth();
  if (from === lastMonth.from && to === lastMonth.to) return 'last';
  return 'custom';
}

export function costQuery(basis: string, currency: string, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (basis) params.set('basis', basis);
  if (currency) params.set('currency', currency);
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function readinessLabel(value: string | undefined) {
  return (value || '').toLowerCase() === 'ready' ? 'Ready' : 'Unknown';
}

export function freshnessLabel(value: string | undefined) {
  if ((value || '').toLowerCase() === 'current') return 'Current';
  if ((value || '').toLowerCase() === 'stale') return 'Stale';
  return 'Unknown';
}

export function sampleCostK8sSnapshot() {
  return JSON.stringify({
    cluster_uid: 'cluster-nonprod-a',
    window_start: '2026-10-24T00:00:00Z',
    window_end: '2026-10-25T00:00:00Z',
    complete: true,
    collected_at: '2026-10-25T01:00:00Z',
    inventory: {
      nodes: [{ name: 'ip-10-0-1-10', provider_id: 'aws:///us-east-1a/i-0costk2node01' }],
      pods: [
        {
          uid: 'pod-uid-live',
          name: 'api-abc',
          namespace: 'payments',
          controller_kind: 'Deployment',
          controller_name: 'api',
          cpu_request: '200m',
          cpu_usage: '80m',
          memory_request: '256Mi',
          memory_usage: '128Mi',
          deleted: false,
          managed_by: 'Helm',
          hpa: 'api',
          vpa: 'api',
          pdb: 'api',
          labels: { team: 'payments' },
        },
        {
          uid: 'pod-uid-gone',
          name: 'api-abc',
          namespace: 'payments',
          controller_kind: 'Deployment',
          controller_name: 'api',
          cpu_request: '200m',
          deleted: true,
          ended_at: '2026-10-24T18:00:00Z',
        },
        {
          uid: 'pod-uid-job',
          name: 'settle-1',
          namespace: 'payments',
          controller_kind: 'Job',
          controller_name: 'settle',
          cpu_request: '100m',
          deleted: true,
          ended_at: '2026-10-24T03:00:00Z',
        },
      ],
    },
    opencost: {
      data: [
        {
          properties: { namespace: 'payments', controller: 'api', controllerKind: 'deployment', pod: 'api-abc', pod_uid: 'pod-uid-live' },
          totalCost: '4.20',
        },
        {
          properties: { namespace: 'payments', controller: 'api', controllerKind: 'deployment', pod: 'api-abc', pod_uid: 'pod-uid-gone' },
          totalCost: '1.10',
        },
        {
          properties: { namespace: '__idle__' },
          totalCost: '2.00',
        },
      ],
    },
  }, null, 2);
}

export function sampleCUR2(accountId: string) {
  return JSON.stringify({
    label: 'September 2026 CUR',
    kind: 'import',
    complete: true,
    window_start: '2026-09-01',
    window_end: '2026-09-30',
    lines: [
      {
        product_servicename: 'Amazon Elastic Compute Cloud',
        product_region: 'us-east-1',
        line_item_resource_id: 'i-0costc2api01',
        line_item_usage_start_date: '2026-09-01',
        line_item_unblended_cost: '100.10',
        line_item_net_amortized_cost: '88.40',
        line_item_currency_code: 'USD',
        line_item_usage_account_id: accountId,
        resource_tags_user_team: 'platform-team',
      },
      {
        product_servicename: 'Amazon Simple Storage Service',
        product_region: 'us-east-1',
        line_item_resource_id: 'cost-c2-logs',
        line_item_usage_start_date: '2026-09-01',
        line_item_unblended_cost: '12.50',
        line_item_net_amortized_cost: '12.50',
        line_item_currency_code: 'USD',
        line_item_usage_account_id: accountId,
      },
    ],
  }, null, 2);
}

export function importableLabel(value: string | undefined) {
  if ((value || '').toLowerCase() === 'ready') return 'Ready';
  if ((value || '').toLowerCase() === 'not_imported') return 'Not imported';
  return 'Unknown';
}

export function budgetAlertLabel(value: string | undefined) {
  if ((value || '').toLowerCase() === 'over') return 'Over';
  if ((value || '').toLowerCase() === 'warn') return 'Warning';
  if ((value || '').toLowerCase() === 'none') return 'On track';
  return 'Unknown';
}

export type CostUnknownReason = {
  code: 'not_imported' | 'incomplete' | 'stale' | 'none' | 'empty';
  title: string;
  detail: string;
};

export function costUnknownReason(input: {
  display?: string | null;
  coverage?: string;
  importStatus?: string;
  freshness?: string;
  stale?: boolean;
  lineCount?: number;
}): CostUnknownReason | null {
  if (input.display && input.display !== 'Unknown') return null;
  const imported = (input.importStatus || '').toLowerCase();
  const coverage = (input.coverage || '').toLowerCase();
  const freshness = (input.freshness || '').toLowerCase();
  if (imported === 'not_imported') {
    return {
      code: 'not_imported',
      title: 'Not imported',
      detail: 'Cost is not imported for this account. Enable Cost, then import billed lines. Spend stays Unknown until a complete revision exists.',
    };
  }
  if (coverage === 'none' || (input.lineCount === 0 && coverage !== 'complete' && coverage !== 'incomplete')) {
    return {
      code: 'none',
      title: 'No billed revision',
      detail: 'No complete billed revision exists for this window. Coverage stays Unknown, never $0.',
    };
  }
  if (coverage === 'incomplete') {
    return {
      code: 'incomplete',
      title: 'Incomplete coverage',
      detail: 'This window is incomplete. Incomplete stays Unknown, never $0. Import a complete revision to show the billed amount.',
    };
  }
  if (freshness === 'stale' || input.stale) {
    return {
      code: 'stale',
      title: 'Stale window',
      detail: 'The billed window is stale. Import a newer complete revision. Do not treat a missing refresh as $0.',
    };
  }
  return {
    code: 'empty',
    title: 'No billed lines',
    detail: 'No billed lines for this slice. Widen the filters or import billed lines. Coverage stays Unknown until a complete revision exists.',
  };
}

export type CostAccountStatus = 'billed' | 'unknown' | 'not_imported' | 'stale';

export function costAccountStatus(account: CostTreeAccount): CostAccountStatus {
  if ((account.import_status || '').toLowerCase() === 'not_imported') return 'not_imported';
  if (account.stale_hint || (account.freshness || '').toLowerCase() === 'stale') return 'stale';
  if (!account.spend || account.spend.display === 'Unknown') return 'unknown';
  return 'billed';
}

export function costAccountStatusLabel(status: CostAccountStatus) {
  if (status === 'billed') return 'Billed';
  if (status === 'not_imported') return 'Not imported';
  if (status === 'stale') return 'Stale';
  return 'Unknown';
}

function costSpendRank(money?: CostMoney | null, importStatus?: string) {
  if ((importStatus || '').toLowerCase() === 'not_imported') return { bucket: 2, amount: '' };
  if (!money || money.display === 'Unknown' || !money.amount) return { bucket: 1, amount: '' };
  return { bucket: 0, amount: money.amount };
}

function compareCostSpend(
  left: { bucket: number; amount: string },
  right: { bucket: number; amount: string },
) {
  if (left.bucket !== right.bucket) return left.bucket - right.bucket;
  return right.amount.localeCompare(left.amount, undefined, { numeric: true });
}

export function sortCostTreeBySpend(projects: CostTreeProject[]): CostTreeProject[] {
  return (projects || []).map((project) => ({
    ...project,
    clouds: (project.clouds || []).map((cloud) => ({
      ...cloud,
      accounts: [...(cloud.accounts || [])].sort((a, b) => compareCostSpend(
        costSpendRank(a.spend, a.import_status),
        costSpendRank(b.spend, b.import_status),
      )),
    })).sort((a, b) => compareCostSpend(costSpendRank(a.spend), costSpendRank(b.spend))),
  })).sort((a, b) => compareCostSpend(costSpendRank(a.spend), costSpendRank(b.spend)));
}

const COST_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatCostWindowRange(from: string, to: string) {
  if (!from || !to) return '';
  const parse = (value: string) => {
    const [year, month, day] = value.split('-').map((part) => Number(part));
    return { year, month, day, label: COST_MONTHS[(month || 1) - 1] || '' };
  };
  const start = parse(from);
  const end = parse(to);
  if (start.month === end.month && start.year === end.year) {
    return `${start.day}–${end.day} ${end.label}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${start.label} – ${end.day} ${end.label}`;
  }
  return `${start.day} ${start.label} ${start.year} – ${end.day} ${end.label} ${end.year}`;
}

export function resolvedCostWindow(from: string, to: string) {
  if (from && to) return { from, to };
  const thisMonth = costThisMonth();
  if (from) return { from, to: thisMonth.to };
  if (to) return { from: thisMonth.from, to };
  return thisMonth;
}

export function validateCostAllocation(matchType: string, matchValue: string, team: string, service: string) {
  const value = matchValue.trim();
  const teamSlug = team.trim();
  const serviceName = service.trim();
  if (!value) return 'Match value is required.';
  if (value.includes('@') || teamSlug.includes('@') || serviceName.includes('@')) return 'Allocation rule cannot include an email.';
  if (matchType === 'account' && !/^[0-9]{12}$/.test(value)) return 'Account identifier must be 12 digits.';
  if (matchType === 'product' && value.length < 3) return 'Product name is too short.';
  if (matchType === 'resource' && (value.length < 3 || /\s/.test(value))) return 'Resource identifier is not valid.';
  if (teamSlug && (teamSlug.length < 2 || /[\s/]/.test(teamSlug))) return 'Team is not valid.';
  if (serviceName && (serviceName.length < 2 || /\s/.test(serviceName))) return 'Service name is not valid.';
  return '';
}

export function budgetBarPercent(row: CostBudgetStatus): number | null {
  if (row.spent?.display === 'Unknown' || row.remaining?.display === 'Unknown') return null;
  if ((row.spent?.coverage || '') !== 'complete' || (row.remaining?.coverage || '') !== 'complete') return null;
  const spent = Number(row.spent?.amount);
  const limit = Number(row.amount);
  if (!Number.isFinite(spent) || !Number.isFinite(limit) || limit <= 0) return null;
  const pct = Math.round((spent / limit) * 100);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

export async function fetchCostCSV(apiUrl: string, path: string): Promise<string> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem(COST_TOKEN_KEY) || '';
  const res = await fetch(`${apiUrl}${path}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let message = 'Cost export could not be loaded.';
    try {
      const data = JSON.parse(text) as { error?: string };
      if (typeof data.error === 'string') message = data.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return text;
}

export function downloadCostCSV(text: string, filename = 'cost-explorer.csv') {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function fetchCostJson<T>(apiUrl: string, path: string, init?: RequestInit): Promise<T> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem(COST_TOKEN_KEY) || '';
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Cost could not be loaded.');
  }
  return data as T;
}
