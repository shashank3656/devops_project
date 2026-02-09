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
      <div style={{ padding: '24px 0' }}>
        <h1 style={{ margin: 0, marginBottom: '8px', fontSize: '24px', fontWeight: 600 }}>IAM</h1>
        <p style={{ color: 'var(--color-text-muted, var(--text-secondary))', marginBottom: '24px', fontSize: '14px' }}>
          Identity and Access Management – manage access and permissions.
        </p>
        <div className="card" style={{ maxWidth: 560 }}>
          <p style={{ color: 'var(--color-text-muted, var(--text-secondary))', margin: 0 }}>
            IAM features can be configured here. Use the links below to navigate.
          </p>
          <div style={{ marginTop: '20px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <Link href="/home" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
              Back to Home
            </Link>
            <Link href="/create-infrastructure" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Create Infrastructure
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
