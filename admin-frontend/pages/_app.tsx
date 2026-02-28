import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect } from 'react';
import { ADMIN_SITE_NAME } from '../lib/site';
import '../styles/globals.css';

const THEME_KEY = 'infra-portal-theme';

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
