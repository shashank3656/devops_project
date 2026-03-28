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
            <section className="my-project-strip">
              <article className="my-project-pill">
                <span className="my-project-pill__label">Assigned projects</span>
                <strong className="my-project-pill__value">{summary.total}</strong>
              </article>
              <article className="my-project-pill">
                <span className="my-project-pill__label">Ready now</span>
                <strong className="my-project-pill__value">{summary.ready}</strong>
              </article>
              <article className="my-project-pill">
                <span className="my-project-pill__label">Allowed services</span>
                <strong className="my-project-pill__value">{summary.services}</strong>
              </article>
              <article className="my-project-pill">
                <span className="my-project-pill__label">Open activity</span>
                <strong className="my-project-pill__value">{summary.pending}</strong>
              </article>
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
                        {project.description || 'Request only the environments and services approved for this project.'}
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

                  <div className="my-project-card__meta">
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
                      <strong>Clouds and services</strong>
                      <div className="my-project-card__list" style={{ marginTop: 8 }}>
                        {servicesByCloud.map((entry) => (
                          <div key={`${project.id}-${entry.cloud}`}>
                            <strong>{entry.cloud.toUpperCase()}</strong>: {entry.services.join(', ') || 'No services configured'}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="my-project-card__recent">
                    <strong>Recent activity</strong>
                    {projectRequests.length === 0 ? (
                      <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                        No recent requests yet. You can start from the allowed services above.
                      </p>
                    ) : (
                      <div className="my-project-card__list" style={{ marginTop: 10 }}>
                        {projectRequests.map((request) => (
                          <div key={`project-request-${request.id}`}>
                            <strong>#{request.id}</strong> · {request.env} · {request.cloud} · {request.service} · {request.status.replace(/_/g, ' ')} · {formatDateTime(request.created_at)}
                          </div>
                        ))}
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
