import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

export default function IAMPage() {
  const router = useRouter();

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
  }, [router]);

  return (
    <>
      <Head>
        <title>IAM - InfraGate</title>
        <meta name="description" content="Identity and Access Management" />
      </Head>
      <div>
        <h1 className="page-title" style={{ marginBottom: 8 }}>IAM</h1>
        <p style={{ color: 'var(--color-text-muted, var(--text-secondary))', marginBottom: 24 }}>
          Identity and Access Management
        </p>
        <div className="card">
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>
            IAM services and settings will be available here.
          </p>
          <Link href="/home" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
            Back to Home
          </Link>
        </div>
      </div>
    </>
  );
}
