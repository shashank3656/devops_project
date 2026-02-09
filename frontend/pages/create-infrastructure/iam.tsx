import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect } from 'react';

const CLOUDS = [
  { id: 'aws', name: 'Amazon Web Services', short: 'AWS', color: '#FF9900', description: 'Manage IAM users, roles, and policies on AWS.' },
  { id: 'azure', name: 'Microsoft Azure', short: 'Azure', color: '#0078D4', description: 'Manage Azure Active Directory and access control.' },
  { id: 'gcp', name: 'Google Cloud Platform', short: 'GCP', color: '#4285F4', description: 'Manage IAM and service accounts on GCP.' },
] as const;

export default function IAMCloudSelect() {
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
        <title>IAM - Select Cloud - InfraGate</title>
        <meta name="description" content="Select a cloud for IAM" />
      </Head>
      <div style={{ padding: '40px 20px' }}>
        <div className="container">
          <Link
            href="/create-infrastructure"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24, textDecoration: 'none' }}
          >
            ← Back to New Request
          </Link>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '8px' }}>
            Cloud Service
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '16px', marginBottom: '32px' }}>
            Select a cloud to manage IAM (Identity and Access Management)
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '24px',
            maxWidth: '960px',
          }}>
            {CLOUDS.map((c) => (
              <div
                key={c.id}
                onClick={() => router.push(`/select-service?cloud=${c.id}&type=iam`)}
                className="card card-interactive"
                style={{
                  padding: '32px 24px',
                  border: '2px solid var(--color-border)',
                  margin: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = c.color;
                  e.currentTarget.style.boxShadow = `0 4px 12px ${c.color}20`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ height: '48px', display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                  <img
                    src={`/${c.id}-logo.png`}
                    alt={c.short}
                    style={{ height: 48, width: 'auto', objectFit: 'contain' }}
                  />
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text)' }}>
                  {c.name}
                </h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
                  {c.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
