import { useCallback, useEffect, useMemo, useState } from 'react';
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
  config: string;
  teams?: TeamSummary[];
  visible_to_all?: boolean;
}

interface TeamSummary {
  id: number;
  name: string;
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
      return `${parsed.length} array value(s) preset in the request payload.`;
    }
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed as Record<string, unknown>);
      if (keys.length === 0) return 'No JSON defaults configured.';
      return `${keys.length} default field(s) preset for request creation.`;
    }
  } catch {
    return 'Raw JSON config saved with the template.';
  }
  return 'Template defaults ready for reuse.';
}

export default function TemplateDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [template, setTemplate] = useState<RequestTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const formattedConfig = useMemo(() => formatTemplateConfig(template?.config || '{}'), [template?.config]);
  const configSummary = useMemo(() => getConfigSummary(template?.config || '{}'), [template?.config]);

  const fetchTemplate = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined' || typeof id !== 'string' || !id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/templates/${id}`, {
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
      setError(data?.error || 'Template not found');
    } catch {
      setTemplate(null);
      setError('Failed to load template. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    if (typeof id === 'string' && id) {
      void fetchTemplate();
    }
  }, [id, router, fetchTemplate]);

  return (
    <>
      <Head>
        <title>View template - Infrastructure Portal</title>
      </Head>

      <div className="portal-page portal-page--narrow">
        <header className="portal-page__header">
          <div className="portal-page__header-main">
            <span className="portal-page__eyebrow">Templates</span>
            <h1 className="portal-page__title">View Template</h1>
            <p className="portal-page__subtitle">
              Review template defaults before launching a new infrastructure request.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/templates" className="btn btn-secondary">
              Back to templates
            </Link>
            {template && (
              <Link
                href={`/select-service?cloud=${encodeURIComponent(template.cloud)}&env=${encodeURIComponent(template.env)}&service=${encodeURIComponent(template.service)}&template_id=${template.id}`}
                className="btn btn-primary"
              >
                Use template
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
            <div className="empty-state">Loading template...</div>
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
                <article className="portal-detail-card">
                  <span className="portal-kv__label">Availability</span>
                  <strong className="portal-detail-card__value">
                    {template.visible_to_all || !template.teams?.length ? 'All portal teams' : `${template.teams.length} team${template.teams.length === 1 ? '' : 's'} assigned`}
                  </strong>
                </article>
              </div>
            </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Availability</span>
                    <h2 className="portal-surface__title">Team scope</h2>
                    <p className="portal-surface__subtitle">
                      This template is visible based on your portal team membership.
                    </p>
                  </div>
                </div>
                <div className="portal-pill-row">
                  {template.visible_to_all || !template.teams?.length ? (
                    <span className="portal-pill">All portal teams</span>
                  ) : (
                    template.teams.map((team) => (
                      <span key={team.id} className="portal-pill">{team.name}</span>
                    ))
                  )}
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
            <div className="empty-state">Template details are unavailable.</div>
          </section>
        )}
      </div>
    </>
  );
}
