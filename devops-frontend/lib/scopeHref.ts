function first(value: string | string[] | undefined): string {
  const text = Array.isArray(value) ? value[0] : value;
  return (text || '').trim();
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
