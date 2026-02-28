import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import AppLayout from '../components/AppLayout';
import { ToastProvider } from '../context/ToastContext';
import { getStoredTheme } from '../components/AppLayout';
import { SITE_NAME } from '../lib/site';
import '../styles/globals.css';

const AUTHED_PATHS = ['/home', '/create-infrastructure', '/templates', '/select-service', '/custom-json', '/history', '/profile', '/my-teams', '/request-success', '/notifications', '/sql-editor'];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();

  useEffect(() => {
    const theme = getStoredTheme();
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  const showLayout = AUTHED_PATHS.some((p) => router.pathname === p || router.pathname.startsWith(p + '/'));

  return (
    <ToastProvider>
      <Head>
        <title>{SITE_NAME}</title>
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="application-name" content={SITE_NAME} />
        <meta name="theme-color" content="#0d9488" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      {showLayout ? (
        <AppLayout>
          <Component {...pageProps} />
        </AppLayout>
      ) : (
        <Component {...pageProps} />
      )}
    </ToastProvider>
  );
}
