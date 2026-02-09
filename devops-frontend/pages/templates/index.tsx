import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
  config: string;
  created_at: string;
  created_by: number | null;
}

export default function DevOpsTemplatesList() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchTemplates();
  }, [router]);

  const fetchTemplates = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/templates`, {
        headers: { Authorization: `Bearer ${localStorage.getItem(DEVOPS_TOKEN_KEY)}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTemplates(Array.isArray(data.templates) ? data.templates : []);
        setError('');
      } else {
        setTemplates([]);
        setError('');
      }
    } catch (_) {
      setTemplates([]);
      setError('');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (t: RequestTemplate) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    setDeletingId(t.id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/templates/${t.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem(DEVOPS_TOKEN_KEY)}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      } else {
        setError(data.error || 'Failed to delete');
      }
    } catch (_) {
      setError('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

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
        <title>Templates - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600 }}>Request templates</h1>
            <Link href="/templates/new" className="btn btn-primary" style={{ padding: '10px 20px', textDecoration: 'none' }}>
              New template
            </Link>
          </div>
          {error && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <span>{error}</span>
              <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={() => { setError(''); fetchTemplates(); }}>
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
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>No templates are available currently. Create one to get started.</p>
              <Link href="/templates/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Create first template
              </Link>
            </div>
          ) : !error ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {clouds.map((cloudKey) => (
                <div key={cloudKey} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ padding: '12px 16px', background: 'var(--bg-gray-50)', fontWeight: 600, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {cloudKey}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-gray-50)' }}>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px' }}>Name</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px' }}>Env</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px' }}>Service</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px' }}>Description</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, fontSize: '13px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(byCloud[cloudKey] || []).map((t) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 16px' }}>{t.name}</td>
                          <td style={{ padding: '12px 16px' }}>{t.env}</td>
                          <td style={{ padding: '12px 16px' }}>{t.service}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', maxWidth: 240 }}>{t.description || '—'}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <Link href={`/templates/${t.id}/edit`} className="btn btn-secondary" style={{ marginRight: 8, padding: '6px 12px', textDecoration: 'none' }}>
                              Edit
                            </Link>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '6px 12px' }}
                              disabled={deletingId === t.id}
                              onClick={() => handleDelete(t)}
                            >
                              {deletingId === t.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
