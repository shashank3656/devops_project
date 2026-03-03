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

export default function MyProjects() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
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
    fetch(`${apiUrl}/api/me/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load projects');
        }
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl]);

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
          <div className="portal-grid">
            {projects.map((project) => {
              const servicesByCloud = project.clouds.map((cloud) => ({
                cloud,
                services: project.services.filter((service) => service.cloud === cloud).map((service) => service.service),
              }));
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
                  </div>

                  <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                    {servicesByCloud.map((entry) => (
                      <div key={`${project.id}-${entry.cloud}`} className="request-choice-card">
                        <strong>{entry.cloud.toUpperCase()}</strong>
                        <p style={{ marginTop: 8 }}>{entry.services.join(', ') || 'No services configured'}</p>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
