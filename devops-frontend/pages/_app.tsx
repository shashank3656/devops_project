import type { AppProps } from 'next/app';
import Head from 'next/head';
import { ApiUrlProvider } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ApiUrlProvider>
      <>
        <Head>
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <link rel="manifest" href="/manifest.json" />
        <title>{DEVOPS_SITE_NAME}</title>
        <meta name="application-name" content={DEVOPS_SITE_NAME} />
        <meta name="theme-color" content="#6366f1" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <Component {...pageProps} />
      </>
    </ApiUrlProvider>
  );
}
