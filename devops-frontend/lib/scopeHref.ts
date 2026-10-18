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

export function scopeListHref(path: string, query: { project_id?: string | string[]; environment?: string | string[] }): string {
  const params = new URLSearchParams();
  const projectId = first(query.project_id);
  const environment = first(query.environment);
  if (projectId) params.set('project_id', projectId);
  if (environment) params.set('environment', environment);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
