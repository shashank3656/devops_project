import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';

export const ADMIN_SITE_NAME = 'InfraGate Admin';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <title>{ADMIN_SITE_NAME}</title>
        <meta name="application-name" content={ADMIN_SITE_NAME} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
