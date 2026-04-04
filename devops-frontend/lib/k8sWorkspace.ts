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
  cpu_utilization_pct: number;
  cpu_hours: number;
  memory_utilization_gb: number;
  memory_hours: number;
}

export interface VolumeItem {
  name: string;
  namespace: string;
  cluster_name: string;
  type: string;
  claim: string;
  status: string;
  mounted_by: string;
  storage_class: string;
  capacity: string;
  access_mode: string;
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
  external_ip: string;
  ingress_host: string;
}

export interface IngressItem {
  name: string;
  namespace: string;
  cluster_name: string;
  host: string;
  paths: string;
  exposure: string;
  status: string;
  tls_secret: string;
  certificate_status: string;
}

export interface ConfigMapItem {
  name: string;
  namespace: string;
  cluster_name: string;
  data_keys: number;
  mounted_by: string;
  resource_version: string;
  age: string;
}

export interface SecretItem {
  name: string;
  namespace: string;
  cluster_name: string;
  type: string;
  managed_by: string;
  age: string;
  key_count: number;
  bound_to: string;
  expires_at: string;
  certificate_status: string;
}

export interface PodItem {
  name: string;
  namespace: string;
  cluster_name: string;
  status: string;
  restarts: number;
  node: string;
  age: string;
  deployment: string;
}

export interface LogItem {
  name: string;
  namespace: string;
  cluster_name: string;
  container: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface EventItem {
  id: string;
  namespace: string;
  cluster_name: string;
  severity: string;
  reason: string;
  message: string;
  resource_kind: string;
  resource_name: string;
  timestamp: string;
  occurrence_count: number;
}

export interface ReplicaSetItem {
  name: string;
  namespace: string;
  cluster_name: string;
  desired_replicas: number;
  ready_replicas: number;
  age: string;
  deployment: string;
}

export interface CertificateItem {
  name: string;
  namespace: string;
  cluster_name: string;
  secret_name: string;
  hosts: string;
  issuer: string;
  status: string;
  expires_at: string;
  days_remaining: number;
  managed_by: string;
}

export interface NamespaceHealth {
  namespace: string;
  cluster_name: string;
  status: string;
  issue_count: number;
  restarting_pods: number;
  warning_logs: number;
  affected_deployments: number;
}

export interface WorkloadSpotlight {
  name: string;
  namespace: string;
  cluster_name: string;
  status: string;
  ready_replicas: number;
  replicas: number;
  restart_count: number;
  warning_count: number;
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

export interface K8sResourceMeta {
  projects: ProjectOption[];
  selected_project_id: number;
  selected_cluster: string;
  selected_namespace: string;
  selected_environment: string;
  clusters: string[];
  namespaces: string[];
  environments: string[];
  connections?: K8sConnection[];
}

export interface K8sClusterListItem {
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
  node_pool: string;
  node_count: number;
  kubernetes_version: string;
  location: string;
  health_status: string;
  updated_at: string;
}

export interface K8sClustersData extends K8sResourceMeta {
  items: K8sClusterListItem[];
}

export interface K8sWorkloadsData extends K8sResourceMeta {
  health_summary: WorkloadHealthSummary;
  items: DeploymentItem[];
}

export interface K8sServicesData extends K8sResourceMeta {
  items: ServiceItem[];
}

export interface K8sIngressesData extends K8sResourceMeta {
  items: IngressItem[];
}

export interface K8sConfigMapsData extends K8sResourceMeta {
  items: ConfigMapItem[];
}

export interface K8sSecretsData extends K8sResourceMeta {
  items: SecretItem[];
}

export interface K8sStorageData extends K8sResourceMeta {
  items: VolumeItem[];
}

export interface K8sPodsData extends K8sResourceMeta {
  items: PodItem[];
}

export interface K8sLogsData extends K8sResourceMeta {
  items: LogItem[];
}

export interface K8sLogStreamData extends K8sResourceMeta {
  items: LogItem[];
  next_cursor: string;
  stream_status: string;
  live_interval_seconds: number;
  appended_count: number;
}

export interface K8sEventsData extends K8sResourceMeta {
  items: EventItem[];
}

export interface K8sCertificatesData extends K8sResourceMeta {
  items: CertificateItem[];
}

export interface K8sClusterDetailData extends K8sResourceMeta {
  cluster: K8sClusterListItem | null;
  summary: Summary;
  health_summary: WorkloadHealthSummary;
  namespace_items: NamespaceItem[];
  namespace_health: NamespaceHealth[];
  workload_spotlights: WorkloadSpotlight[];
  recent_logs: LogItem[];
  events: EventItem[];
}

export interface K8sPodDetailData extends K8sResourceMeta {
  pod: PodItem | null;
  deployment: DeploymentItem | null;
  sibling_pods: PodItem[];
  services: ServiceItem[];
  recent_logs: LogItem[];
  recent_events: EventItem[];
}

export interface RolloutStep {
  title: string;
  detail: string;
  status: string;
  timestamp: string;
}

export interface IngressRouteItem {
  host: string;
  path: string;
  service_name: string;
  service_type: string;
  target_address: string;
  exposure: string;
  tls_secret: string;
  certificate_status: string;
}

export interface K8sRolloutDetailData extends K8sResourceMeta {
  cluster: K8sClusterListItem | null;
  workload: DeploymentItem | null;
  replicasets: ReplicaSetItem[];
  pods: PodItem[];
  services: ServiceItem[];
  recent_logs: LogItem[];
  recent_events: EventItem[];
  timeline: RolloutStep[];
}

export interface K8sOperatorActivityItem {
  id: string;
  action: string;
  actor_name: string;
  resource_type: string;
  resource_name: string;
  cluster_name: string;
  namespace: string;
  environment: string;
  project_id: number;
  summary: string;
  detail: string;
  timestamp: string;
}

export interface K8sActivityData extends K8sResourceMeta {
  items: K8sOperatorActivityItem[];
}

export interface K8sPodExecProfileData extends K8sResourceMeta {
  cluster: K8sClusterListItem | null;
  pod: PodItem | null;
  available_containers: string[];
  allowed_shells: string[];
  default_shell: string;
  command_preview: string;
  access_model: string;
  audit_hint: string;
  recent_logs: LogItem[];
  recent_events: EventItem[];
}

export interface K8sTerminalLaunchData extends K8sResourceMeta {
  session_id: string;
  status: string;
  cluster: K8sClusterListItem | null;
  pod: PodItem | null;
  container: string;
  shell: string;
  command_preview: string;
  reason: string;
  created_at: string;
  expires_at: string;
  last_activity_at: string;
  access_model: string;
  audit_hint: string;
  initial_output: string[];
}

export interface K8sTerminalSessionData extends K8sResourceMeta {
  session_id: string;
  status: string;
  cluster: K8sClusterListItem | null;
  pod: PodItem | null;
  container: string;
  shell: string;
  command_preview: string;
  reason: string;
  created_at: string;
  expires_at: string;
  last_activity_at: string;
  transcript: string[];
}

export interface K8sLogAttachEventData {
  type: string;
  timestamp: string;
  message: string;
  data: K8sLogStreamData | null;
}

export interface K8sTerminalAttachEventData {
  type: string;
  timestamp: string;
  message: string;
  data: K8sTerminalSessionData | null;
}

export interface K8sIngressDetailData extends K8sResourceMeta {
  cluster: K8sClusterListItem | null;
  ingress: IngressItem | null;
  routes: IngressRouteItem[];
  services: ServiceItem[];
  secret: SecretItem | null;
  certificates: CertificateItem[];
  recent_events: EventItem[];
}

export interface K8sWorkspaceFilters {
  project_id?: string;
  cluster_name?: string;
  namespace?: string;
  environment?: string;
}

export interface K8sWorkloadActionPayload {
  project_id: number;
  cluster_name: string;
  namespace: string;
  environment?: string;
  workload_name: string;
  action: 'restart' | 'scale' | 'resume';
  replicas?: number;
  reason?: string;
}

export interface K8sLogStreamFilters extends K8sWorkspaceFilters {
  cursor?: string;
  workload_name?: string;
  pod_name?: string;
  container?: string;
  level?: string;
}

export interface K8sTerminalLaunchPayload {
  project_id: number;
  cluster_name: string;
  namespace: string;
  environment?: string;
  pod_name: string;
  container?: string;
  shell?: string;
  reason?: string;
}

export interface K8sTerminalCommandPayload {
  session_id: string;
  command: string;
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
      cpu_utilization_pct: Number(row.cpu_utilization_pct) || 0,
      cpu_hours: Number(row.cpu_hours) || 0,
      memory_utilization_gb: Number(row.memory_utilization_gb) || 0,
      memory_hours: Number(row.memory_hours) || 0,
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
      storage_class: getString(row.storage_class),
      capacity: getString(row.capacity),
      access_mode: getString(row.access_mode),
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
      external_ip: getString(row.external_ip),
      ingress_host: getString(row.ingress_host),
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
      resource_version: getString(row.resource_version),
      age: getString(row.age),
    };
  }).filter((item) => item.name);
}

function normalizeIngressItems(value: unknown): IngressItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        name: getString(row.name),
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        host: getString(row.host),
        paths: getString(row.paths),
        exposure: getString(row.exposure),
        status: getString(row.status),
        tls_secret: getString(row.tls_secret),
        certificate_status: getString(row.certificate_status),
      };
    })
    .filter((item) => item.name);
}

function normalizeSecretItems(value: unknown): SecretItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        name: getString(row.name),
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        type: getString(row.type),
        managed_by: getString(row.managed_by),
        age: getString(row.age),
        key_count: Number(row.key_count) || 0,
        bound_to: getString(row.bound_to),
        expires_at: getString(row.expires_at),
        certificate_status: getString(row.certificate_status),
      };
    })
    .filter((item) => item.name);
}

function normalizePodItems(value: unknown): PodItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        name: getString(row.name),
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        status: getString(row.status),
        restarts: Number(row.restarts) || 0,
        node: getString(row.node),
        age: getString(row.age),
        deployment: getString(row.deployment),
      };
    })
    .filter((item) => item.name);
}

function normalizeLogItems(value: unknown): LogItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        name: getString(row.name),
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        container: getString(row.container),
        level: getString(row.level),
        message: getString(row.message),
        timestamp: getString(row.timestamp),
      };
    })
    .filter((item) => item.name);
}

function normalizeEventItems(value: unknown): EventItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        id: getString(row.id),
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        severity: getString(row.severity),
        reason: getString(row.reason),
        message: getString(row.message),
        resource_kind: getString(row.resource_kind),
        resource_name: getString(row.resource_name),
        timestamp: getString(row.timestamp),
        occurrence_count: Number(row.occurrence_count) || 0,
      };
    })
    .filter((item) => item.id || item.message);
}

function normalizeReplicaSetItems(value: unknown): ReplicaSetItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        name: getString(row.name),
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        desired_replicas: Number(row.desired_replicas) || 0,
        ready_replicas: Number(row.ready_replicas) || 0,
        age: getString(row.age),
        deployment: getString(row.deployment),
      };
    })
    .filter((item) => item.name);
}

function normalizeCertificateItems(value: unknown): CertificateItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        name: getString(row.name),
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        secret_name: getString(row.secret_name),
        hosts: getString(row.hosts),
        issuer: getString(row.issuer),
        status: getString(row.status),
        expires_at: getString(row.expires_at),
        days_remaining: Number(row.days_remaining) || 0,
        managed_by: getString(row.managed_by),
      };
    })
    .filter((item) => item.name);
}

function normalizeRolloutSteps(value: unknown): RolloutStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        title: getString(row.title),
        detail: getString(row.detail),
        status: getString(row.status),
        timestamp: getString(row.timestamp),
      };
    })
    .filter((item) => item.title || item.detail);
}

function normalizeIngressRouteItems(value: unknown): IngressRouteItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        host: getString(row.host),
        path: getString(row.path),
        service_name: getString(row.service_name),
        service_type: getString(row.service_type),
        target_address: getString(row.target_address),
        exposure: getString(row.exposure),
        tls_secret: getString(row.tls_secret),
        certificate_status: getString(row.certificate_status),
      };
    })
    .filter((item) => item.path || item.service_name || item.host);
}

function normalizeNamespaceHealth(value: unknown): NamespaceHealth[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        status: getString(row.status),
        issue_count: Number(row.issue_count) || 0,
        restarting_pods: Number(row.restarting_pods) || 0,
        warning_logs: Number(row.warning_logs) || 0,
        affected_deployments: Number(row.affected_deployments) || 0,
      };
    })
    .filter((item) => item.namespace);
}

function normalizeWorkloadSpotlights(value: unknown): WorkloadSpotlight[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        name: getString(row.name),
        namespace: getString(row.namespace),
        cluster_name: getString(row.cluster_name),
        status: getString(row.status),
        ready_replicas: Number(row.ready_replicas) || 0,
        replicas: Number(row.replicas) || 0,
        restart_count: Number(row.restart_count) || 0,
        warning_count: Number(row.warning_count) || 0,
      };
    })
    .filter((item) => item.name);
}

function normalizeSummary(value: unknown): Summary {
  const summary = asRecord(value);
  return {
    namespace_count: Number(summary.namespace_count) || 0,
    deployment_count: Number(summary.deployment_count) || 0,
    pod_count: Number(summary.pod_count) || 0,
    service_count: Number(summary.service_count) || 0,
    ingress_count: Number(summary.ingress_count) || 0,
    warning_event_count: Number(summary.warning_event_count) || 0,
  };
}

function normalizeHealthSummary(value: unknown): WorkloadHealthSummary {
  const healthSummary = asRecord(value);
  return {
    healthy_deployments: Number(healthSummary.healthy_deployments) || 0,
    degraded_deployments: Number(healthSummary.degraded_deployments) || 0,
    blocked_deployments: Number(healthSummary.blocked_deployments) || 0,
    scaled_down_deployments: Number(healthSummary.scaled_down_deployments) || 0,
    restarting_pods: Number(healthSummary.restarting_pods) || 0,
    non_running_pods: Number(healthSummary.non_running_pods) || 0,
    warning_logs: Number(healthSummary.warning_logs) || 0,
    unhealthy_namespaces: Number(healthSummary.unhealthy_namespaces) || 0,
  };
}

function normalizeResourceMeta(value: unknown): K8sResourceMeta {
  const data = asRecord(value);
  return {
    projects: normalizeProjects(data.projects),
    selected_project_id: Number(data.selected_project_id) || 0,
    selected_cluster: getString(data.selected_cluster),
    selected_namespace: getString(data.selected_namespace),
    selected_environment: getString(data.selected_environment),
    clusters: normalizeStringArray(data.clusters),
    namespaces: normalizeStringArray(data.namespaces),
    environments: normalizeStringArray(data.environments),
    connections: normalizeConnections(data.connections),
  };
}

function normalizeClusterItems(value: unknown): K8sClusterListItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      return {
        project_id: Number(row.project_id) || 0,
        project_name: getString(row.project_name) || 'Unknown',
        project_code: getString(row.project_code) || 'n/a',
        cloud: getString(row.cloud),
        cluster_name: getString(row.cluster_name),
        cluster_endpoint: getString(row.cluster_endpoint),
        environment: getString(row.environment),
        auth_mode: getString(row.auth_mode),
        has_auth_credential: Boolean(row.has_auth_credential),
        namespace_count: Number(row.namespace_count) || 0,
        workload_count: Number(row.workload_count) || 0,
        service_count: Number(row.service_count) || 0,
        configmap_count: Number(row.configmap_count) || 0,
        storage_count: Number(row.storage_count) || 0,
        node_pool: getString(row.node_pool),
        node_count: Number(row.node_count) || 0,
        kubernetes_version: getString(row.kubernetes_version),
        location: getString(row.location),
        health_status: getString(row.health_status),
        updated_at: getString(row.updated_at),
      };
    })
    .filter((item) => item.cluster_name);
}

function normalizeOverviewData(value: unknown): K8sOverviewData {
  const data = asRecord(value);
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
    summary: normalizeSummary(data.summary),
    health_summary: normalizeHealthSummary(data.health_summary),
    namespace_items: normalizeNamespaceItems(data.namespace_items),
    deployments: normalizeDeploymentItems(data.deployments),
    volumes: normalizeVolumeItems(data.volumes),
    services: normalizeServiceItems(data.services),
    configmaps: normalizeConfigMapItems(data.configmaps),
  };
}

function normalizeClustersData(value: unknown): K8sClustersData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeClusterItems(data.items),
  };
}

function normalizeWorkloadsData(value: unknown): K8sWorkloadsData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    health_summary: normalizeHealthSummary(data.health_summary),
    items: normalizeDeploymentItems(data.items),
  };
}

function normalizeServicesData(value: unknown): K8sServicesData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeServiceItems(data.items),
  };
}

function normalizeIngressesData(value: unknown): K8sIngressesData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeIngressItems(data.items),
  };
}

function normalizeConfigMapsData(value: unknown): K8sConfigMapsData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeConfigMapItems(data.items),
  };
}

function normalizeSecretsData(value: unknown): K8sSecretsData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeSecretItems(data.items),
  };
}

function normalizeStorageData(value: unknown): K8sStorageData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeVolumeItems(data.items),
  };
}

function normalizePodsData(value: unknown): K8sPodsData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizePodItems(data.items),
  };
}

function normalizeLogsData(value: unknown): K8sLogsData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeLogItems(data.items),
  };
}

function normalizeLogStreamData(value: unknown): K8sLogStreamData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  const liveIntervalSeconds = Number(data.live_interval_seconds);
  return {
    ...meta,
    items: normalizeLogItems(data.items),
    next_cursor: getString(data.next_cursor),
    stream_status: getString(data.stream_status) || 'idle',
    live_interval_seconds: Number.isFinite(liveIntervalSeconds) && liveIntervalSeconds > 0 ? liveIntervalSeconds : 5,
    appended_count: Number(data.appended_count) || 0,
  };
}

function normalizeEventsData(value: unknown): K8sEventsData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeEventItems(data.items),
  };
}

function normalizeCertificatesData(value: unknown): K8sCertificatesData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeCertificateItems(data.items),
  };
}

function normalizeClusterDetailData(value: unknown): K8sClusterDetailData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  const clusterItems = normalizeClusterItems(data.cluster ? [data.cluster] : []);
  return {
    ...meta,
    cluster: clusterItems[0] || null,
    summary: normalizeSummary(data.summary),
    health_summary: normalizeHealthSummary(data.health_summary),
    namespace_items: normalizeNamespaceItems(data.namespace_items),
    namespace_health: normalizeNamespaceHealth(data.namespace_health),
    workload_spotlights: normalizeWorkloadSpotlights(data.workload_spotlights),
    recent_logs: normalizeLogItems(data.recent_logs),
    events: normalizeEventItems(data.events),
  };
}

function normalizePodDetailData(value: unknown): K8sPodDetailData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  const podItems = normalizePodItems(data.pod ? [data.pod] : []);
  const deploymentItems = normalizeDeploymentItems(data.deployment ? [data.deployment] : []);
  return {
    ...meta,
    pod: podItems[0] || null,
    deployment: deploymentItems[0] || null,
    sibling_pods: normalizePodItems(data.sibling_pods),
    services: normalizeServiceItems(data.services),
    recent_logs: normalizeLogItems(data.recent_logs),
    recent_events: normalizeEventItems(data.recent_events),
  };
}

function normalizeRolloutDetailData(value: unknown): K8sRolloutDetailData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  const clusterItems = normalizeClusterItems(data.cluster ? [data.cluster] : []);
  const workloadItems = normalizeDeploymentItems(data.workload ? [data.workload] : []);
  return {
    ...meta,
    cluster: clusterItems[0] || null,
    workload: workloadItems[0] || null,
    replicasets: normalizeReplicaSetItems(data.replicasets),
    pods: normalizePodItems(data.pods),
    services: normalizeServiceItems(data.services),
    recent_logs: normalizeLogItems(data.recent_logs),
    recent_events: normalizeEventItems(data.recent_events),
    timeline: normalizeRolloutSteps(data.timeline),
  };
}

function normalizeOperatorActivityItems(value: unknown): K8sOperatorActivityItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const data = asRecord(entry);
    const projectIdValue = data.project_id;
    const projectId =
      typeof projectIdValue === 'number'
        ? projectIdValue
        : Number.parseInt(getString(projectIdValue) || '0', 10) || 0;
    return {
      id: getString(data.id),
      action: getString(data.action),
      actor_name: getString(data.actor_name),
      resource_type: getString(data.resource_type),
      resource_name: getString(data.resource_name),
      cluster_name: getString(data.cluster_name),
      namespace: getString(data.namespace),
      environment: getString(data.environment),
      project_id: projectId,
      summary: getString(data.summary),
      detail: getString(data.detail),
      timestamp: getString(data.timestamp),
    };
  });
}

function normalizeActivityData(value: unknown): K8sActivityData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  return {
    ...meta,
    items: normalizeOperatorActivityItems(data.items),
  };
}

function normalizePodExecProfileData(value: unknown): K8sPodExecProfileData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  const clusterItems = normalizeClusterItems(data.cluster ? [data.cluster] : []);
  const podItems = normalizePodItems(data.pod ? [data.pod] : []);
  return {
    ...meta,
    cluster: clusterItems[0] || null,
    pod: podItems[0] || null,
    available_containers: normalizeStringArray(data.available_containers),
    allowed_shells: normalizeStringArray(data.allowed_shells),
    default_shell: getString(data.default_shell),
    command_preview: getString(data.command_preview),
    access_model: getString(data.access_model),
    audit_hint: getString(data.audit_hint),
    recent_logs: normalizeLogItems(data.recent_logs),
    recent_events: normalizeEventItems(data.recent_events),
  };
}

function normalizeTerminalLaunchData(value: unknown): K8sTerminalLaunchData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  const clusterItems = normalizeClusterItems(data.cluster ? [data.cluster] : []);
  const podItems = normalizePodItems(data.pod ? [data.pod] : []);
  return {
    ...meta,
    session_id: getString(data.session_id),
    status: getString(data.status) || 'pending',
    cluster: clusterItems[0] || null,
    pod: podItems[0] || null,
    container: getString(data.container),
    shell: getString(data.shell),
    command_preview: getString(data.command_preview),
    reason: getString(data.reason),
    created_at: getString(data.created_at),
    expires_at: getString(data.expires_at),
    last_activity_at: getString(data.last_activity_at),
    access_model: getString(data.access_model),
    audit_hint: getString(data.audit_hint),
    initial_output: normalizeStringArray(data.initial_output),
  };
}

function normalizeTerminalSessionData(value: unknown): K8sTerminalSessionData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  const clusterItems = normalizeClusterItems(data.cluster ? [data.cluster] : []);
  const podItems = normalizePodItems(data.pod ? [data.pod] : []);
  return {
    ...meta,
    session_id: getString(data.session_id),
    status: getString(data.status) || 'attached',
    cluster: clusterItems[0] || null,
    pod: podItems[0] || null,
    container: getString(data.container),
    shell: getString(data.shell),
    command_preview: getString(data.command_preview),
    reason: getString(data.reason),
    created_at: getString(data.created_at),
    expires_at: getString(data.expires_at),
    last_activity_at: getString(data.last_activity_at),
    transcript: normalizeStringArray(data.transcript),
  };
}

function normalizeLogAttachEventData(value: unknown): K8sLogAttachEventData {
  const data = asRecord(value);
  return {
    type: getString(data.type) || 'snapshot',
    timestamp: getString(data.timestamp),
    message: getString(data.message),
    data: data.data ? normalizeLogStreamData(data.data) : null,
  };
}

function normalizeTerminalAttachEventData(value: unknown): K8sTerminalAttachEventData {
  const data = asRecord(value);
  return {
    type: getString(data.type) || 'snapshot',
    timestamp: getString(data.timestamp),
    message: getString(data.message),
    data: data.data ? normalizeTerminalSessionData(data.data) : null,
  };
}

function normalizeIngressDetailData(value: unknown): K8sIngressDetailData {
  const meta = normalizeResourceMeta(value);
  const data = asRecord(value);
  const clusterItems = normalizeClusterItems(data.cluster ? [data.cluster] : []);
  const ingressItems = normalizeIngressItems(data.ingress ? [data.ingress] : []);
  const secretItems = normalizeSecretItems(data.secret ? [data.secret] : []);
  return {
    ...meta,
    cluster: clusterItems[0] || null,
    ingress: ingressItems[0] || null,
    routes: normalizeIngressRouteItems(data.routes),
    services: normalizeServiceItems(data.services),
    secret: secretItems[0] || null,
    certificates: normalizeCertificateItems(data.certificates),
    recent_events: normalizeEventItems(data.recent_events),
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

async function streamAuthorizedNdjson(
  apiUrl: string,
  path: string,
  onEvent: (value: unknown) => void,
  signal?: AbortSignal,
) {
  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
  if (!token) {
    clearDevOpsSessionAndRedirect();
    throw new Error('DevOps session expired');
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/x-ndjson',
    },
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    clearDevOpsSessionAndRedirect();
    throw new Error('DevOps session expired');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text || 'Failed to attach Kubernetes stream';
    try {
      const payload = asRecord(JSON.parse(text));
      message = getString(payload.error, message);
    } catch {
      // Keep the plain-text fallback when the stream endpoint returns a non-JSON error.
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error('Streaming transport is not available');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    for (;;) {
      const separator = buffer.indexOf('\n');
      if (separator < 0) break;
      const line = buffer.slice(0, separator).trim();
      buffer = buffer.slice(separator + 1);
      if (!line) continue;
      onEvent(JSON.parse(line));
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    onEvent(JSON.parse(trailing));
  }
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

function buildK8sFilterParams(filters: K8sWorkspaceFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  return params.toString();
}

export async function fetchK8sClusters(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sClustersData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-clusters${query ? `?${query}` : ''}`);
  return normalizeClustersData(payload.data);
}

export async function fetchK8sWorkloads(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sWorkloadsData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-workloads${query ? `?${query}` : ''}`);
  return normalizeWorkloadsData(payload.data);
}

export async function fetchK8sServices(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sServicesData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-services${query ? `?${query}` : ''}`);
  return normalizeServicesData(payload.data);
}

export async function fetchK8sIngresses(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sIngressesData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-ingresses${query ? `?${query}` : ''}`);
  return normalizeIngressesData(payload.data);
}

export async function fetchK8sConfigMaps(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sConfigMapsData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-configmaps${query ? `?${query}` : ''}`);
  return normalizeConfigMapsData(payload.data);
}

export async function fetchK8sSecrets(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sSecretsData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-secrets${query ? `?${query}` : ''}`);
  return normalizeSecretsData(payload.data);
}

export async function fetchK8sStorage(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sStorageData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-storage${query ? `?${query}` : ''}`);
  return normalizeStorageData(payload.data);
}

export async function fetchK8sPods(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sPodsData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-pods${query ? `?${query}` : ''}`);
  return normalizePodsData(payload.data);
}

export async function fetchK8sLogs(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sLogsData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-logs${query ? `?${query}` : ''}`);
  return normalizeLogsData(payload.data);
}

export async function fetchK8sLogStream(apiUrl: string, filters: K8sLogStreamFilters = {}): Promise<K8sLogStreamData> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.workload_name) params.set('workload_name', filters.workload_name);
  if (filters.pod_name) params.set('pod_name', filters.pod_name);
  if (filters.container) params.set('container', filters.container);
  if (filters.level) params.set('level', filters.level);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-log-stream?${params.toString()}`);
  return normalizeLogStreamData(payload.data);
}

export async function streamK8sLogAttach(
  apiUrl: string,
  filters: K8sLogStreamFilters,
  onEvent: (event: K8sLogAttachEventData) => void,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  if (filters.workload_name) params.set('workload_name', filters.workload_name);
  if (filters.pod_name) params.set('pod_name', filters.pod_name);
  if (filters.container) params.set('container', filters.container);
  if (filters.level) params.set('level', filters.level);
  await streamAuthorizedNdjson(apiUrl, `/api/devops/k8s-log-attach?${params.toString()}`, (value) => {
    onEvent(normalizeLogAttachEventData(value));
  }, signal);
}

export async function fetchK8sEvents(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sEventsData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-events${query ? `?${query}` : ''}`);
  return normalizeEventsData(payload.data);
}

export async function fetchK8sCertificates(apiUrl: string, filters: K8sWorkspaceFilters = {}): Promise<K8sCertificatesData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-certificates${query ? `?${query}` : ''}`);
  return normalizeCertificatesData(payload.data);
}

export async function fetchK8sClusterDetail(
  apiUrl: string,
  filters: K8sWorkspaceFilters = {}
): Promise<K8sClusterDetailData> {
  const query = buildK8sFilterParams(filters);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-cluster-detail${query ? `?${query}` : ''}`);
  return normalizeClusterDetailData(payload.data);
}

export async function fetchK8sPodDetail(
  apiUrl: string,
  filters: K8sWorkspaceFilters & { pod_name: string }
): Promise<K8sPodDetailData> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  params.set('pod_name', filters.pod_name);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-pod-detail?${params.toString()}`);
  return normalizePodDetailData(payload.data);
}

export async function fetchK8sRolloutDetail(
  apiUrl: string,
  filters: K8sWorkspaceFilters & { workload_name: string }
): Promise<K8sRolloutDetailData> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  params.set('workload_name', filters.workload_name);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-rollout-detail?${params.toString()}`);
  return normalizeRolloutDetailData(payload.data);
}

export async function fetchK8sActivity(
  apiUrl: string,
  filters: K8sWorkspaceFilters & { workload_name?: string; pod_name?: string; limit?: number } = {}
): Promise<K8sActivityData> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  if (filters.workload_name) params.set('workload_name', filters.workload_name);
  if (filters.pod_name) params.set('pod_name', filters.pod_name);
  if (typeof filters.limit === 'number' && filters.limit > 0) params.set('limit', String(filters.limit));
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-activity?${params.toString()}`);
  return normalizeActivityData(payload.data);
}

export async function fetchK8sPodExecProfile(
  apiUrl: string,
  filters: K8sWorkspaceFilters & { pod_name: string }
): Promise<K8sPodExecProfileData> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  params.set('pod_name', filters.pod_name);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-pod-exec-profile?${params.toString()}`);
  return normalizePodExecProfileData(payload.data);
}

export async function launchK8sTerminalSession(
  apiUrl: string,
  body: K8sTerminalLaunchPayload
): Promise<K8sTerminalLaunchData> {
  const payload = await fetchAuthorizedJson(apiUrl, '/api/devops/k8s-terminal-launch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return normalizeTerminalLaunchData(payload.data);
}

export async function fetchK8sTerminalSession(
  apiUrl: string,
  filters: K8sWorkspaceFilters & { session_id: string }
): Promise<K8sTerminalSessionData> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  params.set('session_id', filters.session_id);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-terminal-session?${params.toString()}`);
  return normalizeTerminalSessionData(payload.data);
}

export async function streamK8sTerminalAttach(
  apiUrl: string,
  filters: K8sWorkspaceFilters & { session_id: string },
  onEvent: (event: K8sTerminalAttachEventData) => void,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  params.set('session_id', filters.session_id);
  await streamAuthorizedNdjson(apiUrl, `/api/devops/k8s-terminal-attach?${params.toString()}`, (value) => {
    onEvent(normalizeTerminalAttachEventData(value));
  }, signal);
}

export async function sendK8sTerminalCommand(
  apiUrl: string,
  body: K8sTerminalCommandPayload
): Promise<K8sTerminalSessionData> {
  const payload = await fetchAuthorizedJson(apiUrl, '/api/devops/k8s-terminal-command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return normalizeTerminalSessionData(payload.data);
}

export async function fetchK8sIngressDetail(
  apiUrl: string,
  filters: K8sWorkspaceFilters & { ingress_name: string }
): Promise<K8sIngressDetailData> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.cluster_name) params.set('cluster_name', filters.cluster_name);
  if (filters.namespace) params.set('namespace', filters.namespace);
  if (filters.environment) params.set('environment', filters.environment);
  params.set('ingress_name', filters.ingress_name);
  const payload = await fetchAuthorizedJson(apiUrl, `/api/devops/k8s-ingress-detail?${params.toString()}`);
  return normalizeIngressDetailData(payload.data);
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

export async function triggerK8sWorkloadAction(apiUrl: string, body: K8sWorkloadActionPayload): Promise<string> {
  const payload = await fetchAuthorizedJson(apiUrl, '/api/devops/k8s-workload-actions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return getString(payload.message, 'K8s workload action queued');
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
