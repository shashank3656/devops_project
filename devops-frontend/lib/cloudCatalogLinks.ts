import { normalizeCloudProvider } from './cloudProviders';
import { cloudInventoryAccountHref } from './cloudInventoryRoutes';

/** Environment catalog filtered to a project (and optional env name for client-side search). */
export function environmentCatalogHref(projectId: number, environment?: string): string {
  const params = new URLSearchParams();
  params.set('project_id', String(projectId));
  if (environment?.trim()) {
    params.set('env', environment.trim());
  }
  return `/environments?${params.toString()}`;
}

export function cloudAccountDetailHref(accountDbId: number): string {
  return `/cloud-accounts/${accountDbId}`;
}

export function inventoryListHref(opts: {
  cloud?: string;
  accountId?: string;
  projectId?: string;
  environment?: string;
  team?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.cloud) params.set('cloud', normalizeCloudProvider(opts.cloud));
  if (opts.accountId?.trim()) params.set('account_id', opts.accountId.trim());
  if (opts.projectId?.trim()) params.set('project_id', opts.projectId.trim());
  if (opts.environment?.trim()) params.set('environment', opts.environment.trim());
  if (opts.team?.trim()) params.set('team', opts.team.trim());
  const q = params.toString();
  return q ? `/cloud-resources?${q}` : '/cloud-resources';
}

export { cloudInventoryAccountHref };

/** Merge ScopeBar-style scope into inventory/catalog hrefs when not already set. */
export function mergeInventoryScope(
  href: string,
  scope: { projectId?: string; environment?: string },
): string {
  if (!scope.projectId && !scope.environment) return href;
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  if (scope.projectId && !params.has('project_id')) params.set('project_id', scope.projectId);
  if (scope.environment && !params.has('environment')) params.set('environment', scope.environment);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}
