/**
 * Runtime API URL resolution for the three portals.
 *
 * NEXT_PUBLIC_API_URL is baked into the browser bundle at build time. When an image
 * is built without it, every request goes to http://localhost:8080, which fails for
 * anyone opening the deployed site. This module rewrites those requests in the
 * browser to the real backend when the page is not served from localhost.
 */

export const RAILWAY_PRODUCTION_API_URL = 'https://backend-api-production-ed.up.railway.app';

const LOCAL_HOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i;
const LOCAL_API_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

export function trimSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

function isLocalPageHost(hostname: string): boolean {
  return LOCAL_API_HOSTS.has(hostname);
}

function isAllowedApiHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOCAL_API_HOSTS.has(host)) return true;
  if (host === 'backend-api-production-ed.up.railway.app') return true;
  return host.endsWith('.railway.app');
}

/**
 * Validates a fully resolved portal API URL before fetch (mitigates SSRF from tainted path segments).
 */
export function assertPortalApiUrl(urlString: string): string {
  let url: URL;
  try {
    const base =
      typeof window !== 'undefined' ? window.location.href : `${trimSlash(RAILWAY_PRODUCTION_API_URL)}/`;
    url = new URL(urlString, base);
  } catch {
    throw new Error('Invalid API URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid API URL scheme');
  }
  if (!isAllowedApiHostname(url.hostname)) {
    throw new Error('Disallowed API host');
  }
  if (!url.pathname.startsWith('/api/') || url.pathname.includes('..')) {
    throw new Error('Invalid API path');
  }
  return url.toString();
}

/** Numeric resource ids from Next.js dynamic routes (e.g. `[id]`). */
export function parsePortalNumericId(raw: string | string[] | undefined): string | null {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (typeof id !== 'string' || !/^\d+$/.test(id)) return null;
  return id;
}

/** Safe single path segment for whitelisted actions (e.g. change status transitions). */
export function parsePortalPathSegment(raw: string, allowed: ReadonlySet<string>): string | null {
  if (!allowed.has(raw) || !/^[a-z0-9_-]+$/i.test(raw)) return null;
  return raw;
}

/**
 * Builds an absolute API URL under the configured portal base. Path must start with `/api/`.
 */
export function buildPortalApiUrl(apiBase: string, path: string): string {
  const base = trimSlash(resolveRuntimeApiUrl(apiBase));
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!normalized.startsWith('/api/')) {
    throw new Error('Portal API path must start with /api/');
  }
  return assertPortalApiUrl(`${base}${normalized}`);
}

/**
 * Returns the API base URL the browser should use.
 * - Page on localhost: keep the built URL (local development).
 * - Built URL points to localhost but page is deployed: use the production backend.
 */
export function resolveRuntimeApiUrl(builtUrl: string | undefined): string {
  const built = trimSlash((builtUrl || '').trim() || 'http://localhost:8080');
  if (typeof window === 'undefined') return built;
  if (isLocalPageHost(window.location.hostname)) return built;
  if (!LOCAL_HOST_PATTERN.test(built)) return built;
  return RAILWAY_PRODUCTION_API_URL;
}

type PatchedWindow = Window & { __infragateApiRewrite?: boolean };

/**
 * Patches window.fetch once so requests aimed at the built API URL go to the
 * runtime API URL instead. Safe to call more than once.
 */
export type PortalFetchInit = RequestInit & {
  token?: string | null;
  timeoutMs?: number;
};

/**
 * Shared fetch wrapper: optional bearer token, timeout, allowed API hosts only.
 */
export async function portalFetch(input: string, init: PortalFetchInit = {}): Promise<Response> {
  const safeUrl = assertPortalApiUrl(input);
  const { token, timeoutMs = 30000, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token && token !== 'undefined') {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timer =
    typeof window !== 'undefined' ? window.setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    return await fetch(safeUrl, { ...rest, headers, signal: rest.signal ?? controller.signal });
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export function installApiUrlRewrite(builtUrl: string | undefined): void {
  if (typeof window === 'undefined') return;
  const win = window as PatchedWindow;
  if (win.__infragateApiRewrite) return;
  win.__infragateApiRewrite = true;

  const built = trimSlash((builtUrl || '').trim() || 'http://localhost:8080');
  const runtime = resolveRuntimeApiUrl(built);
  if (runtime === built) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (rawUrl === built || rawUrl.startsWith(`${built}/`) || rawUrl.startsWith(`${built}?`)) {
      const rewritten = `${runtime}${rawUrl.slice(built.length)}`;
      if (typeof input === 'string' || input instanceof URL) {
        return originalFetch(rewritten, init);
      }
      return originalFetch(new Request(rewritten, input), init);
    }
    return originalFetch(input, init);
  };
}
