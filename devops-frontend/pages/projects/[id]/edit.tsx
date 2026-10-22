import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import CloudServiceSelect from '../../../components/CloudServiceSelect';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { asRecord, getString } from '../../../lib/payload';
import { useUnsavedChanges } from '../../../lib/useUnsavedChanges';
import { expireSession } from '../../../lib/sessionExpiry';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

const CLOUD_OPTIONS = [
  { value: 'aws', label: 'AWS' },
  { value: 'azure', label: 'Azure' },
  { value: 'gcp', label: 'GCP' },
];

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

function clearSessionAndRedirect() {
  expireSession();
}

function parseProjectId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function EditProjectPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [portalTeams, setPortalTeams] = useState<TeamOption[]>([]);
  const [ownerTeams, setOwnerTeams] = useState<TeamOption[]>([]);
  const [form, setForm] = useState<ProjectFormState>(createEmptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const [error, setError] = useState('');
  const [teamOptionsError, setTeamOptionsError] = useState('');
  const [notice, setNotice] = useState('');
  const [teamQuery, setTeamQuery] = useState('');

  const projectId = useMemo(() => parseProjectId(router.query.id), [router.query.id]);

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

  const fetchProjectOptions = async (token: string) => {
    const res = await fetch(`${apiUrl}/api/devops/project-options`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) {
      clearSessionAndRedirect();
      return;
    }
    const data = asRecord(await res.json().catch(() => ({})));
    if (!res.ok) throw new Error(getString(data.error, 'Failed to load team options'));
    setPortalTeams(Array.isArray(data.portal_teams) ? (data.portal_teams as TeamOption[]) : []);
    setOwnerTeams(Array.isArray(data.owner_teams) ? (data.owner_teams as TeamOption[]) : []);
    setTeamOptionsError('');
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const token = await validateDevOpsSession();
      if (!token) return;
      await fetchProjectOptions(token);
      const response = await fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to load projects'));
      }
      const nextProjects = Array.isArray(data.projects) ? (data.projects as ProjectOption[]) : [];
      setProjects(nextProjects);
      if (projectId) {
        const project = nextProjects.find((item) => item.id === projectId);
        if (!project) throw new Error('Project not found');
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
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load project';
      setTeamOptionsError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    if (!projectId) {
      setError('Invalid project id');
      setLoading(false);
      return;
    }
    void loadData();
  }, [apiUrl, projectId, router.isReady]);

  const updateForm = (patch: Partial<ProjectFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
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
        approval_rules: normalizedEnvironments.map((nextEnvironment) => {
          const existing = current.approval_rules.find((rule) => rule.environment === nextEnvironment);
          return existing || {
            environment: nextEnvironment,
            require_manager_approval: nextEnvironment !== 'dev',
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

  const updateApprovalRule = (environment: string, field: 'require_manager_approval' | 'require_devops_approval', checked: boolean) => {
    setForm((current) => ({
      ...current,
      approval_rules: current.approval_rules.map((rule) =>
        rule.environment === environment ? { ...rule, [field]: checked } : rule,
      ),
    }));
  };

  const selectedOwnerTeamName = ownerTeams.find((team) => String(team.id) === form.owner_team_id)?.name || 'Not set';
  const teamNeedle = teamQuery.trim().toLowerCase();
  const visibleTeams = portalTeams.filter((team) => team.name.toLowerCase().includes(teamNeedle));

  const deleteProject = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !projectId) {
      clearSessionAndRedirect();
      return;
    }
    setDeleting(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/projects/${projectId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = asRecord(await response.json().catch(() => ({})));
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      if (!response.ok) {
        throw new Error(getString(data.error, 'The project was not deleted.'));
      }
      setDirty(false);
      await router.push('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The project was not deleted.');
      setDeleting(false);
    }
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!projectId) {
      setError('Invalid project id');
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
      const response = await fetch(`${apiUrl}/api/devops/projects/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to save project'));
      }
      setNotice('Project updated.');
      setDirty(false);
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Edit Project - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Onboarding</span>
            <h1 className="portal-page__title">Edit project</h1>
            <p className="portal-page__subtitle">
              Change the name, where it runs, which services it can request, and who can raise work against it.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/projects" className="btn btn-secondary">
              Back to projects
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        {loading ? (
          <div className="empty-state">Loading project...</div>
        ) : (
          <form className="project-edit" onSubmit={submitForm} onChange={() => setDirty(true)}>
            <fieldset className="form-section">
              <legend className="form-section__title">Project</legend>
              <p className="form-section__copy">The name can be changed after the project is created. Save to keep it.</p>
              <div className="portal-form-grid">
                <label className="label" htmlFor="project-edit-project-name">Project name<span className="form-req" aria-hidden="true"> *</span>
                  <input id="project-edit-project-name" className="input" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} required />
                </label>
                <label className="label" htmlFor="project-edit-project-code">Project code<span className="form-req" aria-hidden="true"> *</span>
                  <input id="project-edit-project-code" className="input" value={form.code} onChange={(e) => updateForm({ code: normalizeCode(e.target.value) })} placeholder="payments-core" required />
                </label>
                <label className="label" htmlFor="project-edit-owner-team">Owner team
                  <select id="project-edit-owner-team" className="input" value={form.owner_team_id} onChange={(e) => updateForm({ owner_team_id: e.target.value })}>
                    <option value="">Select owner team</option>
                    {ownerTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                        {team.team_type ? ` (${team.team_type})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label" htmlFor="project-edit-status">Status
                  <select id="project-edit-status" className="input" value={form.status} onChange={(e) => updateForm({ status: e.target.value as ProjectStatus })}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label className="label portal-form-grid__span-2" htmlFor="project-edit-description">Description
                  <textarea id="project-edit-description" className="textarea" rows={3} value={form.description} onChange={(e) => updateForm({ description: e.target.value })} />
                </label>
              </div>
              <p className="form-section__copy">
                {ownerTeams.length > 0
                  ? `Owner team: ${selectedOwnerTeamName}. ${ownerTeams.length} team${ownerTeams.length === 1 ? '' : 's'} can own a project.`
                  : teamOptionsError || 'No owner teams were returned yet.'}
              </p>
            </fieldset>

            <fieldset className="form-section">
              <legend className="form-section__title">Where it runs</legend>
              <p className="form-section__copy">Pick the environments and clouds this project is allowed to use.</p>
              <div>
                <p className="project-edit__label">Environments</p>
                <div className="project-edit__chips">
                  {DEFAULT_ENVIRONMENTS.map((environment) => (
                    <label key={environment} className={`project-edit__chip${form.environments.includes(environment) ? ' is-selected' : ''}`}>
                      <input type="checkbox" checked={form.environments.includes(environment)} onChange={() => toggleEnvironment(environment)} />
                      <span>{environment.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="project-edit__label">Clouds</p>
                <div className="project-edit__chips">
                  {CLOUD_OPTIONS.map((cloud) => (
                    <label key={cloud.value} className={`project-edit__chip${form.clouds.includes(cloud.value) ? ' is-selected' : ''}`}>
                      <input type="checkbox" checked={form.clouds.includes(cloud.value)} onChange={() => toggleCloud(cloud.value)} />
                      <span>{cloud.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend className="form-section__title">Services</legend>
              <p className="form-section__copy">Search and tick the services each selected cloud can request. Selected services stay listed above the search.</p>
              {form.clouds.map((cloud) => (
                <CloudServiceSelect
                  key={cloud}
                  cloud={cloud}
                  selected={form.services.filter((entry) => entry.cloud === cloud).map((entry) => entry.service)}
                  onToggle={toggleService}
                />
              ))}
            </fieldset>

            <fieldset className="form-section">
              <legend className="form-section__title">Approvals</legend>
              <p className="form-section__copy">Choose who must approve a request in each environment before any change is opened.</p>
              <div className="project-edit__rules">
                {form.environments.map((environment) => {
                  const rule = form.approval_rules.find((entry) => entry.environment === environment) || {
                    environment,
                    require_manager_approval: environment !== 'dev',
                    require_devops_approval: true,
                  };
                  return (
                    <div key={`approval-${environment}`} className="project-edit__rule">
                      <strong>{environment.toUpperCase()}</strong>
                      <label>
                        <input
                          type="checkbox"
                          checked={rule.require_manager_approval}
                          onChange={(e) => updateApprovalRule(environment, 'require_manager_approval', e.target.checked)}
                        />
                        <span>Manager approval</span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={rule.require_devops_approval}
                          onChange={(e) => updateApprovalRule(environment, 'require_devops_approval', e.target.checked)}
                        />
                        <span>DevOps approval</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend className="form-section__title">Who can request</legend>
              <p className="form-section__copy">Turn a team on, then choose the environments that team can request in.</p>
              <label className="label" htmlFor="project-edit-team-search">Find a team
                <input id="project-edit-team-search" className="input" type="search" value={teamQuery} placeholder="Search teams" onChange={(event) => setTeamQuery(event.target.value)} />
              </label>
              <div className="project-edit__teams">
                {portalTeams.length === 0 ? (
                  <p className="form-section__copy">{teamOptionsError || 'No portal teams were returned yet.'}</p>
                ) : visibleTeams.length === 0 ? (
                  <p className="form-section__copy">No teams match that search.</p>
                ) : visibleTeams.map((team) => {
                  const access = form.team_access.find((entry) => entry.team_id === team.id);
                  return (
                    <div key={team.id} className={`project-edit__team${access ? ' is-selected' : ''}`}>
                      <label className="project-edit__team-name">
                        <input type="checkbox" checked={!!access} onChange={() => toggleTeamAccess(team.id)} />
                        <span>{team.name}</span>
                      </label>
                      {access ? (
                        <div className="project-edit__chips">
                          {form.environments.map((environment) => (
                            <label key={`${team.id}-${environment}`} className={`project-edit__chip${access.environments.includes(environment) ? ' is-selected' : ''}`}>
                              <input
                                type="checkbox"
                                checked={access.environments.includes(environment)}
                                onChange={() => toggleTeamEnvironment(team.id, environment)}
                              />
                              <span>{environment.toUpperCase()}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <span className="project-edit__muted">No access</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving || deleting}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              <Link href={projectId ? `/projects/${projectId}` : '/projects'} className="btn btn-secondary">
                Cancel
              </Link>
            </div>

            <section className="project-edit__danger" aria-label="Delete project">
              <div>
                <h2>Delete project</h2>
                <p>Services and access rules for this project are removed. Requests already raised stay, without this project.</p>
              </div>
              {confirmDelete ? (
                <div className="project-edit__danger-actions">
                  <button type="button" className="btn btn-primary" disabled={deleting} onClick={() => void deleteProject()}>
                    {deleting ? 'Deleting...' : 'Delete project'}
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                    Keep project
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" disabled={saving || deleting} onClick={() => setConfirmDelete(true)}>
                  Delete project
                </button>
              )}
            </section>
          </form>
        )}
      </div>
    </DevOpsLayout>
  );
}
