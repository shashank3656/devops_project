import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';
import { asRecord, getString } from '../../lib/payload';
import { buildCloudGroups, formatEnvironmentList, normalizeTemplate, RequestTemplate } from '../../lib/requestTemplates';

export default function TemplatesList() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setTemplates(
          Array.isArray(data.templates)
            ? data.templates.map(normalizeTemplate).filter((item): item is RequestTemplate => Boolean(item))
            : [],
        );
        setError('');
      } else {
        setTemplates([]);
        setError(getString(data.error, 'Failed to load templates'));
      }
    } catch (_) {
      setTemplates([]);
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const cloudGroups = useMemo(() => buildCloudGroups(templates), [templates]);

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
                Pick a cloud first, then open its service library and templates on a dedicated page.
              </p>
            </div>
            <Link href="/templates/new" className="btn btn-primary">
              New template
            </Link>
          </div>

          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="portal-surface">
              <div className="empty-state">Loading templates...</div>
            </div>
          ) : templates.length === 0 ? (
            <div className="portal-surface">
              <div className="empty-state">No templates exist yet.</div>
            </div>
          ) : (
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Template library</span>
                  <h2 className="portal-surface__title">Cloud list</h2>
                  <p className="portal-surface__subtitle">
                    Open a cloud to view the services and templates available inside it.
                  </p>
                </div>
              </div>

              <div className="table-scroll">
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Cloud</th>
                      <th>Services</th>
                      <th>Templates</th>
                      <th>Environments</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cloudGroups.map((cloud) => (
                      <tr key={cloud.key}>
                        <td>
                          <div className="template-tree__template-name">{cloud.label}</div>
                          <div className="template-tree__meta">Open this cloud to browse its services and templates.</div>
                        </td>
                        <td>{cloud.services.length}</td>
                        <td>{cloud.templateCount}</td>
                        <td>{formatEnvironmentList(cloud.environments) || '—'}</td>
                        <td>
                          <Link href={`/templates/cloud/${cloud.key}`} className="btn btn-secondary btn-sm">
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
