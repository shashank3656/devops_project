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
  email: string;
  role: string;
  production: boolean;
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
    environments: [],
    clouds: [],
    services: [],
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
  const [productionReviewed, setProductionReviewed] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);

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

  const fetchConnectedProviders = async (token: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/devops/cloud/accounts`, { headers: { Authorization: `Bearer ${token}` } });
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        setConnectedProviders([]);
        setProvidersLoaded(false);
        return;
      }
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      const providers = accounts
        .map((item) => asRecord(item))
        .filter((row) => row.status === 'connected' && typeof row.provider === 'string')
        .map((row) => String(row.provider).toLowerCase());
      setConnectedProviders(Array.from(new Set(providers)));
      setProvidersLoaded(true);
    } catch {
      setConnectedProviders([]);
      setProvidersLoaded(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError('');
    void validateDevOpsSession()
      .then(async (token) => {
        if (!token) return;
        await fetchProjectOptions(token);
        await fetchConnectedProviders(token);
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
      const normalizedEnvironments = nextEnvironments;
      if (environment === 'prod' && exists) setProductionReviewed(false);
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
      const normalizedClouds = nextClouds;
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
          : [...current.team_access, {
              team_id: teamID,
              environments: current.environments.filter((environment) => environment !== 'prod'),
              email: '',
              role: '',
              production: false,
            }],
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
        return { ...access, environments: nextEnvironments, production: nextEnvironments.includes('prod') };
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

  const providerReason = (value: string) => {
    if (!providersLoaded) return 'Cloud connections could not be confirmed.';
    if (!connectedProviders.includes(value)) return 'No connected account.';
    return '';
  };

  const updateTeamAccess = (teamID: number, patch: Partial<ProjectTeamAccess>) => {
    setForm((current) => ({
      ...current,
      team_access: current.team_access.map((access) => (access.team_id === teamID ? { ...access, ...patch } : access)),
    }));
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!form.name.trim() || !form.code.trim()) {
      setError('Project name and key are required.');
      return;
    }
    if (!form.owner_team_id) {
      setError('Choose the working team before the cloud connection.');
      return;
    }
    if (form.clouds.length === 0) {
      setError('Choose a configured cloud connection.');
      return;
    }
    if (form.clouds.some((cloud) => providerReason(cloud))) {
      setError('Only a connected cloud account can be selected.');
      return;
    }
    if (form.environments.length === 0) {
      setError('Choose at least one allowed environment.');
      return;
    }
    if (form.environments.includes('prod') && !productionReviewed) {
      setError('Production needs an explicit review before it can be saved.');
      return;
    }
    if (form.services.length === 0) {
      setError('Choose at least one allowed service.');
      return;
    }
    if (form.team_access.length === 0) {
      setError('Add a team, email, role, and environment access.');
      return;
    }
    for (const access of form.team_access) {
      if (!access.email.includes('@') || !access.role || access.environments.filter((environment) => environment !== 'prod').length === 0) {
        setError('Each member needs a team, email, role, and environment. Production is confirmed separately.');
        return;
      }
      if (access.environments.includes('prod') && !access.production) {
        setError('Production access needs its own confirmation.');
        return;
      }
    }
    setSaving(true);
    setError('');
    setNotice('');
    const payload = {
      ...form,
      code: normalizeCode(form.code || form.name),
      owner_team_id: form.owner_team_id ? Number(form.owner_team_id) : null,
      services: form.services,
      approval_rules: form.approval_rules.filter((rule) => form.environments.includes(rule.environment)),
      team_access: form.team_access.map((access) => ({
        team_id: access.team_id,
        environments: access.production ? access.environments : access.environments.filter((environment) => environment !== 'prod'),
      })),
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
      setNotice(typeof asRecord(data.project).id === 'number' ? `Saved project ${asRecord(data.project).id}.` : 'The server accepted the project, but did not return a reference.');
      setForm(createEmptyForm());
      setProductionReviewed(false);
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
              Name and key, then the working team, then a connected cloud, then the allowed environments. This setup does not provision infrastructure or grant IAM.
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
                Review the catalog, then save. Saving records the project. It does not create a cloud resource.
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
                    Choose the working team before a cloud connection.
                    {teamOptionsError ? ` ${teamOptionsError}` : ''}
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
                <strong>Cloud connection</strong>
                <p className="catalog-editor__section-copy">Only a connected account can be selected. Choosing one does not provision that cloud or grant IAM.</p>
                <div className="catalog-editor__choice-row">
                  {CLOUD_OPTIONS.map((cloud) => {
                    const reason = providerReason(cloud.value);
                    return (
                      <label key={cloud.value} className="catalog-editor__toggle-label">
                        <input
                          type="checkbox"
                          checked={form.clouds.includes(cloud.value)}
                          disabled={Boolean(reason)}
                          onChange={() => toggleCloud(cloud.value)}
                        />
                        <span>{cloud.label}{reason ? ` — ${reason}` : ''}</span>
                      </label>
                    );
                  })}
                </div>
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
                {form.environments.includes('prod') ? (
                  <label className="catalog-editor__toggle-label">
                    <input type="checkbox" checked={productionReviewed} onChange={(event) => setProductionReviewed(event.target.checked)} />
                    <span>Production reviewed. This confirms the catalog entry. It does not deploy to production.</span>
                  </label>
                ) : null}
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
                <p className="catalog-editor__section-copy">
                  Each row needs a team, email, role, and environment. Production is a separate confirmation. A checked row is pending until this project is saved. Effective access is the saved project. This does not grant IAM.
                </p>
                <div className="catalog-editor__table-wrap">
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Enabled</th>
                        <th>Team</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Allowed environments</th>
                        <th>Production</th>
                        <th>Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portalTeams.map((team) => {
                        const access = form.team_access.find((entry) => entry.team_id === team.id);
                        const inherited = String(team.id) === form.owner_team_id;
                        return (
                          <tr key={team.id}>
                            <td>
                              <input type="checkbox" checked={!!access} onChange={() => toggleTeamAccess(team.id)} />
                            </td>
                            <td>{team.name}</td>
                            <td>
                              {access ? (
                                <input className="input" type="email" value={access.email} onChange={(event) => updateTeamAccess(team.id, { email: event.target.value })} placeholder="name@company.com" />
                              ) : (
                                <span className="catalog-editor__field-help">No access</span>
                              )}
                            </td>
                            <td>
                              {access ? (
                                <select className="select" value={access.role} onChange={(event) => updateTeamAccess(team.id, { role: event.target.value })}>
                                  <option value="">Select role</option>
                                  <option value="viewer">Viewer</option>
                                  <option value="operator">Operator</option>
                                  <option value="admin">Admin</option>
                                </select>
                              ) : null}
                            </td>
                            <td>
                              {access ? (
                                <div className="catalog-editor__choice-row catalog-editor__choice-row--tight">
                                  {form.environments.filter((environment) => environment !== 'prod').map((environment) => (
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
                            <td>
                              {access && form.environments.includes('prod') ? (
                                <label className="catalog-editor__toggle-label catalog-editor__toggle-label--tight">
                                  <input
                                    type="checkbox"
                                    checked={access.production}
                                    onChange={(event) => {
                                      const production = event.target.checked;
                                      const environments = production
                                        ? Array.from(new Set([...access.environments, 'prod']))
                                        : access.environments.filter((environment) => environment !== 'prod');
                                      updateTeamAccess(team.id, { production, environments });
                                    }}
                                  />
                                  <span>Confirm</span>
                                </label>
                              ) : (
                                <span className="catalog-editor__field-help">Not included</span>
                              )}
                            </td>
                            <td>
                              {access
                                ? inherited
                                  ? `Inherited from owner team ${team.name}. Pending until save.`
                                  : 'Pending until save. Effective access is the saved project.'
                                : 'No access'}
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
