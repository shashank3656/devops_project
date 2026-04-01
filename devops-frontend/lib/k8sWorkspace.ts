import { asRecord, getString } from './payload';

export const DEVOPS_TOKEN_KEY = 'devops_token';
export const DEVOPS_USER_KEY = 'devops_user';

export interface ProjectOption {
  id: number;
  name: string;
  code: string;
  clouds: string[];
  environments: string[];
}

export interface K8sConnection {
  id: number;
  project_id: number;
  project_name: string;
  project_code: string;
  cloud: string;
  cluster_name: string;
  cluster_endpoint: string;
  environment: string;
  namespace: string;
  auth_mode: string;
  has_auth_credential: boolean;
  created_at: string;
  updated_at: string;
}

export interface Summary {
  namespace_count: number;
  deployment_count: number;
  pod_count: number;
  service_count: number;
  ingress_count: number;
  warning_event_count: number;
}

export interface WorkloadHealthSummary {
  healthy_deployments: number;
  degraded_deployments: number;
  blocked_deployments: number;
  scaled_down_deployments: number;
  restarting_pods: number;
  non_running_pods: number;
  warning_logs: number;
  unhealthy_namespaces: number;
}

export interface NamespaceItem {
  name: string;
  status: string;
  environment: string;
  cluster_name: string;
  pod_count: number;
  service_count: number;
  last_activity: string;
}

export interface DeploymentItem {
  name: string;
  namespace: string;
  cluster_name: string;
  image: string;
  replicas: number;
  ready_replicas: number;
  updated_replicas: number;
  status: string;
}

export interface VolumeItem {
  name: string;
  namespace: string;
  cluster_name: string;
  type: string;
  claim: string;
  status: string;
  mounted_by: string;
}

export interface ServiceItem {
  name: string;
  namespace: string;
  cluster_name: string;
  type: string;
  cluster_ip: string;
  ports: string;
  selector: string;
  exposure: string;
}

export interface ConfigMapItem {
  name: string;
  namespace: string;
  cluster_name: string;
  data_keys: number;
  mounted_by: string;
}

export interface K8sOverviewData {
  projects: ProjectOption[];
  connections: K8sConnection[];
  selected_project_id: number;
  selected_cluster: string;
  selected_namespace: string;
  selected_environment: string;
  clusters: string[];
  namespaces: string[];
  environments: string[];
  summary: Summary;
  health_summary: WorkloadHealthSummary;
  namespace_items: NamespaceItem[];
  deployments: DeploymentItem[];
  volumes: VolumeItem[];
  services: ServiceItem[];
  configmaps: ConfigMapItem[];
}

export interface K8sOnboardingData {
  projects: ProjectOption[];
  connections: K8sConnection[];
  auth_modes: string[];
}

export interface K8sConnectionPayload {
  project_id: number;
  cloud: string;
  cluster_name: string;
  cluster_endpoint: string;
  environment: string;
  auth_mode: string;
  auth_credential: string;
}

export interface K8sClusterCatalogItem {
  key: string;
  project_id: number;
  project_name: string;
  project_code: string;
  cloud: string;
  cluster_name: string;
  cluster_endpoint: string;
  environment: string;
  auth_mode: string;
  has_auth_credential: boolean;
  namespace_count: number;
  workload_count: number;
  service_count: number;
  configmap_count: number;
  storage_count: number;
  updated_at: string;
}

export interface K8sWorkspaceFilters {
  project_id?: string;
  cluster_name?: string;
  namespace?: string;
  environment?: string;
}

export function clearDevOpsSessionAndRedirect() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export function readQueryString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

export function buildK8sHref(
  path: string,
  query: Record<string, string | number | undefined | null>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    params.set(key, normalized);
  }
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export function authModeRequiresCredential(mode: string): boolean {
  return mode !== 'in_cluster';
}

export function authModeCredentialLabel(mode: string): string {
  switch (mode) {
    case 'kubeconfig':
      return 'Kubeconfig content';
    case 'service_account':
      return 'Service account token';
    case 'token':
      return 'Bearer token';
    case 'oidc':
      return 'OIDC token';
    default:
      return 'Auth credential';
  }
}

export function authModeCredentialPlaceholder(mode: string): string {
  switch (mode) {
    case 'kubeconfig':
      return 'Paste kubeconfig content here';
    case 'service_account':
      return 'Paste service account token';
    case 'token':
      return 'Paste cluster access token';
    case 'oidc':
      return 'Paste OIDC token';
    default:
      return 'Paste authentication credential';
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeProjects(value: unknown): ProjectOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((project) => {
    const item = asRecord(project);
    return {
      id: Number(item.id) || 0,
      name: getString(item.name) || 'Unknown',
      code: getString(item.code) || 'n/a',
      clouds: normalizeStringArray(item.clouds),
      environments: normalizeStringArray(item.environments),
    };
  });
}

function normalizeConnections(value: unknown): K8sConnection[] {
  if (!Array.isArray(value)) return [];
  return value.map((connection) => {
    const item = asRecord(connection);
    return {
      id: Number(item.id) || 0,
      project_id: Number(item.project_id) || 0,
      project_name: getString(item.project_name) || 'Unknown',
      project_code: getString(item.project_code) || 'n/a',
      cloud: getString(item.cloud),
      cluster_name: getString(item.cluster_name),
      cluster_endpoint: getString(item.cluster_endpoint),
      environment: getString(item.environment),
      namespace: getString(item.namespace),
      auth_mode: getString(item.auth_mode),
      has_auth_credential: Boolean(item.has_auth_credential),
      created_at: getString(item.created_at),
      updated_at: getString(item.updated_at),
    };
  });
}

function normalizeNamespaceItems(value: unknown): NamespaceItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      name: getString(row.name),
      status: getString(row.status),
      environment: getString(row.environment),
      cluster_name: getString(row.cluster_name),
      pod_count: Number(row.pod_count) || 0,
      service_count: Number(row.service_count) || 0,
      last_activity: getString(row.last_activity),
    };
  }).filter((item) => item.name);
}

function normalizeDeploymentItems(value: unknown): DeploymentItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      name: getString(row.name),
      namespace: getString(row.namespace),
      cluster_name: getString(row.cluster_name),
      image: getString(row.image),
      replicas: Number(row.replicas) || 0,
      ready_replicas: Number(row.ready_replicas) || 0,
      updated_replicas: Number(row.updated_replicas) || 0,
      status: getString(row.status),
    };
  }).filter((item) => item.name);
}

function normalizeVolumeItems(value: unknown): VolumeItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      name: getString(row.name),
      namespace: getString(row.namespace),
      cluster_name: getString(row.cluster_name),
      type: getString(row.type),
      claim: getString(row.claim),
      status: getString(row.status),
      mounted_by: getString(row.mounted_by),
    };
  }).filter((item) => item.name);
}

function normalizeServiceItems(value: unknown): ServiceItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      name: getString(row.name),
      namespace: getString(row.namespace),
      cluster_name: getString(row.cluster_name),
      type: getString(row.type),
      cluster_ip: getString(row.cluster_ip),
      ports: getString(row.ports),
      selector: getString(row.selector),
      exposure: getString(row.exposure),
    };
  }).filter((item) => item.name);
}

function normalizeConfigMapItems(value: unknown): ConfigMapItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      name: getString(row.name),
      namespace: getString(row.namespace),
      cluster_name: getString(row.cluster_name),
      data_keys: Number(row.data_keys) || 0,
      mounted_by: getString(row.mounted_by),
    };
  }).filter((item) => item.name);
}

function normalizeOverviewData(value: unknown): K8sOverviewData {
  const data = asRecord(value);
  const summary = asRecord(data.summary);
  const healthSummary = asRecord(data.health_summary);
  return {
    projects: normalizeProjects(data.projects),
    connections: normalizeConnections(data.connections),
    selected_project_id: Number(data.selected_project_id) || 0,
    selected_cluster: getString(data.selected_cluster),
    selected_namespace: getString(data.selected_namespace),
    selected_environment: getString(data.selected_environment),
    clusters: normalizeStringArray(data.clusters),
    namespaces: normalizeStringArray(data.namespaces),
    environments: normalizeStringArray(data.environments),
    summary: {
      namespace_count: Number(summary.namespace_count) || 0,
      deployment_count: Number(summary.deployment_count) || 0,
      pod_count: Number(summary.pod_count) || 0,
      service_count: Number(summary.service_count) || 0,
      ingress_count: Number(summary.ingress_count) || 0,
      warning_event_count: Number(summary.warning_event_count) || 0,
    },
    health_summary: {
      healthy_deployments: Number(healthSummary.healthy_deployments) || 0,
      degraded_deployments: Number(healthSummary.degraded_deployments) || 0,
      blocked_deployments: Number(healthSummary.blocked_deployments) || 0,
      scaled_down_deployments: Number(healthSummary.scaled_down_deployments) || 0,
      restarting_pods: Number(healthSummary.restarting_pods) || 0,
      non_running_pods: Number(healthSummary.non_running_pods) || 0,
      warning_logs: Number(healthSummary.warning_logs) || 0,
      unhealthy_namespaces: Number(healthSummary.unhealthy_namespaces) || 0,
    },
    namespace_items: normalizeNamespaceItems(data.namespace_items),
    deployments: normalizeDeploymentItems(data.deployments),
    volumes: normalizeVolumeItems(data.volumes),
    services: normalizeServiceItems(data.services),
    configmaps: normalizeConfigMapItems(data.configmaps),
  };
}

function normalizeOnboardingData(value: unknown): K8sOnboardingData {
  const data = asRecord(value);
  return {
    projects: normalizeProjects(data.projects),
    connections: normalizeConnections(data.connections),
    auth_modes: normalizeStringArray(data.auth_modes),
  };
}

async function fetchAuthorizedJson(apiUrl: string, path: string, init?: RequestInit) {
  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
  if (!token) {
    clearDevOpsSessionAndRedirect();
    throw new Error('DevOps session expired');
  }
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (response.status === 401 || response.status === 403) {
    clearDevOpsSessionAndRedirect();
    throw new Error('DevOps session expired');
  }
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new Error(getString(payload.error, 'Failed to load Kubernetes workspace'));
  }
  return payload;
}

export async function fetchK8sOverview(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sOverviewData> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-overview?${params.toString()}`);
  return normalizeOverviewData(payload.data);
}

export async function fetchK8sConnections(apiUrl: string): Promise<K8sOnboardingData> {
  const payload = await fetchAuthorizedJson(apiUrl, '/api/devops/k8s-connections');
  return normalizeOnboardingData(payload.data);
}

export async function saveK8sConnection(apiUrl: string, body: K8sConnectionPayload): Promise<string> {
  const payload = await fetchAuthorizedJson(apiUrl, '/api/devops/k8s-connections', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return getString(payload.message, 'K8s cluster saved');
}

export function buildClusterCatalog(overview: K8sOverviewData): K8sClusterCatalogItem[] {
  const rows = new Map<string, K8sClusterCatalogItem>();

  for (const connection of overview.connections) {
    const key = `${connection.project_id}:${connection.cloud}:${connection.cluster_name}:${connection.environment}`;
    const existing = rows.get(key);
    if (existing) {
      if (connection.updated_at && connection.updated_at > existing.updated_at) {
        existing.updated_at = connection.updated_at;
      }
      existing.has_auth_credential = existing.has_auth_credential || connection.has_auth_credential;
      continue;
    }

    rows.set(key, {
      key,
      project_id: connection.project_id,
      project_name: connection.project_name,
      project_code: connection.project_code,
      cloud: connection.cloud,
      cluster_name: connection.cluster_name,
      cluster_endpoint: connection.cluster_endpoint,
      environment: connection.environment,
      auth_mode: connection.auth_mode,
      has_auth_credential: connection.has_auth_credential,
      namespace_count: 0,
      workload_count: 0,
      service_count: 0,
      configmap_count: 0,
      storage_count: 0,
      updated_at: connection.updated_at,
    });
  }

  const matchRows = (clusterName: string, environment?: string) =>
    Array.from(rows.values()).filter(
      (row) => row.cluster_name === clusterName && (!environment || !row.environment || row.environment === environment)
    );

  for (const item of overview.namespace_items) {
    for (const row of matchRows(item.cluster_name, item.environment)) {
      row.namespace_count += 1;
    }
  }

  for (const item of overview.deployments) {
    for (const row of matchRows(item.cluster_name)) {
      row.workload_count += 1;
    }
  }

  for (const item of overview.services) {
    for (const row of matchRows(item.cluster_name)) {
      row.service_count += 1;
    }
  }

  for (const item of overview.configmaps) {
    for (const row of matchRows(item.cluster_name)) {
      row.configmap_count += 1;
    }
  }

  for (const item of overview.volumes) {
    for (const row of matchRows(item.cluster_name)) {
      row.storage_count += 1;
    }
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (a.project_name !== b.project_name) return a.project_name.localeCompare(b.project_name);
    if (a.cluster_name !== b.cluster_name) return a.cluster_name.localeCompare(b.cluster_name);
    return a.environment.localeCompare(b.environment);
  });
}
