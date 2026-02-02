import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import AppLayout from '../components/AppLayout';
import { ToastProvider } from '../context/ToastContext';
import { getStoredTheme } from '../components/NavBar';
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
