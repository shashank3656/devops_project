import { useEffect, useState } from 'react';
import Link from 'next/link';
import Head from 'next/head';

interface ProjectServiceOption {
  cloud: string;
  service: string;
}

interface ProjectTeamAccess {
  team_id: number;
  team_name: string;
  team_slug: string;
  environments: string[];
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  description: string;
  status: string;
  onboarding_stage?: string;
  ready_for_requests?: boolean;
  service_count?: number;
  team_count?: number;
  owner_team?: string;
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
}

interface RecentProjectRequest {
  id: number;
  project_id?: number | null;
  project_name?: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  created_at: string;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default function MyProjects() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [recentRequests, setRecentRequests] = useState<RecentProjectRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      setLoading(false);
      setError('Login required');
      return;
    }
    Promise.all([
      fetch(`${apiUrl}/api/me/projects`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/history?limit=12`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([projectsRes, historyRes]) => {
        const [projectsData, historyData] = await Promise.all([
          projectsRes.json().catch(() => ({})),
          historyRes.json().catch(() => ({})),
        ]);
        if (!projectsRes.ok) {
          throw new Error(projectsData?.error || 'Failed to load projects');
        }
        setProjects(Array.isArray(projectsData.projects) ? projectsData.projects : []);
        setRecentRequests(Array.isArray(historyData.requests) ? historyData.requests : []);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const summary = {
    total: projects.length,
    ready: projects.filter((project) => project.ready_for_requests).length,
    services: projects.reduce((sum, project) => sum + (project.service_count ?? project.services.length), 0),
    pending: recentRequests.filter((request) => request.status !== 'completed' && request.status !== 'rejected').length,
  };

  return (
    <>
      <Head>
        <title>My Projects - Infrastructure Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Catalog</span>
            <h1 className="portal-page__title">My Projects</h1>
            <p className="portal-page__subtitle">
              These are the projects, environments, clouds, and services your teams are allowed to request against.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/create-infrastructure" className="btn btn-primary">
              Create request
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="portal-surface">
            <div className="empty-state">Loading projects...</div>
          </div>
        ) : error ? (
          <div className="portal-surface">
            <div className="empty-state">{error}</div>
          </div>
        ) : projects.length === 0 ? (
          <div className="portal-surface">
            <div className="empty-state">No projects are assigned to your teams yet.</div>
          </div>
        ) : (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Assigned projects</span>
                <span className="portal-stat-card__value">{summary.total}</span>
                <p className="portal-stat-card__copy">Projects your current team memberships can request against.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Ready now</span>
                <span className="portal-stat-card__value">{summary.ready}</span>
                <p className="portal-stat-card__copy">Projects fully ready for request intake.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Allowed services</span>
                <span className="portal-stat-card__value">{summary.services}</span>
                <p className="portal-stat-card__copy">Service options across your visible project catalog.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Open activity</span>
                <span className="portal-stat-card__value">{summary.pending}</span>
                <p className="portal-stat-card__copy">Recent project-scoped requests still in flight.</p>
              </article>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">How It Works</span>
                  <h2 className="portal-surface__title">Project-first request flow</h2>
                  <p className="portal-surface__subtitle">
                    Pick a project first, then request only the clouds and services that DevOps has allowed for that project.
                  </p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <div className="request-choice-card">
                  <strong>1. Choose project</strong>
                  <p style={{ marginTop: 8 }}>Start from the project that owns the workload or environment you need.</p>
                </div>
                <div className="request-choice-card">
                  <strong>2. Pick allowed service</strong>
                  <p style={{ marginTop: 8 }}>Each project exposes only the clouds, services, and environments approved for that team scope.</p>
                </div>
                <div className="request-choice-card">
                  <strong>3. Track delivery</strong>
                  <p style={{ marginTop: 8 }}>Use project history and detail pages to follow approvals, provisioning, and completion state.</p>
                </div>
              </div>
            </section>

            <div className="portal-grid">
              {projects.map((project) => {
              const servicesByCloud = project.clouds.map((cloud) => ({
                cloud,
                services: project.services.filter((service) => service.cloud === cloud).map((service) => service.service),
              }));
              const projectRequests = recentRequests
                .filter((request) => Number(request.project_id) === project.id)
                .slice(0, 3);
              return (
                <section key={project.id} className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">{project.code}</span>
                      <h2 className="portal-surface__title">{project.name}</h2>
                      <p className="portal-surface__subtitle">
                        {project.description || 'Project-managed infrastructure request scope.'}
                      </p>
                    </div>
                    <div className="portal-page__actions">
                      <Link href={`/my-projects/${project.id}`} className="btn btn-secondary">
                        View details
                      </Link>
                      <Link href={`/select-service?project_id=${project.id}`} className="btn btn-primary">
                        Request service
                      </Link>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
                    <span className="portal-pill">{project.status}</span>
                    <span className="portal-pill">{project.onboarding_stage || 'configured'}</span>
                    <span className="portal-pill">{project.ready_for_requests ? 'ready for requests' : 'setup in progress'}</span>
                    <span className="portal-pill">{project.service_count ?? project.services.length} services</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                    <div>
                      <strong>Environments</strong>
                      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {project.environments.map((environment) => (
                          <span key={environment} className="portal-pill">{environment}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <strong>Team Access</strong>
                      <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                        {project.team_access.map((access) => (
                          <li key={`${project.id}-${access.team_id}`}>
                            {access.team_name}: {access.environments.join(', ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>Quick actions</strong>
                      <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                        <Link href={`/select-service?project_id=${project.id}`} className="btn btn-primary btn-sm">
                          Request an allowed service
                        </Link>
                        <Link href={`/history?project_id=${project.id}`} className="btn btn-secondary btn-sm">
                          View project request history
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                    {servicesByCloud.map((entry) => (
                      <div key={`${project.id}-${entry.cloud}`} className="request-choice-card">
                        <strong>{entry.cloud.toUpperCase()}</strong>
                        <p style={{ marginTop: 8 }}>{entry.services.join(', ') || 'No services configured'}</p>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 18 }}>
                    <strong>Recent request activity</strong>
                    {projectRequests.length === 0 ? (
                      <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                        No recent requests for this project yet. Start with the allowed services above.
                      </p>
                    ) : (
                      <div style={{ overflowX: 'auto', marginTop: 10 }}>
                        <table className="templates-table">
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Environment</th>
                              <th>Cloud</th>
                              <th>Service</th>
                              <th>Status</th>
                              <th>Created</th>
                            </tr>
                          </thead>
                          <tbody>
                            {projectRequests.map((request) => (
                              <tr key={`project-request-${request.id}`}>
                                <td>{request.id}</td>
                                <td>{request.env}</td>
                                <td>{request.cloud}</td>
                                <td>{request.service}</td>
                                <td>{request.status.replace(/_/g, ' ')}</td>
                                <td>{formatDateTime(request.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
