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

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isLocalPageHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
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
