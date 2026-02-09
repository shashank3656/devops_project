import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

const CLOUDS = [
  { id: 'aws', name: 'Amazon Web Services', short: 'AWS', color: '#FF9900', description: 'Provision AWS resources: EC2, S3, RDS, Lambda, and more with guided configuration.' },
  { id: 'azure', name: 'Microsoft Azure', short: 'Azure', color: '#0078D4', description: 'Deploy Azure resources: VMs, Storage, Databases, and services with guided inputs.' },
  { id: 'gcp', name: 'Google Cloud Platform', short: 'GCP', color: '#4285F4', description: 'Create GCP resources: Compute Engine, Cloud Storage, BigQuery, and more.' },
] as const;

interface UserSavedConfig {
  id: number;
  name: string;
  cloud: string;
  env: string;
  service: string;
  created_at: string;
}

export default function CreateInfrastructureNew() {
  const router = useRouter();
  const [savedConfigs, setSavedConfigs] = useState<UserSavedConfig[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedConfigsError, setSavedConfigsError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  const fetchSavedConfigs = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoadingSaved(true);
    setSavedConfigsError('');
    fetch(`${apiUrl}/api/me/saved-configs`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.saved_configs)) {
          setSavedConfigs(data.saved_configs);
          setSavedConfigsError('');
        } else {
          setSavedConfigs([]);
          setSavedConfigsError('');
        }
      })
      .catch(() => {
        setSavedConfigs([]);
        setSavedConfigsError('');
      })
      .finally(() => setLoadingSaved(false));
  }, [apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    fetchSavedConfigs();
  }, [fetchSavedConfigs]);

  return (
    <>
      <Head>
        <title>Create Infrastructure - InfraGate</title>
        <meta name="description" content="Create infrastructure resources" />
      </Head>
      <div style={{ padding: '40px 20px' }}>
        <div className="container">
          <Link
            href="/create-infrastructure"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24, textDecoration: 'none' }}
          >
            ← Back to New Request
          </Link>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
              Create Infrastructure
            </h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
              <Link href="/custom-json" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Custom JSON
              </Link>
              <Link href="/history" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                Logs
              </Link>
              <Link href="/home" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                Home
              </Link>
            </div>
          </div>

          {(savedConfigs.length > 0 || savedConfigsError || loadingSaved) && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: 'var(--color-text)' }}>
                My saved configurations
              </h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '16px' }}>
                Reuse a configuration you saved from history.
              </p>
              {loadingSaved ? (
                <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
              ) : !savedConfigsError && savedConfigs.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)' }}>No saved configurations available.</p>
              ) : !savedConfigsError ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {savedConfigs.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '12px 20px', textAlign: 'left' }}
                      onClick={() => router.push(`/select-service?cloud=${encodeURIComponent(s.cloud)}&env=${encodeURIComponent(s.env)}&service=${encodeURIComponent(s.service)}&saved_id=${s.id}`)}
                    >
                      <span style={{ fontWeight: 600 }}>{s.name}</span>
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginTop: 4 }}>
                        {s.cloud} / {s.env} / {s.service}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          <div className="card" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px', fontSize: '16px' }}>
              Choose how you want to create your infrastructure resources
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '24px',
              maxWidth: '960px',
              margin: '0 auto',
            }}>
              {CLOUDS.map((c) => (
                <div
                  key={c.id}
                  onClick={() => router.push(`/select-service?cloud=${c.id}`)}
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
      </div>
    </>
  );
}
