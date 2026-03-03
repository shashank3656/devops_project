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
  status?: string;
  created_at: string;
  created_by: number | null;
  teams?: TeamSummary[];
  projects?: ProjectSummary[];
  visible_to_all?: boolean;
}

interface TeamSummary {
  id: number;
  name: string;
}

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
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
        setError('');
      } else {
        setTemplates([]);
        setError(data?.error || 'Failed to load templates');
      }
    } catch (_) {
      setTemplates([]);
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (template: RequestTemplate) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    setDeletingId(template.id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/templates/${template.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTemplates((prev) => prev.filter((x) => x.id !== template.id));
      } else {
        setError(data.error || 'Failed to delete');
      }
    } catch (_) {
      setError('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const byCloud = templates.reduce<Record<string, RequestTemplate[]>>((acc, template) => {
    const cloud = (template.cloud || 'other').toLowerCase();
    if (!acc[cloud]) acc[cloud] = [];
    acc[cloud].push(template);
    return acc;
  }, {});

  const cloudOrder = ['aws', 'gcp', 'azure'];
  const clouds = Array.from(
    new Set([
      ...cloudOrder.filter((cloud) => byCloud[cloud]?.length),
      ...Object.keys(byCloud).filter((cloud) => !cloudOrder.includes(cloud)),
    ]),
  );

  return (
    <>
      <Head>
        <title>Templates - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">Template Management</h1>
              <p className="portal-page__subtitle">
                Shape reusable request patterns by cloud, update weak templates, and retire the ones that should not be reused.
              </p>
            </div>
            <Link href="/templates/new" className="btn btn-primary">
              New template
            </Link>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="portal-surface">
              <div className="empty-state">Loading templates...</div>
            </div>
          ) : templates.length === 0 ? (
            <div className="portal-surface">
              <div className="empty-state">
                No templates exist yet.
              </div>
            </div>
          ) : (
            clouds.map((cloud) => (
              <section key={cloud} className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">{cloud.toUpperCase()}</span>
                    <h2 className="portal-surface__title">{cloud.toUpperCase()} template set</h2>
                  </div>
                </div>

                <div className="portal-template-grid">
                  {(byCloud[cloud] || []).map((template) => (
                    <article key={template.id} className="portal-template-card">
                      <div className="portal-template-card__top">
                        <div>
                          <h3 className="portal-template-card__name">{template.name}</h3>
                          <p className="portal-template-card__description">
                            {template.description || 'Template for repeatable infrastructure request creation.'}
                          </p>
                        </div>
                      </div>
                      <div className="portal-template-card__meta">
                        <span className="portal-pill">{template.env}</span>
                        <span className="portal-pill">{template.service}</span>
                        <span className="portal-pill">{(template.status || 'draft').replace('_', ' ')}</span>
                        <span className="portal-pill">
                          {template.visible_to_all || !template.teams?.length
                            ? 'All portal teams'
                            : `${template.teams.length} portal team${template.teams.length === 1 ? '' : 's'}`}
                        </span>
                        <span className="portal-pill">
                          {template.projects?.length
                            ? `${template.projects.length} project${template.projects.length === 1 ? '' : 's'}`
                            : 'All projects'}
                        </span>
                      </div>
                      <div className="portal-template-card__actions">
                        <Link href={`/templates/${template.id}`} className="btn btn-secondary btn-sm">
                          View
                        </Link>
                        <Link href={`/templates/${template.id}/edit`} className="btn btn-secondary btn-sm">
                          Edit
                        </Link>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={deletingId === template.id} onClick={() => handleDelete(template)}>
                          {deletingId === template.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </AdminLayout>
    </>
  );
}
