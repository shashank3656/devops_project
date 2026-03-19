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

interface DependencySummary {
  node_count: number;
  edge_count: number;
  service_edges: number;
  team_edges: number;
  cluster_edges: number;
  cloud_edges: number;
}

interface DependencyNode {
  project_id: number;
  project_name: string;
  project_code: string;
  status: string;
  owner_team?: string;
  environments: string[];
  clouds: string[];
  teams: string[];
  services: string[];
  clusters: string[];
  pending_request_count: number;
  open_incident_count: number;
  dependency_edge_count: number;
  dependency_peer_count: number;
}

interface DependencyEdge {
  source_project_id: number;
  source_project_name: string;
  source_project_code: string;
  target_project_id: number;
  target_project_name: string;
  target_project_code: string;
  relationship: string;
  label: string;
  shared_count: number;
  shared_values: string[];
}

interface DependencyHotspot {
  project_id: number;
  project_name: string;
  project_code: string;
  relationship_count: number;
  peer_count: number;
  shared_labels: string[];
}

interface DependencyPayload {
  projects: ProjectSummary[];
  summary: DependencySummary;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  hotspots: DependencyHotspot[];
  focus_project_id?: number;
  focus_node?: DependencyNode;
}

export default function ProjectDependenciesPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [dependencies, setDependencies] = useState<DependencyPayload | null>(null);
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

    fetch(`${apiUrl}/api/devops/project-dependencies?${params.toString()}`, {
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
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load project dependencies');
        }
        return data;
      })
      .then((data) => {
        if (!data) return;
        setDependencies(data?.dependencies || null);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load project dependencies';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router]);

  const summary = dependencies?.summary;
  const projects = dependencies?.projects || [];

  return (
    <DevOpsLayout>
      <Head>
        <title>Project Dependencies - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Dependency Map</span>
            <h1 className="portal-page__title">Project Dependency Map</h1>
            <p className="portal-page__subtitle">
              Visualize shared services, teams, clusters, and cloud footprints so change impact is visible before approval and release.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/projects" className="btn btn-secondary">Projects</Link>
            <Link href="/service-heatmap" className="btn btn-secondary">Service heatmap</Link>
            <Link href="/ops-command-center" className="btn btn-primary">Ops Command Center</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading project dependency map...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && summary ? (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Projects in scope</span>
                <strong className="portal-stat-card__value">{summary.node_count}</strong>
                <p className="portal-stat-card__copy">Projects included in the current dependency graph.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Relationships</span>
                <strong className="portal-stat-card__value">{summary.edge_count}</strong>
                <p className="portal-stat-card__copy">Detected dependency edges across service, team, cluster, and cloud overlap.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Shared services</span>
                <strong className="portal-stat-card__value">{summary.service_edges}</strong>
                <p className="portal-stat-card__copy">Dependency edges caused by common service usage.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Shared clusters</span>
                <strong className="portal-stat-card__value">{summary.cluster_edges}</strong>
                <p className="portal-stat-card__copy">Projects sharing cluster placement and operational blast radius.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Shared teams</span>
                <strong className="portal-stat-card__value">{summary.team_edges}</strong>
                <p className="portal-stat-card__copy">Projects coupled through the same ownership or delivery teams.</p>
              </article>
            </section>

            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Scope</span>
                  <h2 className="portal-surface__title">Focus a project</h2>
                  <p className="portal-surface__subtitle">Use a focused graph view to inspect one project and its closest dependency peers.</p>
                </div>
              </div>
              <div className="portal-toolbar">
                <div className="portal-toolbar__group">
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="dependency-project-filter">Project</label>
                    <select
                      id="dependency-project-filter"
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

            {dependencies?.focus_node ? (
              <section className="portal-surface" style={{ marginBottom: 24 }}>
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Focused project</span>
                    <h2 className="portal-surface__title">{dependencies.focus_node.project_name}</h2>
                    <p className="portal-surface__subtitle">
                      {dependencies.focus_node.project_code} · {dependencies.focus_node.dependency_peer_count} peer projects · {dependencies.focus_node.dependency_edge_count} relationships
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {dependencies.focus_node.services.map((service) => (
                    <span key={`focus-service-${service}`} className="portal-pill">{service}</span>
                  ))}
                  {dependencies.focus_node.clusters.map((cluster) => (
                    <span key={`focus-cluster-${cluster}`} className="portal-pill">{cluster}</span>
                  ))}
                  {dependencies.focus_node.teams.map((team) => (
                    <span key={`focus-team-${team}`} className="portal-pill">{team}</span>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="portal-grid" style={{ alignItems: 'start' }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Hotspots</span>
                    <h2 className="portal-surface__title">Most connected projects</h2>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {(dependencies?.hotspots || []).map((item) => (
                    <article key={`hotspot-${item.project_id}`} className="portal-surface" style={{ padding: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <strong>{item.project_name}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_code}</div>
                        </div>
                        <span className="portal-pill">{item.relationship_count} relationships · {item.peer_count} peers</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        {item.shared_labels.map((label) => (
                          <span key={`${item.project_id}-${label}`} className="portal-pill">{label}</span>
                        ))}
                      </div>
                    </article>
                  ))}
                  {(dependencies?.hotspots || []).length === 0 ? (
                    <div className="empty-state">No dependency hotspots were found in the current scope.</div>
                  ) : null}
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Nodes</span>
                    <h2 className="portal-surface__title">Project graph nodes</h2>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Peers</th>
                        <th>Edges</th>
                        <th>Pending</th>
                        <th>Incidents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dependencies?.nodes || []).map((node) => (
                        <tr key={`node-${node.project_id}`}>
                          <td>
                            <Link href={`/projects/${node.project_id}`}><strong>{node.project_name}</strong></Link>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{node.project_code}</div>
                          </td>
                          <td>{node.dependency_peer_count}</td>
                          <td>{node.dependency_edge_count}</td>
                          <td>{node.pending_request_count}</td>
                          <td>{node.open_incident_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <section className="portal-surface" style={{ marginTop: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Edges</span>
                  <h2 className="portal-surface__title">Shared dependency relationships</h2>
                  <p className="portal-surface__subtitle">Each row shows why two projects are operationally coupled.</p>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>To</th>
                      <th>Relationship</th>
                      <th>Shared count</th>
                      <th>Shared values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dependencies?.edges || []).map((edge) => (
                      <tr key={`${edge.source_project_id}-${edge.target_project_id}-${edge.relationship}`}>
                        <td>
                          <strong>{edge.source_project_name}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{edge.source_project_code}</div>
                        </td>
                        <td>
                          <strong>{edge.target_project_name}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{edge.target_project_code}</div>
                        </td>
                        <td>{edge.label}</td>
                        <td>{edge.shared_count}</td>
                        <td>{edge.shared_values.join(', ')}</td>
                      </tr>
                    ))}
                    {(dependencies?.edges || []).length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty-state">No dependency edges were found for the current scope.</div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
