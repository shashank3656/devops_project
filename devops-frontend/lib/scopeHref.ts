function first(value: string | string[] | undefined): string {
  const text = Array.isArray(value) ? value[0] : value;
  return (text || '').trim();
}

export function safeReturnPath(value: string | string[] | undefined): string {
  const text = first(value);
  if (!text.startsWith('/') || text.startsWith('//') || text.startsWith('/login') || text.includes('://')) return '';
  return text;
}

export function serviceTicketHref(path: string, item: { id: number; project_id?: number; environment?: string; service?: string }): string {
  const params = new URLSearchParams();
  const environment = (item.environment || '').trim();
  const service = (item.service || '').trim();
  if (item.project_id) params.set('project_id', String(item.project_id));
  if (environment) params.set('environment', environment);
  if (service) params.set('service', service);
  params.set('service_id', String(item.id));
  params.set('return', `/services/${item.id}`);
  return `${path}?${params.toString()}`;
}

export function isRecordDetailPath(pathname: string): boolean {
  return /^\/(requests|changes|incidents|problems|services)\/.+/.test(pathname) && !pathname.endsWith('/new');
}

export function scopeListHref(path: string, query: { project_id?: string | string[]; environment?: string | string[] }): string {
  const params = new URLSearchParams();
  const projectId = first(query.project_id);
  const environment = first(query.environment);
  if (projectId) params.set('project_id', projectId);
  if (environment) params.set('environment', environment);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function catalogueListHref(query: {
  project_id?: string | string[];
  environment?: string | string[];
  q?: string | string[];
  team?: string | string[];
}): string {
  const params = new URLSearchParams();
  const projectId = first(query.project_id);
  const q = first(query.q);
  const team = first(query.team);
  if (projectId) params.set('project_id', projectId);
  if (q) params.set('q', q);
  if (team) params.set('team', team);
  const search = params.toString();
  return search ? `/services?${search}` : '/services';
}

export function serviceDetailHref(
  id: number,
  query: {
    project_id?: string | string[];
    environment?: string | string[];
    q?: string | string[];
    team?: string | string[];
  },
): string {
  return `/services/${id}?from=${encodeURIComponent(catalogueListHref(query))}`;
}

export function serviceCatalogueBackHref(
  query: { from?: string | string[]; project_id?: string | string[]; environment?: string | string[] },
  item?: { project_id?: number; environment?: string },
): string {
  const from = safeReturnPath(query.from);
  if (from) return from;
  if (item?.project_id) {
    return scopeListHref('/services', { project_id: String(item.project_id) });
  }
  return scopeListHref('/services', { project_id: query.project_id });
}
