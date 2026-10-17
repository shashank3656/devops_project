import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { scopeListHref } from '../../lib/scopeHref';
import { CHANGE_DRAFT_KEY } from '../../lib/returnPath';
import { ITSM_PRIORITIES } from '../../lib/itsm';
import { asRecord, getString } from '../../lib/payload';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { readWorkspaceScope, WORKSPACE_SCOPE_EVENT, type WorkspaceScope } from '@infragate/ui';
import { expireSession } from '../../lib/sessionExpiry';
import { saveSubmissionResult } from '../../lib/submissionResult';
import BlockedAction from '../../components/BlockedAction';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  team?: string;
  cloud?: string;
  environments?: string[];
}

interface ServiceOption {
  id: number;
  service: string;
  repo: string;
  environment: string;
  project_id?: number;
  project_name?: string;
  project_code?: string;
}

interface PortalUserOption {
  id: number;
  username: string;
  email?: string;
}

function clearSessionAndRedirect() {
  expireSession();
}

function parseProjectList(raw: unknown): ProjectOption[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const clouds = Array.isArray(row.clouds)
        ? row.clouds.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry))
        : [];
      const environments = Array.isArray(row.environments)
        ? row.environments.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry))
        : [];
      return {
        id: typeof row.id === 'number' ? row.id : 0,
        name: typeof row.name === 'string' ? row.name : '',
        code: typeof row.code === 'string' ? row.code : '',
        team: typeof row.owner_team === 'string' ? row.owner_team : '',
        cloud: clouds.join(', '),
        environments,
      };
    })
    .filter((item) => item.id > 0);
}

function parseServiceList(raw: unknown): ServiceOption[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        id: typeof row.id === 'number' ? row.id : 0,
        service: typeof row.service === 'string' ? row.service : '',
        repo: typeof row.repo === 'string' ? row.repo : '',
        environment: typeof row.environment === 'string' ? row.environment : '',
        project_id: typeof row.project_id === 'number' ? row.project_id : undefined,
        project_name: typeof row.project_name === 'string' ? row.project_name : '',
        project_code: typeof row.project_code === 'string' ? row.project_code : '',
      };
    })
    .filter((item) => item.id > 0 && item.service);
}

function parsePortalUsers(raw: unknown): PortalUserOption[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        id: typeof row.id === 'number' ? row.id : 0,
        username: typeof row.username === 'string' ? row.username : '',
        email: typeof row.email === 'string' ? row.email : '',
      };
    })
    .filter((item) => item.id > 0 && item.username);
}

function withSignedInAssignee(users: PortalUserOption[]): PortalUserOption[] {
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    const account = raw ? JSON.parse(raw) as { id?: number; username?: string } : null;
    if (!account || typeof account.id !== 'number' || !account.username) return users;
    if (users.some((user) => user.id === account.id)) return users;
    return [...users, { id: account.id, username: account.username, email: '' }];
  } catch {
    return users;
  }
}

export default function NewChangeRequestPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [users, setUsers] = useState<PortalUserOption[]>([]);
  const [previewNumber, setPreviewNumber] = useState('');
  const [title, setTitle] = useState('');
  const [changeType, setChangeType] = useState('standard');
  const [projectId, setProjectId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [repo, setRepo] = useState('');
  const [sha, setSha] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [priority, setPriority] = useState('p3');
  const [riskLevel, setRiskLevel] = useState('medium');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [summary, setSummary] = useState('');
  const [impact, setImpact] = useState('');
  const [backoutPlan, setBackoutPlan] = useState('');
  const [testPlan, setTestPlan] = useState('');
  const [incidentNumber, setIncidentNumber] = useState('');
  const [watchMinutes, setWatchMinutes] = useState('120');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  const [error, setError] = useState('');
  const [pendingScope, setPendingScope] = useState<WorkspaceScope | null>(null);

  const selectedService = useMemo(
    () => services.find((item) => String(item.id) === serviceId) || null,
    [services, serviceId],
  );
  const draftDirty = Boolean(title.trim() || summary.trim() || impact.trim() || backoutPlan.trim() || serviceId || sha.trim());
  const { allowLeave } = useUnsavedChanges(draftDirty);
  const servicesForProject = projectId
    ? services.filter((item) => !item.project_id || String(item.project_id) === projectId)
    : [];
  const selectedProject = projects.find((project) => String(project.id) === projectId) || null;

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/devops/services`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/devops/users?audience=portal`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/devops/changes?mode=preview`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([projectRes, serviceRes, userRes, previewRes]) => {
        if ([projectRes, serviceRes, userRes, previewRes].some((res) => res.status === 401 || res.status === 403)) {
          clearSessionAndRedirect();
          return;
        }
        const projectData = asRecord(await projectRes.json().catch(() => ({})));
        const serviceData = asRecord(await serviceRes.json().catch(() => ({})));
        const userData = asRecord(await userRes.json().catch(() => ({})));
        const previewData = asRecord(await previewRes.json().catch(() => ({})));
        setProjects(parseProjectList(projectData.projects));
        setServices(parseServiceList(serviceData.services));
        setUsers(withSignedInAssignee(parsePortalUsers(userData.users)));
        const number = getString(previewData.change_number);
        if (number) setPreviewNumber(number);
      })
      .catch(() => setError('Failed to load change form options'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  useEffect(() => {
    const problemNumber = typeof router.query.problem === 'string' ? router.query.problem : '';
    const problemTitle = typeof router.query.title === 'string' ? router.query.title : '';
    const linkedIncident = typeof router.query.incident === 'string' ? router.query.incident : '';
    if (problemTitle) setTitle((current) => current || problemTitle);
    if (problemNumber) setSummary((current) => current || `Fix for ${problemNumber}`);
    if (linkedIncident) setIncidentNumber((current) => current || linkedIncident);
  }, [router.query.incident, router.query.problem, router.query.title]);

  useEffect(() => {
    const raw = sessionStorage.getItem(CHANGE_DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Record<string, unknown>;
      if (typeof draft.title === 'string') setTitle((current) => current || draft.title as string);
      if (typeof draft.summary === 'string') setSummary((current) => current || draft.summary as string);
      if (typeof draft.impact === 'string') setImpact((current) => current || draft.impact as string);
      if (typeof draft.backoutPlan === 'string') setBackoutPlan((current) => current || draft.backoutPlan as string);
      if (typeof draft.projectId === 'string') setProjectId((current) => current || draft.projectId as string);
      if (typeof draft.serviceId === 'string') setServiceId((current) => current || draft.serviceId as string);
    } catch {
      sessionStorage.removeItem(CHANGE_DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    const scope = readWorkspaceScope();
    if (scope.projectId) setProjectId((current) => current || scope.projectId);
  }, [projects]);

  useEffect(() => {
    if (!draftDirty) return;
    sessionStorage.setItem(CHANGE_DRAFT_KEY, JSON.stringify({
      title, summary, impact, backoutPlan, projectId, serviceId,
    }));
  }, [draftDirty, title, summary, impact, backoutPlan, projectId, serviceId]);

  useEffect(() => {
    const onScope = (event: Event) => {
      const next = (event as CustomEvent<WorkspaceScope>).detail || readWorkspaceScope();
      if (!next?.projectId || next.projectId === projectId) return;
      if (draftDirty) {
        setPendingScope(next);
        return;
      }
      setProjectId(next.projectId);
      setServiceId('');
    };
    window.addEventListener(WORKSPACE_SCOPE_EVENT, onScope);
    return () => window.removeEventListener(WORKSPACE_SCOPE_EVENT, onScope);
  }, [draftDirty, projectId]);

  const applyService = (id: string) => {
    setServiceId(id);
    const mapped = services.find((item) => String(item.id) === id);
    if (!mapped) {
      return;
    }
    if (mapped.repo) setRepo(mapped.repo);
    if (mapped.project_id) setProjectId(String(mapped.project_id));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!projectId) {
      setError('Select one project. All projects cannot create a change.');
      return;
    }
    if (!selectedService) {
      setError('Select a service from the Services catalog');
      return;
    }
    if (!assigneeUserId) {
      setError('Assigned to is required');
      return;
    }
    if (plannedStart && plannedEnd && plannedEnd < plannedStart) {
      setError('Planned end must be after planned start');
      return;
    }
    if (changeType === 'emergency' && !incidentNumber.trim()) {
      setError('Emergency changes must link an incident number');
      return;
    }
    if (!impact.trim() || !testPlan.trim() || !backoutPlan.trim()) {
      setError('Impact, test plan, and rollback plan are required.');
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    const idempotencyKey = sessionStorage.getItem('opstrellis-change-idempotency') || crypto.randomUUID();
    sessionStorage.setItem('opstrellis-change-idempotency', idempotencyKey);
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/changes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          title: title.trim(),
          change_type: changeType,
          project_id: projectId ? Number(projectId) : selectedService.project_id || 0,
          service: selectedService.service,
          repo: repo.trim() || selectedService.repo,
          sha: sha.trim(),
          pr_number: prNumber ? Number(prNumber) : 0,
          pr_url: prUrl.trim(),
          summary: [summary.trim(), testPlan.trim() ? `Test plan: ${testPlan.trim()}` : ''].filter(Boolean).join('\n\n'),
          impact: impact.trim(),
          backout_plan: backoutPlan.trim(),
          priority,
          risk_level: riskLevel,
          planned_start: plannedStart,
          planned_end: plannedEnd,
          incident_number: incidentNumber.trim(),
          watch_minutes: Number(watchMinutes) || 120,
          assignee_user_id: Number(assigneeUserId),
          status: 'new',
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        const base = getString(data.error, 'Failed to create change request');
        const cause = getString(data.cause, '');
        throw new Error(cause ? `${base} (${cause})` : base);
      }
      const change = data.change && typeof data.change === 'object' ? (data.change as Record<string, unknown>) : {};
      const id = typeof change.id === 'number' ? change.id : 0;
      sessionStorage.removeItem(CHANGE_DRAFT_KEY);
      sessionStorage.removeItem('opstrellis-change-idempotency');
      allowLeave();
      saveSubmissionResult({
        kind: 'Change',
        id: previewNumber || (id > 0 ? `#${id}` : 'created'),
        status: 'new',
        next: 'Submitting saved the request. It does not deploy. An approver still has to accept it.',
      });
      await router.push(id > 0 ? `/changes/${id}` : '/changes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create change request');
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Create change request - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Change request</span>
            <h1 className="portal-page__title">Create change request</h1>
            <p className="portal-page__subtitle">
              Scope, change details, plans, then review. Saving a request is not a deployment. Approval is not execution.
            </p>
          </div>
          <Link href={scopeListHref('/changes', router.query)} className="btn btn-secondary">
            Back to changes
          </Link>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {pendingScope ? (
          <div className="alert" role="dialog" aria-labelledby="scope-switch-title">
            <strong id="scope-switch-title">This draft is for another project.</strong>
            <p>Switching clears the service selected for this change.</p>
            <div className="portal-form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPendingScope(null)}>Keep editing</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setProjectId(pendingScope.projectId);
                  setServiceId('');
                  setPendingScope(null);
                }}
              >
                Discard and switch
              </button>
            </div>
          </div>
        ) : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">New change</span>
              <h2 className="portal-surface__title">Change details</h2>
              <p className="portal-surface__subtitle">
                Request reference: <strong>{previewNumber || 'Generated on save'}</strong>. A commit SHA is entered separately and is never generated here.
              </p>
            </div>
            <Link href="/services/new" className="btn btn-secondary">
              Add service
            </Link>
          </div>

          {loading ? (
            <div className="empty-state">Loading change form...</div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              {!services.length ? (
                <div className="empty-state">
                  Add a service first. The service dropdown is filled from the Services catalog.
                  {' '}
                  <Link href="/services/new">Create a service</Link>
                </div>
              ) : null}
              <p className="form-req-note"><span aria-hidden="true">*</span> Required</p>
              <fieldset className="form-section">
                <legend className="form-section__title">Scope</legend>
                <p className="form-section__copy">Pick the project first. The service list only shows services in that project.</p>
                <div className="portal-form-grid">
                  <label className="label">
                    Project<span className="form-req" aria-hidden="true"> *</span>
                    <select className="input" required value={projectId} onChange={(event) => {
                      setProjectId(event.target.value);
                      setServiceId('');
                    }}>
                      <option value="">Select one project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name} ({project.code})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Service<span className="form-req" aria-hidden="true"> *</span>
                    <select className="input" value={serviceId} onChange={(event) => applyService(event.target.value)} required>
                      <option value="">Select a service</option>
                      {servicesForProject.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.service}
                          {item.project_name ? ` · ${item.project_name}` : ''}
                          {item.repo ? ` · ${item.repo}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Assigned to<span className="form-req" aria-hidden="true"> *</span>
                    <select className="input" value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)} required>
                      <option value="">Select a portal user</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.username}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="form-section__meta">
                  Team {selectedProject?.team || 'Unknown'} · Cloud {selectedProject?.cloud || 'Unknown'} · Environment {selectedService?.environment || selectedProject?.environments?.join(', ') || 'Unknown'}
                </p>
              </fieldset>
              <fieldset className="form-section">
                <legend className="form-section__title">Change</legend>
                <div className="portal-form-grid">
                  <label className="label">
                    Title<span className="form-req" aria-hidden="true"> *</span>
                    <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Deploy payments-api timeout change" required />
                  </label>
                  <label className="label">
                    Type
                    <select className="input" value={changeType} onChange={(event) => setChangeType(event.target.value)}>
                      <option value="standard">Standard</option>
                      <option value="normal">Normal (CAB on prod)</option>
                      <option value="emergency">Emergency</option>
                    </select>
                  </label>
                  <label className="label">
                    Priority
                    <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
                      {ITSM_PRIORITIES.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Risk
                    <select className="input" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  {changeType === 'emergency' ? (
                    <label className="label">
                      Linked incident<span className="form-req" aria-hidden="true"> *</span>
                      <input className="input" value={incidentNumber} onChange={(event) => setIncidentNumber(event.target.value)} placeholder="INC0000123" required />
                    </label>
                  ) : null}
                </div>
              </fieldset>
              <fieldset className="form-section">
                <legend className="form-section__title">Plans</legend>
                <p className="form-section__copy">Approvers read these before the change runs.</p>
                <label className="label">
                  Impact<span className="form-req" aria-hidden="true"> *</span>
                  <textarea className="input" rows={3} value={impact} onChange={(event) => setImpact(event.target.value)} placeholder="Who or what is affected if this change goes wrong." required />
                </label>
                <label className="label">
                  Test plan<span className="form-req" aria-hidden="true"> *</span>
                  <textarea className="input" rows={3} value={testPlan} onChange={(event) => setTestPlan(event.target.value)} placeholder="How this change will be tested before approval." required />
                </label>
                <label className="label">
                  Rollback plan<span className="form-req" aria-hidden="true"> *</span>
                  <textarea className="input" rows={3} value={backoutPlan} onChange={(event) => setBackoutPlan(event.target.value)} placeholder="How to revert if health or errors move after the change." required />
                </label>
                <label className="label">
                  Summary <span className="onboard-optional">Optional</span>
                  <textarea className="input" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is changing and why this window is safe." />
                </label>
              </fieldset>
              <fieldset className="form-section">
                <legend className="form-section__title">Window <span className="onboard-optional">Optional</span></legend>
                <div className="portal-form-grid">
                  <label className="label">
                    Planned start
                    <input className="input" type="datetime-local" value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)} />
                  </label>
                  <label className="label">
                    Planned end
                    <input className="input" type="datetime-local" value={plannedEnd} onChange={(event) => setPlannedEnd(event.target.value)} />
                  </label>
                  <label className="label">
                    Watch minutes
                    <input className="input" type="number" min={15} value={watchMinutes} onChange={(event) => setWatchMinutes(event.target.value)} />
                  </label>
                </div>
              </fieldset>
              <details className="onboard-advanced" open={Boolean(sha || prNumber || prUrl) || undefined}>
                <summary>Code reference <span className="onboard-optional">Optional</span></summary>
                <p className="form-section__copy">Repo is filled from the selected service. Add a commit or pull request if you already have one.</p>
                <div className="portal-form-grid">
                  <label className="label">
                    Repo
                    <input className="input" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="Filled from the selected service" />
                  </label>
                  <label className="label">
                    Commit SHA
                    <input className="input" value={sha} onChange={(event) => setSha(event.target.value)} placeholder="Commit SHA, if you already have one" />
                  </label>
                  <label className="label">
                    Pull request
                    <input className="input" value={prNumber} onChange={(event) => setPrNumber(event.target.value)} placeholder="1842" />
                  </label>
                  <label className="label">
                    Pull request URL
                    <input className="input" value={prUrl} onChange={(event) => setPrUrl(event.target.value)} placeholder="https://github.com/acme/payments-api/pull/1842" />
                  </label>
                </div>
              </details>
              <p className="form-section__meta">Submitting saves the request. It does not deploy. A later material edit invalidates an existing approval. Approval is not execution.</p>
              <div className="portal-form-actions">
                <BlockedAction
                  blocked={!saving && (!title.trim() || !projectId || !serviceId || !assigneeUserId || !services.length)}
                  reason={!services.length ? 'Add a service to this project before you can request a change.' : !projectId ? 'Choose a project to continue.' : !serviceId ? 'Choose a service to continue.' : !assigneeUserId ? 'Choose who the change is assigned to.' : !title.trim() ? 'Add a title to continue.' : ''}
                >
                <button type="submit" className="btn btn-primary" disabled={saving || !title.trim() || !projectId || !serviceId || !assigneeUserId || !services.length} title={!services.length ? 'Add a service to this project before you can request a change.' : !projectId ? 'Choose a project to continue.' : undefined}>
                  {saving ? 'Creating...' : 'Create change request'}
                </button>
                </BlockedAction>
                <Link href={scopeListHref('/changes', router.query)} className="btn btn-secondary">Cancel</Link>
              </div>
            </form>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
