import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface OpsSummary {
  blocked_promotions: number;
  attention_promotions: number;
  active_incidents: number;
  delivery_failures: number;
  actionable_expiry: number;
  drifted_projects: number;
  unhealthy_namespaces: number;
  active_overrides: number;
}

interface ProjectPulse {
  project_id: number;
  project_name: string;
  project_code: string;
  drift_state: string;
  drift_score: number;
  pending_requests: number;
  blocked_promotions: number;
  attention_promotions: number;
  open_incidents: number;
  expiry_items: number;
  namespace_alerts: number;
}

interface PromotionItem {
  request_id: number;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  team: string;
  environment: string;
  next_environment: string;
  cloud: string;
  service: string;
  status: string;
  updated_at: string;
}

interface IncidentItem {
  id: number;
  request_id: number;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  severity: string;
  status: string;
  escalation_level: string;
  summary: string;
  updated_at: string;
}

interface DeliveryFailureItem {
  id: number;
  job_type: string;
  target: string;
  error_message: string;
  status: string;
  retry_count: number;
  updated_at: string;
}

interface ExpiryItem {
  item_key: string;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  category: string;
  environment?: string;
  resource_name: string;
  status: string;
  workflow_state: string;
  days_remaining: number;
  recommendation: string;
}

interface NamespaceAlert {
  project_id: number;
  project_name: string;
  project_code: string;
  namespace: string;
  cluster_name: string;
  status: string;
  issue_count: number;
  restarting_pods: number;
  warning_logs: number;
}

interface AccessOverride {
  id: number;
  project_id: number;
  project_name: string;
  project_code: string;
  username: string;
  permission: string;
  reason: string;
  expires_at: string;
}

interface DriftProject {
  project_id: number;
  project_name: string;
  project_code: string;
  state: string;
  drift_score: number;
  summary: string;
}

interface OpsPayload {
  projects: ProjectSummary[];
  summary: OpsSummary;
  project_pulse: ProjectPulse[];
  drifted_projects: DriftProject[];
  blocked_promotions: PromotionItem[];
  attention_promotions: PromotionItem[];
  active_incidents: IncidentItem[];
  delivery_failures: DeliveryFailureItem[];
  expiry_items: ExpiryItem[];
  namespace_alerts: NamespaceAlert[];
  active_overrides: AccessOverride[];
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function OpsCommandCenterPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [center, setCenter] = useState<OpsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const queryProjectId = router.query.project_id;
    if (typeof queryProjectId === 'string' && queryProjectId.trim()) {
      setProjectId(queryProjectId.trim());
    }
  }, [router.isReady, router.query.project_id]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      localStorage.removeItem(DEVOPS_USER_KEY);
      router.replace('/login');
      return;
    }

    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);

    fetch(`${apiUrl}/api/devops/ops-command-center?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem(DEVOPS_TOKEN_KEY);
          localStorage.removeItem(DEVOPS_USER_KEY);
          router.replace('/login');
          return null;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load ops command center');
        }
        return data;
      })
      .then((data) => {
        if (!data) return;
        setCenter(data?.center || null);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load ops command center';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router]);

  const summary = center?.summary;
  const projects = center?.projects || [];

  return (
    <DevOpsLayout>
      <Head>
        <title>Ops Command Center - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Phase 1</span>
            <h1 className="portal-page__title">Ops Command Center</h1>
            <p className="portal-page__subtitle">
              A single operational surface for blocked promotions, unhealthy workloads, expiring assets, active incidents, drift, and delivery failures.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/environment-drift" className="btn btn-secondary">Environment Drift</Link>
            <Link href="/promotions" className="btn btn-secondary">Promotions</Link>
            <Link href="/incidents" className="btn btn-primary">Incidents</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading ops command center...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && summary ? (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Blocked promotions</span>
                <strong className="portal-stat-card__value">{summary.blocked_promotions}</strong>
                <p className="portal-stat-card__copy">Promotion candidates currently blocked by deployment gate policy.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Attention promotions</span>
                <strong className="portal-stat-card__value">{summary.attention_promotions}</strong>
                <p className="portal-stat-card__copy">Candidates waiting on a gate approval or manual review step.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Active incidents</span>
                <strong className="portal-stat-card__value">{summary.active_incidents}</strong>
                <p className="portal-stat-card__copy">Open incidents that should shape release decisions and response priorities.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Actionable expiry</span>
                <strong className="portal-stat-card__value">{summary.actionable_expiry}</strong>
                <p className="portal-stat-card__copy">Secrets and certificates that need acknowledgement, rotation, or owner action.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Namespace alerts</span>
                <strong className="portal-stat-card__value">{summary.unhealthy_namespaces}</strong>
                <p className="portal-stat-card__copy">Namespaces with workload health issues, restart pressure, or warning logs.</p>
              </article>
            </section>

            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Scope</span>
                  <h2 className="portal-surface__title">Filter command center by project</h2>
                  <p className="portal-surface__subtitle">Focus one project during triage without losing the command-center layout.</p>
                </div>
              </div>
              <div className="portal-toolbar">
                <div className="portal-toolbar__group">
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="ops-command-project-filter">Project</label>
                    <select
                      id="ops-command-project-filter"
                      className="input"
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                    >
                      <option value="">All projects</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}{project.code ? ` (${project.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <div className="portal-grid" style={{ alignItems: 'start' }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Project pulse</span>
                    <h2 className="portal-surface__title">Priority projects</h2>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Drift</th>
                        <th>Pending</th>
                        <th>Promotions</th>
                        <th>Incidents</th>
                        <th>Expiry</th>
                        <th>Namespaces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(center?.project_pulse || []).map((item) => (
                        <tr key={`pulse-${item.project_id}`}>
                          <td>
                            <Link href={`/projects/${item.project_id}`}><strong>{item.project_name}</strong></Link>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_code}</div>
                          </td>
                          <td>{item.drift_state} · {item.drift_score}</td>
                          <td>{item.pending_requests}</td>
                          <td>{item.blocked_promotions + item.attention_promotions}</td>
                          <td>{item.open_incidents}</td>
                          <td>{item.expiry_items}</td>
                          <td>{item.namespace_alerts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Drift</span>
                    <h2 className="portal-surface__title">Projects needing alignment</h2>
                  </div>
                  <Link href="/environment-drift" className="btn btn-secondary btn-sm">Open drift view</Link>
                </div>
                {(center?.drifted_projects || []).length === 0 ? (
                  <div className="empty-state">No drifted projects in the current scope.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {center?.drifted_projects.map((item) => (
                      <article key={`drift-project-${item.project_id}`} className="portal-surface" style={{ padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <div>
                            <strong>{item.project_name}</strong>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_code}</div>
                          </div>
                          <span className="portal-pill">{item.state} · score {item.drift_score}</span>
                        </div>
                        <p style={{ marginTop: 8, color: 'var(--color-text-muted)' }}>{item.summary}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="portal-grid" style={{ alignItems: 'start', marginTop: 24 }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Promotion gates</span>
                    <h2 className="portal-surface__title">Blocked and attention promotions</h2>
                  </div>
                  <Link href="/promotions" className="btn btn-secondary btn-sm">Open promotions</Link>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {[...(center?.blocked_promotions || []), ...(center?.attention_promotions || [])].slice(0, 8).map((item) => (
                    <article key={`promotion-${item.request_id}`} className="portal-surface" style={{ padding: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <strong>{item.project_name || `Request #${item.request_id}`}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                            {item.environment.toUpperCase()} → {item.next_environment.toUpperCase()} · {item.cloud} / {item.service}
                          </div>
                        </div>
                        <span className="portal-pill">{item.status}</span>
                      </div>
                    </article>
                  ))}
                  {(center?.blocked_promotions || []).length + (center?.attention_promotions || []).length === 0 ? (
                    <div className="empty-state">No promotion gates need attention right now.</div>
                  ) : null}
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Incidents and failures</span>
                    <h2 className="portal-surface__title">Response queue</h2>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Link href="/incidents" className="btn btn-secondary btn-sm">Incidents</Link>
                    <Link href="/retry-center" className="btn btn-secondary btn-sm">Retry center</Link>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {(center?.active_incidents || []).slice(0, 4).map((item) => (
                    <article key={`incident-${item.id}`} className="portal-surface" style={{ padding: 16 }}>
                      <strong>{item.project_name || `Request #${item.request_id}`}</strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {item.severity} · {item.status} · {formatDateTime(item.updated_at)}
                      </div>
                      <p style={{ marginTop: 8 }}>{item.summary}</p>
                    </article>
                  ))}
                  {(center?.delivery_failures || []).slice(0, 4).map((item) => (
                    <article key={`failure-${item.id}`} className="portal-surface" style={{ padding: 16 }}>
                      <strong>{item.job_type}</strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {item.target} · retries {item.retry_count} · {formatDateTime(item.updated_at)}
                      </div>
                      <p style={{ marginTop: 8 }}>{item.error_message}</p>
                    </article>
                  ))}
                  {(center?.active_incidents || []).length === 0 && (center?.delivery_failures || []).length === 0 ? (
                    <div className="empty-state">No active incidents or unresolved delivery failures.</div>
                  ) : null}
                </div>
              </section>
            </div>

            <div className="portal-grid" style={{ alignItems: 'start', marginTop: 24 }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Expiry and workload</span>
                    <h2 className="portal-surface__title">Operational watchlists</h2>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Link href="/credential-audit" className="btn btn-secondary btn-sm">Credential audit</Link>
                    <Link href="/k8s" className="btn btn-secondary btn-sm">K8s dashboard</Link>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Project</th>
                        <th>Resource</th>
                        <th>State</th>
                        <th>Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(center?.expiry_items || []).slice(0, 5).map((item) => (
                        <tr key={item.item_key}>
                          <td>{item.category}</td>
                          <td>{item.project_name || item.project_code || '—'}</td>
                          <td>
                            <strong>{item.resource_name}</strong>
                            {item.environment ? (
                              <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.environment.toUpperCase()}</div>
                            ) : null}
                          </td>
                          <td>{item.workflow_state}</td>
                          <td>{item.days_remaining}</td>
                        </tr>
                      ))}
                      {(center?.namespace_alerts || []).slice(0, 5).map((item) => (
                        <tr key={`${item.project_id}-${item.namespace}-${item.cluster_name}`}>
                          <td>namespace</td>
                          <td>{item.project_name}</td>
                          <td>
                            <strong>{item.namespace}</strong>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.cluster_name}</div>
                          </td>
                          <td>{item.status}</td>
                          <td>{item.issue_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Access overrides</span>
                    <h2 className="portal-surface__title">Temporary elevated access</h2>
                  </div>
                  <Link href="/access-overrides" className="btn btn-secondary btn-sm">Open overrides</Link>
                </div>
                {(center?.active_overrides || []).length === 0 ? (
                  <div className="empty-state">No active overrides in the current scope.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {center?.active_overrides.map((item) => (
                      <article key={`override-${item.id}`} className="portal-surface" style={{ padding: 16 }}>
                        <strong>{item.project_name}</strong>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                          {item.username} · {item.permission} · expires {formatDateTime(item.expires_at)}
                        </div>
                        <p style={{ marginTop: 8 }}>{item.reason}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
