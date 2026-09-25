import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { applyTheme, installApiUrlRewrite } from '@infragate/ui';
import AppLayout from '../components/AppLayout';
import { ToastProvider } from '../context/ToastContext';
import { installUserSessionGuard } from '../lib/session';
import { SITE_NAME } from '../lib/site';
import '../styles/globals.css';
import '../../shared-ui/tokens.css';
import '../../shared-ui/workspace.css';
import '../../shared-ui/theme.css';

// Must run before any page fetches (child effects run before this component's effects).
installApiUrlRewrite(process.env.NEXT_PUBLIC_API_URL);

const AUTHED_PATHS = ['/home', '/create-infrastructure', '/templates', '/select-service', '/custom-json', '/history', '/profile', '/my-teams', '/my-projects', '/incidents', '/changes', '/scorecards', '/request-success'];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();

  useEffect(() => {
    applyTheme();
    installUserSessionGuard();
  }, []);

  const showLayout = AUTHED_PATHS.some((p) => router.pathname === p || router.pathname.startsWith(`${p}/`));

  return (
    <ToastProvider>
      <Head>
        <title>{SITE_NAME}</title>
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="application-name" content={SITE_NAME} />
        <meta name="theme-color" content="#0d9488" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
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
