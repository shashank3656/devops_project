import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';

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

function getCloudBadgeClass(cloud: string): string {
  const normalized = (cloud || '').toLowerCase();
  if (normalized === 'aws' || normalized === 'gcp' || normalized === 'azure') {
    return `devops-ticket-cloud devops-ticket-cloud--${normalized}`;
  }
  return 'portal-badge portal-badge--neutral';
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
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    void fetchTemplates();
  }, [router]);

  const fetchTemplates = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
      if (!token || token === 'undefined') {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${apiUrl}/api/devops/templates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setTemplates(Array.isArray(data.templates) ? (data.templates as RequestTemplate[]) : []);
      } else {
        setTemplates([]);
        setError(getString(data.error, 'Failed to load templates'));
      }
    } catch {
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
      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
      if (!token || token === 'undefined') {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${apiUrl}/api/devops/templates/${template.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setTemplates((previous) => previous.filter((item) => item.id !== template.id));
      } else {
        setError(getString(data.error, 'Failed to delete template'));
      }
    } catch {
      setError('Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  };

  const byCloud = useMemo(() => {
    return templates.reduce<Record<string, RequestTemplate[]>>((accumulator, template) => {
      const cloud = (template.cloud || 'other').toLowerCase();
      if (!accumulator[cloud]) accumulator[cloud] = [];
      accumulator[cloud].push(template);
      return accumulator;
    }, {});
  }, [templates]);

  const cloudOrder = ['aws', 'gcp', 'azure'];
  const clouds = useMemo(() => {
    const discovered = Object.keys(byCloud).filter((cloud) => !cloudOrder.includes(cloud));
    return [...cloudOrder.filter((cloud) => byCloud[cloud]?.length), ...discovered];
  }, [byCloud]);

  return (
    <>
      <Head>
        <title>Templates - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">Template Management</h1>
              <p className="portal-page__subtitle">
                Keep the existing template features, but present them as a cleaner design system for fast editing, review, and creation.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/templates/new" className="btn btn-primary">
                New template
              </Link>
            </div>
          </header>

          <section className="portal-stat-grid">
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Templates</span>
              <strong className="portal-stat-card__value">{templates.length}</strong>
              <p className="portal-stat-card__copy">Reusable request entry points across the DevOps workflow.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Cloud groups</span>
              <strong className="portal-stat-card__value">{clouds.length}</strong>
              <p className="portal-stat-card__copy">Cloud-specific template collections currently available.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Most common</span>
              <strong className="portal-stat-card__value">{clouds[0]?.toUpperCase() || 'None'}</strong>
              <p className="portal-stat-card__copy">Top cloud grouping based on the current template inventory.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Catalog state</span>
              <strong className="portal-stat-card__value">{loading ? 'Syncing' : 'Live'}</strong>
              <p className="portal-stat-card__copy">Template CRUD remains unchanged while the UI layer is refreshed.</p>
            </article>
          </section>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>Loading templates...</p>
              </div>
            </section>
          ) : templates.length === 0 ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>No templates are available currently. Create one to get started.</p>
              </div>
              <div className="portal-form-actions" style={{ justifyContent: 'center' }}>
                <Link href="/templates/new" className="btn btn-primary">
                  Create first template
                </Link>
              </div>
            </section>
          ) : (
            clouds.map((cloud) => (
              <section key={cloud} className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Cloud collection</span>
                    <h2 className="portal-surface__title">{cloud.toUpperCase()}</h2>
                    <p className="portal-surface__subtitle">
                      Existing request template functionality grouped into a cleaner browsing pattern.
                    </p>
                  </div>
                  <span className="portal-badge portal-badge--neutral">{byCloud[cloud].length} templates</span>
                </div>

                <div className="portal-template-grid">
                  {byCloud[cloud].map((template) => (
                    <article key={template.id} className="portal-template-card">
                      <div className="portal-template-card__top">
                        <div>
                          <h3 className="portal-template-card__name">{template.name}</h3>
                          <p className="portal-template-card__description">
                            {template.description || 'No description provided for this template yet.'}
                          </p>
                        </div>
                        <span className={getCloudBadgeClass(template.cloud)}>{template.cloud}</span>
                      </div>

                      <div className="portal-template-card__meta">
                        <span className="portal-pill">{template.env}</span>
                        <span className="portal-pill">{template.service}</span>
                        <span className="portal-pill">{template.config ? 'JSON config' : 'No config'}</span>
                      </div>

                      <div className="portal-template-card__actions">
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
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
