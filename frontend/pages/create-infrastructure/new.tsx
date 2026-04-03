import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { asRecord, getString } from '../../lib/payload';

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
        const data = asRecord(await res.json().catch(() => ({})));
        if (res.ok && Array.isArray(data.saved_configs)) {
          setSavedConfigs(data.saved_configs as UserSavedConfig[]);
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
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(data.error, 'Failed to load projects'));
        }
        setProjects(Array.isArray(data.projects) ? (data.projects as ProjectOption[]) : []);
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
        <title>Create Infrastructure - SetuOps</title>
        <meta name="description" content="Create infrastructure resources" />
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">New Request</span>
            <h1 className="portal-page__title">Choose where to start</h1>
            <p className="portal-page__subtitle">
              Start from a project, reuse a saved request, or switch to Advanced JSON if you already know the full payload.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/custom-json" className="btn btn-secondary">
              Advanced JSON
            </Link>
            <Link href="/history" className="btn btn-secondary">
              My Requests
            </Link>
          </div>
        </div>

        {(savedConfigs.length > 0 || savedConfigsError || loadingSaved) && (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Saved Requests</span>
                <h2 className="portal-surface__title">Reuse something you already trust</h2>
                <p className="portal-surface__subtitle">Open a saved setup and continue from the last cloud, environment, and service you used.</p>
              </div>
            </div>

            {loadingSaved ? (
              <div className="empty-state">Loading saved requests...</div>
            ) : savedConfigs.length === 0 ? (
              <div className="empty-state">No saved requests yet.</div>
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
                      <p>Reuse this saved request and continue from there.</p>
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
              <span className="portal-surface__eyebrow">Projects</span>
              <h2 className="portal-surface__title">Pick a project</h2>
              <p className="portal-surface__subtitle">Projects decide which teams, environments, clouds, and services you can request.</p>
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
            <div className="empty-state">No projects are assigned to you yet.</div>
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
            <strong>Need more control?</strong>
            <p>Use Advanced JSON when you already have the full request body and want to send it directly for review.</p>
            <div className="request-studio-actions">
              <Link href="/custom-json" className="btn btn-primary">
                Open Advanced JSON
              </Link>
            </div>
          </article>

          <article className="request-choice-card">
            <strong>Need to check access first?</strong>
            <p>Open My Projects to review the teams, environments, clouds, and services available to you before starting.</p>
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
