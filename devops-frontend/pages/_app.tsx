import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect } from 'react';
import { applyTheme, ConfirmProvider, installApiUrlRewrite, PortalErrorBoundary } from '@infragate/ui';
import { ApiUrlProvider } from '../context/ApiUrlContext';
import { purgeUnsignedDevopsSession } from '../lib/session';
import { DEVOPS_SITE_NAME } from '../lib/site';
import '../styles/globals.css';
import '../../shared-ui/tokens.css';
import '../../shared-ui/workspace.css';
import '../../shared-ui/theme.css';

// Must run before any page fetches (child effects run before this component's effects).
installApiUrlRewrite(process.env.NEXT_PUBLIC_API_URL);
purgeUnsignedDevopsSession();

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    applyTheme();
  }, []);
  return (
    <ApiUrlProvider>
      <Head>
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <link rel="manifest" href="/manifest.json" />
        <title>{DEVOPS_SITE_NAME}</title>
        <meta name="application-name" content={DEVOPS_SITE_NAME} />
        <meta name="theme-color" content="#0d9488" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
      </Head>
      <ConfirmProvider>
        <PortalErrorBoundary>
          <Component {...pageProps} />
        </PortalErrorBoundary>
      </ConfirmProvider>
    </ApiUrlProvider>
  );
}
