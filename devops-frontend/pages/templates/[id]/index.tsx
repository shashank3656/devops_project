import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
  config: string;
  created_at?: string;
}

function formatTemplateConfig(config: string): string {
  const normalized = config?.trim();
  if (!normalized) return '{}';
  try {
    return JSON.stringify(JSON.parse(normalized), null, 2);
  } catch {
    return normalized;
  }
}

function getConfigSummary(config: string): string {
  const normalized = config?.trim();
  if (!normalized) return 'No JSON defaults configured.';
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (Array.isArray(parsed)) {
      return `${parsed.length} array value(s) preset in the template.`;
    }
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed as Record<string, unknown>);
      if (keys.length === 0) return 'No JSON defaults configured.';
      return `${keys.length} default field(s) preset for new requests.`;
    }
  } catch {
    return 'Raw JSON config saved with the template.';
  }
  return 'Template defaults ready for reuse.';
}

export default function ViewDevOpsTemplate() {
  const router = useRouter();
  const { id } = router.query;
  const apiUrl = useApiUrl();
  const [template, setTemplate] = useState<RequestTemplate | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const formattedConfig = useMemo(() => formatTemplateConfig(template?.config || '{}'), [template?.config]);
  const configSummary = useMemo(() => getConfigSummary(template?.config || '{}'), [template?.config]);

  const fetchTemplate = useCallback(async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined' || typeof id !== 'string' || !id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/templates/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.template) {
        setTemplate(data.template as RequestTemplate);
        return;
      }
      setTemplate(null);
      setError(data.error || 'Template not found');
    } catch {
      setTemplate(null);
      setError('Failed to load template. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [id, router, apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    if (typeof id === 'string' && id) void fetchTemplate();
  }, [id, router, fetchTemplate]);

  return (
    <>
      <Head>
        <title>View template - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page portal-page--narrow">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Templates</span>
              <h1 className="portal-page__title">View Template</h1>
              <p className="portal-page__subtitle">
                Review request defaults before editing or reusing this template in the DevOps catalog.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/templates" className="btn btn-secondary">
                Back to templates
              </Link>
              {template && (
                <Link href={`/templates/${template.id}/edit`} className="btn btn-primary">
                  Edit template
                </Link>
              )}
            </div>
          </header>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>Loading template...</p>
              </div>
            </section>
          ) : template ? (
            <>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Template details</span>
                    <h2 className="portal-surface__title">{template.name}</h2>
                    <p className="portal-surface__subtitle">
                      {template.description || 'Reusable template for repeatable infrastructure requests.'}
                    </p>
                  </div>
                  <div className="portal-pill-row">
                    <span className="portal-pill">ID {template.id}</span>
                    <span className="portal-pill">{template.cloud}</span>
                    {template.created_at && (
                      <span className="portal-pill">Created {new Date(template.created_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                <div className="portal-detail-grid">
                  <article className="portal-detail-card">
                    <span className="portal-kv__label">Cloud</span>
                    <strong className="portal-detail-card__value">{template.cloud.toUpperCase()}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="portal-kv__label">Environment</span>
                    <strong className="portal-detail-card__value">{template.env}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="portal-kv__label">Service</span>
                    <strong className="portal-detail-card__value">{template.service}</strong>
                  </article>
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Config</span>
                    <h2 className="portal-surface__title">Default request payload</h2>
                    <p className="portal-surface__subtitle">{configSummary}</p>
                  </div>
                </div>
                <pre className="portal-code-block">{formattedConfig}</pre>
              </section>
            </>
          ) : (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>Template details are unavailable.</p>
              </div>
            </section>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
