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

interface GraphNodeLayout {
  node: DependencyNode;
  x: number;
  y: number;
}

function relationshipColor(relationship: string): string {
  switch (relationship) {
    case 'shared_service':
      return '#0ea5e9';
    case 'shared_team':
      return '#8b5cf6';
    case 'shared_cluster':
      return '#22c55e';
    case 'shared_cloud':
      return '#f97316';
    default:
      return '#94a3b8';
  }
}

export default function ProjectDependenciesPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [dependencies, setDependencies] = useState<DependencyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [showScope, setShowScope] = useState(false);

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
        const payload = asRecord(await response.json().catch(() => ({})));
        if (!response.ok) {
          throw new Error(getString(payload.error, 'Failed to load project dependencies'));
        }
        return payload;
      })
      .then((payload) => {
        if (!payload) return;
        const nextDependencies = payload.dependencies && typeof payload.dependencies === 'object'
          ? (payload.dependencies as DependencyPayload)
          : null;
        setDependencies(nextDependencies);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load project dependencies';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router]);

  const summary = dependencies?.summary;
  const projects = dependencies?.projects || [];
  const graphLayouts = useMemo(() => {
    const nodes = dependencies?.nodes || [];
    const edges = dependencies?.edges || [];
    if (nodes.length === 0) return [] as GraphNodeLayout[];

    const visibleNodeMap = new Map<number, DependencyNode>();
    const focusNode = dependencies?.focus_node;
    if (focusNode) {
      visibleNodeMap.set(focusNode.project_id, focusNode);
      edges.forEach((edge) => {
        if (edge.source_project_id === focusNode.project_id) {
          const target = nodes.find((node) => node.project_id === edge.target_project_id);
          if (target) visibleNodeMap.set(target.project_id, target);
        }
        if (edge.target_project_id === focusNode.project_id) {
          const source = nodes.find((node) => node.project_id === edge.source_project_id);
          if (source) visibleNodeMap.set(source.project_id, source);
        }
      });
    } else {
      const hotspotIds = (dependencies?.hotspots || []).slice(0, 8).map((item) => item.project_id);
      nodes.forEach((node) => {
        if (hotspotIds.includes(node.project_id)) visibleNodeMap.set(node.project_id, node);
      });
      if (visibleNodeMap.size === 0) {
        nodes.slice(0, 8).forEach((node) => visibleNodeMap.set(node.project_id, node));
      }
    }

    const visibleNodes = Array.from(visibleNodeMap.values()).slice(0, 9);
    if (visibleNodes.length === 0) return [] as GraphNodeLayout[];

    if (focusNode && visibleNodeMap.has(focusNode.project_id)) {
      const orbitNodes = visibleNodes.filter((node) => node.project_id !== focusNode.project_id);
      const layouts: GraphNodeLayout[] = [{ node: focusNode, x: 340, y: 180 }];
      orbitNodes.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(orbitNodes.length, 1);
        layouts.push({
          node,
          x: 340 + Math.cos(angle) * 170,
          y: 180 + Math.sin(angle) * 120,
        });
      });
      return layouts;
    }

    return visibleNodes.map((node, index) => {
      const angle = (Math.PI * 2 * index) / visibleNodes.length;
      return {
        node,
        x: 340 + Math.cos(angle) * 200,
        y: 180 + Math.sin(angle) * 130,
      };
    });
  }, [dependencies?.edges, dependencies?.focus_node, dependencies?.hotspots, dependencies?.nodes]);

  const visibleNodeIds = useMemo(() => graphLayouts.map((item) => item.node.project_id), [graphLayouts]);
  const visibleEdges = useMemo(() => {
    return (dependencies?.edges || []).filter((edge) => visibleNodeIds.includes(edge.source_project_id) && visibleNodeIds.includes(edge.target_project_id));
  }, [dependencies?.edges, visibleNodeIds]);
  const relationshipLegend = useMemo(() => {
    const legendMap = new Map<string, string>();
    visibleEdges.forEach((edge) => {
      if (!legendMap.has(edge.relationship)) legendMap.set(edge.relationship, edge.label);
    });
    return Array.from(legendMap.entries());
  }, [visibleEdges]);

  const hasFocusedProject = Boolean(projectId);

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
            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-page__actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="portal-pill-row">
                  <span className="portal-pill">Projects {summary.node_count}</span>
                  <span className="portal-pill">Relationships {summary.edge_count}</span>
                  <span className="portal-pill">Shared services {summary.service_edges}</span>
                  <span className="portal-pill">Shared clusters {summary.cluster_edges}</span>
                  <span className="portal-pill">Shared teams {summary.team_edges}</span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowScope((current) => !current)}>
                  {showScope ? 'Hide scope' : 'Show scope'}
                </button>
              </div>
            </section>

            {hasFocusedProject ? (
              <div className="alert alert-info" style={{ marginBottom: 24 }}>
                Viewing a focused dependency slice.
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginLeft: 12 }}
                  onClick={() => setProjectId('')}
                >
                  Clear scope
                </button>
              </div>
            ) : null}

            {showScope ? (
            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Scope</span>
                  <h2 className="portal-surface__title">Focus a project</h2>
                  <p className="portal-surface__subtitle">Use a focused graph view to inspect one project and its closest dependency peers.</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowScope(false)}>
                  Close
                </button>
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
            ) : null}

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

            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Graph view</span>
                  <h2 className="portal-surface__title">Dependency relationship graph</h2>
                  <p className="portal-surface__subtitle">
                    {dependencies?.focus_node
                      ? 'Focused project in the center with its visible dependency peers around it.'
                      : 'Top connected projects laid out as a lightweight dependency graph.'}
                  </p>
                </div>
              </div>
              {graphLayouts.length === 0 ? (
                <div className="empty-state">No graph data available for the current scope.</div>
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
                    <svg viewBox="0 0 680 360" role="img" aria-label="Project dependency graph" style={{ width: '100%', minWidth: 680, height: 'auto' }}>
                      <rect x="0" y="0" width="680" height="360" rx="24" fill="rgba(15, 23, 42, 0.02)" />
                      {visibleEdges.map((edge) => {
                        const source = graphLayouts.find((item) => item.node.project_id === edge.source_project_id);
                        const target = graphLayouts.find((item) => item.node.project_id === edge.target_project_id);
                        if (!source || !target) return null;
                        return (
                          <g key={`graph-edge-${edge.source_project_id}-${edge.target_project_id}-${edge.relationship}`}>
                            <line
                              x1={source.x}
                              y1={source.y}
                              x2={target.x}
                              y2={target.y}
                              stroke={relationshipColor(edge.relationship)}
                              strokeOpacity="0.6"
                              strokeWidth={Math.min(7, 2 + edge.shared_count)}
                            />
                          </g>
                        );
                      })}
                      {graphLayouts.map((layout) => {
                        const nodeRadius = dependencies?.focus_node?.project_id === layout.node.project_id ? 32 : 24;
                        const nodeColor = layout.node.open_incident_count > 0
                          ? 'rgba(239, 68, 68, 0.92)'
                          : layout.node.pending_request_count > 0
                            ? 'rgba(249, 115, 22, 0.92)'
                            : 'rgba(14, 165, 233, 0.92)';
                        return (
                          <g key={`graph-node-${layout.node.project_id}`}>
                            <circle cx={layout.x} cy={layout.y} r={nodeRadius} fill={nodeColor} />
                            <text x={layout.x} y={layout.y + 4} textAnchor="middle" fontSize="11" fill="#f8fafc" fontWeight="700">
                              {layout.node.project_code || String(layout.node.project_id)}
                            </text>
                            <text x={layout.x} y={layout.y + nodeRadius + 18} textAnchor="middle" fontSize="12" fill="var(--color-text)">
                              {layout.node.project_name}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  {relationshipLegend.length > 0 ? (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {relationshipLegend.map(([relationship, label]) => (
                        <span key={`legend-${relationship}`} className="portal-pill" style={{ borderColor: relationshipColor(relationship), color: relationshipColor(relationship) }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </section>

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
