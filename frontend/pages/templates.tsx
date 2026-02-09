import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTemplates = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/templates`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.templates)) {
          setTemplates(data.templates);
          setError('');
        } else {
          setTemplates([]);
          setError(data.error || 'No templates are available currently.');
        }
      })
      .catch(() => {
        setTemplates([]);
        setError('No templates are available currently.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchTemplates();
  }, [router, fetchTemplates]);

  const byCloud = templates.reduce<Record<string, RequestTemplate[]>>((acc, t) => {
    const c = (t.cloud || 'other').toLowerCase();
    if (!acc[c]) acc[c] = [];
    acc[c].push(t);
    return acc;
  }, {});
  const cloudOrder = ['aws', 'gcp', 'azure'];
  const clouds = Array.from(new Set([...cloudOrder.filter((c) => byCloud[c]?.length), ...Object.keys(byCloud).filter((c) => !cloudOrder.includes(c))]));

  return (
    <>
      <Head>
        <title>Templates - Infrastructure Portal</title>
        <meta name="description" content="Browse request templates to create infrastructure" />
      </Head>
      <div style={{ padding: '24px' }} className="container">
        <h1 style={{ margin: 0, marginBottom: '8px', fontSize: '24px', fontWeight: 600 }}>Templates</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '14px' }}>
          Use a template to pre-fill cloud, environment and service when creating infrastructure.
        </p>

        {error && (
          <div
            role="alert"
            style={{
              marginBottom: '16px',
              padding: '12px 16px',
              background: 'var(--error-bg, #fef2f2)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <span style={{ color: 'var(--error-color, #dc2626)' }}>{error}</span>
            <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={fetchTemplates}>
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
            Loading…
          </div>
        ) : !error && templates.length === 0 ? (
          <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>No templates are available currently.</p>
            <Link href="/create-infrastructure" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Create from scratch
            </Link>
          </div>
        ) : !error ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {clouds.map((cloudKey) => (
              <div key={cloudKey} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div
                  style={{
                    padding: '12px 16px',
                    background: 'var(--bg-gray-50)',
                    fontWeight: 600,
                    fontSize: '14px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {cloudKey}
                </div>
                <div style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {(byCloud[cloudKey] || []).map((t) => (
                    <div
                      key={t.id}
                      className="card"
                      style={{
                        padding: '16px',
                        minWidth: 200,
                        maxWidth: 280,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '15px' }}>{t.name}</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t.env} / {t.service}</div>
                      {t.description && (
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1 }}>{t.description}</div>
                      )}
                      <Link
                        href={`/select-service?cloud=${encodeURIComponent(t.cloud)}&env=${encodeURIComponent(t.env)}&service=${encodeURIComponent(t.service)}&template_id=${t.id}`}
                        className="btn btn-primary"
                        style={{ marginTop: '4px', textAlign: 'center', textDecoration: 'none', padding: '8px 16px' }}
                      >
                        Use this template
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
