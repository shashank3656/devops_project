import type { FormEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';
import { useUnsavedChanges } from '../lib/useUnsavedChanges';

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
  github_owner?: string;
  github_repo?: string;
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

interface GitOpsSyncFeedback {
  ok?: boolean;
  pr_url?: string;
  branch?: string;
  files?: string[];
  warning?: string;
}

interface ActionFeedback {
  tone: 'success' | 'warning';
  message: string;
  link?: string;
}

interface RepoTreeNode {
  id: string;
  depth: number;
  kind: 'folder' | 'file';
  name: string;
  path: string;
  environment?: string;
  exists: boolean;
}

interface RepoFileDocument {
  project_id: number;
  project_name: string;
  path: string;
  name: string;
  environment: string;
  component: string;
  content: string;
  exists: boolean;
  current_permission: string;
  can_write: boolean;
  can_manage: boolean;
  warning?: string;
}

interface AccessGroup {
  user_id: number;
  username: string;
  email: string;
  permission: string;
  environments: string[];
  rows: ProjectAccess[];
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
      github_owner: String(project.github_owner || ''),
      github_repo: String(project.github_repo || ''),
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

function buildSyncFeedback(sync: GitOpsSyncFeedback | undefined, fallbackMessage: string): ActionFeedback {
  if (sync?.warning) {
    return {
      tone: 'warning',
      message: sync.warning,
      link: sync.pr_url,
    };
  }
  if (sync?.ok) {
    const filesCount = Array.isArray(sync.files) ? sync.files.length : 0;
    const suffix = filesCount > 0 ? ` ${filesCount} file${filesCount === 1 ? '' : 's'} synced.` : '';
    const branch = sync.branch ? ` Branch: ${sync.branch}.` : '';
    return {
      tone: 'success',
      message: `${fallbackMessage}${suffix}${branch}`,
      link: sync.pr_url,
    };
  }
  return { tone: 'success', message: fallbackMessage };
}

function buildAccessGroups(project: ManagedProject | null): AccessGroup[] {
  if (!project) return [];
  const grouped = new Map<number, AccessGroup>();
  for (const access of project.access) {
    const existing = grouped.get(access.user_id);
    if (existing) {
      if (!existing.environments.includes(access.environment)) {
        existing.environments.push(access.environment);
      }
      if (existing.permission !== access.permission) {
        existing.permission = 'mixed';
      }
      existing.rows.push(access);
      continue;
    }
    grouped.set(access.user_id, {
      user_id: access.user_id,
      username: access.username,
      email: access.email,
      permission: access.permission,
      environments: access.environment ? [access.environment] : [],
      rows: [access],
    });
  }
  return Array.from(grouped.values()).sort((left, right) => left.username.localeCompare(right.username));
}

export default function GitOpsControlPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const requestedProject = typeof router.query.project === 'string' ? Number(router.query.project) : 0;
  const requestedView = typeof router.query.view === 'string' ? router.query.view : '';
  const [data, setData] = useState<ManagementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [saving, setSaving] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeWarning, setTreeWarning] = useState('');
  const [treeNodes, setTreeNodes] = useState<RepoTreeNode[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [openDocument, setOpenDocument] = useState<RepoFileDocument | null>(null);
  const [editorValue, setEditorValue] = useState('');
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
  const [createGithubOwner, setCreateGithubOwner] = useState('');
  const [createGithubRepo, setCreateGithubRepo] = useState('');
  useUnsavedChanges(
    editingProjectId === null && Boolean(
      createName.trim()
      || createSlug.trim()
      || createGithubOwner.trim()
      || createGithubRepo.trim()
      || createEnvironments !== 'dev, qa, prod'
      || createComponents !== 'networking, eks, rds',
    ),
  );
  const [jsonProjectId, setJsonProjectId] = useState<number | null>(null);
  const [newJsonComponent, setNewJsonComponent] = useState('');
  const [accessProjectId, setAccessProjectId] = useState('');
  const [accessUserId, setAccessUserId] = useState('');
  const [accessPermission, setAccessPermission] = useState('read');
  const [accessEnvironments, setAccessEnvironments] = useState<string[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);

  const openBuilder = () => {
    setShowBuilder(true);
    setEditingProjectId(null);
    if (requestedView !== 'builder') {
      void router.push({ pathname: '/gitops-control', query: { view: 'builder' } }, undefined, { shallow: true });
    }
  };

  const resetProjectForm = () => {
    setShowBuilder(false);
    if (requestedView === 'builder') {
      void router.replace('/gitops-control', undefined, { shallow: true });
    }
    setEditingProjectId(null);
    setCreateName('');
    setCreateSlug('');
    setCreateCloud('aws');
    setCreateEnvironments('dev, qa, prod');
    setCreateComponents('networking, eks, rds');
    setCreateGithubOwner('');
    setCreateGithubRepo('');
  };

  const loadProjectIntoForm = (project: ManagedProject) => {
    setEditingProjectId(project.id);
    setCreateTeamId(String(project.team_id));
    setCreateName(project.name);
    setCreateSlug(project.slug);
    setCreateCloud(project.default_cloud || 'aws');
    setCreateEnvironments(project.environments.join(', '));
    setCreateComponents(project.components.join(', '));
    setCreateGithubOwner(project.github_owner || '');
    setCreateGithubRepo(project.github_repo || '');
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
    if (!router.isReady) {
      return;
    }
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
    if (requestedProject > 0) {
      const matchedProject = next.projects.find((project) => project.id === requestedProject);
      if (matchedProject) {
        selectProject(matchedProject);
        loadProjectIntoForm(matchedProject);
      }
    }
    if (requestedView === 'builder' && (next.can_create_projects || requestedProject > 0 || next.projects.some((project) => project.can_manage))) {
      setActiveRail('builder');
    }
  };

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    loadData()
      .catch((err: Error) => setError(err.message || 'Failed to load GitOps management'))
      .finally(() => setLoading(false));
  }, [apiUrl, requestedProject, requestedView, router.isReady]);

  useEffect(() => {
    if (!data || !router.isReady) {
      return;
    }
    if (requestedView === 'builder' && (data.can_create_projects || selectedPanelProject?.can_manage || data.projects.length === 0)) {
      setActiveRail('builder');
      return;
    }
    if (requestedProject > 0) {
      const matchedProject = data.projects.find((project) => project.id === requestedProject);
      if (matchedProject) {
        selectProject(matchedProject);
        if (matchedProject.can_manage) {
          loadProjectIntoForm(matchedProject);
        }
      }
    }
  }, [data, requestedProject, requestedView, router.isReady]);

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

  const accessGroups = useMemo(() => buildAccessGroups(selectedPanelProject), [selectedPanelProject]);

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
      setTreeNodes([]);
      setTreeWarning('');
      setOpenDocument(null);
      setEditorValue('');
      return;
    }
    if (!selectedPanelProject.environments.includes(activeEnvironment)) {
      setActiveEnvironment(selectedPanelProject.environments[0] || '');
    }
  }, [activeEnvironment, selectedPanelProject]);

  const loadProjectTree = async (projectId: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setTreeLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/projects/${projectId}/tree`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok || getString(payload.status) !== 'ok') {
        throw new Error(getString(payload.error, 'Failed to load repository tree'));
      }
      const nodes: RepoTreeNode[] = Array.isArray(payload.nodes)
        ? (payload.nodes as Partial<RepoTreeNode>[]).map((node: Partial<RepoTreeNode>): RepoTreeNode => ({
            id: String(node.id || ''),
            depth: Number(node.depth || 0),
            kind: node.kind === 'file' ? 'file' : 'folder',
            name: String(node.name || ''),
            path: String(node.path || ''),
            environment: typeof node.environment === 'string' ? node.environment : undefined,
            exists: Boolean(node.exists),
          }))
        : [];
      setTreeNodes(nodes);
      setTreeWarning(getString(payload.warning));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load repository tree';
      setTreeWarning(message);
      setTreeNodes([]);
    } finally {
      setTreeLoading(false);
    }
  };

  const loadDocument = async (projectId: number, environment: string, component: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setFileLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        project_id: String(projectId),
        environment,
        component,
      });
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/project-files?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = asRecord(await response.json().catch(() => ({})));
      const documentValue = payload.document;
      if (!response.ok || getString(payload.status) !== 'ok' || !documentValue || typeof documentValue !== 'object') {
        throw new Error(getString(payload.error, 'Failed to load file'));
      }
      const document = documentValue as RepoFileDocument;
      setOpenDocument(document);
      setEditorValue(String(document.content || ''));
      if (document.environment) {
        setActiveEnvironment(document.environment);
      }
      if (document.warning) {
        setTreeWarning(document.warning);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load file';
      setError(message);
    } finally {
      setFileLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedPanelProject) return;
    void loadProjectTree(selectedPanelProject.id);
  }, [apiUrl, selectedPanelProject?.id]);

  useEffect(() => {
    if (!selectedPanelProject || treeLoading) return;
    const firstFileForEnv = treeNodes.find((node) => node.kind === 'file' && node.environment === activeEnvironment);
    if (!firstFileForEnv) {
      setOpenDocument(null);
      setEditorValue('');
      return;
    }
    const nextComponent = firstFileForEnv.name.replace(/\.json$/i, '');
    if (openDocument?.project_id === selectedPanelProject.id && openDocument.environment === activeEnvironment && openDocument.component === nextComponent) {
      return;
    }
    void loadDocument(selectedPanelProject.id, activeEnvironment, nextComponent);
  }, [activeEnvironment, openDocument?.component, openDocument?.environment, openDocument?.project_id, selectedPanelProject, treeLoading, treeNodes]);

  useEffect(() => {
    if (activeRail !== 'builder') return;
    if (data?.can_create_projects || selectedPanelProject?.can_manage || !data?.projects.length) return;
    setActiveRail('explorer');
  }, [activeRail, data?.can_create_projects, data?.projects.length, selectedPanelProject?.can_manage]);

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const isEditing = editingProjectId !== null;
    setSaving(true);
    setError('');
    setFeedback(null);
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
            github_owner: createGithubOwner.trim(),
            github_repo: createGithubRepo.trim(),
            environments: createEnvironments.split(',').map((item) => item.trim()).filter(Boolean),
            components: createComponents.split(',').map((item) => item.trim()).filter(Boolean),
          }),
        },
      );
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok || getString(payload.status) !== 'ok') {
        throw new Error(getString(payload.error, `Failed to ${editingProjectId ? 'update' : 'create'} project structure`));
      }
      const projectRecord = asRecord(payload.project);
      if (typeof projectRecord.id === 'number') {
        setSelectedProjectId(projectRecord.id);
        setAccessProjectId(String(projectRecord.id));
      }
      setActiveRail('explorer');
      resetProjectForm();
      setFeedback(
        buildSyncFeedback(
          payload.sync && typeof payload.sync === 'object' ? (payload.sync as GitOpsSyncFeedback) : undefined,
          isEditing ? 'Project structure updated.' : 'Project structure created.'
        )
      );
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
    setFeedback(null);
    try {
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/project-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          project_id: project.id,
          component: componentName,
          }),
      });
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok || getString(payload.status) !== 'ok') {
        throw new Error(getString(payload.error, 'Failed to create JSON file'));
      }
      setJsonProjectId(null);
      setNewJsonComponent('');
      setFeedback(
        buildSyncFeedback(
          payload.sync && typeof payload.sync === 'object' ? (payload.sync as GitOpsSyncFeedback) : undefined,
          `${componentName}.json created for ${project.name}.`
        )
      );
      await loadData();
      await loadProjectTree(project.id);
      await loadDocument(project.id, activeEnvironment || project.environments[0] || 'dev', componentName);
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
    setFeedback(null);
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
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok || getString(payload.status) !== 'ok') {
        throw new Error(getString(payload.error, 'Failed to grant access'));
      }
      setFeedback({ tone: 'success', message: 'Project access saved.' });
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to grant access';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditAccessGroup = (project: ManagedProject, group: AccessGroup) => {
    selectProject(project);
    setAccessProjectId(String(project.id));
    setAccessUserId(String(group.user_id));
    setAccessPermission(group.permission === 'mixed' ? 'write' : group.permission || 'read');
    setAccessEnvironments(group.environments.slice());
    setActiveRail('access');
  };

  const handleClearAccessGroup = async (projectId: number, userId: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    setFeedback(null);
    try {
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          project_id: projectId,
          user_id: userId,
          permission: 'read',
          environments: [],
          }),
      });
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok || getString(payload.status) !== 'ok') {
        throw new Error(getString(payload.error, 'Failed to remove access'));
      }
      setFeedback({ tone: 'success', message: 'Project access removed.' });
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove access';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDocument = async () => {
    if (!selectedPanelProject || !openDocument) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setFileSaving(true);
    setError('');
    setFeedback(null);
    try {
      const response = await fetch(`${apiUrl}/api/devops/gitops/manage/project-files`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          project_id: selectedPanelProject.id,
          environment: openDocument.environment,
          component: openDocument.component,
          content: editorValue,
          }),
      });
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok || getString(payload.status) !== 'ok') {
        throw new Error(getString(payload.error, 'Failed to save JSON file'));
      }
      setFeedback(
        buildSyncFeedback(
          payload.sync && typeof payload.sync === 'object' ? (payload.sync as GitOpsSyncFeedback) : undefined,
          `${openDocument.name} saved.`
        )
      );
      await loadProjectTree(selectedPanelProject.id);
      await loadDocument(selectedPanelProject.id, openDocument.environment, openDocument.component);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save JSON file';
      setError(message);
    } finally {
      setFileSaving(false);
    }
  };

  const openProjectEditor = (project: ManagedProject) => {
    void router.push(`/gitops-control/${project.id}/edit`);
  };

  const hasProjects = Boolean(data?.projects.length);
  const showCreateForm = !hasProjects || showBuilder || requestedView === 'builder' || editingProjectId !== null;
  const canCreate = Boolean(data?.can_create_projects || editingProjectId !== null || !hasProjects);
  const useIde = hasProjects && !showCreateForm;

  return (
    <>
      <Head>
        <title>Project-Infra - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className={`portal-page gitops-page${useIde ? ' gitops-page--ide' : ''}`}>
          <section className="portal-page__hero">
            <div>
              <span className="portal-page__eyebrow">Manager Control</span>
              <h1 className="portal-page__title">GitOps projects</h1>
              <p className="portal-page__subtitle">
                Create a project folder, pick environments, and choose who can see each one.
              </p>
            </div>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-primary" onClick={openBuilder}>
                New GitOps project
              </button>
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
                  <div className="portal-empty gitops-page__message">
                    <p>{error}</p>
                  </div>
                </section>
              )}
              {feedback && (
                <section className={`portal-surface portal-surface--tight gitops-feedback gitops-feedback--${feedback.tone}`}>
                  <div className="portal-empty gitops-page__message">
                    <p>
                      {feedback.message}{' '}
                      {feedback.link && (
                        <a href={feedback.link} target="_blank" rel="noreferrer">
                          Open PR
                        </a>
                      )}
                    </p>
                  </div>
                </section>
              )}
              <section className="portal-surface gitops-page__summary-surface">
                <div className="portal-pill-row">
                  <span className="portal-pill">Managed teams {formatCount(data.teams.length)}</span>
                  <span className="portal-pill">Projects {formatCount(data.projects.length)}</span>
                  <span className="portal-pill">
                    Access rules {formatCount(data.projects.reduce((total, project) => total + project.access.length, 0))}
                  </span>
                  <span className="portal-pill">Visible users {formatCount(data.users.length)}</span>
                </div>
              </section>

              {showCreateForm && (
              <section className="gitops-create">
                <article className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">{editingProjectId ? 'Edit structure' : 'Create project'}</span>
                      <h2 className="portal-surface__title">{editingProjectId ? 'Edit GitOps project' : 'New GitOps project'}</h2>
                      <p className="portal-surface__subtitle">Name the project, list environments, and choose the JSON files each environment should get.</p>
                    </div>
                    {hasProjects ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={resetProjectForm}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {canCreate ? (
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
                            {data.teams.length > 0 ? (
                              <select id="gitops-team" className="input" value={createTeamId} onChange={(event) => setCreateTeamId(event.target.value)}>
                                {data.teams.map((team) => (
                                  <option key={team.id} value={team.id}>
                                    {team.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <>
                                <input id="gitops-team" className="input" value="Auto-create DevOps Platform team on first save" readOnly />
                                <p className="form-help">No DevOps team exists yet. The first project save will bootstrap a default DevOps team automatically.</p>
                              </>
                            )}
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
                            <label className="label" htmlFor="gitops-name">Project Name<span className="form-req" aria-hidden="true"> *</span></label>
                            <input id="gitops-name" className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="payments-platform" required />
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
                    <div className="portal-empty gitops-page__message">
                      <p>Your GitOps admin scope can manage existing projects, but only managers can create new project structures in this portal scope.</p>
                    </div>
                  )}
                </article>
              </section>
              )}

              {hasProjects ? (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Project Inventory</span>
                    <h2 className="portal-surface__title">Project-Infra workflow</h2>
                    <p className="portal-surface__subtitle">Select a project, then manage that project&apos;s access, environment folders, and JSON files in the same flow.</p>
                  </div>
                </div>
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
                        disabled={!data.can_create_projects && !selectedPanelProject?.can_manage}
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
                                {!selectedPanelProject.can_manage ? (
                                  <div className="gitops-editor-list__item">
                                    <div>
                                      <strong>{selectedPanelProject.current_permission || 'read'}</strong>
                                      <span>{selectedPanelProject.environments.join(', ') || 'No environments assigned'}</span>
                                    </div>
                                  </div>
                                ) : accessGroups.length === 0 ? (
                                  <div className="gitops-editor-list__item">No access configured</div>
                                ) : (
                                  accessGroups.map((group) => (
                                    <div key={group.user_id} className="gitops-editor-list__item">
                                      <div>
                                        <strong>{group.username}</strong>
                                        <span>{group.permission} · {group.environments.join(', ')}</span>
                                      </div>
                                      <div className="gitops-access-actions">
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleEditAccessGroup(selectedPanelProject, group)}>
                                          Edit
                                        </button>
                                        <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void handleClearAccessGroup(selectedPanelProject.id, group.user_id)}>
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                              {selectedPanelProject.can_manage ? (
                              <form onSubmit={handleGrantAccess} className="portal-stack">
                                <div className="form-group">
                                  <label className="label" htmlFor="sidebar-access-user">User</label>
                                  <select id="sidebar-access-user" className="input" value={accessUserId} onChange={(event) => setAccessUserId(event.target.value)}>
                                    {data.users.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.username}
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
                                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                                    {saving ? 'Saving...' : 'Save access'}
                                  </button>
                                </div>
                              </form>
                              ) : (
                                <div className="portal-empty">
                                  <p>Only project admins can change access.</p>
                                </div>
                              )}
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
                          {(data.can_create_projects || editingProjectId !== null || selectedPanelProject?.can_manage) ? (
                            <form onSubmit={handleCreateProject} className="gitops-editor-builder">
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-team">DevOps Team</label>
                                {data.teams.length > 0 ? (
                                  <select id="sidebar-gitops-team" className="input" value={createTeamId} onChange={(event) => setCreateTeamId(event.target.value)} disabled={!data.can_create_projects && !selectedPanelProject?.can_manage}>
                                    {data.teams.map((team) => (
                                      <option key={team.id} value={team.id}>
                                        {team.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <>
                                    <input id="sidebar-gitops-team" className="input" value="Auto-create DevOps Platform team on first save" readOnly />
                                    <p className="form-help">No DevOps team exists yet. Saving the first project will bootstrap one automatically.</p>
                                  </>
                                )}
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-name">Project Name<span className="form-req" aria-hidden="true"> *</span></label>
                                <input id="sidebar-gitops-name" className="input" required value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="payments-platform" disabled={!selectedPanelProject?.can_manage && editingProjectId !== null} />
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-slug">Project Slug</label>
                                <input id="sidebar-gitops-slug" className="input" value={createSlug} onChange={(event) => setCreateSlug(event.target.value)} placeholder="payments-platform" disabled={!selectedPanelProject?.can_manage && editingProjectId !== null} />
                              </div>
                              <details className="onboard-advanced" open={Boolean(createGithubOwner || createGithubRepo) || undefined}>
                                <summary>GitHub repository <span className="onboard-optional">Optional</span></summary>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-github-owner">GitHub owner</label>
                                <input id="sidebar-gitops-github-owner" className="input" value={createGithubOwner} onChange={(event) => setCreateGithubOwner(event.target.value)} placeholder="org-or-user" disabled={!selectedPanelProject?.can_manage && editingProjectId !== null} />
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-github-repo">GitHub repository</label>
                                <input id="sidebar-gitops-github-repo" className="input" value={createGithubRepo} onChange={(event) => setCreateGithubRepo(event.target.value)} placeholder="infra-live" disabled={!selectedPanelProject?.can_manage && editingProjectId !== null} />
                                <p className="form-help">Deploy intelligence and webhooks use this repo instead of the global GITHUB_OWNER/GITHUB_REPO.</p>
                              </div>
                              </details>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-cloud">Default Cloud</label>
                                <select id="sidebar-gitops-cloud" className="input" value={createCloud} onChange={(event) => setCreateCloud(event.target.value)} disabled={!selectedPanelProject?.can_manage && editingProjectId !== null}>
                                  <option value="aws">aws</option>
                                  <option value="azure">azure</option>
                                  <option value="gcp">gcp</option>
                                </select>
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-envs">Environments</label>
                                <input id="sidebar-gitops-envs" className="input" value={createEnvironments} onChange={(event) => setCreateEnvironments(event.target.value)} placeholder="dev, qa, prod" disabled={!selectedPanelProject?.can_manage && editingProjectId !== null} />
                              </div>
                              <div className="form-group">
                                <label className="label" htmlFor="sidebar-gitops-components">Components</label>
                                <input id="sidebar-gitops-components" className="input" value={createComponents} onChange={(event) => setCreateComponents(event.target.value)} placeholder="networking, eks, rds" disabled={!selectedPanelProject?.can_manage && editingProjectId !== null} />
                              </div>
                              <div className="portal-form-actions">
                                <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !normalizedCreateName || (editingProjectId !== null && !selectedPanelProject?.can_manage)}>
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
                          {selectedPanelProject?.can_manage && (
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
                            {treeWarning && <div className="gitops-editor-hint">{treeWarning}</div>}
                            <div className="gitops-editor-tree">
                              {treeLoading ? (
                                <div className="portal-empty">
                                  <p>Loading repository tree...</p>
                                </div>
                              ) : treeNodes.map((node) => (
                                <button
                                  key={node.id}
                                  type="button"
                                  className={`gitops-editor-tree__node ${node.environment && node.environment === activeEnvironment ? 'gitops-editor-tree__node--active' : ''}`}
                                  style={{ paddingLeft: `${12 + node.depth * 18}px` }}
                                  onClick={() => {
                                    if (node.environment) setActiveEnvironment(node.environment);
                                    if (node.kind === 'file' && node.environment) {
                                      void loadDocument(selectedPanelProject.id, node.environment, node.name.replace(/\.json$/i, ''));
                                    }
                                  }}
                                >
                                  <span className="gitops-editor-tree__toggle">{node.kind === 'folder' ? '▸' : '•'}</span>
                                  <span className="gitops-editor-tree__label">{node.name}{!node.exists ? ' (pending)' : ''}</span>
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
                                {selectedPanelProject.github_owner && selectedPanelProject.github_repo ? (
                                  <span className="portal-pill">{selectedPanelProject.github_owner}/{selectedPanelProject.github_repo}</span>
                                ) : null}
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
                                <span>{openDocument?.path || `${selectedPanelProject.repo_root}/${activeEnvironment || selectedPanelProject.environments[0]}`}</span>
                                <div className="gitops-card-actions">
                                  {selectedPanelProject.can_write && (
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
                                  )}
                                  {openDocument && selectedPanelProject.can_write && (
                                    <button type="button" className="btn btn-primary btn-sm" disabled={fileSaving} onClick={() => void handleSaveDocument()}>
                                      {fileSaving ? 'Saving...' : 'Save JSON'}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="gitops-editor-code__body">
                                {fileLoading ? (
                                  <div className="portal-empty">
                                    <p>Loading file...</p>
                                  </div>
                                ) : openDocument ? (
                                  <textarea aria-label="Document contents"
                                    className="gitops-editor-code__textarea"
                                    value={editorValue}
                                    onChange={(event) => setEditorValue(event.target.value)}
                                    spellCheck={false}
                                    readOnly={!selectedPanelProject.can_write}
                                  />
                                ) : (
                                  <div className="portal-empty">
                                    <p>Select a JSON file from the explorer.</p>
                                  </div>
                                )}
                              </div>
                            </div>

                            {jsonProjectId === selectedPanelProject.id && selectedPanelProject.can_write && (
                              <div className="gitops-inline-form">
                                <input aria-label="New component name"
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
              </section>
              ) : null}
            </>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
