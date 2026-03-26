import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

const CLOUD_OPTIONS = [
  { value: 'aws', label: 'AWS' },
  { value: 'azure', label: 'Azure' },
  { value: 'gcp', label: 'GCP' },
];

const SERVICE_OPTIONS: Record<string, string[]> = {
  aws: ['ec2', 'eks', 'rds', 'vpc', 's3', 'iam', 'lambda'],
  azure: ['aks', 'postgresql', 'virtual-network', 'storage-account'],
  gcp: ['gke', 'cloudsql', 'vpc', 'storage', 'iam'],
};

type ProjectStatus = 'active' | 'inactive' | 'archived';

interface TeamOption {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

interface ProjectServiceOption {
  cloud: string;
  service: string;
}

interface ProjectApprovalRule {
  environment: string;
  require_manager_approval: boolean;
  require_devops_approval: boolean;
}

interface ProjectTeamAccess {
  team_id: number;
  team_name?: string;
  team_slug?: string;
  environments: string[];
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  description: string;
  status: ProjectStatus;
  onboarding_stage?: string;
  ready_for_requests?: boolean;
  service_count?: number;
  team_count?: number;
  owner_team_id?: number | null;
  owner_team?: string;
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
  approval_rules: ProjectApprovalRule[];
}

interface ProjectFormState {
  name: string;
  code: string;
  description: string;
  status: ProjectStatus;
  owner_team_id: string;
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
  approval_rules: ProjectApprovalRule[];
}

const DEFAULT_ENVIRONMENTS = ['dev', 'uat', 'prod'];

function createEmptyForm(): ProjectFormState {
  return {
    name: '',
    code: '',
    description: '',
    status: 'active',
    owner_team_id: '',
    environments: [...DEFAULT_ENVIRONMENTS],
    clouds: ['aws'],
    services: [{ cloud: 'aws', service: 'eks' }],
    team_access: [],
    approval_rules: [
      { environment: 'dev', require_manager_approval: false, require_devops_approval: true },
      { environment: 'uat', require_manager_approval: true, require_devops_approval: true },
      { environment: 'prod', require_manager_approval: true, require_devops_approval: true },
    ],
  };
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function DevOpsProjectsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<'onboard' | 'bulk-import' | 'bulk-access' | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [portalTeams, setPortalTeams] = useState<TeamOption[]>([]);
  const [ownerTeams, setOwnerTeams] = useState<TeamOption[]>([]);
  const [form, setForm] = useState<ProjectFormState>(createEmptyForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [bulkTeamIds, setBulkTeamIds] = useState<number[]>([]);
  const [bulkEnvironments, setBulkEnvironments] = useState<string[]>([...DEFAULT_ENVIRONMENTS]);
  const [bulkAction, setBulkAction] = useState<'grant' | 'replace' | 'revoke'>('grant');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResults, setBulkResults] = useState<Array<{ index: number; project?: { id: number; name: string; code: string }; error?: string }>>([]);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [teamOptionsError, setTeamOptionsError] = useState('');
  const [notice, setNotice] = useState('');

  const clearSessionAndRedirect = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    if (typeof window !== 'undefined') return window.location.assign('/login');
    router.replace('/login');
  };

  const validateDevOpsSession = async (): Promise<string | null> => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return null;
    }

    const response = await fetch(`${apiUrl}/api/devops/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      clearSessionAndRedirect();
      return null;
    }
    const data = asRecord(await response.json().catch(() => ({})));
    if (!response.ok || !data.user) {
      throw new Error(getString(data.error, 'Failed to validate DevOps session'));
    }
    localStorage.setItem(DEVOPS_USER_KEY, JSON.stringify(data.user));
    const nextToken = typeof data.token === 'string' && data.token.trim() ? data.token.trim() : token;
    localStorage.setItem(DEVOPS_TOKEN_KEY, nextToken);
    return nextToken;
  };

  const fetchProjectOptions = (token: string) => {
    return fetch(`${apiUrl}/api/devops/project-options`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(data.error, 'Failed to load team options'));
        }
        setPortalTeams(Array.isArray(data.portal_teams) ? (data.portal_teams as TeamOption[]) : []);
        setOwnerTeams(Array.isArray(data.owner_teams) ? (data.owner_teams as TeamOption[]) : []);
        setTeamOptionsError('');
        return data;
      })
      .catch((err: Error) => {
        setTeamOptionsError(err.message || 'Failed to load team options');
        return null;
      });
  };

  const fetchData = () => {
    setLoading(true);
    setError('');
    void validateDevOpsSession()
      .then((token) => {
        if (!token) {
          setLoading(false);
          return null;
        }
        void fetchProjectOptions(token);
        return fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } });
      })
      .then(async (res) => {
        if (!res) return null;
        if (res.status === 401 || res.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(data.error, 'Failed to load projects'));
        }
        setProjects(Array.isArray(data.projects) ? (data.projects as ProjectOption[]) : []);
        if (!teamOptionsError) {
          setPortalTeams(Array.isArray(data.portal_teams) ? (data.portal_teams as TeamOption[]) : []);
          setOwnerTeams(
            Array.isArray(data.owner_teams)
              ? (data.owner_teams as TeamOption[])
              : Array.isArray(data.portal_teams)
                ? (data.portal_teams as TeamOption[])
                : [],
          );
        }
        return data;
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [apiUrl, router]);

  const servicesByCloud = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    for (const cloud of form.clouds) {
      grouped[cloud] = SERVICE_OPTIONS[cloud] || [];
    }
    return grouped;
  }, [form.clouds]);

  const updateForm = (patch: Partial<ProjectFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(createEmptyForm());
    setNotice('');
    setError('');
    setActivePanel(null);
  };

  const openCreatePanel = () => {
    setEditingId(null);
    setForm(createEmptyForm());
    setNotice('');
    setError('');
    setActivePanel('onboard');
  };

  const toggleProjectSelection = (projectID: number) => {
    setSelectedProjectIds((current) =>
      current.includes(projectID) ? current.filter((id) => id !== projectID) : [...current, projectID],
    );
  };

  const toggleBulkTeam = (teamID: number) => {
    setBulkTeamIds((current) =>
      current.includes(teamID) ? current.filter((id) => id !== teamID) : [...current, teamID],
    );
  };

  const toggleBulkEnvironment = (environment: string) => {
    setBulkEnvironments((current) =>
      current.includes(environment) ? current.filter((value) => value !== environment) : [...current, environment],
    );
  };

  const toggleEnvironment = (environment: string) => {
    setForm((current) => {
      const exists = current.environments.includes(environment);
      const nextEnvironments = exists
        ? current.environments.filter((value) => value !== environment)
        : [...current.environments, environment];
      const normalizedEnvironments = nextEnvironments.length > 0 ? nextEnvironments : [environment];
      return {
        ...current,
        environments: normalizedEnvironments,
        approval_rules: normalizedEnvironments.map((environment) => {
          const existing = current.approval_rules.find((rule) => rule.environment === environment);
          return existing || {
            environment,
            require_manager_approval: environment !== 'dev',
            require_devops_approval: true,
          };
        }),
        team_access: current.team_access.map((access) => ({
          ...access,
          environments: access.environments.filter((value) => normalizedEnvironments.includes(value)),
        })),
      };
    });
  };

  const toggleCloud = (cloud: string) => {
    setForm((current) => {
      const exists = current.clouds.includes(cloud);
      const nextClouds = exists ? current.clouds.filter((value) => value !== cloud) : [...current.clouds, cloud];
      const normalizedClouds = nextClouds.length > 0 ? nextClouds : [cloud];
      return {
        ...current,
        clouds: normalizedClouds,
        services: current.services.filter((service) => normalizedClouds.includes(service.cloud)),
      };
    });
  };

  const toggleService = (cloud: string, service: string) => {
    setForm((current) => {
      const exists = current.services.some((entry) => entry.cloud === cloud && entry.service === service);
      return {
        ...current,
        services: exists
          ? current.services.filter((entry) => !(entry.cloud === cloud && entry.service === service))
          : [...current.services, { cloud, service }],
      };
    });
  };

  const toggleTeamAccess = (teamID: number) => {
    setForm((current) => {
      const exists = current.team_access.some((access) => access.team_id === teamID);
      return {
        ...current,
        team_access: exists
          ? current.team_access.filter((access) => access.team_id !== teamID)
          : [...current.team_access, { team_id: teamID, environments: [...current.environments] }],
      };
    });
  };

  const toggleTeamEnvironment = (teamID: number, environment: string) => {
    setForm((current) => ({
      ...current,
      team_access: current.team_access.map((access) => {
        if (access.team_id !== teamID) return access;
        const exists = access.environments.includes(environment);
        const nextEnvironments = exists
          ? access.environments.filter((value) => value !== environment)
          : [...access.environments, environment];
        return { ...access, environments: nextEnvironments.length > 0 ? nextEnvironments : [environment] };
      }),
    }));
  };

  const startEdit = (project: ProjectOption) => {
    setEditingId(project.id);
    setActivePanel('onboard');
    setForm({
      name: project.name,
      code: project.code,
      description: project.description,
      status: project.status,
      owner_team_id: project.owner_team_id ? String(project.owner_team_id) : '',
      environments: [...project.environments],
      clouds: [...project.clouds],
      services: [...project.services],
      team_access: project.team_access.map((access) => ({
        team_id: access.team_id,
        environments: [...access.environments],
      })),
      approval_rules: project.approval_rules?.length
        ? project.approval_rules.map((rule) => ({ ...rule }))
        : project.environments.map((environment) => ({
            environment,
            require_manager_approval: environment !== 'dev',
            require_devops_approval: true,
          })),
    });
    setNotice('');
    setError('');
  };

  const updateApprovalRule = (environment: string, field: 'require_manager_approval' | 'require_devops_approval', checked: boolean) => {
    setForm((current) => ({
      ...current,
      approval_rules: current.approval_rules.map((rule) =>
        rule.environment === environment ? { ...rule, [field]: checked } : rule,
      ),
    }));
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    const payload = {
      ...form,
      code: normalizeCode(form.code || form.name),
      owner_team_id: form.owner_team_id ? Number(form.owner_team_id) : null,
      services: form.services,
      team_access: form.team_access,
    };
    try {
      const response = await fetch(
        editingId ? `${apiUrl}/api/devops/projects/${editingId}` : `${apiUrl}/api/devops/projects`,
        {
          method: editingId ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to save project'));
      }
      setEditingId(null);
      setForm(createEmptyForm());
      setActivePanel(null);
      setNotice(editingId ? 'Project updated.' : 'Project created.');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      setSaving(false);
    }
  };

  const submitBulkTeamAccess = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (selectedProjectIds.length === 0) {
      setError('Select at least one project for bulk team access.');
      return;
    }
    if (bulkTeamIds.length === 0) {
      setError('Select at least one team for bulk team access.');
      return;
    }
    if (bulkAction !== 'revoke' && bulkEnvironments.length === 0) {
      setError('Select at least one environment for grant or replace.');
      return;
    }
    setBulkSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/projects/team-access/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          project_ids: selectedProjectIds,
          team_ids: bulkTeamIds,
          environments: bulkEnvironments,
          action: bulkAction,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to apply bulk team access'));
      }
      setNotice(`Bulk ${bulkAction} applied to ${selectedProjectIds.length} project${selectedProjectIds.length === 1 ? '' : 's'}.`);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply bulk team access');
    } finally {
      setBulkSaving(false);
    }
  };

  const exportProjects = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setExporting(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/projects?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      if (!response.ok) {
        const data = asRecord(await response.json().catch(() => ({})));
        throw new Error(getString(data.error, 'Failed to export projects'));
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'devops-projects.csv';
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export projects');
    } finally {
      setExporting(false);
    }
  };

  const submitBulkProjects = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setError('');
    setNotice('');
    setBulkResults([]);
    let parsedProjects: unknown;
    try {
      parsedProjects = JSON.parse(bulkInput);
    } catch {
      setError('Bulk onboarding input must be valid JSON.');
      return;
    }
    if (!Array.isArray(parsedProjects) || parsedProjects.length === 0) {
      setError('Bulk onboarding input must be a non-empty JSON array.');
      return;
    }
    setBulkImporting(true);
    try {
      const response = await fetch(`${apiUrl}/api/devops/projects/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projects: parsedProjects }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok && !Array.isArray(data.results)) {
        throw new Error(getString(data.error, 'Failed to import projects'));
      }
      const createdCount = typeof data.created_count === 'number' ? data.created_count : 0;
      const errorCount = typeof data.error_count === 'number' ? data.error_count : 0;
      setBulkResults(
        Array.isArray(data.results)
          ? (data.results as Array<{ index: number; project?: { id: number; name: string; code: string }; error?: string }>)
          : [],
      );
      setNotice(`Bulk onboarding finished: ${createdCount} created, ${errorCount} errors.`);
      if (createdCount > 0) {
        setBulkInput('');
        fetchData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import projects');
    } finally {
      setBulkImporting(false);
    }
  };

  const selectedOwnerTeamName = ownerTeams.find((team) => String(team.id) === form.owner_team_id)?.name || 'Not set';

  return (
    <DevOpsLayout>
      <Head>
        <title>Projects - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Onboarding</span>
            <h1 className="portal-page__title">Projects</h1>
            <p className="portal-page__subtitle">
              Define the project catalog that drives user requests: environments, clouds, services, and team access.
            </p>
          </div>
          <div className="portal-page__actions">
            <button type="button" className="btn btn-secondary" onClick={() => void exportProjects()} disabled={exporting}>
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreatePanel}>
              Onboard project
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setNotice('');
                setError('');
                setActivePanel((current) => (current === 'bulk-import' ? null : 'bulk-import'));
              }}
            >
              {activePanel === 'bulk-import' ? 'Hide import' : 'Bulk import'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setNotice('');
                setError('');
                setActivePanel((current) => (current === 'bulk-access' ? null : 'bulk-access'));
              }}
            >
              {activePanel === 'bulk-access' ? 'Hide team access' : 'Bulk team access'}
            </button>
          </div>
        </div>

        {!activePanel && (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Project onboarding</span>
                <h2 className="portal-surface__title">Start from the project list</h2>
                <p className="portal-surface__subtitle">
                  Use <strong>Onboard project</strong> only when you want to create or edit a project. Bulk import and team access updates are available on demand.
                </p>
              </div>
            </div>
          </section>
        )}

        {activePanel === 'onboard' && (
          <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">{editingId ? 'Edit Project' : 'Create Project'}</span>
              <h2 className="portal-surface__title">{editingId ? 'Update project catalog' : 'Onboard a new project'}</h2>
              <p className="portal-surface__subtitle">
                Projects become the first choice in the user portal, and only mapped teams can request the configured services.
              </p>
            </div>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Close
              </button>
            </div>
          </div>

          <form onSubmit={submitForm}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label className="label">Project name</label>
                <input className="input" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="label">Project code</label>
                <input className="input" value={form.code} onChange={(e) => updateForm({ code: normalizeCode(e.target.value) })} placeholder="payments-core" required />
              </div>
              <div className="form-group">
                <label className="label">Owner team</label>
                <select className="select" value={form.owner_team_id} onChange={(e) => updateForm({ owner_team_id: e.target.value })}>
                  <option value="">Select owner team</option>
                  {ownerTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                      {team.team_type ? ` (${team.team_type})` : ''}
                    </option>
                  ))}
                </select>
                <small style={{ color: 'var(--text-muted)' }}>
                  {ownerTeams.length > 0
                    ? `Showing ${ownerTeams.length} team${ownerTeams.length === 1 ? '' : 's'} from the admin team catalog for project ownership.`
                    : teamOptionsError
                      ? `Team options error: ${teamOptionsError}`
                      : error
                        ? `Projects API error: ${error}`
                        : 'No teams were returned from the backend team catalog yet.'}
                </small>
              </div>
              <div className="form-group">
                <label className="label">Status</label>
                <select className="select" value={form.status} onChange={(e) => updateForm({ status: e.target.value as ProjectStatus })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="label">Description</label>
              <textarea className="textarea" rows={3} value={form.description} onChange={(e) => updateForm({ description: e.target.value })} />
            </div>

            <div style={{ marginTop: 20 }}>
              <strong>Environments</strong>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
                {DEFAULT_ENVIRONMENTS.map((environment) => (
                  <label key={environment} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={form.environments.includes(environment)} onChange={() => toggleEnvironment(environment)} />
                    <span>{environment.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <strong>Clouds</strong>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
                {CLOUD_OPTIONS.map((cloud) => (
                  <label key={cloud.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={form.clouds.includes(cloud.value)} onChange={() => toggleCloud(cloud.value)} />
                    <span>{cloud.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <strong>Approval rules</strong>
              <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
                Choose which approval stages apply per environment before a PR is created.
              </p>
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Environment</th>
                      <th>Require manager approval</th>
                      <th>Require DevOps approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.environments.map((environment) => {
                      const rule = form.approval_rules.find((entry) => entry.environment === environment) || {
                        environment,
                        require_manager_approval: environment !== 'dev',
                        require_devops_approval: true,
                      };
                      return (
                        <tr key={`approval-${environment}`}>
                          <td>{environment.toUpperCase()}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={rule.require_manager_approval}
                              onChange={(e) => updateApprovalRule(environment, 'require_manager_approval', e.target.checked)}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={rule.require_devops_approval}
                              onChange={(e) => updateApprovalRule(environment, 'require_devops_approval', e.target.checked)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <strong>Allowed services</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 12 }}>
                {Object.entries(servicesByCloud).map(([cloud, services]) => (
                  <div key={cloud} className="request-choice-card">
                    <strong>{cloud.toUpperCase()}</strong>
                    <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                      {services.map((service) => (
                        <label key={`${cloud}-${service}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={form.services.some((entry) => entry.cloud === cloud && entry.service === service)}
                            onChange={() => toggleService(cloud, service)}
                          />
                          <span>{service}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <strong>Team access</strong>
              <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>Choose which portal teams can see the project, then scope the environments they can request.</p>
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Enabled</th>
                      <th>Team</th>
                      <th>Allowed environments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portalTeams.map((team) => {
                      const access = form.team_access.find((entry) => entry.team_id === team.id);
                      return (
                        <tr key={team.id}>
                          <td>
                            <input type="checkbox" checked={!!access} onChange={() => toggleTeamAccess(team.id)} />
                          </td>
                          <td>{team.name}</td>
                          <td>
                            {access ? (
                              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                {form.environments.map((environment) => (
                                  <label key={`${team.id}-${environment}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <input
                                      type="checkbox"
                                      checked={access.environments.includes(environment)}
                                      onChange={() => toggleTeamEnvironment(team.id, environment)}
                                    />
                                    <span>{environment}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>No access</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}
            {notice && <div className="success" style={{ marginTop: 16 }}>{notice}</div>}

            <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update project' : 'Create project'}
              </button>
              {editingId && (
                <button type="button" className="btn btn-secondary" onClick={resetForm}>
                  Cancel edit
                </button>
              )}
              <span style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>Owner team: {selectedOwnerTeamName}</span>
            </div>
          </form>
          </section>
        )}

        {activePanel === 'bulk-import' && (
          <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Bulk onboarding</span>
              <h2 className="portal-surface__title">Import multiple projects</h2>
              <p className="portal-surface__subtitle">
                Paste a JSON array of project definitions to onboard multiple catalogs, environments, clouds, and team mappings in one step.
              </p>
            </div>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-secondary" onClick={() => setActivePanel(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Bulk project JSON</label>
            <textarea
              className="textarea"
              rows={10}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={`[
  {
    "name": "Payments Core",
    "code": "payments-core",
    "description": "Shared payments infrastructure",
    "status": "active",
    "owner_team_id": 1,
    "environments": ["dev", "uat", "prod"],
    "clouds": ["aws"],
    "services": [{ "cloud": "aws", "service": "eks" }, { "cloud": "aws", "service": "rds" }],
    "team_access": [{ "team_id": 2, "environments": ["dev", "uat"] }],
    "approval_rules": [{ "environment": "prod", "require_manager_approval": true, "require_devops_approval": true }]
  }
]`}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => void submitBulkProjects()} disabled={bulkImporting}>
              {bulkImporting ? 'Importing...' : 'Import projects'}
            </button>
            <span style={{ color: 'var(--text-muted)' }}>
              Use owner team IDs and portal team IDs from the existing team catalog.
            </span>
          </div>
          {bulkResults.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Index</th>
                    <th>Result</th>
                    <th>Project</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkResults.map((result) => (
                    <tr key={`bulk-result-${result.index}`}>
                      <td>{result.index + 1}</td>
                      <td>{result.error ? result.error : 'Created'}</td>
                      <td>{result.project ? `${result.project.name} (${result.project.code})` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </section>
        )}

        {activePanel === 'bulk-access' && (
          <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Bulk access</span>
              <h2 className="portal-surface__title">Bulk team mapping editor</h2>
              <p className="portal-surface__subtitle">
                Select multiple projects, choose portal teams, then grant, replace, or revoke environment access in one action.
              </p>
            </div>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-secondary" onClick={() => setActivePanel(null)}>
                Close
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <strong>Selected projects</strong>
              <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
                {selectedProjectIds.length === 0 ? 'No projects selected yet.' : `${selectedProjectIds.length} project${selectedProjectIds.length === 1 ? '' : 's'} selected for bulk updates.`}
              </p>
            </div>
            <div>
              <strong>Portal teams</strong>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
                {portalTeams.map((team) => (
                  <label key={`bulk-team-${team.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={bulkTeamIds.includes(team.id)} onChange={() => toggleBulkTeam(team.id)} />
                    <span>{team.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <strong>Environment scope</strong>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
                {DEFAULT_ENVIRONMENTS.map((environment) => (
                  <label key={`bulk-env-${environment}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={bulkEnvironments.includes(environment)} onChange={() => toggleBulkEnvironment(environment)} disabled={bulkAction === 'revoke'} />
                    <span>{environment.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="select" value={bulkAction} onChange={(e) => setBulkAction(e.target.value as 'grant' | 'replace' | 'revoke')}>
                <option value="grant">Grant environments</option>
                <option value="replace">Replace environments</option>
                <option value="revoke">Revoke team access</option>
              </select>
              <button type="button" className="btn btn-primary" onClick={() => void submitBulkTeamAccess()} disabled={bulkSaving}>
                {bulkSaving ? 'Applying...' : 'Apply bulk update'}
              </button>
            </div>
          </div>
          </section>
        )}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Managed projects</h2>
              <p className="portal-surface__subtitle">Projects listed here will appear in the user portal for mapped teams only.</p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading projects...</div>
          ) : error && projects.length === 0 ? (
            <div className="empty-state">{error}</div>
          ) : projects.length === 0 ? (
            <div className="empty-state">No projects onboarded yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Project</th>
                    <th>Owner team</th>
                    <th>Environments</th>
                    <th>Clouds</th>
                    <th>Services</th>
                    <th>Approval rules</th>
                    <th>Team access</th>
                    <th>Status</th>
                    <th>Stage</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <input type="checkbox" checked={selectedProjectIds.includes(project.id)} onChange={() => toggleProjectSelection(project.id)} />
                      </td>
                      <td>
                        <strong>{project.name}</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{project.code}</div>
                      </td>
                      <td>{project.owner_team || 'Not set'}</td>
                      <td>{project.environments.join(', ')}</td>
                      <td>{project.clouds.join(', ')}</td>
                      <td>{project.services.map((service) => `${service.cloud}:${service.service}`).join(', ')}</td>
                      <td>{project.approval_rules?.map((rule) => `${rule.environment}:${rule.require_manager_approval ? 'mgr' : 'no-mgr'}/${rule.require_devops_approval ? 'devops' : 'admin'}`).join(', ') || 'Default'}</td>
                      <td>{project.team_access.map((access) => `${access.team_name || access.team_slug} (${access.environments.join('/')})`).join(', ')}</td>
                      <td>{project.status}</td>
                      <td>{project.onboarding_stage || 'configured'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">
                            View
                          </Link>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(project)}>
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
