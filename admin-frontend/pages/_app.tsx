import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect } from 'react';
import { ADMIN_SITE_NAME } from '../lib/site';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('infra-portal-theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
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
