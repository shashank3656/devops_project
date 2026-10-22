import Link from 'next/link';
import { formatOperationalTime } from './time';
import { useEffect, useMemo, useState } from 'react';
import { buildPortalApiUrl, portalFetch } from './apiRuntime';
import type { GuardedIncidentBrief } from './guardedActions';
import type { DeliveryVisibility } from './types';

export type ResourceContextKind = 'ticket' | 'change' | 'cloud_resource';

export type ResourceContextPayload = {
  kind: ResourceContextKind;
  project_id?: number;
  project_name?: string;
  environment?: string;
  target_environment?: string;
  delivery?: DeliveryVisibility;
  environment_catalog?: {
    project_id: number;
    project_name: string;
    name: string;
    env_type?: string;
    cloud_account_label?: string;
    default_region?: string;
    default_cluster?: string;
    frozen?: boolean;
    freeze_reason?: string;
    freeze_ends_at?: string;
  };
  account_context?: {
    onboarded_account_id?: number;
    account_status?: string;
    message?: string;
  };
  freeze?: { active: boolean; reason?: string; ends_at?: string };
  open_incidents?: GuardedIncidentBrief[];
  guarded_hints?: { block_summary?: string; warnings?: string[] };
  operator_activity?: Array<{
    id: number;
    action: string;
    result?: string;
    summary?: string;
    actor_username?: string;
    created_at: string;
  }>;
  partial_errors?: Record<string, string>;
};

function incidentsHref(projectId?: number, environment?: string) {
  const params = new URLSearchParams();
  if (projectId && projectId > 0) params.set('project_id', String(projectId));
  if (environment?.trim()) params.set('environment', environment.trim());
  const qs = params.toString();
  return qs ? `/incidents?${qs}` : '/incidents';
}

function environmentsHref(projectId?: number, environment?: string) {
  const params = new URLSearchParams();
  if (projectId && projectId > 0) params.set('project_id', String(projectId));
  if (environment?.trim()) params.set('environment', environment.trim());
  const qs = params.toString();
  return qs ? `/environments?${qs}` : '/environments';
}

function normalizeResourceContextId(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

function LoadingSkeleton() {
  return (
    <div className="resource-context-panel resource-context-panel--loading" aria-busy="true" aria-label="Loading resource context">
      <div className="ig-skeleton ig-skeleton--line" style={{ height: 14, width: '40%' }} />
      <div className="ig-skeleton ig-skeleton--line" style={{ height: 12, marginTop: 10 }} />
      <div className="ig-skeleton ig-skeleton--line" style={{ height: 12, marginTop: 8, width: '85%' }} />
      <div className="ig-skeleton ig-skeleton--line" style={{ height: 12, marginTop: 8, width: '70%' }} />
    </div>
  );
}

export default function ResourceContextPanel({
  apiUrl,
  token,
  kind,
  resourceId,
  hideDelivery = false,
  className,
}: {
  apiUrl: string;
  token: string | null;
  kind: ResourceContextKind;
  /** Numeric id or digits-only string (e.g. from `parsePortalNumericId`). */
  resourceId: number | string | null | undefined;
  /** When parent already renders DeliveryVisibilityCard (tickets / CHGs). */
  hideDelivery?: boolean;
  className?: string;
}) {
  const numericId = normalizeResourceContextId(resourceId);
  const [data, setData] = useState<ResourceContextPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    if (!token || !numericId) {
      setData(null);
      setFetchError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError('');
    const params = new URLSearchParams({ kind, id: String(numericId) });
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/resource-context?${params.toString()}`), { token })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setData(null);
          setFetchError(typeof body?.error === 'string' ? body.error : 'Resource context unavailable');
          return;
        }
        setData((body.context as ResourceContextPayload) || null);
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setFetchError('Resource context unavailable');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, token, kind, numericId]);

  const incidents = data?.open_incidents || [];
  const activity = data?.operator_activity || [];
  const partial = data?.partial_errors || {};
  const envCatalog = data?.environment_catalog;
  const freeze = data?.freeze;
  const hints = data?.guarded_hints;

  const titleEnv = useMemo(() => {
    if (data?.target_environment?.trim()) {
      return `${data.environment || 'env'} → ${data.target_environment}`;
    }
    return data?.environment || '';
  }, [data]);

  if (!numericId || !token) return null;

  const hasSignal = Boolean(
    data?.account_context?.message ||
    envCatalog ||
    freeze?.active ||
    incidents.length ||
    partial.open_incidents ||
    partial.environment_catalog ||
    partial.operator_activity ||
    hints?.block_summary ||
    (hints?.warnings?.length ?? 0) > 0 ||
    activity.length ||
    (!hideDelivery && data?.delivery),
  );
  if (loading || !hasSignal) return null;

  return (
    <section
      className={`portal-surface portal-surface--tight resource-context-panel ${className || ''}`.trim()}
      aria-label="Resource context"
    >
      <div className="portal-surface__header">
        <div>
          <span className="portal-surface__eyebrow">Operator context</span>
          <h3 className="portal-surface__title">Resource context</h3>
          {titleEnv ? <p className="portal-surface__subtitle">{titleEnv}</p> : null}
        </div>
        <Link
          href={environmentsHref(data?.project_id, data?.environment_catalog?.name || data?.environment)}
          className="btn btn-secondary btn-sm"
        >
          Environments
        </Link>
      </div>

      {loading ? <LoadingSkeleton /> : null}
      {!loading && fetchError ? (
        <div className="alert alert-warning" role="status">
          {fetchError}. Approval and detail actions still work; refresh to retry context.
        </div>
      ) : null}
      {!loading && !fetchError && data ? (
        <div className="resource-context-panel__blocks">
          {data.account_context?.message ? (
            <div
              className={`alert ${data.account_context.account_status === 'disabled' ? 'alert-error' : 'alert-info'}`}
              role="status"
            >
              {data.account_context.message}
              {data.account_context.onboarded_account_id ? (
                <>
                  {' '}
                  <Link href={`/cloud-accounts/${data.account_context.onboarded_account_id}`} className="ig-cell-link">
                    Cloud account
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          {!hideDelivery && data.delivery ? (
            <div className="resource-context-panel__block">
              <h4 className="resource-context-panel__block-title">Delivery</h4>
              <dl className="resource-context-panel__dl">
                {data.delivery.last_sha ? (
                  <>
                    <dt>SHA</dt>
                    <dd>
                      <code>{data.delivery.last_sha}</code>
                    </dd>
                  </>
                ) : null}
                {data.delivery.repo ? (
                  <>
                    <dt>Repo</dt>
                    <dd>{data.delivery.repo}</dd>
                  </>
                ) : null}
                {data.delivery.pr_url ? (
                  <>
                    <dt>PR</dt>
                    <dd>
                      <a href={data.delivery.pr_url} target="_blank" rel="noreferrer">
                        Open pull request
                      </a>
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
          ) : null}

          {partial.environment_catalog ? (
            <p className="resource-context-panel__inline-error">{partial.environment_catalog}</p>
          ) : envCatalog ? (
            <div className="resource-context-panel__block">
              <div className="resource-context-panel__block-head">
                <h4 className="resource-context-panel__block-title">Environment catalog</h4>
                <Link
                  href={environmentsHref(envCatalog.project_id, envCatalog.name)}
                  className="ig-cell-link"
                >
                  Open row
                </Link>
              </div>
              <dl className="resource-context-panel__dl">
                <dt>Type</dt>
                <dd>{envCatalog.env_type || '—'}</dd>
                <dt>Region</dt>
                <dd>{envCatalog.default_region || '—'}</dd>
                <dt>Cluster</dt>
                <dd>{envCatalog.default_cluster || '—'}</dd>
                <dt>Cloud account</dt>
                <dd>{envCatalog.cloud_account_label || 'Not linked'}</dd>
              </dl>
            </div>
          ) : null}

          {freeze?.active ? (
            <div className="resource-context-panel__block">
              <h4 className="resource-context-panel__block-title">Deployment freeze</h4>
              {data.target_environment?.trim() ? (
                <p className="resource-context-panel__muted">Promotion target: {data.target_environment}</p>
              ) : null}
              <p className="resource-context-panel__freeze">
                Active{freeze.reason ? `: ${freeze.reason}` : ''}
                {freeze.ends_at ? ` (until ${formatOperationalTime(freeze.ends_at)})` : ''}
              </p>
            </div>
          ) : null}

          {partial.open_incidents || incidents.length > 0 ? (
            <div className="resource-context-panel__block">
              <div className="resource-context-panel__block-head">
                <h4 className="resource-context-panel__block-title">Open incidents</h4>
                <Link href={incidentsHref(data.project_id, data.target_environment || data.environment)} className="ig-cell-link">
                  View queue
                </Link>
              </div>
              {partial.open_incidents ? (
                <p className="resource-context-panel__inline-error">{partial.open_incidents}</p>
              ) : (
                <ul className="ig-simple-list">
                  {incidents.slice(0, 5).map((inc) => (
                    <li key={`${inc.reference}-${inc.summary}`}>
                      <strong>{inc.reference}</strong>
                      {inc.severity ? ` · ${inc.severity}` : ''}
                      {inc.blocks_promotion ? ' · may block promotion' : ''}
                      {inc.summary ? ` — ${inc.summary}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {hints && (hints.block_summary || (hints.warnings?.length ?? 0) > 0) ? (
            <div className="resource-context-panel__block">
              <h4 className="resource-context-panel__block-title">Guarded-action hints</h4>
              {hints.block_summary ? <p className="resource-context-panel__block-summary">{hints.block_summary}</p> : null}
              <ul className="ig-simple-list">
                {(hints.warnings || []).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {partial.operator_activity || activity.length > 0 ? (
            <div className="resource-context-panel__block">
              <h4 className="resource-context-panel__block-title">Operator activity</h4>
              {partial.operator_activity ? (
                <p className="resource-context-panel__inline-error">{partial.operator_activity}</p>
              ) : (
                <ul className="ig-simple-list">
                  {activity.map((row) => (
                    <li key={row.id}>
                      <strong>{row.actor_username || 'Operator'}</strong> · {row.action.replace(/_/g, ' ')}
                      {row.result ? ` (${row.result})` : ''}
                      {row.summary ? ` — ${row.summary}` : ''}
                      <br />
                      <small>{formatOperationalTime(row.created_at)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
