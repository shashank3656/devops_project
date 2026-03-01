import type { FormEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface DevOpsTeam {
  id: number;
  name: string;
  slug: string;
  application_id: string;
}

interface AssignableUser {
  id: number;
  username: string;
  email: string;
  is_manager: boolean;
  level: string;
}

interface ProjectAccess {
  id: number;
  project_id: number;
  user_id: number;
  username: string;
  email: string;
  environment: string;
  created_at: string;
}

interface ManagedProject {
  id: number;
  team_id: number;
  team_name: string;
  group_id: string;
  name: string;
  slug: string;
  repo_root: string;
  base_branch: string;
  default_cloud: string;
  environments: string[];
  components: string[];
  access: ProjectAccess[];
}

interface ManagementResponse {
  status: string;
  teams: DevOpsTeam[];
  users: AssignableUser[];
  projects: ManagedProject[];
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function toggleSelection(value: string, current: string[]): string[] {
  if (current.includes(value)) {
    return current.filter((item) => item !== value);
  }
  return [...current, value];
}

export default function GitOpsControlPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [data, setData] = useState<ManagementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [createTeamId, setCreateTeamId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createCloud, setCreateCloud] = useState('aws');
  const [createEnvironments, setCreateEnvironments] = useState('dev, qa, prod');
  const [createComponents, setCreateComponents] = useState('networking, eks, rds');
  const [accessProjectId, setAccessProjectId] = useState('');
  const [accessUserId, setAccessUserId] = useState('');
  const [accessEnvironments, setAccessEnvironments] = useState<string[]>([]);

  const loadData = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    const response = await fetch(`${apiUrl}/api/devops/gitops/manage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      router.replace('/login');
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as Partial<ManagementResponse> & { error?: string };
    if (!response.ok || payload.status !== 'ok') {
      throw new Error(payload.error || 'Failed to load GitOps management');
    }
    const next = payload as ManagementResponse;
    setData(next);
    if (!createTeamId && next.teams.length > 0) {
      setCreateTeamId(String(next.teams[0].id));
    }
    if (!accessProjectId && next.projects.length > 0) {
      setAccessProjectId(String(next.projects[0].id));
    }
    if (!accessUserId && next.users.length > 0) {
      setAccessUserId(String(next.users[0].id));
    }
  };

  useEffect(() => {
    loadData()
      .catch((err: Error) => setError(err.message || 'Failed to load GitOps management'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const selectedProject = useMemo(() => {
    if (!data || !accessProjectId) return null;
    return data.projects.find((project) => project.id === Number(accessProjectId)) || null;
  }, [accessProjectId, data]);

  useEffect(() => {
    if (!selectedProject) {
      setAccessEnvironments([]);
      return;
    }
    setAccessEnvironments((current) => {
      const next = current.filter((value) => selectedProject.environments.includes(value));
      if (next.length > 0) return next;
      return selectedProject.environments.slice(0, 1);
    });
  }, [selectedProject]);

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          team_id: Number(createTeamId),
          name: createName,
          slug: createSlug,
          default_cloud: createCloud,
          environments: createEnvironments.split(',').map((item) => item.trim()).filter(Boolean),
          components: createComponents.split(',').map((item) => item.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.status !== 'ok') {
        throw new Error(payload?.error || 'Failed to create project structure');
      }
      setCreateName('');
      setCreateSlug('');
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project structure';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleGrantAccess = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          project_id: Number(accessProjectId),
          user_id: Number(accessUserId),
          environments: accessEnvironments,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.status !== 'ok') {
        throw new Error(payload?.error || 'Failed to grant access');
      }
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to grant access';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAccess = async (accessId: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/access/${accessId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.status !== 'ok') {
        throw new Error(payload?.error || 'Failed to remove access');
      }
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove access';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>Project Structure - DevOps Portal</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page gitops-page">
          <section className="portal-page__hero">
            <div>
              <span className="portal-page__eyebrow">Manager Control</span>
              <h1 className="portal-page__title">Project Structure</h1>
              <p className="portal-page__subtitle">
                Create GitOps project folders and files, then decide exactly which DevOps user can view each environment.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/gitops-projects" className="btn btn-secondary">
                Open GitOps Projects
              </Link>
            </div>
          </section>

          {loading ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>Loading project structure controls...</p>
              </div>
            </section>
          ) : !data ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>{error || 'Failed to load project structure controls.'}</p>
              </div>
            </section>
          ) : (
            <>
              {error && (
                <section className="portal-surface portal-surface--tight">
                  <div className="portal-empty" style={{ padding: 0, textAlign: 'left' }}>
                    <p>{error}</p>
                  </div>
                </section>
              )}
              <section className="portal-stat-grid">
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Managed Teams</span>
                  <strong className="portal-stat-card__value">{formatCount(data.teams.length)}</strong>
                  <p className="portal-stat-card__copy">DevOps teams available for project structure ownership.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Projects</span>
                  <strong className="portal-stat-card__value">{formatCount(data.projects.length)}</strong>
                  <p className="portal-stat-card__copy">GitOps structures created directly from the DevOps portal.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Access Rules</span>
                  <strong className="portal-stat-card__value">
                    {formatCount(data.projects.reduce((total, project) => total + project.access.length, 0))}
                  </strong>
                  <p className="portal-stat-card__copy">User and environment visibility rules currently enforced by managers.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Scope</span>
                  <strong className="portal-stat-card__value">{formatCount(data.users.length)}</strong>
                  <p className="portal-stat-card__copy">Assignable DevOps users available for project visibility.</p>
                </article>
              </section>

              <section className="portal-grid">
                <article className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Create Structure</span>
                      <h2 className="portal-surface__title">New GitOps project</h2>
                      <p className="portal-surface__subtitle">This defines the folder root, environments, and component file set that the portal will expose.</p>
                    </div>
                  </div>
                  <form onSubmit={handleCreateProject} className="portal-stack">
                    <div className="portal-field-grid portal-field-grid--two">
                      <div className="form-group">
                        <label className="label" htmlFor="gitops-team">DevOps Team</label>
                        <select id="gitops-team" className="input" value={createTeamId} onChange={(event) => setCreateTeamId(event.target.value)}>
                          {data.teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="label" htmlFor="gitops-cloud">Default Cloud</label>
                        <select id="gitops-cloud" className="input" value={createCloud} onChange={(event) => setCreateCloud(event.target.value)}>
                          <option value="aws">aws</option>
                          <option value="azure">azure</option>
                          <option value="gcp">gcp</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="label" htmlFor="gitops-name">Project Name</label>
                        <input id="gitops-name" className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="payments-platform" />
                      </div>
                      <div className="form-group">
                        <label className="label" htmlFor="gitops-slug">Project Slug</label>
                        <input id="gitops-slug" className="input" value={createSlug} onChange={(event) => setCreateSlug(event.target.value)} placeholder="payments-platform" />
                      </div>
                    </div>
                    <div className="portal-field-grid portal-field-grid--two">
                      <div className="form-group">
                        <label className="label" htmlFor="gitops-envs">Environments</label>
                        <input id="gitops-envs" className="input" value={createEnvironments} onChange={(event) => setCreateEnvironments(event.target.value)} placeholder="dev, qa, prod" />
                      </div>
                      <div className="form-group">
                        <label className="label" htmlFor="gitops-components">Components</label>
                        <input id="gitops-components" className="input" value={createComponents} onChange={(event) => setCreateComponents(event.target.value)} placeholder="networking, eks, rds" />
                      </div>
                    </div>
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-primary" disabled={saving}>
                        {saving ? 'Saving...' : 'Create project structure'}
                      </button>
                    </div>
                  </form>
                </article>

                <article className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Grant Access</span>
                      <h2 className="portal-surface__title">Environment visibility</h2>
                      <p className="portal-surface__subtitle">Managers decide which DevOps user can see which project environments. Users only see assigned environments in GitOps Projects.</p>
                    </div>
                  </div>
                  <form onSubmit={handleGrantAccess} className="portal-stack">
                    <div className="portal-field-grid portal-field-grid--two">
                      <div className="form-group">
                        <label className="label" htmlFor="access-project">Project</label>
                        <select id="access-project" className="input" value={accessProjectId} onChange={(event) => setAccessProjectId(event.target.value)}>
                          {data.projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="label" htmlFor="access-user">User</label>
                        <select id="access-user" className="input" value={accessUserId} onChange={(event) => setAccessUserId(event.target.value)}>
                          {data.users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.username}{user.email ? ` (${user.email})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="form-group">
                      <span className="label">Visible Environments</span>
                      <div className="gitops-check-row">
                        {(selectedProject?.environments || []).map((environment) => (
                          <label key={environment} className="gitops-check">
                            <input
                              type="checkbox"
                              checked={accessEnvironments.includes(environment)}
                              onChange={() => setAccessEnvironments((current) => toggleSelection(environment, current))}
                            />
                            <span>{environment}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-primary" disabled={saving || accessEnvironments.length === 0}>
                        {saving ? 'Saving...' : 'Grant access'}
                      </button>
                    </div>
                  </form>
                </article>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Current Structures</span>
                    <h2 className="portal-surface__title">Project catalog</h2>
                    <p className="portal-surface__subtitle">Every project below was created from the portal and carries its own access rules.</p>
                  </div>
                </div>
                {data.projects.length === 0 ? (
                  <div className="portal-empty">
                    <p>No GitOps project structure exists yet.</p>
                  </div>
                ) : (
                  <div className="gitops-control-grid">
                    {data.projects.map((project) => (
                      <article key={project.id} className="gitops-control-card">
                        <div className="gitops-control-card__header">
                          <div>
                            <h3 className="gitops-control-card__title">{project.name}</h3>
                            <p className="gitops-control-card__subtitle">{project.repo_root}</p>
                          </div>
                          <span className="portal-badge portal-badge--neutral">{project.team_name}</span>
                        </div>

                        <div className="portal-pill-row">
                          <span className="portal-pill">Group ID {project.group_id}</span>
                          <span className="portal-pill">{project.default_cloud || 'aws'}</span>
                          <span className="portal-pill">{project.base_branch}</span>
                        </div>

                        <div className="gitops-control-card__section">
                          <strong>Environments</strong>
                          <div className="portal-pill-row">
                            {project.environments.map((environment) => (
                              <span key={environment} className="portal-pill">{environment}</span>
                            ))}
                          </div>
                        </div>

                        <div className="gitops-control-card__section">
                          <strong>Components</strong>
                          <div className="portal-pill-row">
                            {project.components.map((component) => (
                              <span key={component} className="portal-pill">{component}</span>
                            ))}
                          </div>
                        </div>

                        <div className="gitops-control-card__section">
                          <strong>Access Rules</strong>
                          {project.access.length === 0 ? (
                            <p className="gitops-control-card__empty">No user access assigned yet.</p>
                          ) : (
                            <div className="gitops-access-list">
                              {project.access.map((access) => (
                                <div key={access.id} className="gitops-access-list__item">
                                  <div>
                                    <strong>{access.username}</strong>
                                    <p>{access.email || 'No email'} · {access.environment}</p>
                                  </div>
                                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void handleRemoveAccess(access.id)}>
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
