import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface ChangeRiskSummary {
  project_count: number;
  low_risk_count: number;
  medium_risk_count: number;
  high_risk_count: number;
  blocked_projects: number;
  incident_linked_projects: number;
  drifted_projects: number;
}

interface ChangeRiskFactor {
  key: string;
  label: string;
  severity: string;
  weight: number;
  detail: string;
}

interface ChangeRiskEnvironment {
  environment: string;
  score: number;
  risk_level: string;
  summary: string;
  drift_state: string;
  latest_status: string;
  gate_status: string;
  incident_count: number;
  pending_count: number;
  namespace_alerts: number;
}

interface ChangeRiskProjectItem {
  project_id: number;
  project_name: string;
  project_code: string;
  owner_team?: string;
  score: number;
  risk_level: string;
  summary: string;
  recommended_action: string;
  blocked_promotion_count: number;
  attention_promotion_count: number;
  open_incident_count: number;
  actionable_expiry_count: number;
  namespace_alert_count: number;
  drift_state: string;
  cost_risk_level?: string;
  factors: ChangeRiskFactor[];
  environments: ChangeRiskEnvironment[];
}

interface ChangeRiskPayload {
  projects: ProjectSummary[];
  summary: ChangeRiskSummary;
  items: ChangeRiskProjectItem[];
}

function clearSessionAndRedirect(router: ReturnType<typeof useRouter>) {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  router.replace('/login');
}

function riskTone(level: string): { background: string; color: string } {
  switch (level) {
    case 'high':
      return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
    case 'medium':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    default:
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
  }
}

export default function ChangeRiskPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [risk, setRisk] = useState<ChangeRiskPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [showFilters, setShowFilters] = useState(false);

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
      clearSessionAndRedirect(router);
      return;
    }

    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);

    fetch(`${apiUrl}/api/devops/change-risk?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          clearSessionAndRedirect(router);
          return null;
        }
        const payload = asRecord(await response.json().catch(() => ({})));
        if (!response.ok) {
          throw new Error(getString(payload.error, 'Failed to load change risk'));
        }
        return payload;
      })
      .then((payload) => {
        if (!payload) return;
        const nextRisk = payload.risk && typeof payload.risk === 'object'
          ? (payload.risk as ChangeRiskPayload)
          : null;
        setRisk(nextRisk);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load change risk');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router]);

  const projects = risk?.projects || [];
  const summary = risk?.summary;
  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === projectId) || null,
    [projectId, projects],
  );

  return (
    <DevOpsLayout>
      <Head>
        <title>Change Risk - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Phase 2</span>
            <h1 className="portal-page__title">Change Risk Score</h1>
            <p className="portal-page__subtitle">
              Compare delivery pressure, deployment gates, incidents, workload health, expiry exposure, and drift so release approvals are grounded in current operational risk.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/ops-command-center" className="btn btn-secondary">Ops Command Center</Link>
            <Link href="/promotions" className="btn btn-secondary">Promotion Center</Link>
            <Link href="/incident-workspace" className="btn btn-primary">Incident Workspace</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading change risk...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && summary ? (
          <>
            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-page__actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="portal-pill-row">
                  <span className="portal-pill">High risk {summary.high_risk_count}</span>
                  <span className="portal-pill">Medium risk {summary.medium_risk_count}</span>
                  <span className="portal-pill">Blocked {summary.blocked_projects}</span>
                  <span className="portal-pill">Incident-linked {summary.incident_linked_projects}</span>
                  <span className="portal-pill">Drifted {summary.drifted_projects}</span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters((current) => !current)}>
                  {showFilters ? 'Hide filters' : 'Show filters'}
                </button>
              </div>
            </section>

            {projectId ? (
              <div className="alert alert-info" style={{ marginBottom: 24 }}>
                Reviewing {selectedProject ? selectedProject.name : `project #${projectId}`}
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={() => setProjectId('')}>
                  Clear filter
                </button>
              </div>
            ) : null}

            {showFilters ? (
              <section className="portal-surface" style={{ marginBottom: 24 }}>
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Filters</span>
                    <h2 className="portal-surface__title">Focus a project</h2>
                    <p className="portal-surface__subtitle">Only open this when you want a tighter change review for one project.</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(false)}>
                    Close
                  </button>
                </div>
                <div className="portal-toolbar">
                  <div className="portal-toolbar__group">
                    <div className="portal-toolbar__item">
                      <label className="credential-audit-label" htmlFor="change-risk-project-filter">Project</label>
                      <select
                        id="change-risk-project-filter"
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
            ) : null}

            <div className="portal-grid" style={{ alignItems: 'start' }}>
              {(risk?.items || []).map((item) => (
                <section key={`change-risk-${item.project_id}`} className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">{item.project_code || 'project'}</span>
                      <h2 className="portal-surface__title">{item.project_name}</h2>
                      <p className="portal-surface__subtitle">{item.summary}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="portal-pill" style={riskTone(item.risk_level)}>
                        {item.risk_level.toUpperCase()} · {item.score}/100
                      </span>
                      {item.owner_team ? <span className="portal-pill">{item.owner_team}</span> : null}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
                    <div className="alert alert-info" style={{ marginBottom: 0 }}>
                      <strong>Recommended action:</strong> {item.recommended_action}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <span className="portal-pill">Blocked promotions: {item.blocked_promotion_count}</span>
                      <span className="portal-pill">Attention promotions: {item.attention_promotion_count}</span>
                      <span className="portal-pill">Open incidents: {item.open_incident_count}</span>
                      <span className="portal-pill">Expiry items: {item.actionable_expiry_count}</span>
                      <span className="portal-pill">Namespace alerts: {item.namespace_alert_count}</span>
                      <span className="portal-pill">Drift: {item.drift_state || 'aligned'}</span>
                    </div>
                  </div>

                  <div className="portal-grid" style={{ alignItems: 'start' }}>
                    <div className="portal-surface" style={{ padding: 16 }}>
                      <h3 className="portal-surface__title" style={{ fontSize: 18, marginBottom: 12 }}>Risk factors</h3>
                      {item.factors.length === 0 ? (
                        <div className="empty-state" style={{ padding: 0 }}>No major change risk drivers are active for this project.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 12 }}>
                          {item.factors.map((factor) => (
                            <article key={`${item.project_id}-${factor.key}`} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                                <strong>{factor.label}</strong>
                                <span className="portal-pill" style={riskTone(factor.severity)}>{factor.severity.toUpperCase()} · +{factor.weight}</span>
                              </div>
                              <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{factor.detail}</div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="portal-surface" style={{ padding: 16 }}>
                      <h3 className="portal-surface__title" style={{ fontSize: 18, marginBottom: 12 }}>Environment scoring</h3>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="templates-table">
                          <thead>
                            <tr>
                              <th>Environment</th>
                              <th>Risk</th>
                              <th>Signals</th>
                              <th>Summary</th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.environments.map((environment) => (
                              <tr key={`${item.project_id}-${environment.environment}`}>
                                <td>{environment.environment.toUpperCase()}</td>
                                <td>
                                  <span className="portal-pill" style={riskTone(environment.risk_level)}>
                                    {environment.risk_level.toUpperCase()} · {environment.score}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {environment.gate_status ? <span className="portal-pill">Gate: {environment.gate_status}</span> : null}
                                    {environment.drift_state ? <span className="portal-pill">Drift: {environment.drift_state}</span> : null}
                                    {environment.latest_status ? <span className="portal-pill">Latest: {environment.latest_status}</span> : null}
                                    {environment.incident_count > 0 ? <span className="portal-pill">Incidents: {environment.incident_count}</span> : null}
                                    {environment.pending_count > 0 ? <span className="portal-pill">Pending: {environment.pending_count}</span> : null}
                                    {environment.namespace_alerts > 0 ? <span className="portal-pill">Namespace alerts: {environment.namespace_alerts}</span> : null}
                                  </div>
                                </td>
                                <td>{environment.summary}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                    <Link href={`/projects/${item.project_id}`} className="btn btn-secondary btn-sm">Open project</Link>
                    <Link href={`/promotions?project_id=${item.project_id}`} className="btn btn-secondary btn-sm">Review promotions</Link>
                    <Link href={`/incident-workspace?project_id=${item.project_id}`} className="btn btn-secondary btn-sm">Open incident workspace</Link>
                    <Link href={`/environment-drift?project_id=${item.project_id}`} className="btn btn-secondary btn-sm">Inspect drift</Link>
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
