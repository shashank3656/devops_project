import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

interface UserSavedConfig {
  id: number;
  name: string;
  cloud: string;
  env: string;
  service: string;
  created_at: string;
}

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
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export default function CreateInfrastructureNew() {
  const router = useRouter();
  const [savedConfigs, setSavedConfigs] = useState<UserSavedConfig[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedConfigsError, setSavedConfigsError] = useState('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [router]);

  const fetchSavedConfigs = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoadingSaved(true);
    setSavedConfigsError('');
    fetch(`${apiUrl}/api/me/saved-configs`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.saved_configs)) {
          setSavedConfigs(data.saved_configs);
          setSavedConfigsError('');
        } else {
          setSavedConfigs([]);
          setSavedConfigsError('');
        }
      })
      .catch(() => {
        setSavedConfigs([]);
        setSavedConfigsError('');
      })
      .finally(() => setLoadingSaved(false));
  }, [apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    fetchSavedConfigs();
  }, [fetchSavedConfigs]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setLoadingProjects(true);
    setProjectsError('');
    fetch(`${apiUrl}/api/me/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load projects');
        }
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      })
      .catch((err: Error) => {
        setProjects([]);
        setProjectsError(err.message || 'Failed to load projects');
      })
      .finally(() => setLoadingProjects(false));
  }, [apiUrl]);

  const projectCards = useMemo(() => {
    return projects.map((project) => {
      const serviceCount = project.services.length;
      const teamCount = project.team_access.length;
      return {
        ...project,
        summary: `${project.clouds.length} cloud lane(s), ${serviceCount} allowed service(s), ${teamCount} team mapping(s)`,
      };
    });
  }, [projects]);

  return (
    <>
      <Head>
        <title>Create Infrastructure - InfraGate</title>
        <meta name="description" content="Create infrastructure resources" />
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Create Infrastructure</span>
            <h1 className="portal-page__title">Create Infrastructure Request</h1>
            <p className="portal-page__subtitle">
              Start from an assigned project, then continue into the approved clouds and services configured for that project.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/custom-json" className="btn btn-secondary">
              Custom JSON
            </Link>
            <Link href="/history" className="btn btn-secondary">
              Open request history
            </Link>
          </div>
        </div>

        {(savedConfigs.length > 0 || savedConfigsError || loadingSaved) && (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Saved Configurations</span>
                <h2 className="portal-surface__title">Reuse Saved Configurations</h2>
                <p className="portal-surface__subtitle">Pull forward a saved request and continue from the cloud, environment, and service state you already trust.</p>
              </div>
            </div>

            {loadingSaved ? (
              <div className="empty-state">Loading saved configurations...</div>
            ) : savedConfigs.length === 0 ? (
              <div className="empty-state">No saved configurations available yet.</div>
            ) : (
              <div className="request-saved-grid">
                {savedConfigs.map((config) => (
                  <button
                    key={config.id}
                    type="button"
                    className="request-saved-card"
                    onClick={() =>
                      router.push(
                        `/select-service?cloud=${encodeURIComponent(config.cloud)}&env=${encodeURIComponent(config.env)}&service=${encodeURIComponent(config.service)}&saved_id=${config.id}`,
                      )
                    }
                  >
                    <div>
                      <h3 className="request-saved-card__title">{config.name}</h3>
                      <p>Resume a request path based on this saved configuration.</p>
                    </div>
                    <div className="request-saved-card__meta">
                      <span className="portal-pill">{config.cloud}</span>
                      <span className="portal-pill">{config.env}</span>
                      <span className="portal-pill">{config.service}</span>
                    </div>
                    <small>Saved on {formatDate(config.created_at)}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Assigned Projects</span>
              <h2 className="portal-surface__title">Choose a project first</h2>
              <p className="portal-surface__subtitle">Projects control which teams, environments, clouds, and services you can request.</p>
            </div>
            <div className="portal-page__actions">
              <Link href="/my-projects" className="btn btn-secondary">
                View all projects
              </Link>
            </div>
          </div>

          {loadingProjects ? (
            <div className="empty-state">Loading projects...</div>
          ) : projectsError ? (
            <div className="empty-state">{projectsError}</div>
          ) : projectCards.length === 0 ? (
            <div className="empty-state">No projects are assigned to your teams yet.</div>
          ) : (
            <div className="request-studio-grid">
              {projectCards.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="request-cloud-card"
                  onClick={() => router.push(`/select-service?project_id=${project.id}`)}
                >
                  <div>
                    <span className="portal-pill">{project.code}</span>
                    <h2 className="request-cloud-card__title" style={{ marginTop: 12 }}>{project.name}</h2>
                    <p>{project.description || project.summary}</p>
                  </div>
                  <div className="request-studio-actions">
                    {project.environments.slice(0, 3).map((environment) => (
                      <span key={`${project.id}-${environment}`} className="portal-badge portal-badge--neutral">{environment}</span>
                    ))}
                  </div>
                  <small>{project.summary}</small>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="portal-grid">
          <article className="request-choice-card">
            <strong>Need maximum control?</strong>
            <p>Use Custom JSON when you already have a project-approved payload and want to submit it directly into the review flow.</p>
            <div className="request-studio-actions">
              <Link href="/custom-json" className="btn btn-primary">
                Open Custom JSON
              </Link>
            </div>
          </article>

          <article className="request-choice-card">
            <strong>Need project context first?</strong>
            <p>Open My Projects to review allowed teams, environments, clouds, and services before raising a request.</p>
            <div className="request-studio-actions">
              <Link href="/my-projects" className="btn btn-secondary">
                Open My Projects
              </Link>
            </div>
          </article>
        </section>
      </div>
    </>
  );
}
