import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Stepper } from '@infragate/ui';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import CloudServiceSelect from '../../components/CloudServiceSelect';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';
import { expireSession } from '../../lib/sessionExpiry';

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
  on_call: boolean;
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
    on_call: false,
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

const STEPS = [
  { id: 'team', label: 'Team' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'connection', label: 'Connection' },
  { id: 'environments', label: 'Environments' },
  { id: 'access', label: 'Access' },
  { id: 'review', label: 'Review' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

function clearSessionAndRedirect() {
  expireSession();
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
  const [dirty, setDirty] = useState(false);
  const submitLock = useRef(false);
  useUnsavedChanges(dirty);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [step, setStep] = useState<StepId>('team');
  const [stepError, setStepError] = useState('');

  const validateDevOpsSession = async (): Promise<string | null> => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return null;
    }

    const response = await fetch(`${apiUrl}/api/devops/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      clearSessionAndRedirect();
      return null;
    }
    if (response.status === 403) {
      setError('You do not have access to create a project.');
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
    if (res.status === 401) {
      clearSessionAndRedirect();
      return;
    }
    if (res.status === 403) {
      setTeamOptionsError('You do not have access to the project teams.');
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

  const providerNote = (value: string) => {
    if (!providersLoaded) return '';
    if (connectedProviders.includes(value)) return 'Account connected';
    return '';
  };

  const updateTeamAccess = (teamID: number, patch: Partial<ProjectTeamAccess>) => {
    setForm((current) => ({
      ...current,
      team_access: current.team_access.map((access) => (access.team_id === teamID ? { ...access, ...patch } : access)),
    }));
  };

  const validateStep = (id: StepId): string => {
    if (id === 'team') {
      if (!form.name.trim() || !form.code.trim()) return 'Enter a project name and key.';
      if (!form.owner_team_id) return 'Choose the owner team. It decides who works on this project.';
    }
    if (id === 'cloud') {
      if (form.clouds.length === 0) return 'Choose at least one cloud.';
      if (form.services.length === 0) return 'Choose at least one allowed service for the selected cloud.';
    }
    if (id === 'environments') {
      if (form.environments.length === 0) return 'Choose at least one allowed environment.';
      if (form.environments.includes('prod') && !productionReviewed) return 'Confirm the production review before continuing.';
    }
    if (id === 'access') {
      if (form.team_access.length === 0) return 'Give at least one group access to this project.';
      for (const access of form.team_access) {
        if (!access.email.includes('@') || !access.role || access.environments.filter((environment) => environment !== 'prod').length === 0) {
          return 'Each enabled group needs a contact email, a role, and at least one non-production environment.';
        }
        if (access.environments.includes('prod') && !access.production) return 'Production access needs its own confirmation.';
      }
    }
    return '';
  };

  const stepIndex = STEPS.findIndex((entry) => entry.id === step);

  const goNext = () => {
    const message = validateStep(step);
    setStepError(message);
    if (message) return;
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.id);
  };

  const goBack = () => {
    setStepError('');
    const previous = STEPS[stepIndex - 1];
    if (previous) setStep(previous.id);
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (step !== 'review') {
      goNext();
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    const firstInvalid = STEPS.find((entry) => validateStep(entry.id));
    if (firstInvalid) {
      setStep(firstInvalid.id);
      setStepError(validateStep(firstInvalid.id));
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
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
      if (response.status === 401) {
        clearSessionAndRedirect();
        return;
      }
      if (response.status === 403) {
        setError('You do not have access to create a project.');
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.cause) || getString(data.error, 'Failed to save project'));
      }
      const savedProject = asRecord(data.project);
      const savedId = typeof savedProject.id === 'number' ? `#${savedProject.id}` : '';
      setNotice(savedId
        ? `Project ${savedId} is active. Next, connect its cloud account and add services before anyone can request resources.`
        : 'The server accepted the project, but did not return a reference. Check the project list before creating it again.');
      setForm(createEmptyForm());
      setProductionReviewed(false);
      setDirty(false);
      setStep('team');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  };

  const teamName = (id: number) => portalTeams.find((team) => team.id === id)?.name || `Group ${id}`;
  const cloudLabel = (value: string) => CLOUD_OPTIONS.find((cloud) => cloud.value === value)?.label || value.toUpperCase();

  return (
    <DevOpsLayout>
      <Head>
        <title>Create Project - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Onboarding</span>
            <h1 className="portal-page__title">Onboard project</h1>
            <p className="portal-page__subtitle">
              Six short steps: team, cloud, connection, environments, access, then review. Saving records the project. It does not provision infrastructure or grant IAM.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/projects" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? (
          <div className="alert alert-success" role="status">
            {notice} <Link href="/projects">View projects</Link>
          </div>
        ) : null}

        <section className="portal-surface onboard-wizard">
          <Stepper steps={[...STEPS]} current={step} onSelect={(id) => { setStepError(''); setStep(id as StepId); }} />

          {loading ? (
            <div className="empty-state" role="status">Loading project options…</div>
          ) : (
            <form className="catalog-editor__form" onSubmit={submitForm} onChange={() => setDirty(true)} noValidate>
              {step === 'team' ? (
                <fieldset className="onboard-step">
                  <legend className="onboard-step__title">1. Team and project details</legend>
                  <p className="onboard-step__copy">Name the project and choose the team that owns it. The owner team handles requests and on-call.</p>
                  <div className="catalog-editor__field-grid">
                    <div className="form-group">
                      <label className="label" htmlFor="project-name">Project name</label>
                      <input id="project-name" className="input" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} required />
                    </div>
                    <div className="form-group">
                      <label className="label" htmlFor="project-code">Project key</label>
                      <input id="project-code" className="input" value={form.code} onChange={(e) => updateForm({ code: normalizeCode(e.target.value) })} placeholder="payments-core" required aria-describedby="project-code-help" />
                      <small id="project-code-help" className="catalog-editor__field-help">Lowercase letters, numbers and dashes. Used in URLs and branch names.</small>
                    </div>
                    <div className="form-group">
                      <label className="label" htmlFor="project-owner">Owner team</label>
                      <select id="project-owner" className="select" value={form.owner_team_id} onChange={(e) => updateForm({ owner_team_id: e.target.value })} required disabled={ownerTeams.length === 0}>
                        <option value="">{ownerTeams.length === 0 ? 'No teams available' : 'Select owner team'}</option>
                        {ownerTeams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                            {team.team_type ? ` (${team.team_type})` : ''}
                          </option>
                        ))}
                      </select>
                      <small className="catalog-editor__field-help">
                        {ownerTeams.length === 0
                          ? teamOptionsError || 'No owner teams exist yet. An administrator creates them in Portal Access → Groups.'
                          : 'The owner team decides who works on this project.'}
                      </small>
                    </div>
                    <div className="form-group">
                      <label className="label" htmlFor="project-status">Status <span className="onboard-optional">optional</span></label>
                      <select id="project-status" className="select" value={form.status} onChange={(e) => updateForm({ status: e.target.value as ProjectStatus })}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group catalog-editor__field-block">
                    <label className="label" htmlFor="project-description">Description <span className="onboard-optional">optional</span></label>
                    <textarea id="project-description" className="textarea" rows={3} value={form.description} onChange={(e) => updateForm({ description: e.target.value })} />
                  </div>
                  <details className="onboard-advanced">
                    <summary>Advanced: on-call</summary>
                    <p className="catalog-editor__section-copy">Turn this on when the project needs a person every day. The owner team chooses who rotates. If that person is unavailable, they ask someone else, and that person approves before the day changes.</p>
                    <label className="catalog-editor__toggle-label">
                      <input type="checkbox" checked={form.on_call} onChange={(event) => updateForm({ on_call: event.target.checked })} />
                      <span>This project uses on-call</span>
                    </label>
                  </details>
                </fieldset>
              ) : null}

              {step === 'cloud' ? (
                <fieldset className="onboard-step">
                  <legend className="onboard-step__title">2. Cloud and services</legend>
                  <p className="onboard-step__copy">Choose the clouds this project can request against, then the services allowed in each. This records the catalog. It does not provision anything.</p>
                  <div className="catalog-editor__choice-row" role="group" aria-label="Clouds">
                    {CLOUD_OPTIONS.map((cloud) => {
                      const note = providerNote(cloud.value);
                      return (
                        <label key={cloud.value} className="catalog-editor__toggle-label">
                          <input type="checkbox" checked={form.clouds.includes(cloud.value)} onChange={() => toggleCloud(cloud.value)} />
                          <span>{cloud.label}{note ? ` — ${note}` : ''}</span>
                        </label>
                      );
                    })}
                  </div>
                  {form.clouds.length === 0 ? <p className="catalog-editor__field-help">Select a cloud to choose its services.</p> : null}
                  {form.clouds.map((cloud) => (
                    <CloudServiceSelect
                      key={cloud}
                      cloud={cloud}
                      selected={form.services.filter((entry) => entry.cloud === cloud).map((entry) => entry.service)}
                      onToggle={toggleService}
                    />
                  ))}
                </fieldset>
              ) : null}

              {step === 'connection' ? (
                <fieldset className="onboard-step">
                  <legend className="onboard-step__title">3. Cloud connection</legend>
                  <p className="onboard-step__copy">
                    A connected cloud account is what lets OpsTrellis read inventory and run scans. You can save the project without one; those features stay off until you connect.
                  </p>
                  <ul className="onboard-connections">
                    {form.clouds.map((cloud) => {
                      const connected = providersLoaded && connectedProviders.includes(cloud);
                      return (
                        <li key={cloud} className={`onboard-connection onboard-connection--${!providersLoaded ? 'unknown' : connected ? 'ok' : 'missing'}`}>
                          <strong>{cloudLabel(cloud)}</strong>
                          <span>
                            {!providersLoaded
                              ? 'Unknown. Cloud accounts could not be checked.'
                              : connected
                                ? 'Connected. Inventory and scans can run.'
                                : 'Not connected. Inventory and scans stay off for this cloud.'}
                          </span>
                          {!connected ? (
                            <Link href="/cloud-accounts/new" className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">
                              Connect {cloudLabel(cloud)} account
                            </Link>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="catalog-editor__field-help">Connecting opens in a new tab so this form keeps its answers.</p>
                </fieldset>
              ) : null}

              {step === 'environments' ? (
                <fieldset className="onboard-step">
                  <legend className="onboard-step__title">4. Environments and approvals</legend>
                  <p className="onboard-step__copy">Choose where this project can deploy, and which approvals each environment needs before a PR is created.</p>
                  <div className="catalog-editor__choice-row" role="group" aria-label="Environments">
                    {DEFAULT_ENVIRONMENTS.map((environment) => (
                      <label key={environment} className="catalog-editor__toggle-label">
                        <input type="checkbox" checked={form.environments.includes(environment)} onChange={() => toggleEnvironment(environment)} />
                        <span>{environment.toUpperCase()}</span>
                      </label>
                    ))}
                  </div>
                  {form.environments.includes('prod') ? (
                    <label className="catalog-editor__toggle-label onboard-prod-confirm">
                      <input type="checkbox" checked={productionReviewed} onChange={(event) => setProductionReviewed(event.target.checked)} />
                      <span>Production reviewed. This confirms the catalog entry. It does not deploy to production.</span>
                    </label>
                  ) : null}
                  {form.environments.length > 0 ? (
                    <div className="catalog-editor__table-wrap">
                      <table className="templates-table">
                        <caption className="onboard-caption">Approval rules per environment</caption>
                        <thead>
                          <tr>
                            <th scope="col">Environment</th>
                            <th scope="col">Manager approval</th>
                            <th scope="col">DevOps approval</th>
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
                                <th scope="row">{environment.toUpperCase()}</th>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`Require manager approval in ${environment}`}
                                    checked={rule.require_manager_approval}
                                    onChange={(e) => updateApprovalRule(environment, 'require_manager_approval', e.target.checked)}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`Require DevOps approval in ${environment}`}
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
                  ) : (
                    <p className="catalog-editor__field-help">Choose an environment to set its approvals.</p>
                  )}
                </fieldset>
              ) : null}

              {step === 'access' ? (
                <fieldset className="onboard-step">
                  <legend className="onboard-step__title">5. Group access</legend>
                  <p className="onboard-step__copy">
                    Enable each group that works on this project. Each needs a contact email, a role, and at least one environment. Production is confirmed separately. Access takes effect when the project is saved; it does not grant cloud IAM.
                  </p>
                  {portalTeams.length === 0 ? (
                    <p className="onboard-unavailable">No portal groups exist yet. An administrator creates them in Portal Access → Groups.</p>
                  ) : (
                    <div className="catalog-editor__table-wrap">
                      <table className="templates-table">
                        <thead>
                          <tr>
                            <th scope="col">Enabled</th>
                            <th scope="col">Group</th>
                            <th scope="col">Contact email</th>
                            <th scope="col">Role</th>
                            <th scope="col">Environments</th>
                            <th scope="col">Production</th>
                          </tr>
                        </thead>
                        <tbody>
                          {portalTeams.map((team) => {
                            const access = form.team_access.find((entry) => entry.team_id === team.id);
                            const inherited = String(team.id) === form.owner_team_id;
                            return (
                              <tr key={team.id}>
                                <td>
                                  <input type="checkbox" aria-label={`Give ${team.name} access`} checked={!!access} onChange={() => toggleTeamAccess(team.id)} />
                                </td>
                                <th scope="row">
                                  {team.name}
                                  {inherited ? <small className="catalog-editor__field-help"> Owner team</small> : null}
                                </th>
                                <td>
                                  {access ? (
                                    <input className="input" type="email" aria-label={`Contact email for ${team.name}`} value={access.email} onChange={(event) => updateTeamAccess(team.id, { email: event.target.value })} placeholder="name@company.com" />
                                  ) : (
                                    <span className="catalog-editor__field-help">No access</span>
                                  )}
                                </td>
                                <td>
                                  {access ? (
                                    <select className="select" aria-label={`Role for ${team.name}`} value={access.role} onChange={(event) => updateTeamAccess(team.id, { role: event.target.value })}>
                                      <option value="">Select role</option>
                                      <option value="viewer">Viewer</option>
                                      <option value="operator">Operator</option>
                                      <option value="admin">Admin</option>
                                    </select>
                                  ) : null}
                                </td>
                                <td>
                                  {access ? (
                                    form.environments.filter((environment) => environment !== 'prod').length === 0 ? (
                                      <span className="catalog-editor__field-help">Add DEV or UAT in step 4 first.</span>
                                    ) : (
                                      <div className="catalog-editor__choice-row catalog-editor__choice-row--tight">
                                        {form.environments.filter((environment) => environment !== 'prod').map((environment) => (
                                          <label key={`${team.id}-${environment}`} className="catalog-editor__toggle-label catalog-editor__toggle-label--tight">
                                            <input type="checkbox" checked={access.environments.includes(environment)} onChange={() => toggleTeamEnvironment(team.id, environment)} />
                                            <span>{environment}</span>
                                          </label>
                                        ))}
                                      </div>
                                    )
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
                                    <span className="catalog-editor__field-help">{form.environments.includes('prod') ? 'No access' : 'Production not selected'}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </fieldset>
              ) : null}

              {step === 'review' ? (
                <fieldset className="onboard-step">
                  <legend className="onboard-step__title">6. Review</legend>
                  <p className="onboard-step__copy">Check everything, then create the project. Use Edit to change a step.</p>
                  <dl className="onboard-review">
                    <div>
                      <dt>Team <button type="button" className="onboard-edit" onClick={() => setStep('team')}>Edit</button></dt>
                      <dd>{form.name || '—'} ({form.code || '—'}) · Owner {selectedOwnerTeamName} · {form.status}{form.on_call ? ' · On-call on' : ''}</dd>
                    </div>
                    <div>
                      <dt>Cloud <button type="button" className="onboard-edit" onClick={() => setStep('cloud')}>Edit</button></dt>
                      <dd>
                        {form.clouds.length ? form.clouds.map(cloudLabel).join(', ') : '—'}
                        {form.services.length ? ` · ${form.services.length} service${form.services.length === 1 ? '' : 's'}` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Connection <button type="button" className="onboard-edit" onClick={() => setStep('connection')}>Edit</button></dt>
                      <dd>
                        {!providersLoaded
                          ? 'Unknown'
                          : form.clouds.map((cloud) => `${cloudLabel(cloud)} ${connectedProviders.includes(cloud) ? 'connected' : 'not connected'}`).join(' · ') || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Environments <button type="button" className="onboard-edit" onClick={() => setStep('environments')}>Edit</button></dt>
                      <dd>
                        {form.environments.length ? form.environments.map((environment) => environment.toUpperCase()).join(', ') : '—'}
                        {form.environments.includes('prod') ? (productionReviewed ? ' · Production reviewed' : ' · Production not reviewed') : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Access <button type="button" className="onboard-edit" onClick={() => setStep('access')}>Edit</button></dt>
                      <dd>
                        {form.team_access.length
                          ? form.team_access.map((access) => `${teamName(access.team_id)} (${access.role || 'no role'}: ${access.environments.join(', ') || 'none'})`).join(' · ')
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </fieldset>
              ) : null}

              {stepError ? (
                <div className="alert alert-error onboard-step-error" role="alert">
                  {stepError}
                </div>
              ) : null}

              <div className="catalog-editor__footer onboard-footer">
                <button type="button" className="btn btn-secondary" onClick={goBack} disabled={stepIndex === 0 || saving}>
                  Back
                </button>
                <span className="onboard-progress">Step {stepIndex + 1} of {STEPS.length}</span>
                {step === 'review' ? (
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Creating…' : 'Create project'}
                  </button>
                ) : (
                  <button type="submit" className="btn btn-primary">
                    Continue
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
