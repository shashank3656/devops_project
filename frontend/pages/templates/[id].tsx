import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { asRecord, getString } from '../../lib/payload';

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

function getNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeTeamSummary(value: unknown): TeamSummary | null {
  const record = asRecord(value);
  const id = getNumber(record.id, 0);
  if (id <= 0) return null;
  return {
    id,
    name: getString(record.name, `Team ${id}`),
  };
}

function normalizeProjectSummary(value: unknown): ProjectSummary | null {
  const record = asRecord(value);
  const id = getNumber(record.id, 0);
  if (id <= 0) return null;
  return {
    id,
    name: getString(record.name, `Project ${id}`),
    code: getString(record.code, ''),
  };
}

function normalizeTemplate(value: unknown): RequestTemplate | null {
  const record = asRecord(value);
  const id = getNumber(record.id, 0);
  if (id <= 0) return null;
  return {
    id,
    name: getString(record.name, `Template ${id}`),
    description: getString(record.description, ''),
    cloud: getString(record.cloud, 'other'),
    env: getString(record.env, 'shared'),
    service: getString(record.service, 'service'),
    config: getString(record.config, '{}'),
    teams: Array.isArray(record.teams)
      ? record.teams.map(normalizeTeamSummary).filter((item): item is TeamSummary => Boolean(item))
      : [],
    projects: Array.isArray(record.projects)
      ? record.projects.map(normalizeProjectSummary).filter((item): item is ProjectSummary => Boolean(item))
      : [],
    visible_to_all: Boolean(record.visible_to_all),
  };
}

function parsePositiveIntParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
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
  const [template, setTemplate] = useState<RequestTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const templateId = useMemo(() => parsePositiveIntParam(router.query.id), [router.query.id]);

  const formattedConfig = useMemo(() => formatTemplateConfig(template?.config || '{}'), [template?.config]);
  const configSummary = useMemo(() => getConfigSummary(template?.config || '{}'), [template?.config]);

  const fetchTemplate = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined' || !templateId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/templates/${templateId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      const matchedTemplate = normalizeTemplate(data.template);
      if (res.ok && matchedTemplate) {
        setTemplate(matchedTemplate);
        return;
      }
      setTemplate(null);
      setError(getString(data.error, 'Template not found'));
    } catch {
      setTemplate(null);
      setError('Failed to load template. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [router, templateId]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    if (templateId) {
      void fetchTemplate();
    } else {
      setLoading(false);
      setTemplate(null);
      setError('Template not found');
    }
  }, [router, templateId, fetchTemplate]);

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
                href={`/select-service?cloud=${encodeURIComponent(template.cloud)}&env=${encodeURIComponent(template.env)}&service=${encodeURIComponent(template.service)}&template_id=${template.id}${template.projects?.length === 1 ? `&project_id=${template.projects[0].id}` : ''}`}
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
                <article className="portal-detail-card">
                  <span className="portal-kv__label">Projects</span>
                  <strong className="portal-detail-card__value">
                    {template.projects?.length ? `${template.projects.length} scoped project${template.projects.length === 1 ? '' : 's'}` : 'All assigned projects'}
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
                    <span className="portal-surface__eyebrow">Projects</span>
                    <h2 className="portal-surface__title">Project scope</h2>
                    <p className="portal-surface__subtitle">
                      Some templates are limited to specific onboarded projects and their allowed service catalogs.
                    </p>
                  </div>
                </div>
                <div className="portal-pill-row">
                  {template.projects?.length ? (
                    template.projects.map((project) => (
                      <span key={project.id} className="portal-pill">{project.name} ({project.code})</span>
                    ))
                  ) : (
                    <span className="portal-pill">All assigned projects</span>
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
