import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

const CLOUDS = [
  { id: 'aws', name: 'Amazon Web Services', short: 'AWS', color: '#FF9900', description: 'Provision AWS resources: EC2, S3, RDS, Lambda, and more with guided configuration.' },
  { id: 'azure', name: 'Microsoft Azure', short: 'Azure', color: '#0078D4', description: 'Deploy Azure resources: VMs, Storage, Databases, and services with guided inputs.' },
  { id: 'gcp', name: 'Google Cloud Platform', short: 'GCP', color: '#4285F4', description: 'Create GCP resources: Compute Engine, Cloud Storage, BigQuery, and more.' },
] as const;

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
}

interface UserSavedConfig {
  id: number;
  name: string;
  cloud: string;
  env: string;
  service: string;
  created_at: string;
}

export default function CreateInfrastructure() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<UserSavedConfig[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoadingTemplates(true);
    fetch(`${apiUrl}/api/templates`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : { templates: [] })
      .then((data) => setTemplates(data.templates || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, [apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoadingSaved(true);
    fetch(`${apiUrl}/api/me/saved-configs`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : { saved_configs: [] })
      .then((data) => setSavedConfigs(data.saved_configs || []))
      .catch(() => setSavedConfigs([]))
      .finally(() => setLoadingSaved(false));
  }, [apiUrl]);

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  return (
    <>
      <Head>
        <title>Create Infrastructure - Infrastructure Portal</title>
        <meta name="description" content="Create infrastructure resources" />
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '32px',
          }}>
            <h1 style={{
              fontSize: '36px',
              fontWeight: 'bold',
              color: 'var(--text-primary)',
              margin: 0,
            }}>
              Create Infrastructure
            </h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={() => router.push('/custom-json')}
                className="btn btn-primary"
              >
                Custom JSON
              </button>
              <Link href="/history" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                Logs
              </Link>
              <button onClick={() => router.push('/home')} className="btn btn-secondary">
                Home
              </button>
              <button onClick={handleLogout} className="btn btn-secondary">
                Logout
              </button>
            </div>
          </div>

          {templates.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
                Start from template
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                Use an admin-defined template to pre-fill cloud, environment and service.
              </p>
              {loadingTemplates ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading templates…</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '12px 20px', textAlign: 'left' }}
                      onClick={() => router.push(`/select-service?cloud=${encodeURIComponent(t.cloud)}&env=${encodeURIComponent(t.env)}&service=${encodeURIComponent(t.service)}&template_id=${t.id}`)}
                    >
                      <span style={{ fontWeight: 600 }}>{t.name}</span>
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
                        {t.cloud} / {t.env} / {t.service}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {savedConfigs.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
                My saved configurations
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                Reuse a configuration you saved from history.
              </p>
              {loadingSaved ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : (
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
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
                        {s.cloud} / {s.env} / {s.service}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ textAlign: 'center' }}>
            <p style={{
              color: 'var(--text-secondary)',
              marginBottom: '32px',
              fontSize: '16px',
            }}>
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
                    border: '2px solid var(--border-color)',
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
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{
                    height: '48px',
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '16px',
                  }}>
                    <img
                      src={`/${c.id}-logo.png`}
                      alt={c.short}
                      style={{ height: 48, width: 'auto', objectFit: 'contain' }}
                    />
                  </div>
                  <h3 style={{
                    fontSize: '20px',
                    fontWeight: '600',
                    marginBottom: '8px',
                    color: 'var(--text-primary)',
                  }}>
                    {c.name}
                  </h3>
                  <p style={{
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    margin: 0,
                  }}>
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
