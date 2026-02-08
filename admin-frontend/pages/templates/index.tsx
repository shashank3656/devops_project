import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

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

export default function TemplatesList() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
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
      const res = await fetch(`${apiUrl}/api/admin/templates`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTemplates(Array.isArray(data.templates) ? data.templates : []);
      } else {
        setError(data.error || 'Failed to load templates');
      }
    } catch (_) {
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (t: RequestTemplate) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    setDeletingId(t.id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/templates/${t.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
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

  return (
    <>
      <Head>
        <title>Templates - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
            <h1 style={{ margin: 0 }}>Request templates</h1>
            <Link href="/templates/new" className="btn btn-primary">
              New template
            </Link>
          </div>
          {error && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: '16px' }}>
              {error}
            </div>
          )}
          {loading ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
              Loading…
            </div>
          ) : templates.length === 0 ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>No templates yet.</p>
              <Link href="/templates/new" className="btn btn-primary">
                Create first template
              </Link>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', background: 'var(--bg-gray-50)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Name</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Cloud</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Env</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Service</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Description</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px 16px' }}>{t.name}</td>
                      <td style={{ padding: '12px 16px' }}>{t.cloud}</td>
                      <td style={{ padding: '12px 16px' }}>{t.env}</td>
                      <td style={{ padding: '12px 16px' }}>{t.service}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', maxWidth: 240 }}>{t.description || '—'}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <Link href={`/templates/${t.id}/edit`} className="btn btn-secondary" style={{ marginRight: 8, padding: '6px 12px' }}>
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
          )}
        </div>
      </AdminLayout>
    </>
  );
}
