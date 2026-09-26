import { portalFetch, resolveRuntimeApiUrl, type PortalFetchInit } from '@infragate/ui';

const defaultBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export function getApiBaseUrl(): string {
  return resolveRuntimeApiUrl(defaultBase);
}

/** Admin portal authenticated fetch (Bearer from caller). */
export function apiFetch(path: string, init: PortalFetchInit = {}) {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  return portalFetch(url, init);
}
