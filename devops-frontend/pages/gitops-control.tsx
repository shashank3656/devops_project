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
  permission: string;
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
  current_permission?: string;
  can_write?: boolean;
  can_manage?: boolean;
  access: ProjectAccess[];
}

interface ManagementResponse {
  status: string;
  can_create_projects: boolean;
  teams: DevOpsTeam[];
  users: AssignableUser[];
  projects: ManagedProject[];
}

interface ExplorerNode {
  id: string;
  depth: number;
  kind: 'folder' | 'file';
  name: string;
  path: string;
  environment?: string;
}

function normalizeProjectAccess(value: unknown): ProjectAccess[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const access = (item || {}) as Partial<ProjectAccess>;
    return {
      id: Number(access.id || 0),
      project_id: Number(access.project_id || 0),
      user_id: Number(access.user_id || 0),
      username: String(access.username || ''),
      email: String(access.email || ''),
      environment: String(access.environment || ''),
      permission: String(access.permission || 'read'),
      created_at: String(access.created_at || ''),
    };
  });
}

function normalizeManagedProjects(value: unknown): ManagedProject[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const project = (item || {}) as Partial<ManagedProject>;
    return {
      id: Number(project.id || 0),
      team_id: Number(project.team_id || 0),
      team_name: String(project.team_name || ''),
      group_id: String(project.group_id || ''),
      name: String(project.name || ''),
      slug: String(project.slug || ''),
      repo_root: String(project.repo_root || ''),
      base_branch: String(project.base_branch || 'main'),
      default_cloud: String(project.default_cloud || 'aws'),
      environments: Array.isArray(project.environments) ? project.environments.map((entry) => String(entry || '')) : [],
      components: Array.isArray(project.components) ? project.components.map((entry) => String(entry || '')) : [],
      current_permission: typeof project.current_permission === 'string' ? project.current_permission : undefined,
      can_write: Boolean(project.can_write),
      can_manage: Boolean(project.can_manage),
      access: normalizeProjectAccess(project.access),
    };
  });
}

function normalizeManagementResponse(payload: Partial<ManagementResponse>): ManagementResponse {
  return {
    status: String(payload.status || 'ok'),
    can_create_projects: Boolean(payload.can_create_projects),
    teams: Array.isArray(payload.teams)
      ? payload.teams.map((item) => ({
          id: Number(item?.id || 0),
          name: String(item?.name || ''),
          slug: String(item?.slug || ''),
          application_id: String(item?.application_id || ''),
        }))
      : [],
    users: Array.isArray(payload.users)
      ? payload.users.map((item) => ({
          id: Number(item?.id || 0),
          username: String(item?.username || ''),
          email: String(item?.email || ''),
          is_manager: Boolean(item?.is_manager),
          level: String(item?.level || ''),
        }))
      : [],
    projects: normalizeManagedProjects(payload.projects),
  };
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

function normalizePreviewToken(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildExplorerNodes(project: ManagedProject | null): ExplorerNode[] {
  if (!project) return [];
  const rootParts = project.repo_root.split('/').filter(Boolean);
  const nodes: ExplorerNode[] = rootParts.map((part, index) => ({
    id: `root-${index}-${part}`,
    depth: index,
    kind: 'folder',
    name: part,
    path: rootParts.slice(0, index + 1).join('/'),
  }));
  for (const environment of project.environments) {
    const envPath = `${project.repo_root}/${environment}`;
    nodes.push({
      id: `env-${environment}`,
      depth: rootParts.length,
      kind: 'folder',
      name: environment,
      path: envPath,
      environment,
    });
    for (const component of project.components) {
      nodes.push({
        id: `file-${environment}-${component}`,
        depth: rootParts.length + 1,
        kind: 'file',
        name: `${component}.json`,
        path: `${envPath}/${component}.json`,
        environment,
      });
    }
  }
  return nodes;
}

export default function GitOpsControlPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [data, setData] = useState<ManagementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeRail, setActiveRail] = useState<'explorer' | 'access' | 'builder'>('explorer');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [activeEnvironment, setActiveEnvironment] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [createTeamId, setCreateTeamId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createCloud, setCreateCloud] = useState('aws');
  const [createEnvironments, setCreateEnvironments] = useState('dev, qa, prod');
  const [createComponents, setCreateComponents] = useState('networking, eks, rds');
  const [jsonProjectId, setJsonProjectId] = useState<number | null>(null);
  const [newJsonComponent, setNewJsonComponent] = useState('');
  const [accessProjectId, setAccessProjectId] = useState('');
  const [accessUserId, setAccessUserId] = useState('');
  const [accessPermission, setAccessPermission] = useState('read');
  const [accessEnvironments, setAccessEnvironments] = useState<string[]>([]);

  const resetProjectForm = () => {
    setEditingProjectId(null);
    setCreateName('');
    setCreateSlug('');
    setCreateCloud('aws');
    setCreateEnvironments('dev, qa, prod');
    setCreateComponents('networking, eks, rds');
  };

  const loadProjectIntoForm = (project: ManagedProject) => {
    setEditingProjectId(project.id);
    setCreateTeamId(String(project.team_id));
    setCreateName(project.name);
    setCreateSlug(project.slug);
    setCreateCloud(project.default_cloud || 'aws');
    setCreateEnvironments(project.environments.join(', '));
    setCreateComponents(project.components.join(', '));
    setJsonProjectId(null);
    setNewJsonComponent('');
  };

  const selectProject = (project: ManagedProject) => {
    setSelectedProjectId(project.id);
    setAccessProjectId(String(project.id));
    setAccessEnvironments(project.environments.slice(0, 1));
    setActiveEnvironment(project.environments[0] || '');
  };

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
    const next = normalizeManagementResponse(payload);
    setData(next);
    if (!createTeamId && next.teams.length > 0) {
      setCreateTeamId(String(next.teams[0].id));
    }
    if (!accessProjectId && next.projects.length > 0) {
      setAccessProjectId(String(next.projects[0].id));
    }
    if (!selectedProjectId && next.projects.length > 0) {
      selectProject(next.projects[0]);
    }
    if (!accessUserId && next.users.length > 0) {
      setAccessUserId(String(next.users[0].id));
    }
    const projectQuery = typeof router.query.project === 'string' ? Number(router.query.project) : 0;
    if (projectQuery > 0) {
      const matchedProject = next.projects.find((project) => project.id === projectQuery);
      if (matchedProject) {
        selectProject(matchedProject);
        loadProjectIntoForm(matchedProject);
      }
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

  const selectedPanelProject = useMemo(() => {
    if (!data || selectedProjectId == null) return null;
    return data.projects.find((project) => project.id === selectedProjectId) || null;
  }, [data, selectedProjectId]);

  const selectedCreateTeam = useMemo(() => {
    if (!data || !createTeamId) return null;
    return data.teams.find((team) => team.id === Number(createTeamId)) || null;
  }, [createTeamId, data]);

  const normalizedCreateName = useMemo(() => createName.trim(), [createName]);
  const projectSlugPreview = useMemo(() => {
    const candidate = normalizePreviewToken(createSlug || createName);
    return candidate || 'project';
  }, [createName, createSlug]);
  const normalizedCreateEnvironments = useMemo(
    () => createEnvironments.split(',').map((item) => normalizePreviewToken(item)).filter(Boolean),
    [createEnvironments],
  );
  const normalizedCreateComponents = useMemo(
    () => createComponents.split(',').map((item) => normalizePreviewToken(item)).filter(Boolean),
    [createComponents],
  );
  const repoRootPreview = useMemo(() => {
    const teamKey = normalizePreviewToken(selectedCreateTeam?.slug || selectedCreateTeam?.name || 'team') || 'team';
    return `projects/${teamKey}/${projectSlugPreview}`;
  }, [projectSlugPreview, selectedCreateTeam]);

  const explorerNodes = useMemo(() => buildExplorerNodes(selectedPanelProject), [selectedPanelProject]);

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

  useEffect(() => {
    if (!selectedPanelProject) {
      setActiveEnvironment('');
      return;
    }
    if (!selectedPanelProject.environments.includes(activeEnvironment)) {
      setActiveEnvironment(selectedPanelProject.environments[0] || '');
    }
  }, [activeEnvironment, selectedPanelProject]);

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        editingProjectId ? `${apiUrl}/api/devops/gitops/manage/projects/${editingProjectId}` : `${apiUrl}/api/devops/gitops/manage/projects`,
        {
          method: editingProjectId ? 'PUT' : 'POST',
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
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.status !== 'ok') {
        throw new Error(payload?.error || `Failed to ${editingProjectId ? 'update' : 'create'} project structure`);
      }
      resetProjectForm();
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to ${editingProjectId ? 'update' : 'create'} project structure`;
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddJsonFile = async (project: ManagedProject) => {
    const componentName = normalizePreviewToken(newJsonComponent);
    if (!componentName) {
      setError('Enter a JSON file name before creating it.');
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const nextComponents = Array.from(new Set([...project.components, componentName]));
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          team_id: project.team_id,
          name: project.name,
          slug: project.slug,
          default_cloud: project.default_cloud,
          environments: project.environments,
          components: nextComponents,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.status !== 'ok') {
        throw new Error(payload?.error || 'Failed to create JSON file');
      }
      setJsonProjectId(null);
      setNewJsonComponent('');
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create JSON file';
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
          permission: accessPermission,
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

  const handleEditAccess = (project: ManagedProject, access: ProjectAccess) => {
    selectProject(project);
    setAccessProjectId(String(project.id));
    setAccessUserId(String(access.user_id));
    setAccessPermission(access.permission || 'read');
    setAccessEnvironments(access.environment ? [access.environment] : []);
  };

  const openProjectEditor = (project: ManagedProject) => {
    selectProject(project);
    loadProjectIntoForm(project);
  };

  return (
    <>
      <Head>
        <title>Project-Infra - DevOps Portal</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page gitops-page gitops-page--ide">
          <section className="portal-page__hero">
            <div>
              <span className="portal-page__eyebrow">Manager Control</span>
              <h1 className="portal-page__title">Project-Infra</h1>
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
                      <span className="portal-surface__eyebrow">{editingProjectId ? 'Edit Structure' : 'Create Structure'}</span>
                      <h2 className="portal-surface__title">{editingProjectId ? 'Edit GitOps project' : 'New GitOps project'}</h2>
                      <p className="portal-surface__subtitle">This defines the folder root, environments, and component JSON file set that the portal will expose.</p>
                    </div>
                    {editingProjectId && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={resetProjectForm}>
                        Cancel edit
                      </button>
                    )}
                  </div>
                  {data.can_create_projects || editingProjectId !== null ? (
                    <form onSubmit={handleCreateProject} className="gitops-builder">
                      <section className="gitops-builder-section">
                        <div className="gitops-builder-section__header">
                          <div>
                            <h3 className="gitops-builder-section__title">1. Project Identity</h3>
                            <p className="gitops-builder-section__copy">Define who owns this structure and what the GitOps root should be called.</p>
                          </div>
                        </div>
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
                      </section>

                      <section className="gitops-builder-section">
                        <div className="gitops-builder-section__header">
                          <div>
                            <h3 className="gitops-builder-section__title">2. Environment Layout</h3>
                            <p className="gitops-builder-section__copy">List the environment folders that should exist under this project root.</p>
                          </div>
                        </div>
                        <div className="portal-field-grid">
                          <div className="form-group">
                            <label className="label" htmlFor="gitops-envs">Environments</label>
                            <input id="gitops-envs" className="input" value={createEnvironments} onChange={(event) => setCreateEnvironments(event.target.value)} placeholder="dev, qa, prod" />
                          </div>
                        </div>
                        <div className="portal-pill-row">
                          {normalizedCreateEnvironments.map((environment) => (
                            <span key={environment} className="portal-pill">{environment}</span>
                          ))}
                        </div>
                      </section>

                      <section className="gitops-builder-section">
                        <div className="gitops-builder-section__header">
                          <div>
                            <h3 className="gitops-builder-section__title">3. Component Files</h3>
                            <p className="gitops-builder-section__copy">These component names become JSON manifest files inside each environment folder.</p>
                          </div>
                        </div>
                        <div className="portal-field-grid">
                          <div className="form-group">
                            <label className="label" htmlFor="gitops-components">Components</label>
                            <input id="gitops-components" className="input" value={createComponents} onChange={(event) => setCreateComponents(event.target.value)} placeholder="networking, eks, rds" />
                          </div>
                        </div>
                        <div className="portal-pill-row">
                          {normalizedCreateComponents.map((component) => (
                            <span key={component} className="portal-pill">{component}.json</span>
                          ))}
                        </div>
                      </section>

                      <section className="gitops-builder-section gitops-builder-section--preview">
                        <div className="gitops-builder-section__header">
                          <div>
                            <h3 className="gitops-builder-section__title">4. Structure Preview</h3>
                            <p className="gitops-builder-section__copy">This is the structure that the portal will register for this new GitOps project.</p>
                          </div>
                        </div>
                        <div className="portal-detail-grid">
                          <div className="portal-detail-card">
                            <span className="portal-surface__eyebrow">Team</span>
                            <strong className="portal-detail-card__value">{selectedCreateTeam?.name || 'Select a team'}</strong>
                          </div>
                          <div className="portal-detail-card">
                            <span className="portal-surface__eyebrow">Project</span>
                            <strong className="portal-detail-card__value">{normalizedCreateName || 'Enter a project name'}</strong>
                          </div>
                          <div className="portal-detail-card">
                            <span className="portal-surface__eyebrow">Slug</span>
                            <strong className="portal-detail-card__value">{projectSlugPreview}</strong>
                          </div>
                          <div className="portal-detail-card">
                            <span className="portal-surface__eyebrow">Repo Root</span>
                            <strong className="portal-detail-card__value">{repoRootPreview}</strong>
                          </div>
                        </div>
                        <pre className="portal-code-block">{`{
  "team": "${selectedCreateTeam?.name || ''}",
  "project": "${normalizedCreateName}",
  "slug": "${projectSlugPreview}",
  "default_cloud": "${createCloud}",
  "environments": ${JSON.stringify(normalizedCreateEnvironments, null, 2)},
  "components": ${JSON.stringify(normalizedCreateComponents, null, 2)}
}`}</pre>
                      </section>

                      <div className="portal-form-actions">
                        <button type="submit" className="btn btn-primary" disabled={saving || !normalizedCreateName}>
                          {saving ? 'Saving...' : editingProjectId ? 'Update project structure' : 'Create project structure'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="portal-empty" style={{ padding: 0, textAlign: 'left' }}>
                      <p>Your GitOps admin scope can manage existing projects, but only managers can create new project structures in this portal scope.</p>
                    </div>
                  )}
                </article>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Project Inventory</span>
                    <h2 className="portal-surface__title">Project-Infra workflow</h2>
                    <p className="portal-surface__subtitle">Select a project, then manage that project's access, environment folders, and JSON files in the same flow.</p>
                  </div>
                </div>
                {data.projects.length === 0 ? (
                  <div className="portal-empty">
                    <p>No GitOps project structure exists yet.</p>
                  </div>
                ) : (
                  <div className="gitops-editor">
                    <nav className="gitops-editor__rail" aria-label="Workspace Views">
                      <button
                        type="button"
                        className={`gitops-editor__rail-button ${activeRail === 'explorer' ? 'gitops-editor__rail-button--active' : ''}`}
                        onClick={() => setActiveRail('explorer')}
                        title="Explorer"
                      >
                        E
                      </button>
                      <button
                        type="button"
                        className={`gitops-editor__rail-button ${activeRail === 'access' ? 'gitops-editor__rail-button--active' : ''}`}
                        onClick={() => setActiveRail('access')}
                        title="Access"
                      >
                        A
                      </button>
                      <button
                        type="button"
                        className={`gitops-editor__rail-button ${activeRail === 'builder' ? 'gitops-editor__rail-button--active' : ''}`}
                        onClick={() => setActiveRail('builder')}
                        title="Builder"
                      >
                        B
                      </button>
                    </nav>

                    <aside className="gitops-editor__sidebar">
                      {activeRail === 'explorer' && (
                        <section className="gitops-editor-pane">
                          <div className="gitops-editor-pane__header">
                            <span className="gitops-editor-pane__title">PROJECTS</span>
                          </div>
                          <div className="gitops-editor-projects">
                            {data.projects.map((project, index) => {
                              const isSelected = selectedProjectId === project.id;
                              return (
                                <button
                                  key={project.id}
                                  type="button"
                                  className={`gitops-editor-projects__item ${isSelected ? 'gitops-editor-projects__item--active' : ''}`}
                                  onClick={() => selectProject(project)}
                                >
                                  <span>{index + 1}) {project.name}</span>
                                  <small>{project.team_name}</small>
                                </button>
                              );
                            })}
                          </div>
                          {selectedPanelProject && (
                            <div className="gitops-editor-pane__footer">
                              <span className="gitops-editor-hint">{selectedPanelProject.repo_root}</span>
                            </div>
                          )}
                        </section>
                      )}

                      {activeRail === 'access' && (
                        <section className="gitops-editor-pane">
                          <div className="gitops-editor-pane__header">
                            <span className="gitops-editor-pane__title">PROJECT ACCESS</span>
                          </div>
                          {selectedPanelProject ? (
                            <>
                              <div className="gitops-editor-list">
                                {selectedPanelProject.access.length === 0 ? (
                                  <div className="gitops-editor-list__item">No access configured</div>
                                ) : (
                                  selectedPanelProject.access.map((access) => (
                                    <div key={access.id} className="gitops-editor-list__item">
                                      <div>
                                        <strong>{access.username}</strong>
                                        <span>{access.permission}</span>
                                      </div>
                                      <div className="gitops-access-actions">
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleEditAccess(selectedPanelProject, access)}>
                                          Edit
                                        </button>
                                        <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void handleRemoveAccess(access.id)}>
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                              <form onSubmit={handleGrantAccess} className="portal-stack">
                              <div className="form-group">
                                  <label className="label" htmlFor="sidebar-access-user">User</label>
                                  <select id="sidebar-access-user" className="input" value={accessUserId} onChange={(event) => setAccessUserId(event.target.value)}>
                                    {data.users.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.username}{user.email ? ` (${user.email})` : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              <div className="form-group">
                                  <label className="label" htmlFor="sidebar-access-permission">Permission</label>
                                  <select id="sidebar-access-permission" className="input" value={accessPermission} onChange={(event) => setAccessPermission(event.target.value)}>
                                    <option value="read">read</option>
                                    <option value="write">write</option>
                                    <option value="admin">admin</option>
                                  </select>
                                </div>
                                <div className="form-group">
                                  <span className="label">Visible Environments</span>
                                  <div className="gitops-check-row">
                                    {selectedPanelProject.environments.map((environment) => (
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
                                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving || accessEnvironments.length === 0}>
                                    {saving ? 'Saving...' : 'Save access'}
                                  </button>
                                </div>
                              </form>
                            </>
                          ) : (
                            <div className="portal-empty">
                              <p>Select a project.</p>
                            </div>
                          )}
                        </section>
                      )}

                      {activeRail === 'builder' && (
                        <section className="gitops-editor-pane">
                          <div className="gitops-editor-pane__header">
                            <span className="gitops-editor-pane__title">{editingProjectId ? 'EDIT PROJECT' : 'NEW PROJECT'}</span>
                          </div>
                          {(data.can_create_projects || editingProjectId !== null) ? (
                            <form onSubmit={handleCreateProject} className="gitops-editor-builder">
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-team">DevOps Team</label>
                                <select id="sidebar-gitops-team" className="input" value={createTeamId} onChange={(event) => setCreateTeamId(event.target.value)}>
                                  {data.teams.map((team) => (
                                    <option key={team.id} value={team.id}>
                                      {team.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-name">Project Name</label>
                                <input id="sidebar-gitops-name" className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="payments-platform" />
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-slug">Project Slug</label>
                                <input id="sidebar-gitops-slug" className="input" value={createSlug} onChange={(event) => setCreateSlug(event.target.value)} placeholder="payments-platform" />
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-cloud">Default Cloud</label>
                                <select id="sidebar-gitops-cloud" className="input" value={createCloud} onChange={(event) => setCreateCloud(event.target.value)}>
                                  <option value="aws">aws</option>
                                  <option value="azure">azure</option>
                                  <option value="gcp">gcp</option>
                                </select>
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-envs">Environments</label>
                                <input id="sidebar-gitops-envs" className="input" value={createEnvironments} onChange={(event) => setCreateEnvironments(event.target.value)} placeholder="dev, qa, prod" />
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-components">Components</label>
                                <input id="sidebar-gitops-components" className="input" value={createComponents} onChange={(event) => setCreateComponents(event.target.value)} placeholder="networking, eks, rds" />
                              </div>
                              <div className="portal-form-actions">
                                <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !normalizedCreateName}>
                                  {saving ? 'Saving...' : editingProjectId ? 'Update project' : 'Create project'}
                                </button>
                                {editingProjectId && (
                                  <button type="button" className="btn btn-secondary btn-sm" onClick={resetProjectForm}>
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </form>
                          ) : (
                            <div className="portal-empty">
                              <p>Only managers can create project structures here.</p>
                            </div>
                          )}
                        </section>
                      )}
                    </aside>

                    <section className="gitops-editor__explorer">
                      <div className="gitops-editor-pane gitops-editor-pane--full">
                        <div className="gitops-editor-pane__header">
                          <span className="gitops-editor-pane__title">EXPLORER</span>
                          {selectedPanelProject && (
                            <div className="gitops-card-actions">
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openProjectEditor(selectedPanelProject)}>
                                Edit structure
                              </button>
                            </div>
                          )}
                        </div>
                        {selectedPanelProject ? (
                          <>
                            <div className="gitops-editor-path">{selectedPanelProject.repo_root}</div>
                            <div className="gitops-editor-tree">
                              {explorerNodes.map((node) => (
                                <button
                                  key={node.id}
                                  type="button"
                                  className={`gitops-editor-tree__node ${node.environment && node.environment === activeEnvironment ? 'gitops-editor-tree__node--active' : ''}`}
                                  style={{ paddingLeft: `${12 + node.depth * 18}px` }}
                                  onClick={() => {
                                    if (node.environment) setActiveEnvironment(node.environment);
                                  }}
                                >
                                  <span className="gitops-editor-tree__toggle">{node.kind === 'folder' ? '▸' : '•'}</span>
                                  <span className="gitops-editor-tree__label">{node.name}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="portal-empty">
                            <p>Select a project to open the explorer.</p>
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="gitops-editor__main">
                      <div className="gitops-editor-pane gitops-editor-pane--full">
                        {selectedPanelProject ? (
                          <>
                            <div className="gitops-editor-main__header">
                              <div>
                                <span className="gitops-editor-pane__title">PROJECT-INFRA</span>
                                <h3 className="portal-surface__title">{selectedPanelProject.name}</h3>
                                <p className="portal-surface__subtitle">{selectedPanelProject.repo_root}</p>
                              </div>
                              <div className="portal-pill-row">
                                <span className="portal-pill">Group ID {selectedPanelProject.group_id}</span>
                                <span className="portal-pill">{selectedPanelProject.default_cloud || 'aws'}</span>
                                <span className="portal-pill">{selectedPanelProject.base_branch}</span>
                              </div>
                            </div>

                            <div className="gitops-editor-tabs">
                              {selectedPanelProject.environments.map((environment) => (
                                <button
                                  key={environment}
                                  type="button"
                                  className={`gitops-editor-tabs__tab ${environment === activeEnvironment ? 'gitops-editor-tabs__tab--active' : ''}`}
                                  onClick={() => setActiveEnvironment(environment)}
                                >
                                  {environment}
                                </button>
                              ))}
                            </div>

                            <div className="gitops-editor-code">
                              <div className="gitops-editor-code__toolbar">
                                <span>{selectedPanelProject.repo_root}/{activeEnvironment || selectedPanelProject.environments[0]}</span>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setJsonProjectId(selectedPanelProject.id);
                                    setNewJsonComponent('');
                                  }}
                                >
                                  Create JSON file
                                </button>
                              </div>
                              <div className="gitops-editor-code__body">
                                {selectedPanelProject.components.map((component, index) => (
                                  <div key={`${activeEnvironment}-${component}`} className="gitops-editor-code__line">
                                    <span className="gitops-editor-code__gutter">{index + 1}</span>
                                    <span className="gitops-editor-code__content">{component}.json</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {jsonProjectId === selectedPanelProject.id && (
                              <div className="gitops-inline-form">
                                <input
                                  className="input"
                                  value={newJsonComponent}
                                  onChange={(event) => setNewJsonComponent(event.target.value)}
                                  placeholder="service-mesh"
                                />
                                <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleAddJsonFile(selectedPanelProject)}>
                                  Add
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setJsonProjectId(null);
                                    setNewJsonComponent('');
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            )}

                          </>
                        ) : (
                          <div className="portal-empty">
                            <p>Select a project to open the editor.</p>
                          </div>
                        )}
                      </div>
                    </section>
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
