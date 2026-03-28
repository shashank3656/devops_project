import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../../components/AdminLayout';
import { asRecord, getString } from '../../../lib/payload';
import {
  buildCloudGroups,
  formatCloudLabel,
  formatEnvironmentList,
  formatProjectScope,
  formatTeamScope,
  normalizeTemplate,
  RequestTemplate,
} from '../../../lib/requestTemplates';

export default function TemplateCloudPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const cloudParam = Array.isArray(router.query.cloud) ? router.query.cloud[0] : router.query.cloud;
  const cloudKey = typeof cloudParam === 'string' ? cloudParam.trim().toLowerCase() : '';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!router.isReady) return;
    fetchTemplates();
  }, [router, router.isReady]);

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
  const selectedCloud = cloudGroups.find((group) => group.key === cloudKey) || null;

  const handleDelete = async (template: RequestTemplate) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    setDeletingId(template.id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/templates/${template.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setTemplates((prev) => prev.filter((item) => item.id !== template.id));
      } else {
        setError(getString(data.error, 'Failed to delete'));
      }
    } catch (_) {
      setError('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const titleCloud = selectedCloud ? selectedCloud.label : formatCloudLabel(cloudKey || 'other');

  return (
    <>
      <Head>
        <title>{titleCloud} Templates - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">{titleCloud} Services</h1>
              <p className="portal-page__subtitle">
                Review the services and templates available under this cloud.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/templates" className="btn btn-secondary">
                Back to clouds
              </Link>
              <Link href="/templates/new" className="btn btn-primary">
                New template
              </Link>
            </div>
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
          ) : !selectedCloud ? (
            <div className="portal-surface">
              <div className="empty-state">No templates are available for this cloud.</div>
            </div>
          ) : (
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">{selectedCloud.label}</span>
                  <h2 className="portal-surface__title">Services and templates</h2>
                  <p className="portal-surface__subtitle">
                    {selectedCloud.services.length} services · {selectedCloud.templateCount} templates · {formatEnvironmentList(selectedCloud.environments) || 'Shared'}
                  </p>
                </div>
              </div>

              <div className="table-scroll">
                <table className="templates-table template-tree-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Environment</th>
                      <th>Team scope</th>
                      <th>Project scope</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCloud.services.map((service) => (
                      <Fragment key={service.key}>
                        <tr className="template-tree__row template-tree__row--service">
                          <td>
                            <div className="template-tree__label">{service.label}</div>
                            <div className="template-tree__meta">
                              {service.templates.length} templates · {formatEnvironmentList(service.environments) || 'Shared'}
                            </div>
                          </td>
                          <td>Service</td>
                          <td>{formatEnvironmentList(service.environments) || '—'}</td>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                          <td></td>
                        </tr>

                        {service.templates.map((template) => (
                          <tr key={template.id} className="template-tree__row template-tree__row--template">
                            <td>
                              <div className="template-tree__template-name">{template.name}</div>
                              <div className="template-tree__meta">
                                {template.description || 'Reusable request defaults for repeatable work.'}
                              </div>
                            </td>
                            <td>Template</td>
                            <td><span className="portal-pill">{template.env.toUpperCase()}</span></td>
                            <td>{formatTeamScope(template)}</td>
                            <td>{formatProjectScope(template)}</td>
                            <td><span className="portal-pill">{(template.status || 'draft').replace(/_/g, ' ')}</span></td>
                            <td>
                              <div className="template-tree__actions">
                                <Link href={`/templates/${template.id}`} className="btn btn-secondary btn-sm">
                                  View
                                </Link>
                                <Link href={`/templates/${template.id}/edit`} className="btn btn-secondary btn-sm">
                                  Edit
                                </Link>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={deletingId === template.id}
                                  onClick={() => handleDelete(template)}
                                >
                                  {deletingId === template.id ? 'Deleting...' : 'Delete'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
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
