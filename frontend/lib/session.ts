export function isSignedSessionToken(raw: string): boolean {
  const token = raw.trim();
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function clearUserSession(): void {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('isAuthenticated');
  } catch (_) {}
}

export function installUserSessionGuard(): void {
  if (typeof window === 'undefined') return;
  const win = window as Window & { __userFetchPatched?: boolean };
  if (win.__userFetchPatched) return;
  const originalFetch = window.fetch.bind(window);
  win.__userFetchPatched = true;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    return originalFetch(input, init).then((response) => {
      const url = response.url || (typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      const isProtectedAPI = url.includes('/api/') && !url.includes('/api/auth/') && !url.includes('/api/public/');
      if (response.status === 401 && isProtectedAPI) {
        clearUserSession();
        if (window.location.pathname !== '/login') {
          window.location.assign('/login');
        }
      }
      return response;
    });
  };
}
