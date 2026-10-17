import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface GitOpsRepo {
  owner: string;
  repository: string;
  base_branch: string;
}

interface GitOpsOverview {
  project_count: number;
  request_count: number;
  pending_count: number;
}

interface GitOpsWorkflowStep {
  step: string;
  detail: string;
}

interface GitOpsComponentSummary {
  name: string;
  key: string;
  manifest_path: string;
  request_count: number;
  last_updated?: string;
}

interface GitOpsEnvironmentSummary {
  name: string;
  folder_path: string;
  request_count: number;
  pending_count: number;
  in_flight_count: number;
  completed_count: number;
  last_updated?: string;
  components: GitOpsComponentSummary[];
}

interface GitOpsRecentChange {
  request_id: number;
  application_id: string;
  service: string;
  cloud: string;
  environment: string;
  status: string;
  branch: string;
  file_path: string;
  updated_at: string;
}

interface GitOpsProjectSummary {
  project_id: number;
  team_id: number;
  project_name: string;
  project_slug: string;
  group_id: string;
  project_key: string;
  repo_root: string;
  github_owner?: string;
  github_repo?: string;
  live_request_path_pattern: string;
  manifest_path_pattern: string;
  branch_pattern: string;
  default_environment: string;
  default_cloud: string;
  current_permission: string;
  can_write: boolean;
  can_manage: boolean;
  request_count: number;
  pending_count: number;
  in_flight_count: number;
  environments: GitOpsEnvironmentSummary[];
  recent_changes: GitOpsRecentChange[];
  folder_tree: string[];
  delivery_mode: string;
}

interface GitOpsPreview {
  project_id: number;
  team_id: number;
  project_name: string;
  group_id: string;
  environment: string;
  component: string;
  repo_root: string;
  environment_folder: string;
  manifest_path: string;
  live_request_path: string;
  branch_example: string;
  pull_request_title: string;
  base_branch: string;
  sample_manifest: Record<string, unknown>;
}

interface GitOpsProjectsResponse {
  status: string;
  repo: GitOpsRepo;
  overview: GitOpsOverview;
  workflow: GitOpsWorkflowStep[];
  projects: GitOpsProjectSummary[];
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatTimestamp(value?: string): string {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No activity yet';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatRelativeTime(value?: string): string {
  if (!value) return 'No recent changes';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No recent changes';
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function pickProjectDefaults(project?: GitOpsProjectSummary): { env: string; component: string } {
  const environment = project?.environments[0];
  const component = environment?.components[0];
  return {
    env: environment?.name || project?.default_environment || 'dev',
    component: component?.key || 'infrastructure',
  };
}

function getStatusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'pending_approval' || status === 'pending_user_manager_approval' || status === 'pending_devops_approval') {
    return 'warning';
  }
  return 'neutral';
}

export default function GitOpsProjectsPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [data, setData] = useState<GitOpsProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedEnv, setSelectedEnv] = useState('');
  const [selectedComponent, setSelectedComponent] = useState('');
  const [preview, setPreview] = useState<GitOpsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const openBuilder = () => {
    void router.push('/gitops-control/new');
  };

  const openProjectInfra = (projectId?: number) => {
    const target = projectId ? `/gitops-control/${projectId}/edit` : '/gitops-control/new';
    void router.push(target);
  };

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }

    fetch(`${apiUrl}/api/devops/gitops/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          router.replace('/login');
          return null;
        }
        const payload = (await response.json().catch(() => ({}))) as Partial<GitOpsProjectsResponse> & { error?: string };
        if (!response.ok || payload.status !== 'ok') {
          throw new Error(payload.error || 'Failed to load GitOps projects');
        }
        return payload as GitOpsProjectsResponse;
      })
      .then((payload) => {
        if (!payload) return;
        setData(payload);
        if (payload.projects.length > 0) {
          const defaults = pickProjectDefaults(payload.projects[0]);
          setSelectedProjectId(payload.projects[0].project_id);
          setSelectedEnv(defaults.env);
          setSelectedComponent(defaults.component);
        }
      })
      .catch((err: Error) => setError(err.message || 'Failed to load GitOps projects'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const selectedProject = useMemo(() => {
    if (!data || selectedProjectId == null) return null;
    return data.projects.find((project) => project.project_id === selectedProjectId) || null;
  }, [data, selectedProjectId]);

  const selectedEnvironment = useMemo(() => {
    if (!selectedProject) return null;
    return selectedProject.environments.find((environment) => environment.name === selectedEnv) || null;
  }, [selectedEnv, selectedProject]);

  useEffect(() => {
    if (!selectedProject) return;
    const defaults = pickProjectDefaults(selectedProject);
    const environmentExists = selectedProject.environments.some((environment) => environment.name === selectedEnv);
    if (!environmentExists) {
      setSelectedEnv(defaults.env);
      setSelectedComponent(defaults.component);
      return;
    }

    const componentExists = selectedEnvironment?.components.some((component) => component.key === selectedComponent) ?? false;
    if (!componentExists) {
      setSelectedComponent(selectedEnvironment?.components[0]?.key || 'infrastructure');
    }
  }, [selectedComponent, selectedEnv, selectedEnvironment, selectedProject]);

  useEffect(() => {
    if (!selectedProject || !selectedEnv || !selectedComponent) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;

    const query = new URLSearchParams({
      project_id: String(selectedProject.project_id),
      env: selectedEnv,
      component: selectedComponent,
    });

    setPreviewLoading(true);
    setPreviewError('');

    fetch(`${apiUrl}/api/devops/gitops/preview?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { status?: string; error?: string; preview?: GitOpsPreview };
        if (!response.ok || payload.status !== 'ok' || !payload.preview) {
          throw new Error(payload.error || 'Failed to load GitOps preview');
        }
        return payload.preview;
      })
      .then((payload) => setPreview(payload))
      .catch((err: Error) => {
        setPreview(null);
        setPreviewError(err.message || 'Failed to load GitOps preview');
      })
      .finally(() => setPreviewLoading(false));
  }, [apiUrl, selectedComponent, selectedEnv, selectedProject]);

  const manifestJson = useMemo(() => {
    if (!preview?.sample_manifest) return '{}';
    return JSON.stringify(preview.sample_manifest, null, 2);
  }, [preview]);

  const permissionLabel = selectedProject?.current_permission || 'read';

  const handleProjectSelect = (project: GitOpsProjectSummary) => {
    const defaults = pickProjectDefaults(project);
    setSelectedProjectId(project.project_id);
    setSelectedEnv(defaults.env);
    setSelectedComponent(defaults.component);
  };

  return (
    <>
      <Head>
        <title>GitOps Projects - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page gitops-page">
          <section className="portal-page__hero">
            <div>
              <span className="portal-page__eyebrow">GitOps Control</span>
              <h1 className="portal-page__title">GitOps Projects</h1>
              <p className="portal-page__subtitle">
                Select a project, then either create the folder structure or open the same project in Project-Infra for view and edit actions.
              </p>
            </div>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-primary" onClick={openBuilder}>
                Create folder structure
              </button>
              {selectedProject?.can_manage ? (
                <button type="button" className="btn btn-secondary" onClick={() => openProjectInfra(selectedProject.project_id)}>
                  View / Edit
                </button>
              ) : (
                <span className="portal-pill">Read-only access</span>
              )}
            </div>
          </section>

          {loading ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>Loading GitOps projects...</p>
              </div>
            </section>
          ) : error ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>{error}</p>
              </div>
            </section>
          ) : !data || data.projects.length === 0 ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>No DevOps projects are available yet. A DevOps manager must create the project structure and grant environment access first.</p>
                <div className="portal-form-actions" style={{ justifyContent: 'center', marginTop: '1rem' }}>
                  <button type="button" className="btn btn-primary" onClick={openBuilder}>
                    Open Project-Infra
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="portal-stat-grid">
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Projects</span>
                  <strong className="portal-stat-card__value">{formatCount(data.overview.project_count)}</strong>
                  <p className="portal-stat-card__copy">Team-scoped GitOps roots currently visible in OpsTrellis.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Requests</span>
                  <strong className="portal-stat-card__value">{formatCount(data.overview.request_count)}</strong>
                  <p className="portal-stat-card__copy">Provisioning changes already tracked through the branch and PR path.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Pending</span>
                  <strong className="portal-stat-card__value">{formatCount(data.overview.pending_count)}</strong>
                  <p className="portal-stat-card__copy">Queued approvals still waiting before CI and apply can continue.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Baseline</span>
                  <strong className="portal-stat-card__value">{data.repo.base_branch}</strong>
                  <p className="portal-stat-card__copy">All project changes converge on the main GitOps control branch.</p>
                </article>
              </section>

              <section className="portal-grid portal-grid--wide">
                <article className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Repository</span>
                      <h2 className="portal-surface__title">Source of truth</h2>
                      <p className="portal-surface__subtitle">The portal writes structured change intent, while Git remains the approval and execution boundary.</p>
                    </div>
                  </div>
                  <div className="portal-detail-grid">
                    <div className="portal-detail-card">
                      <span className="portal-surface__eyebrow">Owner</span>
                      <strong className="portal-detail-card__value">{data.repo.owner || 'Not configured'}</strong>
                    </div>
                    <div className="portal-detail-card">
                      <span className="portal-surface__eyebrow">Repository</span>
                      <strong className="portal-detail-card__value">{data.repo.repository || 'Not configured'}</strong>
                    </div>
                    <div className="portal-detail-card">
                      <span className="portal-surface__eyebrow">Base Branch</span>
                      <strong className="portal-detail-card__value">{data.repo.base_branch}</strong>
                    </div>
                  </div>
                </article>

                <article className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Workflow</span>
                      <h2 className="portal-surface__title">Delivery sequence</h2>
                    </div>
                  </div>
                  <div className="portal-list">
                    {data.workflow.map((step) => (
                      <div key={step.step} className="portal-list__item">
                        <div>
                          <strong>{step.step}</strong>
                          <p>{step.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Projects</span>
                    <h2 className="portal-surface__title">Select a GitOps project</h2>
                    <p className="portal-surface__subtitle">Each project maps to a folder root and now uses the shared request branch and config-path layout for live delivery updates.</p>
                  </div>
                </div>
                <div className="gitops-project-grid">
                  {data.projects.map((project) => {
                    const isActive = project.project_id === selectedProjectId;
                    return (
                      <button
                        key={project.project_id}
                        type="button"
                        className={`gitops-project-card ${isActive ? 'gitops-project-card--active' : ''}`}
                        onClick={() => handleProjectSelect(project)}
                      >
                        <div className="gitops-project-card__header">
                          <div>
                            <h3 className="gitops-project-card__title">{project.project_name}</h3>
                            <p className="gitops-project-card__subtitle">{project.delivery_mode}</p>
                          </div>
                          <span className={`portal-badge ${project.pending_count > 0 ? 'portal-badge--warning' : 'portal-badge--success'}`}>
                            {project.pending_count > 0 ? `${project.pending_count} pending` : 'Clear'}
                          </span>
                        </div>

                        <div className="portal-pill-row">
                          <span className="portal-pill">Group ID {project.group_id || 'Pending'}</span>
                          <span className="portal-pill">{project.default_cloud}</span>
                          <span className="portal-pill">{project.default_environment}</span>
                          {project.github_owner && project.github_repo ? (
                            <span className="portal-pill">{project.github_owner}/{project.github_repo}</span>
                          ) : null}
                          <span className="portal-pill">{project.current_permission}</span>
                        </div>

                        <div className="gitops-project-card__metrics">
                          <div className="gitops-project-card__metric">
                            <span>Repo Root</span>
                            <strong>{project.repo_root}</strong>
                          </div>
                          <div className="gitops-project-card__metric">
                            <span>Manifest Pattern</span>
                            <strong>{project.manifest_path_pattern}</strong>
                          </div>
                          <div className="gitops-project-card__metric">
                            <span>Current request config path</span>
                            <strong>{project.live_request_path_pattern}</strong>
                          </div>
                          <div className="gitops-project-card__metric">
                            <span>Request branch pattern</span>
                            <strong>{project.branch_pattern}</strong>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {selectedProject && (
                <section className="portal-grid portal-grid--wide">
                  <div className="portal-stack">
                    <article className="portal-surface">
                      <div className="portal-surface__header">
                        <div>
                          <span className="portal-surface__eyebrow">Environment Matrix</span>
                          <h2 className="portal-surface__title">{selectedProject.project_name}</h2>
                          <p className="portal-surface__subtitle">Choose the environment and component you want to review before opening a new GitOps change.</p>
                        </div>
                        <div className="portal-pill-row">
                          <span className="portal-pill">Permission {permissionLabel}</span>
                          {selectedProject.can_write ? <span className="portal-pill">Write enabled</span> : <span className="portal-pill">View only</span>}
                        </div>
                      </div>
                      <div className="gitops-env-grid">
                        {selectedProject.environments.map((environment) => {
                          const isActive = environment.name === selectedEnv;
                          return (
                            <div key={environment.name} className={`gitops-env-card ${isActive ? 'gitops-env-card--active' : ''}`}>
                              <button type="button" className="gitops-env-card__header" onClick={() => setSelectedEnv(environment.name)}>
                                <div>
                                  <h3 className="gitops-env-card__title">{environment.name}</h3>
                                  <p className="gitops-env-card__subtitle">{environment.folder_path}</p>
                                </div>
                                <span className="portal-badge portal-badge--neutral">{formatCount(environment.request_count)} requests</span>
                              </button>

                              <div className="portal-pill-row">
                                <span className="portal-pill">Pending {environment.pending_count}</span>
                                <span className="portal-pill">In flight {environment.in_flight_count}</span>
                                <span className="portal-pill">Completed {environment.completed_count}</span>
                              </div>

                              <div className="gitops-component-row">
                                {(environment.components.length > 0 ? environment.components : [{ name: 'Infrastructure', key: 'infrastructure', manifest_path: `${environment.folder_path}/infrastructure.json`, request_count: 0 }]).map((component) => (
                                  <button
                                    key={component.key}
                                    type="button"
                                    className={`gitops-chip-button ${environment.name === selectedEnv && component.key === selectedComponent ? 'gitops-chip-button--active' : ''}`}
                                    onClick={() => {
                                      setSelectedEnv(environment.name);
                                      setSelectedComponent(component.key);
                                    }}
                                  >
                                    {component.name}
                                  </button>
                                ))}
                              </div>

                              <p className="gitops-env-card__timestamp">Last updated {formatTimestamp(environment.last_updated)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </article>

                    <article className="portal-surface">
                      <div className="portal-surface__header">
                        <div>
                          <span className="portal-surface__eyebrow">Recent Delivery</span>
                          <h2 className="portal-surface__title">Recent changes</h2>
                        </div>
                      </div>
                      {selectedProject.recent_changes.length === 0 ? (
                        <div className="portal-empty">
                          <p>No request history exists for this project yet.</p>
                        </div>
                      ) : (
                        <div className="gitops-change-list">
                          {selectedProject.recent_changes.map((change) => (
                            <div key={change.request_id} className="gitops-change-list__item">
                              <div>
                                <strong>
                                  #{change.request_id} · {change.service || change.cloud || 'Infrastructure'}
                                </strong>
                                <p>{change.environment} · Branch: {change.branch}</p>
                                <p>Config path: {change.file_path}</p>
                              </div>
                              <div className="gitops-change-list__meta">
                                <span className={`portal-badge portal-badge--${getStatusTone(change.status)}`}>{change.status.replace(/_/g, ' ')}</span>
                                <small>{formatRelativeTime(change.updated_at)}</small>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  </div>

                  <div className="portal-stack">
                    <article className="portal-surface">
                      <div className="portal-surface__header">
                        <div>
                          <span className="portal-surface__eyebrow">Preview</span>
                          <h2 className="portal-surface__title">Selected manifest path</h2>
                          <p className="portal-surface__subtitle">This preview shows where the current live request file lands and what branch shape the request uses in Git.</p>
                        </div>
                      </div>

                      {previewLoading ? (
                        <div className="portal-empty">
                          <p>Loading manifest preview...</p>
                        </div>
                      ) : previewError ? (
                        <div className="portal-empty">
                          <p>{previewError}</p>
                        </div>
                      ) : preview ? (
                        <>
                          <div className="gitops-preview-grid">
                            <div className="portal-detail-card">
                              <span className="portal-surface__eyebrow">Repo Root</span>
                              <strong className="portal-detail-card__value">{preview.repo_root}</strong>
                            </div>
                            <div className="portal-detail-card">
                              <span className="portal-surface__eyebrow">Env Folder</span>
                              <strong className="portal-detail-card__value">{preview.environment_folder}</strong>
                            </div>
                            <div className="portal-detail-card">
                              <span className="portal-surface__eyebrow">Manifest Path</span>
                              <strong className="portal-detail-card__value">{preview.manifest_path}</strong>
                            </div>
                            <div className="portal-detail-card">
                              <span className="portal-surface__eyebrow">Current request config path</span>
                              <strong className="portal-detail-card__value">{preview.live_request_path}</strong>
                            </div>
                            <div className="portal-detail-card">
                              <span className="portal-surface__eyebrow">Example request branch</span>
                              <strong className="portal-detail-card__value">{preview.branch_example}</strong>
                            </div>
                            <div className="portal-detail-card">
                              <span className="portal-surface__eyebrow">PR Title</span>
                              <strong className="portal-detail-card__value">{preview.pull_request_title}</strong>
                            </div>
                          </div>

                          <div className="portal-form-actions">
                            <Link href="/templates/new" className="btn btn-primary btn-sm">
                              Start from template
                            </Link>
                            <Link href="/templates" className="btn btn-secondary btn-sm">
                              Open template library
                            </Link>
                          </div>

                          <pre className="portal-code-block">{manifestJson}</pre>
                        </>
                      ) : null}
                    </article>

                    <article className="portal-surface">
                      <div className="portal-surface__header">
                        <div>
                          <span className="portal-surface__eyebrow">Folder Tree</span>
                          <h2 className="portal-surface__title">Project layout</h2>
                        </div>
                      </div>
                      <div className="gitops-tree">
                        {selectedProject.folder_tree.map((line) => (
                          <div key={line} className="gitops-tree__line">
                            {line}
                          </div>
                        ))}
                      </div>
                    </article>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
