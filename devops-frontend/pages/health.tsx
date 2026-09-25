import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface HealthMetrics {
  p95_ms?: number;
  error_ratio?: number;
  saturation?: number;
}

interface HealthRollbackPlan {
  allowed?: boolean;
  previous_sha?: string;
  block_reason?: string;
  change_id?: number;
  k8s_href?: string;
}

interface HealthChange {
  id: number;
  change_number: string;
  repo: string;
  sha: string;
  previous_sha?: string;
  service: string;
  environment: string;
  status: string;
  title: string;
  watch_until?: string;
  watch_remaining_minutes?: number;
  pr_number: number;
  baseline?: HealthMetrics;
  latest_metrics?: HealthMetrics;
  rollback_hint?: string;
  rollback_plan?: HealthRollbackPlan;
  cost_delta_usd?: number;
  cost_currency?: string;
}

interface HealthIncident {
  id: number;
  incident_number?: string;
  summary: string;
  severity: string;
  source?: string;
  suspected_change_number?: string;
  request_env?: string;
  environment?: string;
  service?: string;
  rollback_hint?: string;
  caused_by?: string;
  rollback_plan?: HealthRollbackPlan;
}

interface HealthDoraMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  band: string;
  samples: number;
}

interface HealthSLO {
  id: number;
  service: string;
  environment: string;
  latency_p95_ms: number;
  error_ratio: number;
  budget_remaining: number;
  burned: boolean;
  freeze_reason?: string;
  samples: number;
}

interface HealthPayload {
  summary: {
    watching: number;
    regressions: number;
    open_alerts: number;
    high_risk_alerts: number;
    burned_slos?: number;
  };
  watching: HealthChange[];
  regressions: HealthIncident[];
  slos?: HealthSLO[];
  dora?: {
    window_days: number;
    score: number;
    metrics?: HealthDoraMetric[];
  };
}

function parseQueryNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function formatRatio(value?: number): string {
  if (typeof value !== 'number') return '—';
  return `${(value * 100).toFixed(2)}%`;
}

export default function HealthPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [payload, setPayload] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rollingKey, setRollingKey] = useState('');
  const projectID = parseQueryNumber(router.query.project_id);
  const environment = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment || '';

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (projectID) params.set('project_id', String(projectID));
    if (environment) params.set('environment', environment);
    fetch(`${apiUrl}/api/devops/health?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load health');
          return;
        }
        setPayload(data.health || null);
        setError('');
      })
      .catch(() => setError('Failed to load health'))
      .finally(() => setLoading(false));
  }, [apiUrl, projectID, environment]);

  const summary = payload?.summary;
  const sloQuery = new URLSearchParams();
  if (projectID) sloQuery.set('project_id', String(projectID));
  if (environment) sloQuery.set('environment', environment);

  const rollbackFrom = (kind: 'inc' | 'chg', id: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const key = `${kind}-${id}`;
    setRollingKey(key);
    setError('');
    const path = kind === 'inc' ? `/api/devops/incidents/${id}/rollback` : `/api/devops/changes/${id}/rollback`;
    fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to record rollback');
          return;
        }
        if (data.change?.id) {
          void router.push(`/changes/${data.change.id}`);
        }
      })
      .catch(() => setError('Failed to record rollback'))
      .finally(() => setRollingKey(''));
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Health - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Health</h1>
            <p className="portal-page__subtitle">
              Post-deploy watch windows, watcher regressions, and error budget. Scope follows the project and environment bar. Push samples to <code>/api/webhooks/watch-metrics</code> or set a service-map metrics URL.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href={`/health/slo/new${sloQuery.toString() ? `?${sloQuery.toString()}` : ''}`} className="btn btn-secondary">
              Define SLO
            </Link>
            <Link href="/changes" className="btn btn-secondary">
              Open changes
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="k8s-summary-strip">
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Watching</span>
            <strong className="k8s-summary-card__value">{summary?.watching ?? 0}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Regressions</span>
            <strong className="k8s-summary-card__value">{summary?.regressions ?? 0}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">SEV1 / SEV2</span>
            <strong className="k8s-summary-card__value">{summary?.high_risk_alerts ?? 0}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Burned SLOs</span>
            <strong className="k8s-summary-card__value">{summary?.burned_slos ?? 0}</strong>
          </div>
        </section>

        {payload?.dora ? (
          <section className="k8s-summary-strip" style={{ marginBottom: 16 }}>
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">DORA score</span>
              <strong className="k8s-summary-card__value">{payload.dora.score}</strong>
            </div>
            {(payload.dora.metrics || []).slice(0, 3).map((metric) => (
              <div className="k8s-summary-card" key={metric.key}>
                <span className="k8s-summary-card__label">{metric.label}</span>
                <strong className="k8s-summary-card__value">
                  {metric.value}
                  {metric.unit ? ` ${metric.unit}` : ''}
                </strong>
              </div>
            ))}
          </section>
        ) : null}

        <section className="portal-surface" style={{ marginBottom: 16 }}>
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Watching</span>
              <h2 className="portal-surface__title">Changes still in their watch window</h2>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading health...</div>
          ) : !payload?.watching?.length ? (
            <div className="empty-state">No deploys are being watched right now.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Change</th>
                    <th>Service</th>
                    <th>Remaining</th>
                    <th>p95 vs baseline</th>
                    <th>Errors</th>
                    <th>Cost delta</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.watching.map((item) => (
                    <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/changes/${item.id}`)}>
                      <td>
                        <strong>{item.change_number}</strong>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                          {item.repo} · {item.sha.slice(0, 7)}
                          {item.pr_number ? ` · PR #${item.pr_number}` : ''}
                        </div>
                      </td>
                      <td>{item.service || '—'}</td>
                      <td>{item.watch_remaining_minutes ?? 0} min</td>
                      <td>
                        {item.latest_metrics?.p95_ms ?? '—'}
                        {item.baseline?.p95_ms ? ` / ${item.baseline.p95_ms}ms` : ''}
                      </td>
                      <td>
                        {formatRatio(item.latest_metrics?.error_ratio)}
                        {item.baseline ? ` / ${formatRatio(item.baseline.error_ratio)}` : ''}
                      </td>
                      <td>{item.cost_currency || 'USD'} {item.cost_delta_usd ?? 0}</td>
                      <td>
                        {item.rollback_plan?.allowed && item.rollback_plan.previous_sha ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={rollingKey === `chg-${item.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              rollbackFrom('chg', item.id);
                            }}
                          >
                            {rollingKey === `chg-${item.id}` ? 'Recording…' : `Roll back to ${item.rollback_plan.previous_sha.slice(0, 7)}`}
                          </button>
                        ) : item.rollback_plan?.block_reason ? (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.rollback_plan.block_reason}</span>
                        ) : item.previous_sha ? (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Previous {item.previous_sha.slice(0, 7)}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="portal-surface" style={{ marginBottom: 16 }}>
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Regressions</span>
              <h2 className="portal-surface__title">Alerts and watcher pages linked to a change</h2>
            </div>
          </div>
          {!loading && !payload?.regressions?.length ? (
            <div className="empty-state">No change-linked incidents in this scope.</div>
          ) : null}
          {payload?.regressions?.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Change</th>
                    <th>Severity</th>
                    <th>Caused by</th>
                    <th>Rollback hint</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.regressions.map((item) => (
                    <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/incidents/${item.id}/edit`)}>
                      <td>
                        <strong>{item.incident_number || `INC${String(item.id).padStart(7, '0')}`}</strong>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.summary}</div>
                      </td>
                      <td>{item.suspected_change_number || '—'}</td>
                      <td>{item.severity}</td>
                      <td>{item.caused_by || '—'}</td>
                      <td>{item.rollback_hint || '—'}</td>
                      <td>
                        {item.rollback_plan?.allowed && item.rollback_plan.previous_sha ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={rollingKey === `inc-${item.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              rollbackFrom('inc', item.id);
                            }}
                          >
                            {rollingKey === `inc-${item.id}` ? 'Recording…' : `Roll back to ${item.rollback_plan.previous_sha.slice(0, 7)}`}
                          </button>
                        ) : item.rollback_plan?.block_reason ? (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.rollback_plan.block_reason}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Service SLO</span>
              <h2 className="portal-surface__title">Error budget remaining</h2>
            </div>
          </div>
          {!payload?.slos?.length ? (
            <div className="empty-state">No SLOs defined yet. Define one so a 200ms blip on a 2s target is not treated as a page.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Env</th>
                    <th>Budget left</th>
                    <th>Samples</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.slos.map((item) => (
                    <tr key={item.id}>
                      <td>{item.service}</td>
                      <td>{item.environment || 'all'}</td>
                      <td>{Math.round(item.budget_remaining * 100)}%</td>
                      <td>{item.samples}</td>
                      <td>{item.burned ? item.freeze_reason || 'Burned' : 'Healthy'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
