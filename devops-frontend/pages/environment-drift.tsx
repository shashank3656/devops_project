import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { downloadCSV } from '../lib/csv';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface DriftSummary {
  project_count: number;
  aligned_projects: number;
  attention_projects: number;
  drifted_projects: number;
  environment_count: number;
  missing_connection_count: number;
  version_drift_count: number;
  variable_drift_count: number;
  secret_reference_drift_count: number;
}

interface DriftFinding {
  key: string;
  label: string;
  status: string;
  detail: string;
  environments?: string[];
}

interface DriftKeyValue {
  key: string;
  value: string;
}

interface DriftSnapshot {
  environment: string;
  connection_count: number;
  connected_clusters: string[];
  observed_namespaces: string[];
  expected_namespace: string;
  latest_request_id?: number;
  latest_request_status?: string;
  latest_updated_at?: string;
  observed_services: string[];
  version_markers: DriftKeyValue[];
  variable_keys: string[];
  secret_references: string[];
  secret_inventory_count: number;
  state: string;
  notes: string[];
}

interface DriftProjectItem {
  project_id: number;
  project_name: string;
  project_code: string;
  owner_team?: string;
  state: string;
  drift_score: number;
  summary: string;
  findings: DriftFinding[];
  environments: DriftSnapshot[];
}

interface DriftPayload {
  projects: ProjectSummary[];
  summary: DriftSummary;
  items: DriftProjectItem[];
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function toneForState(state: string): { background: string; color: string } {
  switch (state) {
    case 'drift':
      return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
    case 'attention':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    default:
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
  }
}

export default function EnvironmentDriftPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [drift, setDrift] = useState<DriftPayload | null>(null);
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
      localStorage.removeItem(DEVOPS_USER_KEY);
      router.replace('/login');
      return;
    }

    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);

    fetch(`${apiUrl}/api/devops/environment-drift?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem(DEVOPS_TOKEN_KEY);
          localStorage.removeItem(DEVOPS_USER_KEY);
          router.replace('/login');
          return null;
        }
        const payload = asRecord(await response.json().catch(() => ({})));
        if (!response.ok) {
          throw new Error(getString(payload.error, 'Failed to load environment drift'));
        }
        return payload;
      })
      .then((payload) => {
        if (!payload) return;
        const nextDrift = payload.drift && typeof payload.drift === 'object'
          ? (payload.drift as DriftPayload)
          : null;
        setDrift(nextDrift);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load environment drift';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router]);

  const summary = drift?.summary;
  const items = drift?.items || [];
  const projects = drift?.projects || [];
  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === projectId) || null,
    [projectId, projects],
  );

  const exportDriftCSV = () => {
    const rows: unknown[][] = [];
    items.forEach((item) => {
      item.environments.forEach((snapshot) => {
        rows.push([
          item.project_name,
          item.project_code,
          item.owner_team || '',
          item.state,
          item.drift_score,
          snapshot.environment,
          snapshot.state,
          snapshot.connection_count,
          snapshot.expected_namespace,
          snapshot.observed_namespaces.join(' | '),
          snapshot.connected_clusters.join(' | '),
          snapshot.secret_inventory_count,
          snapshot.latest_request_id || '',
          snapshot.latest_request_status || '',
          item.findings.map((finding) => `${finding.label}: ${finding.detail}`).join(' | '),
        ]);
      });
    });

    downloadCSV(
      `environment-drift-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'project_name',
        'project_code',
        'owner_team',
        'project_state',
        'drift_score',
        'environment',
        'environment_state',
        'connection_count',
        'expected_namespace',
        'observed_namespaces',
        'connected_clusters',
        'secret_inventory_count',
        'latest_request_id',
        'latest_request_status',
        'findings',
      ],
      rows,
    );
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Environment Drift - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Phase 1</span>
            <h1 className="portal-page__title">Environment Drift Detection</h1>
            <p className="portal-page__subtitle">
              Compare expected versus observed environment state across runtime connections, request config signals, and secret inventory before drift turns into a failed release.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/ops-command-center" className="btn btn-secondary">Ops Command Center</Link>
            <Link href="/projects" className="btn btn-secondary">Projects</Link>
            <button type="button" className="btn btn-secondary" onClick={exportDriftCSV} disabled={items.length === 0}>
              Export CSV
            </button>
            <Link href="/k8s" className="btn btn-primary">K8s</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading environment drift...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && summary ? (
          <>
            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-page__actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="portal-pill-row">
                  <span className="portal-pill">Drifted {summary.drifted_projects}</span>
                  <span className="portal-pill">Attention {summary.attention_projects}</span>
                  <span className="portal-pill">Missing connections {summary.missing_connection_count}</span>
                  <span className="portal-pill">Version drift {summary.version_drift_count}</span>
                  <span className="portal-pill">Secret references {summary.secret_reference_drift_count}</span>
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
                    <h2 className="portal-surface__title">Focus the drift view</h2>
                    <p className="portal-surface__subtitle">Only open this when you want to drill into a single project lineage.</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(false)}>
                    Close
                  </button>
                </div>
                <div className="portal-toolbar">
                  <div className="portal-toolbar__group">
                    <div className="portal-toolbar__item">
                      <label className="credential-audit-label" htmlFor="environment-drift-project-filter">Project</label>
                      <select
                        id="environment-drift-project-filter"
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
              {items.map((item) => {
                const tone = toneForState(item.state);
                return (
                  <section key={`drift-${item.project_id}`} className="portal-surface">
                    <div className="portal-surface__header">
                      <div>
                        <span className="portal-surface__eyebrow">{item.project_code || 'project'}</span>
                        <h2 className="portal-surface__title">{item.project_name}</h2>
                        <p className="portal-surface__subtitle">{item.summary}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span className="portal-pill" style={tone}>
                          {item.state.toUpperCase()} · score {item.drift_score}
                        </span>
                        {item.owner_team ? <span className="portal-pill">{item.owner_team}</span> : null}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
                      <Link href={`/projects/${item.project_id}`} className="btn btn-secondary btn-sm">Open project</Link>
                      <Link href={`/k8s?project_id=${item.project_id}`} className="btn btn-secondary btn-sm">Inspect K8s</Link>
                      <Link href={`/credential-audit?project_id=${item.project_id}`} className="btn btn-secondary btn-sm">Inspect expiry</Link>
                    </div>

                    <div style={{ marginBottom: 18 }}>
                      <h3 className="portal-section-title">Detected findings</h3>
                      {item.findings.length === 0 ? (
                        <div className="empty-state">No drift findings. This project is currently aligned.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 12 }}>
                          {item.findings.map((finding) => (
                            <article key={`${item.project_id}-${finding.key}`} className="portal-surface" style={{ padding: 16 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                <strong>{finding.label}</strong>
                                <span className="portal-pill" style={toneForState(finding.status === 'drift' ? 'drift' : 'attention')}>
                                  {finding.status}
                                </span>
                              </div>
                              <p style={{ marginTop: 8, color: 'var(--color-text-muted)' }}>{finding.detail}</p>
                              {finding.environments?.length ? (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                                  {finding.environments.map((environment) => (
                                    <span key={`${finding.key}-${environment}`} className="portal-pill">{environment.toUpperCase()}</span>
                                  ))}
                                </div>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table className="templates-table">
                        <thead>
                          <tr>
                            <th>Environment</th>
                            <th>State</th>
                            <th>Connections</th>
                            <th>Namespace</th>
                            <th>Latest request</th>
                            <th>Secret inventory</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.environments.map((snapshot) => (
                            <tr key={`${item.project_id}-${snapshot.environment}`}>
                              <td>
                                <strong>{snapshot.environment.toUpperCase()}</strong>
                                {snapshot.connected_clusters.length > 0 ? (
                                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                                    {snapshot.connected_clusters.join(', ')}
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                <span className="portal-pill" style={toneForState(snapshot.state)}>
                                  {snapshot.state}
                                </span>
                              </td>
                              <td>{snapshot.connection_count}</td>
                              <td>
                                <div>{snapshot.expected_namespace || '—'}</div>
                                {snapshot.observed_namespaces.length > 0 ? (
                                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                                    observed: {snapshot.observed_namespaces.join(', ')}
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                {snapshot.latest_request_id ? `#${snapshot.latest_request_id}` : '—'}
                                {snapshot.latest_request_status ? (
                                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                                    {snapshot.latest_request_status} · {formatDateTime(snapshot.latest_updated_at)}
                                  </div>
                                ) : null}
                              </td>
                              <td>{snapshot.secret_inventory_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
