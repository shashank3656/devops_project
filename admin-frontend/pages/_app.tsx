import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect } from 'react';
import { ADMIN_SITE_NAME } from '../lib/site';
import '../styles/globals.css';

const API_OVERRIDE_KEY = 'admin_api_url_override';
const BUILT_API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('infra-portal-theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');

      const override = (localStorage.getItem(API_OVERRIDE_KEY) || '').trim().replace(/\/+$/, '');
      if (!override || override === BUILT_API_URL) return;

      const originalFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
        if (rawUrl && (rawUrl === BUILT_API_URL || rawUrl.startsWith(`${BUILT_API_URL}/`))) {
          const rewritten = `${override}${rawUrl.slice(BUILT_API_URL.length)}`;
          return originalFetch(rewritten, init);
        }
        return originalFetch(input, init);
      };
    }
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
