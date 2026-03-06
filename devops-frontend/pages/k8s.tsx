import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

type K8sViewMode = 'onboarding' | 'dashboard';
type ResourceTab =
  | 'pods'
  | 'deployments'
  | 'logs'
  | 'replicasets'
  | 'namespaces'
  | 'volumes'
  | 'services'
  | 'ingresses'
  | 'secrets'
  | 'service_accounts'
  | 'configmaps';
type DataSourceMode = 'prometheus' | 'kube_state_metrics' | 'loki';
type ResolutionMode = '15s' | '30s' | '1m' | '5m';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  clouds: string[];
  environments: string[];
}

interface K8sConnection {
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

interface Summary {
  namespace_count: number;
  deployment_count: number;
  pod_count: number;
  service_count: number;
  ingress_count: number;
  warning_event_count: number;
}

interface NamespaceItem {
  name: string;
  status: string;
  environment: string;
  cluster_name: string;
  pod_count: number;
  service_count: number;
  last_activity: string;
}

interface DeploymentItem {
  name: string;
  namespace: string;
  cluster_name: string;
  image: string;
  replicas: number;
  ready_replicas: number;
  updated_replicas: number;
  status: string;
}

interface PodItem {
  name: string;
  namespace: string;
  cluster_name: string;
  status: string;
  restarts: number;
  node: string;
  age: string;
  deployment: string;
}

interface LogItem {
  name: string;
  namespace: string;
  cluster_name: string;
  container: string;
  level: string;
  message: string;
  timestamp: string;
}

interface ReplicaSetItem {
  name: string;
  namespace: string;
  cluster_name: string;
  desired_replicas: number;
  ready_replicas: number;
  age: string;
  deployment: string;
}

interface VolumeItem {
  name: string;
  namespace: string;
  cluster_name: string;
  type: string;
  claim: string;
  status: string;
  mounted_by: string;
}

interface ServiceItem {
  name: string;
  namespace: string;
  cluster_name: string;
  type: string;
  cluster_ip: string;
  ports: string;
  selector: string;
  exposure: string;
}

interface IngressItem {
  name: string;
  namespace: string;
  cluster_name: string;
  host: string;
  paths: string;
  exposure: string;
  status: string;
}

interface SecretItem {
  name: string;
  namespace: string;
  cluster_name: string;
  type: string;
  managed_by: string;
  age: string;
}

interface ServiceAccountItem {
  name: string;
  namespace: string;
  cluster_name: string;
  automount: boolean;
  token_count: number;
}

interface ConfigMapItem {
  name: string;
  namespace: string;
  cluster_name: string;
  data_keys: number;
  mounted_by: string;
}

interface K8sOverviewData {
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
  namespace_items: NamespaceItem[];
  deployments: DeploymentItem[];
  pods: PodItem[];
  logs: LogItem[];
  replicasets: ReplicaSetItem[];
  volumes: VolumeItem[];
  services: ServiceItem[];
  ingresses: IngressItem[];
  secrets: SecretItem[];
  service_accounts: ServiceAccountItem[];
  configmaps: ConfigMapItem[];
}

interface K8sOnboardingData {
  projects: ProjectOption[];
  connections: K8sConnection[];
  auth_modes: string[];
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

function normalizeProjects(value: unknown): ProjectOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((project) => ({
    id: typeof project?.id === 'number' ? project.id : 0,
    name: typeof project?.name === 'string' ? project.name : 'Unknown',
    code: typeof project?.code === 'string' ? project.code : 'n/a',
    clouds: Array.isArray(project?.clouds) ? project.clouds.filter((item: unknown): item is string => typeof item === 'string') : [],
    environments: Array.isArray(project?.environments) ? project.environments.filter((item: unknown): item is string => typeof item === 'string') : [],
  }));
}

function normalizeConnections(value: unknown): K8sConnection[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: typeof item?.id === 'number' ? item.id : 0,
    project_id: typeof item?.project_id === 'number' ? item.project_id : 0,
    project_name: typeof item?.project_name === 'string' ? item.project_name : 'Unknown',
    project_code: typeof item?.project_code === 'string' ? item.project_code : 'n/a',
    cloud: typeof item?.cloud === 'string' ? item.cloud : '',
    cluster_name: typeof item?.cluster_name === 'string' ? item.cluster_name : '',
    cluster_endpoint: typeof item?.cluster_endpoint === 'string' ? item.cluster_endpoint : '',
    environment: typeof item?.environment === 'string' ? item.environment : '',
    namespace: typeof item?.namespace === 'string' ? item.namespace : '',
    auth_mode: typeof item?.auth_mode === 'string' ? item.auth_mode : '',
    has_auth_credential: item?.has_auth_credential === true,
    created_at: typeof item?.created_at === 'string' ? item.created_at : '',
    updated_at: typeof item?.updated_at === 'string' ? item.updated_at : '',
  }));
}

function authModeRequiresCredential(mode: string): boolean {
  return mode !== 'in_cluster';
}

function authModeCredentialLabel(mode: string): string {
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

function authModeCredentialPlaceholder(mode: string): string {
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

function normalizeOverviewData(value: Partial<K8sOverviewData> | null | undefined): K8sOverviewData | null {
  if (!value) return null;
  return {
    projects: normalizeProjects(value.projects),
    connections: normalizeConnections(value.connections),
    selected_project_id: typeof value.selected_project_id === 'number' ? value.selected_project_id : 0,
    selected_cluster: typeof value.selected_cluster === 'string' ? value.selected_cluster : '',
    selected_namespace: typeof value.selected_namespace === 'string' ? value.selected_namespace : '',
    selected_environment: typeof value.selected_environment === 'string' ? value.selected_environment : '',
    clusters: Array.isArray(value.clusters)
      ? value.clusters.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    namespaces: Array.isArray(value.namespaces)
      ? value.namespaces.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    environments: Array.isArray(value.environments)
      ? value.environments.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    summary: {
      namespace_count: typeof value.summary?.namespace_count === 'number' ? value.summary.namespace_count : 0,
      deployment_count: typeof value.summary?.deployment_count === 'number' ? value.summary.deployment_count : 0,
      pod_count: typeof value.summary?.pod_count === 'number' ? value.summary.pod_count : 0,
      service_count: typeof value.summary?.service_count === 'number' ? value.summary.service_count : 0,
      ingress_count: typeof value.summary?.ingress_count === 'number' ? value.summary.ingress_count : 0,
      warning_event_count: typeof value.summary?.warning_event_count === 'number' ? value.summary.warning_event_count : 0,
    },
    namespace_items: Array.isArray(value.namespace_items) ? value.namespace_items as NamespaceItem[] : [],
    deployments: Array.isArray(value.deployments) ? value.deployments as DeploymentItem[] : [],
    pods: Array.isArray(value.pods) ? value.pods as PodItem[] : [],
    logs: Array.isArray(value.logs) ? value.logs as LogItem[] : [],
    replicasets: Array.isArray(value.replicasets) ? value.replicasets as ReplicaSetItem[] : [],
    volumes: Array.isArray(value.volumes) ? value.volumes as VolumeItem[] : [],
    services: Array.isArray(value.services) ? value.services as ServiceItem[] : [],
    ingresses: Array.isArray(value.ingresses) ? value.ingresses as IngressItem[] : [],
    secrets: Array.isArray(value.secrets) ? value.secrets as SecretItem[] : [],
    service_accounts: Array.isArray(value.service_accounts) ? value.service_accounts as ServiceAccountItem[] : [],
    configmaps: Array.isArray(value.configmaps) ? value.configmaps as ConfigMapItem[] : [],
  };
}

function normalizeOnboardingData(value: Partial<K8sOnboardingData> | null | undefined): K8sOnboardingData {
  return {
    projects: normalizeProjects(value?.projects),
    connections: normalizeConnections(value?.connections),
    auth_modes: Array.isArray(value?.auth_modes)
      ? value.auth_modes.filter((item: unknown): item is string => typeof item === 'string')
      : [],
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export default function DevOpsK8sPage() {
  const apiUrl = useApiUrl();
  const [viewMode, setViewMode] = useState<K8sViewMode>('dashboard');
  const [overview, setOverview] = useState<K8sOverviewData | null>(null);
  const [onboarding, setOnboarding] = useState<K8sOnboardingData>({ projects: [], connections: [], auth_modes: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('prometheus');
  const [resolution, setResolution] = useState<ResolutionMode>('30s');
  const [workload, setWorkload] = useState('');
  const [activeTab, setActiveTab] = useState<ResourceTab>('pods');
  const [form, setForm] = useState({
    project_id: '',
    cloud: '',
    cluster_name: '',
    cluster_endpoint: '',
    environment: '',
    auth_mode: 'service_account',
    auth_credential: '',
  });

  const selectedProject = useMemo(
    () => onboarding.projects.find((project) => String(project.id) === form.project_id) || null,
    [onboarding.projects, form.project_id]
  );

  const projectClouds = selectedProject?.clouds || [];
  const projectEnvironments = selectedProject?.environments || [];
  const workloadOptions = useMemo(() => {
    const names = (overview?.deployments || []).map((item) => item.name).filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [overview]);

  const loadOnboarding = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    const response = await fetch(`${apiUrl}/api/devops/k8s-connections`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      clearSessionAndRedirect();
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to load K8s onboarding');
    }
    const nextData = normalizeOnboardingData(payload?.data);
    setOnboarding(nextData);
    if (!form.project_id && nextData.projects[0]?.id) {
      setForm((current) => ({
        ...current,
        project_id: String(nextData.projects[0].id),
        cloud: current.cloud || nextData.projects[0].clouds[0] || '',
          environment: current.environment || nextData.projects[0].environments[0] || '',
          auth_mode: current.auth_mode || nextData.auth_modes[0] || 'service_account',
          auth_credential: current.auth_credential || '',
        }));
    }
  };

  const loadOverview = async (nextProjectId?: string, nextClusterName?: string, nextNamespace?: string, nextEnvironment?: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    const params = new URLSearchParams();
    const projectValue = (nextProjectId ?? projectId).trim();
    const clusterValue = (nextClusterName ?? clusterName).trim();
    const namespaceValue = (nextNamespace ?? namespace).trim();
    const environmentValue = (nextEnvironment ?? environment).trim();
    if (projectValue) params.set('project_id', projectValue);
    if (clusterValue) params.set('cluster_name', clusterValue);
    if (namespaceValue) params.set('namespace', namespaceValue);
    if (environmentValue) params.set('environment', environmentValue);

    const response = await fetch(`${apiUrl}/api/devops/k8s-overview?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      clearSessionAndRedirect();
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to load K8s dashboard');
    }
    const nextData = normalizeOverviewData(payload?.data);
    if (nextData) {
      setOverview(nextData);
      setProjectId(String(nextData.selected_project_id || ''));
      setClusterName(nextData.selected_cluster || '');
      setNamespace(nextData.selected_namespace || '');
      setEnvironment(nextData.selected_environment || '');
    }
  };

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      setError('');
      try {
        await Promise.all([loadOnboarding(), loadOverview()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load K8s workspace');
      } finally {
        setLoading(false);
      }
    };
    void loadAll();
  }, [apiUrl]);

  useEffect(() => {
    if (!selectedProject) return;
    setForm((current) => ({
      ...current,
      cloud: projectClouds.includes(current.cloud) ? current.cloud : (projectClouds[0] || ''),
      environment: projectEnvironments.includes(current.environment) ? current.environment : (projectEnvironments[0] || ''),
    }));
  }, [selectedProject, projectClouds, projectEnvironments]);

  const dashboardView = useMemo(() => {
    if (!overview) return null;
    const workloadToken = workload.trim().toLowerCase();
    if (!workloadToken) return overview;

    const hasWorkload = (value: string) => value.toLowerCase().includes(workloadToken);
    const deployments = overview.deployments.filter((item) => hasWorkload(item.name));
    const pods = overview.pods.filter((item) => hasWorkload(item.name) || hasWorkload(item.deployment));
    const logs = overview.logs.filter((item) => hasWorkload(item.name));
    const replicasets = overview.replicasets.filter((item) => hasWorkload(item.name) || hasWorkload(item.deployment));
    const volumes = overview.volumes.filter((item) => hasWorkload(item.name) || hasWorkload(item.mounted_by));
    const services = overview.services.filter((item) => hasWorkload(item.name));
    const ingresses = overview.ingresses.filter((item) => hasWorkload(item.name));
    const secrets = overview.secrets.filter((item) => hasWorkload(item.name));
    const serviceAccounts = overview.service_accounts.filter((item) => hasWorkload(item.name));
    const configmaps = overview.configmaps.filter((item) => hasWorkload(item.name));
    const podNamespaces = new Set(pods.map((item) => item.namespace));
    const namespaceItems = overview.namespace_items.filter((item) => podNamespaces.has(item.name));

    return {
      ...overview,
      deployments,
      pods,
      logs,
      replicasets,
      volumes,
      services,
      ingresses,
      secrets,
      service_accounts: serviceAccounts,
      configmaps,
      namespace_items: namespaceItems,
      summary: {
        ...overview.summary,
        namespace_count: namespaceItems.length,
        deployment_count: deployments.length,
        pod_count: pods.length,
        service_count: services.length,
        ingress_count: ingresses.length,
        warning_event_count: logs.filter((item) => item.level.toLowerCase() !== 'info').length,
      },
    };
  }, [overview, workload]);

  const deploymentHealth = useMemo(() => {
    const health = { healthy: 0, degraded: 0, blocked: 0, scaledDown: 0 };
    for (const item of dashboardView?.deployments || []) {
      const status = (item.status || '').toLowerCase();
      if (status === 'healthy') health.healthy += 1;
      else if (status === 'degraded') health.degraded += 1;
      else if (status === 'blocked') health.blocked += 1;
      else if (status === 'scaled-down') health.scaledDown += 1;
    }
    return health;
  }, [dashboardView]);

  const namespaceLoad = useMemo(() => {
    const source = dashboardView?.namespace_items || [];
    return source
      .map((item) => ({
        namespace: item.name,
        cluster: item.cluster_name,
        pods: item.pod_count,
      }))
      .sort((a, b) => b.pods - a.pods)
      .slice(0, 6);
  }, [dashboardView]);

  const warningTimeline = useMemo(() => {
    const baseWarnings = dashboardView?.summary.warning_event_count || 0;
    const multiplier = resolution === '15s' ? 0.8 : resolution === '30s' ? 1 : resolution === '1m' ? 1.2 : 1.5;
    return Array.from({ length: 12 }, (_, index) => {
      const wave = Math.sin((index / 11) * Math.PI * 2) * 1.5;
      const drift = (index % 3) - 1;
      const value = Math.max(0, Math.round((baseWarnings + wave + drift) * multiplier));
      return { bucket: index + 1, value };
    });
  }, [dashboardView, resolution]);

  const tabCounts = useMemo(() => ({
    pods: dashboardView?.pods.length || 0,
    deployments: dashboardView?.deployments.length || 0,
    logs: dashboardView?.logs.length || 0,
    replicasets: dashboardView?.replicasets.length || 0,
    namespaces: dashboardView?.namespace_items.length || 0,
    volumes: dashboardView?.volumes.length || 0,
    services: dashboardView?.services.length || 0,
    ingresses: dashboardView?.ingresses.length || 0,
    secrets: dashboardView?.secrets.length || 0,
    service_accounts: dashboardView?.service_accounts.length || 0,
    configmaps: dashboardView?.configmaps.length || 0,
  }), [dashboardView]);

  const tabItems: { key: ResourceTab; label: string }[] = [
    { key: 'pods', label: 'Pods' },
    { key: 'deployments', label: 'Deployments' },
    { key: 'logs', label: 'Logs' },
    { key: 'replicasets', label: 'ReplicaSet' },
    { key: 'namespaces', label: 'Namespaces' },
    { key: 'volumes', label: 'Volumes' },
    { key: 'services', label: 'Services' },
    { key: 'ingresses', label: 'Ingress' },
    { key: 'secrets', label: 'Secret' },
    { key: 'service_accounts', label: 'ServiceAccount' },
    { key: 'configmaps', label: 'Configmaps' },
  ];

  const handleApplyFilters = async () => {
    setLoading(true);
    setError('');
    try {
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load K8s dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardingSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/k8s-connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          project_id: Number(form.project_id),
          cloud: form.cloud,
          cluster_name: form.cluster_name,
          cluster_endpoint: form.cluster_endpoint,
          environment: form.environment,
          auth_mode: form.auth_mode,
          auth_credential: form.auth_credential,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save K8s onboarding');
      }
      setSuccess(payload?.message || 'K8s onboarding saved');
      await Promise.all([
        loadOnboarding(),
        loadOverview(String(form.project_id), form.cluster_name, '', form.environment),
      ]);
      setProjectId(form.project_id);
      setClusterName(form.cluster_name);
      setNamespace('');
      setEnvironment(form.environment);
      setViewMode('dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save K8s onboarding');
    } finally {
      setSaving(false);
    }
  };

  const renderDashboardTable = () => {
    if (!dashboardView) return null;
    switch (activeTab) {
      case 'pods':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Status</th><th>Restarts</th><th>Node</th><th>Deployment</th></tr></thead>
            <tbody>{dashboardView.pods.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.status}</td><td>{item.restarts}</td><td>{item.node}</td><td>{item.deployment}</td></tr>)}</tbody>
          </table>
        );
      case 'deployments':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Image</th><th>Ready</th><th>Replicas</th><th>Status</th></tr></thead>
            <tbody>{dashboardView.deployments.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.image}</td><td>{item.ready_replicas}/{item.updated_replicas}</td><td>{item.replicas}</td><td>{item.status}</td></tr>)}</tbody>
          </table>
        );
      case 'logs':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Timestamp</th><th>Workload</th><th>Cluster</th><th>Namespace</th><th>Level</th><th>Message</th></tr></thead>
            <tbody>{dashboardView.logs.map((item, index) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}-${index}`}><td>{formatDateTime(item.timestamp)}</td><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.level}</td><td>{item.message}</td></tr>)}</tbody>
          </table>
        );
      case 'replicasets':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Deployment</th><th>Ready</th><th>Age</th></tr></thead>
            <tbody>{dashboardView.replicasets.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.deployment}</td><td>{item.ready_replicas}/{item.desired_replicas}</td><td>{item.age}</td></tr>)}</tbody>
          </table>
        );
      case 'namespaces':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Environment</th><th>Pods</th><th>Services</th><th>Last activity</th></tr></thead>
            <tbody>{dashboardView.namespace_items.map((item) => <tr key={`${item.cluster_name}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.environment}</td><td>{item.pod_count}</td><td>{item.service_count}</td><td>{formatDateTime(item.last_activity)}</td></tr>)}</tbody>
          </table>
        );
      case 'volumes':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Type</th><th>Claim</th><th>Status</th><th>Mounted by</th></tr></thead>
            <tbody>{dashboardView.volumes.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.type}</td><td>{item.claim}</td><td>{item.status}</td><td>{item.mounted_by}</td></tr>)}</tbody>
          </table>
        );
      case 'services':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Type</th><th>Cluster IP</th><th>Ports</th><th>Exposure</th></tr></thead>
            <tbody>{dashboardView.services.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.type}</td><td>{item.cluster_ip}</td><td>{item.ports}</td><td>{item.exposure}</td></tr>)}</tbody>
          </table>
        );
      case 'ingresses':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Host</th><th>Paths</th><th>Status</th></tr></thead>
            <tbody>{dashboardView.ingresses.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.host}</td><td>{item.paths}</td><td>{item.status}</td></tr>)}</tbody>
          </table>
        );
      case 'secrets':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Type</th><th>Managed by</th><th>Age</th></tr></thead>
            <tbody>{dashboardView.secrets.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.type}</td><td>{item.managed_by}</td><td>{item.age}</td></tr>)}</tbody>
          </table>
        );
      case 'service_accounts':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Automount</th><th>Tokens</th></tr></thead>
            <tbody>{dashboardView.service_accounts.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.automount ? 'Yes' : 'No'}</td><td>{item.token_count}</td></tr>)}</tbody>
          </table>
        );
      case 'configmaps':
        return (
          <table className="k8s-resource-table">
            <thead><tr><th>Name</th><th>Cluster</th><th>Namespace</th><th>Data keys</th><th>Mounted by</th></tr></thead>
            <tbody>{dashboardView.configmaps.map((item) => <tr key={`${item.cluster_name}-${item.namespace}-${item.name}`}><td>{item.name}</td><td>{item.cluster_name}</td><td>{item.namespace}</td><td>{item.data_keys}</td><td>{item.mounted_by}</td></tr>)}</tbody>
          </table>
        );
      default:
        return null;
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>K8s - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Kubernetes</span>
            <h1 className="portal-page__title">K8s</h1>
            <p className="portal-page__subtitle">
              Onboard project-to-cluster mappings, then browse Kubernetes resources with filters for project name, cluster name, namespace, and environment.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/projects" className="btn btn-secondary">Projects</Link>
            <Link href="/project-operations" className="btn btn-secondary">Project operations</Link>
          </div>
        </div>

        <section className="portal-surface" style={{ marginBottom: 24 }}>
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Workspace</span>
              <h2 className="portal-surface__title">K8s modules</h2>
            </div>
          </div>
          <div className="k8s-mode-switch">
            <button type="button" className={`k8s-mode-switch__button ${viewMode === 'onboarding' ? 'k8s-mode-switch__button--active' : ''}`} onClick={() => setViewMode('onboarding')}>
              K8s Onboarding
            </button>
            <button type="button" className={`k8s-mode-switch__button ${viewMode === 'dashboard' ? 'k8s-mode-switch__button--active' : ''}`} onClick={() => setViewMode('dashboard')}>
              K8s Dashboard
            </button>
          </div>
        </section>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {success ? <div className="alert alert-success">{success}</div> : null}

        {viewMode === 'onboarding' ? (
          <>
            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Onboarding</span>
                  <h2 className="portal-surface__title">Register a project cluster</h2>
                  <p className="portal-surface__subtitle">
                    Configure the project name, cloud, cluster name, endpoint, environment, and auth mode that the DevOps portal will use for this project-wise Kubernetes view.
                  </p>
                </div>
              </div>
              <form onSubmit={handleOnboardingSubmit}>
                <div className="portal-form-grid">
                  <label className="label">
                    Project name
                    <select className="input" value={form.project_id} onChange={(event) => setForm((current) => ({ ...current, project_id: event.target.value }))} required>
                      {onboarding.projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name} ({project.code})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Cloud
                    <select className="input" value={form.cloud} onChange={(event) => setForm((current) => ({ ...current, cloud: event.target.value }))} required>
                      {projectClouds.map((cloud) => (
                        <option key={cloud} value={cloud}>
                          {cloud.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Cluster name
                    <input className="input" value={form.cluster_name} onChange={(event) => setForm((current) => ({ ...current, cluster_name: event.target.value }))} placeholder="payments-eks-prod" required />
                  </label>
                  <label className="label">
                    Cluster endpoint
                    <input className="input" value={form.cluster_endpoint} onChange={(event) => setForm((current) => ({ ...current, cluster_endpoint: event.target.value }))} placeholder="https://cluster.example.com" required />
                  </label>
                  <label className="label">
                    Environment
                    <select className="input" value={form.environment} onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))} required>
                      {projectEnvironments.map((env) => (
                        <option key={env} value={env}>
                          {env.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Auth mode
                    <select className="input" value={form.auth_mode} onChange={(event) => setForm((current) => ({ ...current, auth_mode: event.target.value }))} required>
                      {onboarding.auth_modes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </label>
                  {authModeRequiresCredential(form.auth_mode) ? (
                    <label className="label portal-form-grid__span-2">
                      {authModeCredentialLabel(form.auth_mode)}
                      {form.auth_mode === 'kubeconfig' ? (
                        <textarea
                          className="input"
                          value={form.auth_credential}
                          onChange={(event) => setForm((current) => ({ ...current, auth_credential: event.target.value }))}
                          placeholder={authModeCredentialPlaceholder(form.auth_mode)}
                          rows={6}
                          required
                        />
                      ) : (
                        <input
                          className="input"
                          type="password"
                          value={form.auth_credential}
                          onChange={(event) => setForm((current) => ({ ...current, auth_credential: event.target.value }))}
                          placeholder={authModeCredentialPlaceholder(form.auth_mode)}
                          required
                        />
                      )}
                    </label>
                  ) : (
                    <div className="portal-note">
                      In-cluster mode does not require a manually pasted credential. The backend is expected to run with cluster-native access.
                    </div>
                  )}
                </div>
                <div className="portal-form-actions" style={{ marginTop: 18 }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving...' : 'Save K8s onboarding'}
                  </button>
                </div>
              </form>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Connections</span>
                  <h2 className="portal-surface__title">Registered project clusters</h2>
                </div>
              </div>
              <div className="k8s-table-wrap">
                <table className="k8s-resource-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Cloud</th>
                      <th>Cluster</th>
                      <th>Endpoint</th>
                      <th>Environment</th>
                      <th>Namespace</th>
                      <th>Auth mode</th>
                      <th>Credential</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onboarding.connections.map((item) => (
                      <tr key={item.id}>
                        <td>{item.project_name}</td>
                        <td>{item.cloud.toUpperCase()}</td>
                        <td>{item.cluster_name}</td>
                        <td>{item.cluster_endpoint}</td>
                        <td>{item.environment}</td>
                        <td>{item.namespace}</td>
                        <td>{item.auth_mode}</td>
                        <td>{item.has_auth_credential ? 'Configured' : 'Missing'}</td>
                      </tr>
                    ))}
                    {onboarding.connections.length === 0 ? (
                      <tr>
                        <td colSpan={8}>No K8s onboarding records yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Filters</span>
                  <h2 className="portal-surface__title">Project-wise dashboard</h2>
                  <p className="portal-surface__subtitle">
                    Filter the Kubernetes dashboard by project name, cluster name, namespace, and environment.
                  </p>
                </div>
              </div>
              <div className="k8s-filter-toolbar">
                <div className="k8s-filter-toolbar__group">
                  <span className="k8s-filter-toolbar__label">datasource</span>
                  <select className="k8s-filter-toolbar__select" value={dataSourceMode} onChange={(event) => setDataSourceMode(event.target.value as DataSourceMode)}>
                    <option value="prometheus">Prometheus</option>
                    <option value="kube_state_metrics">kube-state-metrics</option>
                    <option value="loki">Loki</option>
                  </select>
                </div>
                <div className="k8s-filter-toolbar__group">
                  <span className="k8s-filter-toolbar__label">project</span>
                  <select className="k8s-filter-toolbar__select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                    {overview?.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="k8s-filter-toolbar__group">
                  <span className="k8s-filter-toolbar__label">cluster</span>
                  <select className="k8s-filter-toolbar__select" value={clusterName} onChange={(event) => setClusterName(event.target.value)}>
                    <option value="">All clusters</option>
                    {overview?.clusters.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="k8s-filter-toolbar__group">
                  <span className="k8s-filter-toolbar__label">namespace</span>
                  <select className="k8s-filter-toolbar__select" value={namespace} onChange={(event) => setNamespace(event.target.value)}>
                    <option value="">All namespaces</option>
                    {overview?.namespaces.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="k8s-filter-toolbar__group">
                  <span className="k8s-filter-toolbar__label">env</span>
                  <select className="k8s-filter-toolbar__select" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
                    <option value="">All environments</option>
                    {overview?.environments.map((item) => (
                      <option key={item} value={item}>
                        {item.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="k8s-filter-toolbar__group">
                  <span className="k8s-filter-toolbar__label">workload</span>
                  <select className="k8s-filter-toolbar__select" value={workload} onChange={(event) => setWorkload(event.target.value)}>
                    <option value="">All workloads</option>
                    {workloadOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="k8s-filter-toolbar__group">
                  <span className="k8s-filter-toolbar__label">resolution</span>
                  <select className="k8s-filter-toolbar__select" value={resolution} onChange={(event) => setResolution(event.target.value as ResolutionMode)}>
                    <option value="15s">15s</option>
                    <option value="30s">30s</option>
                    <option value="1m">1m</option>
                    <option value="5m">5m</option>
                  </select>
                </div>
                <button type="button" className="k8s-filter-toolbar__action" onClick={handleApplyFilters} disabled={loading}>
                  {loading ? 'Loading...' : 'Apply filters'}
                </button>
              </div>
            </section>

            <section className="k8s-viz-grid" style={{ marginBottom: 24 }}>
              <article className="k8s-viz-panel">
                <header className="k8s-viz-panel__header">
                  <h3>Deployment health</h3>
                  <span>{dataSourceMode.replace(/_/g, ' ')}</span>
                </header>
                <div className="k8s-health-pills">
                  <span className="k8s-health-pill k8s-health-pill--healthy">Healthy {deploymentHealth.healthy}</span>
                  <span className="k8s-health-pill k8s-health-pill--degraded">Degraded {deploymentHealth.degraded}</span>
                  <span className="k8s-health-pill k8s-health-pill--blocked">Blocked {deploymentHealth.blocked}</span>
                  <span className="k8s-health-pill k8s-health-pill--scaled">Scaled-down {deploymentHealth.scaledDown}</span>
                </div>
                <div className="k8s-health-bar">
                  <span style={{ width: `${Math.max(6, deploymentHealth.healthy * 18)}px` }} className="k8s-health-bar__segment k8s-health-bar__segment--healthy" />
                  <span style={{ width: `${Math.max(6, deploymentHealth.degraded * 18)}px` }} className="k8s-health-bar__segment k8s-health-bar__segment--degraded" />
                  <span style={{ width: `${Math.max(6, deploymentHealth.blocked * 18)}px` }} className="k8s-health-bar__segment k8s-health-bar__segment--blocked" />
                  <span style={{ width: `${Math.max(6, deploymentHealth.scaledDown * 18)}px` }} className="k8s-health-bar__segment k8s-health-bar__segment--scaled" />
                </div>
              </article>

              <article className="k8s-viz-panel">
                <header className="k8s-viz-panel__header">
                  <h3>Namespace pod load</h3>
                  <span>{resolution}</span>
                </header>
                <div className="k8s-namespace-bars">
                  {namespaceLoad.length > 0 ? namespaceLoad.map((item) => (
                    <div key={`${item.cluster}-${item.namespace}`} className="k8s-namespace-bars__row">
                      <div className="k8s-namespace-bars__meta">
                        <strong>{item.namespace}</strong>
                        <small>{item.cluster}</small>
                      </div>
                      <div className="k8s-namespace-bars__track">
                        <span style={{ width: `${Math.min(100, item.pods * 7)}%` }} />
                      </div>
                      <span className="k8s-namespace-bars__value">{item.pods}</span>
                    </div>
                  )) : <p className="k8s-viz-empty">No namespace metrics for current filters.</p>}
                </div>
              </article>

              <article className="k8s-viz-panel">
                <header className="k8s-viz-panel__header">
                  <h3>Warning timeline</h3>
                  <span>last 12 windows</span>
                </header>
                <div className="k8s-warning-timeline">
                  {warningTimeline.map((point) => (
                    <div key={point.bucket} className="k8s-warning-timeline__bar-wrap" title={`Window ${point.bucket}: ${point.value}`}>
                      <span style={{ height: `${Math.max(8, point.value * 8)}px` }} className="k8s-warning-timeline__bar" />
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="portal-grid portal-grid--three" style={{ marginBottom: 24 }}>
              <article className="portal-surface portal-surface--tight"><span className="portal-surface__eyebrow">Namespaces</span><h3 className="portal-surface__title">{dashboardView?.summary.namespace_count || 0}</h3></article>
              <article className="portal-surface portal-surface--tight"><span className="portal-surface__eyebrow">Deployments</span><h3 className="portal-surface__title">{dashboardView?.summary.deployment_count || 0}</h3></article>
              <article className="portal-surface portal-surface--tight"><span className="portal-surface__eyebrow">Pods</span><h3 className="portal-surface__title">{dashboardView?.summary.pod_count || 0}</h3></article>
              <article className="portal-surface portal-surface--tight"><span className="portal-surface__eyebrow">Services</span><h3 className="portal-surface__title">{dashboardView?.summary.service_count || 0}</h3></article>
              <article className="portal-surface portal-surface--tight"><span className="portal-surface__eyebrow">Ingress</span><h3 className="portal-surface__title">{dashboardView?.summary.ingress_count || 0}</h3></article>
              <article className="portal-surface portal-surface--tight"><span className="portal-surface__eyebrow">Warnings</span><h3 className="portal-surface__title">{dashboardView?.summary.warning_event_count || 0}</h3></article>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Components</span>
                  <h2 className="portal-surface__title">Kubernetes resources</h2>
                </div>
              </div>
              <div className="k8s-tab-strip">
                {tabItems.map((item) => (
                  <button key={item.key} type="button" className={`k8s-tab-strip__tab ${activeTab === item.key ? 'k8s-tab-strip__tab--active' : ''}`} onClick={() => setActiveTab(item.key)}>
                    {item.label} <span>{tabCounts[item.key]}</span>
                  </button>
                ))}
              </div>
              <div className="k8s-table-wrap">
                {renderDashboardTable()}
              </div>
            </section>
          </>
        )}
      </div>
    </DevOpsLayout>
  );
}
