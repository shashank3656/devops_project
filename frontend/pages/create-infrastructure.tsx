import { useCallback, useEffect, useState } from 'react';
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
  const [templatesError, setTemplatesError] = useState('');
  const [savedConfigsError, setSavedConfigsError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  const fetchTemplates = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoadingTemplates(true);
    setTemplatesError('');
    fetch(`${apiUrl}/api/templates`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.templates)) {
          setTemplates(data.templates);
          setTemplatesError('');
        } else {
          setTemplates([]);
          setTemplatesError(data.error || 'Failed to load templates.');
        }
      })
      .catch(() => {
        setTemplates([]);
        setTemplatesError('Failed to load templates. Check your connection.');
      })
      .finally(() => setLoadingTemplates(false));
  }, [apiUrl]);

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
          setSavedConfigsError(data.error || 'Failed to load saved configs.');
        }
      })
      .catch(() => {
        setSavedConfigs([]);
        setSavedConfigsError('Failed to load saved configs. Check your connection.');
      })
      .finally(() => setLoadingSaved(false));
  }, [apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    fetchSavedConfigs();
  }, [fetchSavedConfigs]);

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

          {(templates.length > 0 || templatesError || loadingTemplates) && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
                Start from template
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                Use a template to pre-fill cloud, environment and service (read-only).
              </p>
              {templatesError && (
                <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--error-bg, #fef2f2)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                  <span style={{ color: 'var(--error-color, #dc2626)' }}>{templatesError}</span>
                  <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={fetchTemplates}>
                    Retry
                  </button>
                </div>
              )}
              {loadingTemplates ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading templates…</p>
              ) : !templatesError && templates.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No templates are there.</p>
              ) : !templatesError ? (
                (() => {
                  const byCloud = templates.reduce<Record<string, RequestTemplate[]>>((acc, t) => {
                    const c = (t.cloud || 'other').toLowerCase();
                    if (!acc[c]) acc[c] = [];
                    acc[c].push(t);
                    return acc;
                  }, {});
                  const cloudOrder = ['aws', 'gcp', 'azure'];
                  const clouds = Array.from(new Set([...cloudOrder.filter((c) => byCloud[c]?.length), ...Object.keys(byCloud).filter((c) => !cloudOrder.includes(c))]));
                  return (
                    <div>
                      {clouds.map((cloudKey) => (
                        <div key={cloudKey} style={{ marginBottom: '20px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                            {cloudKey}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginLeft: '12px' }}>
                            {(byCloud[cloudKey] || []).map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '12px 20px', textAlign: 'left' }}
                                onClick={() => router.push(`/select-service?cloud=${encodeURIComponent(t.cloud)}&env=${encodeURIComponent(t.env)}&service=${encodeURIComponent(t.service)}&template_id=${t.id}`)}
                              >
                                <span style={{ fontWeight: 600 }}>{t.name}</span>
                                <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
                                  {t.env} / {t.service}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : null}
            </div>
          )}

          {(savedConfigs.length > 0 || savedConfigsError || loadingSaved) && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
                My saved configurations
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                Reuse a configuration you saved from history.
              </p>
              {savedConfigsError && (
                <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--error-bg, #fef2f2)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                  <span style={{ color: 'var(--error-color, #dc2626)' }}>{savedConfigsError}</span>
                  <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={fetchSavedConfigs}>
                    Retry
                  </button>
                </div>
              )}
              {loadingSaved ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : !savedConfigsError && savedConfigs.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No saved configurations.</p>
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
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
                        {s.cloud} / {s.env} / {s.service}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
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
