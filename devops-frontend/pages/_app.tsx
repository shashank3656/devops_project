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
        <title>{DEVOPS_SITE_NAME}</title>
        <meta name="application-name" content={DEVOPS_SITE_NAME} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <Component {...pageProps} />
      </>
    </ApiUrlProvider>
  );
}
