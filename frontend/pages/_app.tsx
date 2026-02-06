import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import AppLayout from '../components/AppLayout';
import { ToastProvider } from '../context/ToastContext';
import { getStoredTheme } from '../components/NavBar';
import { SITE_NAME } from '../lib/site';
import '../styles/globals.css';

const AUTHED_PATHS = ['/home', '/create-infrastructure', '/select-service', '/custom-json', '/history', '/profile'];

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
        <meta name="application-name" content={SITE_NAME} />
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
