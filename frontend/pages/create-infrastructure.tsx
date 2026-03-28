import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect } from 'react';

export default function NewRequestLanding() {
  const router = useRouter();

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  return (
    <>
      <Head>
        <title>New Request - SetuOps</title>
        <meta name="description" content="Choose how to start a new request" />
      </Head>
      <div style={{ padding: '40px 20px', minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '8px', textAlign: 'center' }}>
            How would you like to start?
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '16px', marginBottom: '40px', textAlign: 'center' }}>
            Pick the request path that best matches the work you need.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '24px',
          }}>
            <Link
              href="/create-infrastructure/iam"
              className="card card-interactive"
              style={{
                padding: '40px 32px',
                border: '2px solid var(--color-border)',
                margin: 0,
                cursor: 'pointer',
                textAlign: 'center',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(37, 99, 235, 0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ fontSize: '48px', marginBottom: '16px', lineHeight: 1 }}>🔐</div>
              <h2 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text)' }}>
                Access (IAM)
              </h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', margin: 0 }}>
                Request identity and access changes for a cloud account.
              </p>
            </Link>
            <Link
              href="/create-infrastructure/new"
              className="card card-interactive"
              style={{
                padding: '40px 32px',
                border: '2px solid var(--color-border)',
                margin: 0,
                cursor: 'pointer',
                textAlign: 'center',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(37, 99, 235, 0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ fontSize: '48px', marginBottom: '16px', lineHeight: 1 }}>☁️</div>
              <h2 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text)' }}>
                Cloud Infrastructure
              </h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', margin: 0 }}>
                Request cloud resources, reuse templates, or start from a project.
              </p>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
