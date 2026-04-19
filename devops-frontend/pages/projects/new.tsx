import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';

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
  environments: string[];
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
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export default function NewProjectPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [portalTeams, setPortalTeams] = useState<TeamOption[]>([]);
  const [ownerTeams, setOwnerTeams] = useState<TeamOption[]>([]);
  const [form, setForm] = useState<ProjectFormState>(createEmptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [teamOptionsError, setTeamOptionsError] = useState('');
  const [notice, setNotice] = useState('');

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
    if (!res.ok) {
      throw new Error(getString(data.error, 'Failed to load team options'));
    }
    setPortalTeams(Array.isArray(data.portal_teams) ? (data.portal_teams as TeamOption[]) : []);
    setOwnerTeams(Array.isArray(data.owner_teams) ? (data.owner_teams as TeamOption[]) : []);
    setTeamOptionsError('');
  };

  useEffect(() => {
    setLoading(true);
    setError('');
    void validateDevOpsSession()
      .then((token) => {
        if (!token) return;
        return fetchProjectOptions(token);
      })
      .catch((err: Error) => {
        setTeamOptionsError(err.message || 'Failed to load team options');
        setError(err.message || 'Failed to load project options');
      })
      .finally(() => setLoading(false));
  }, [apiUrl]);

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
      const response = await fetch(`${apiUrl}/api/devops/projects`, {
        method: 'POST',
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
        throw new Error(getString(data.cause) || getString(data.error, 'Failed to save project'));
      }
      setNotice('Project created.');
      setForm(createEmptyForm());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Create Project - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Onboarding</span>
            <h1 className="portal-page__title">Onboard project</h1>
            <p className="portal-page__subtitle">
              Use a dedicated page for project onboarding so the project catalog stays easier to browse.
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

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">New project</span>
              <h2 className="portal-surface__title">Project details</h2>
              <p className="portal-surface__subtitle">
                Configure the project catalog, environments, services, and team access in one place.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading project options...</div>
          ) : (
            <form className="catalog-editor__form" onSubmit={submitForm}>
              <div className="catalog-editor__field-grid">
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
                  <small className="catalog-editor__field-help">
                    {ownerTeams.length > 0
                      ? `Showing ${ownerTeams.length} team${ownerTeams.length === 1 ? '' : 's'} from the admin team catalog for project ownership.`
                      : teamOptionsError || 'No teams were returned from the backend team catalog yet.'}
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

              <div className="form-group catalog-editor__field-block">
                <label className="label">Description</label>
                <textarea className="textarea" rows={3} value={form.description} onChange={(e) => updateForm({ description: e.target.value })} />
              </div>

              <div className="catalog-editor__section">
                <strong>Environments</strong>
                <div className="catalog-editor__choice-row">
                  {DEFAULT_ENVIRONMENTS.map((environment) => (
                    <label key={environment} className="catalog-editor__toggle-label">
                      <input type="checkbox" checked={form.environments.includes(environment)} onChange={() => toggleEnvironment(environment)} />
                      <span>{environment.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="catalog-editor__section">
                <strong>Clouds</strong>
                <div className="catalog-editor__choice-row">
                  {CLOUD_OPTIONS.map((cloud) => (
                    <label key={cloud.value} className="catalog-editor__toggle-label">
                      <input type="checkbox" checked={form.clouds.includes(cloud.value)} onChange={() => toggleCloud(cloud.value)} />
                      <span>{cloud.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="catalog-editor__section catalog-editor__section--lg">
                <strong>Approval rules</strong>
                <p className="catalog-editor__section-copy">
                  Choose which approval stages apply per environment before a PR is created.
                </p>
                <div className="catalog-editor__table-wrap">
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

              <div className="catalog-editor__section">
                <strong>Allowed services</strong>
                <div className="catalog-editor__choice-grid">
                  {Object.entries(servicesByCloud).map(([cloud, services]) => (
                    <div key={cloud} className="request-choice-card catalog-editor__choice-card">
                      <strong>{cloud.toUpperCase()}</strong>
                      <div className="catalog-editor__choice-list">
                        {services.map((service) => (
                          <label key={`${cloud}-${service}`} className="catalog-editor__toggle-label">
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

              <div className="catalog-editor__section catalog-editor__section--lg">
                <strong>Team access</strong>
                <p className="catalog-editor__section-copy">Choose which portal teams can see the project, then scope the environments they can request.</p>
                <div className="catalog-editor__table-wrap">
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
                                <div className="catalog-editor__choice-row catalog-editor__choice-row--tight">
                                  {form.environments.map((environment) => (
                                    <label key={`${team.id}-${environment}`} className="catalog-editor__toggle-label catalog-editor__toggle-label--tight">
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
                                <span className="catalog-editor__field-help">No access</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="catalog-editor__footer">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Create project'}
                </button>
                <span className="catalog-editor__owner-note">Owner team: {selectedOwnerTeamName}</span>
              </div>
            </form>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
