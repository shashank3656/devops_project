import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect } from 'react';
import { installApiUrlRewrite } from '@infragate/ui';
import { ADMIN_SITE_NAME } from '../lib/site';
import '../styles/globals.css';
import '../../shared-ui/tokens.css';
import '../../shared-ui/workspace.css';

const API_OVERRIDE_KEY = 'admin_api_url_override';
const BUILT_API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

// Must run before any page fetches (child effects run before this component's effects).
installApiUrlRewrite(BUILT_API_URL);

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    localStorage.setItem('infra-portal-theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');

    const win = window as Window & { __adminFetchPatched?: boolean };
    if (win.__adminFetchPatched) return;

    const originalFetch = window.fetch.bind(window);
    win.__adminFetchPatched = true;

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const override = (localStorage.getItem(API_OVERRIDE_KEY) || '').trim().replace(/\/+$/, '');
      const normalize = (u: string) => u.replace(/\/+$/, '');
      let requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      let nextInput: RequestInfo | URL = input;

      if (!override || override === BUILT_API_URL) {
        requestUrl = normalize(requestUrl);
      } else if (requestUrl && (requestUrl === BUILT_API_URL || requestUrl.startsWith(`${BUILT_API_URL}/`))) {
        const rewritten = `${override}${requestUrl.slice(BUILT_API_URL.length)}`;
        requestUrl = normalize(rewritten);
        if (typeof input === 'string' || input instanceof URL) {
          nextInput = rewritten;
        } else {
          nextInput = new Request(rewritten, input);
        }
      }

      return originalFetch(nextInput, init).then((response) => {
        const responseUrl = response.url ? normalize(response.url) : requestUrl;
        const isAdminProtectedAPI = responseUrl.includes('/api/admin/') || responseUrl.endsWith('/api/me');
        if (response.status === 401 && isAdminProtectedAPI) {
          localStorage.removeItem('admin_token');
          localStorage.removeItem('admin_user');
          if (window.location.pathname !== '/login') {
            window.location.assign('/login');
          }
        }
        return response;
      });
    };
  }, []);
  return (
    <>
      <Head>
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <link rel="manifest" href="/manifest.json" />
        <title>{ADMIN_SITE_NAME}</title>
        <meta name="application-name" content={ADMIN_SITE_NAME} />
        <meta name="theme-color" content="#0d9488" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
