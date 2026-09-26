import { buildK8sHref, readQueryString } from './k8sWorkspace';

/** NF-02: scoped cluster workspace views (legacy list routes remain drill-down targets). */
export type K8sWorkspaceView =
  | 'overview'
  | 'workloads'
  | 'pods'
  | 'services'
  | 'ingresses'
  | 'configmaps'
  | 'secrets'
  | 'storage'
  | 'certificates'
  | 'events'
  | 'logs'
  | 'rollouts';

export interface K8sScopeQuery {
  project_id?: string;
  cluster_name?: string;
  namespace?: string;
  environment?: string;
}

export function readK8sScopeFromQuery(query: Record<string, string | string[] | undefined>): K8sScopeQuery {
  return {
    project_id: readQueryString(query.project_id) || undefined,
    cluster_name: readQueryString(query.cluster_name) || undefined,
    namespace: readQueryString(query.namespace) || undefined,
    environment: readQueryString(query.environment) || undefined,
  };
}

export function hasK8sClusterScope(scope: K8sScopeQuery): boolean {
  return Boolean(scope.cluster_name?.trim());
}

export function viewToListPath(view: K8sWorkspaceView): string {
  switch (view) {
    case 'overview':
      return '/k8s/workspace';
    case 'workloads':
      return '/k8s/workloads';
    case 'pods':
      return '/k8s/pods';
    case 'services':
      return '/k8s/services';
    case 'ingresses':
      return '/k8s/ingresses';
    case 'configmaps':
      return '/k8s/configmaps';
    case 'secrets':
      return '/k8s/secrets';
    case 'storage':
      return '/k8s/storage';
    case 'certificates':
      return '/k8s/certificates';
    case 'events':
      return '/k8s/events';
    case 'logs':
      return '/k8s/logs';
    case 'rollouts':
      return '/k8s/rollouts';
    default:
      return '/k8s/workspace';
  }
}

export function pathnameToView(pathname: string): K8sWorkspaceView | null {
  if (pathname === '/k8s/workspace') return 'overview';
  if (pathname === '/k8s/workloads' || pathname.startsWith('/k8s/workloads/')) return 'workloads';
  if (pathname === '/k8s/pods' || pathname.startsWith('/k8s/pods/')) return 'pods';
  if (pathname === '/k8s/services' || pathname.startsWith('/k8s/services/')) return 'services';
  if (pathname === '/k8s/ingresses' || pathname.startsWith('/k8s/ingresses/')) return 'ingresses';
  if (pathname === '/k8s/configmaps') return 'configmaps';
  if (pathname === '/k8s/secrets') return 'secrets';
  if (pathname === '/k8s/storage') return 'storage';
  if (pathname === '/k8s/certificates') return 'certificates';
  if (pathname === '/k8s/events') return 'events';
  if (pathname === '/k8s/logs') return 'logs';
  if (pathname === '/k8s/rollouts') return 'rollouts';
  return null;
}

export function buildK8sWorkspaceHref(view: K8sWorkspaceView, scope: K8sScopeQuery): string {
  const path = viewToListPath(view);
  if (view === 'overview') {
    return buildK8sHref(path, {
      project_id: scope.project_id,
      cluster_name: scope.cluster_name,
      namespace: scope.namespace,
      environment: scope.environment,
      view: 'overview',
    });
  }
  return buildK8sHref(path, {
    project_id: scope.project_id,
    cluster_name: scope.cluster_name,
    namespace: scope.namespace,
    environment: scope.environment,
  });
}

/** Legacy `/k8s/clusters/:name` → NF-02 workspace entry. */
export function buildClusterWorkspaceEntry(clusterName: string, scope: Omit<K8sScopeQuery, 'cluster_name'>): string {
  return buildK8sWorkspaceHref('overview', { ...scope, cluster_name: clusterName });
}

export const K8S_WORKSPACE_TAB_GROUPS: {
  label: string;
  tabs: { view: K8sWorkspaceView; label: string }[];
}[] = [
  {
    label: 'Compute',
    tabs: [
      { view: 'overview', label: 'Overview' },
      { view: 'workloads', label: 'Workloads' },
      { view: 'pods', label: 'Pods' },
      { view: 'rollouts', label: 'Rollouts' },
    ],
  },
  {
    label: 'Network',
    tabs: [
      { view: 'services', label: 'Services' },
      { view: 'ingresses', label: 'Ingress' },
    ],
  },
  {
    label: 'Config',
    tabs: [
      { view: 'configmaps', label: 'ConfigMaps' },
      { view: 'secrets', label: 'Secrets' },
      { view: 'storage', label: 'Storage' },
      { view: 'certificates', label: 'TLS' },
    ],
  },
  {
    label: 'Observe',
    tabs: [
      { view: 'events', label: 'Events' },
      { view: 'logs', label: 'Logs' },
    ],
  },
];

export const K8S_CATALOG_HREF = '/k8s';
export const K8S_ONBOARD_HREF = '/k8s/onboard';

/** Top-level resource lists that require `cluster_name` (NF-02 workspace flow). */
export const K8S_WORKSPACE_LIST_PATHS = [
  '/k8s/workloads',
  '/k8s/pods',
  '/k8s/services',
  '/k8s/ingresses',
  '/k8s/configmaps',
  '/k8s/secrets',
  '/k8s/storage',
  '/k8s/certificates',
  '/k8s/events',
  '/k8s/logs',
  '/k8s/rollouts',
] as const;

export function isK8sWorkspaceListPath(pathname: string): boolean {
  return (K8S_WORKSPACE_LIST_PATHS as readonly string[]).includes(pathname);
}

export function buildK8sCatalogHref(scope: Pick<K8sScopeQuery, 'project_id' | 'environment'>): string {
  return buildK8sHref(K8S_CATALOG_HREF, {
    project_id: scope.project_id,
    environment: scope.environment,
  });
}
