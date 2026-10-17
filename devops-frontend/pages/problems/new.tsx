import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { FALLBACK_ITSM_CATEGORIES, ITSMCategory, ITSM_PRIORITIES, PROBLEM_STATES, normalizeCategories, subcategoriesFor } from '../../lib/itsm';
import { asRecord, getString } from '../../lib/payload';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { expireSession } from '../../lib/sessionExpiry';
import { focusField } from '../../lib/focusField';
import { saveSubmissionResult } from '../../lib/submissionResult';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  environments?: string[];
}

interface ServiceOption {
  id: number;
  service: string;
  environment: string;
  project_id?: number;
}

interface PortalUserOption {
  id: number;
  username: string;
  email?: string;
}

interface IncidentOption {
  id: number;
  incident_number?: string;
  summary?: string;
  project_id?: number;
}

interface ExistingProblem {
  id: number;
  title: string;
  project_id?: number;
}

function clearSessionAndRedirect() {
  expireSession();
}

export default function NewProblemPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [users, setUsers] = useState<PortalUserOption[]>([]);
  const [incidents, setIncidents] = useState<IncidentOption[]>([]);
  const [previewNumber, setPreviewNumber] = useState('');
  const [title, setTitle] = useState('');
  const [service, setService] = useState('');
  const [environment, setEnvironment] = useState('');
  const [projectId, setProjectId] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assignmentGroupId, setAssignmentGroupId] = useState('');
  const [callerUserId, setCallerUserId] = useState('');
  const [priority, setPriority] = useState('p3');
  const [status, setStatus] = useState('new');
  const [category, setCategory] = useState('software');
  const [subcategory, setSubcategory] = useState('');
  const [categories, setCategories] = useState<ITSMCategory[]>(FALLBACK_ITSM_CATEGORIES);
  const [teams, setTeams] = useState<ProjectOption[]>([]);
  const [description, setDescription] = useState('');
  const [workaround, setWorkaround] = useState('');
  const [knownError, setKnownError] = useState(false);
  const [relatedIncidentId, setRelatedIncidentId] = useState('');
  const [existingProblems, setExistingProblems] = useState<ExistingProblem[]>([]);
  const [problemQuery, setProblemQuery] = useState('');
  const [causeState, setCauseState] = useState<'suspected' | 'confirmed'>('suspected');
  const [fixVerified, setFixVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const { allowLeave } = useUnsavedChanges(Boolean(title.trim() || description.trim() || workaround.trim() || projectId || service.trim()));
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    const authHeaders = { Authorization: `Bearer ${token}` };
    const loadJson = async (path: string) => {
      try {
        const response = await fetch(`${apiUrl}${path}`, { headers: authHeaders });
        if (response.status === 401 || response.status === 403) {
          return { unauthorized: true, data: {} as Record<string, unknown> };
        }
        return { unauthorized: false, data: asRecord(await response.json().catch(() => ({}))) };
      } catch {
        return { unauthorized: false, data: {} as Record<string, unknown> };
      }
    };
    Promise.all([
      loadJson('/api/devops/projects'),
      loadJson('/api/devops/services'),
      loadJson('/api/devops/users?audience=portal'),
      loadJson('/api/devops/incidents'),
      loadJson('/api/devops/problems?mode=preview'),
      loadJson('/api/devops/problems'),
      loadJson('/api/devops/itsm-catalog'),
    ])
      .then(([projectRes, serviceRes, userRes, incidentRes, previewRes, problemRes, catalogRes]) => {
        if ([projectRes, serviceRes, userRes, incidentRes, previewRes, problemRes, catalogRes].every((item) => item.unauthorized)) {
          clearSessionAndRedirect();
          return;
        }
        setCategories(normalizeCategories(catalogRes.data.categories));
        const teamList = Array.isArray(incidentRes.data.teams) ? incidentRes.data.teams : [];
        setTeams(teamList.filter((item: { id?: number; name?: string }) => typeof item.id === 'number').map((item: { id: number; name?: string; slug?: string }) => ({
          id: item.id,
          name: item.name || 'Team',
          code: item.slug || '',
        })));
        const projectList = Array.isArray(projectRes.data.projects) ? projectRes.data.projects : [];
        setProjects(projectList.filter((item: { id?: number }) => typeof item.id === 'number').map((item: { id: number; name?: string; code?: string; environments?: unknown }) => ({
          id: item.id,
          name: item.name || 'Project',
          code: item.code || '',
          environments: Array.isArray(item.environments) ? item.environments.map((value) => String(value)) : [],
        })));
        const serviceList = Array.isArray(serviceRes.data.services) ? serviceRes.data.services : [];
        setServices(serviceList.filter((item: { service?: string }) => item.service) as ServiceOption[]);
        const userList = Array.isArray(userRes.data.users) ? userRes.data.users : [];
        setUsers(userList.filter((item: { id?: number }) => typeof item.id === 'number') as PortalUserOption[]);
        const incidentList = Array.isArray(incidentRes.data.incidents) ? incidentRes.data.incidents : [];
        setIncidents(incidentList.filter((item: { id?: number }) => typeof item.id === 'number').map((item: { id: number; incident_number?: string; summary?: string; project_id?: number }) => ({
          id: item.id,
          incident_number: item.incident_number,
          summary: item.summary,
          project_id: typeof item.project_id === 'number' ? item.project_id : undefined,
        })));
        const problemList = Array.isArray(problemRes.data.problems) ? problemRes.data.problems : [];
        setExistingProblems(problemList.filter((item: { id?: number }) => typeof item.id === 'number').map((item: { id: number; title?: string; summary?: string; project_id?: number }) => ({
          id: item.id,
          title: item.title || item.summary || `Problem ${item.id}`,
          project_id: typeof item.project_id === 'number' ? item.project_id : undefined,
        })));
        const number = getString(previewRes.data.problem_number);
        if (number) setPreviewNumber(number);
      })
      .catch(() => setError('Some dropdowns could not load. You can still create the problem.'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  useEffect(() => {
    const incident = typeof router.query.incident_id === 'string' ? router.query.incident_id : '';
    const nextTitle = typeof router.query.title === 'string' ? router.query.title : '';
    const nextPriority = typeof router.query.priority === 'string' ? router.query.priority : '';
    if (incident) setRelatedIncidentId(incident);
    if (nextTitle) setTitle((current) => current || nextTitle);
    if (nextPriority) setPriority(nextPriority);
  }, [router.query.incident_id, router.query.priority, router.query.title]);

  const applyService = (name: string) => {
    setService(name);
    const mapped = services.find((item) => item.service === name);
    if (mapped?.environment) setEnvironment(mapped.environment);
    if (mapped?.project_id) setProjectId(String(mapped.project_id));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!title.trim()) {
      focusField('problem-title', 'Short description is required');
      setError('Short description is required');
      return;
    }
    if (!projectId) {
      focusField('problem-project', 'Select one project before creating a problem.');
      setError('Select one project before creating a problem.');
      return;
    }
    if (knownError && (!description.trim() || !workaround.trim())) {
      focusField('problem-title', 'A known error needs cause evidence and a workaround.');
      setError('A known error needs cause evidence and a workaround.');
      return;
    }
    if ((status === 'resolved' || status === 'closed') && !fixVerified) {
      setError('Closure needs fix verification.');
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/problems`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          summary: title.trim(),
          description: `Cause (${causeState}): ${description.trim()}`,
          category,
          subcategory,
          service: service.trim(),
          environment: environment.trim(),
          priority,
          status,
          project_id: projectId ? Number(projectId) : 0,
          assignee_user_id: assigneeUserId ? Number(assigneeUserId) : 0,
          assignment_group_id: assignmentGroupId ? Number(assignmentGroupId) : 0,
          caller_user_id: callerUserId ? Number(callerUserId) : 0,
          related_incident_id: relatedIncidentId ? Number(relatedIncidentId) : 0,
          known_error: knownError,
          workaround: workaround.trim(),
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to create problem'));
      }
      const problem = data.problem && typeof data.problem === 'object' ? (data.problem as Record<string, unknown>) : {};
      const id = typeof problem.id === 'number' ? problem.id : 0;
      allowLeave();
      saveSubmissionResult({
        kind: 'Problem',
        id: previewNumber || (id > 0 ? `#${id}` : 'created'),
        status: status || 'new',
        next: 'Assign an owner if it is still unassigned, then record the cause before it can become a known error.',
        href: id > 0 ? `/problems/${id}` : '/problems',
      });
      await router.push(id > 0 ? `/problems/${id}` : '/problems');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create problem');
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  };

  const query = problemQuery.trim().toLowerCase();
  const matchingProblems = projectId
    ? existingProblems.filter((item) => (!item.project_id || String(item.project_id) === projectId) && (!query || item.title.toLowerCase().includes(query)))
    : [];
  const scopedIncidents = projectId
    ? incidents.filter((item) => !item.project_id || String(item.project_id) === projectId)
    : [];
  const scopedServices = projectId
    ? services.filter((item) => !item.project_id || String(item.project_id) === projectId)
    : [];

  return (
    <DevOpsLayout>
      <Head>
        <title>Create problem - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Problem request</span>
            <h1 className="portal-page__title">Create problem</h1>
            <p className="portal-page__subtitle">
              Open a PRB the same way you open a change: short description, service, owner, and a P1–P4 priority.
            </p>
          </div>
          <Link href="/problems" className="btn btn-secondary">
            Back to problems
          </Link>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">New problem</span>
              <h2 className="portal-surface__title">Problem details</h2>
              <p className="portal-surface__subtitle">
                Reference: <strong>{previewNumber || 'Generated on save'}</strong>
              </p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading problem form...</div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <p className="form-req-note"><span aria-hidden="true">*</span> Required</p>
              <fieldset className="form-section">
                <legend className="form-section__title">Scope</legend>
                <p className="form-section__copy">Pick the project first. Service and environment come from that project.</p>
                <div className="portal-form-grid">
<label className="label">
                  Project<span className="form-req" aria-hidden="true"> *</span>
                  <select id="problem-project" className="input" required value={projectId} onChange={(event) => { setProjectId(event.target.value); setRelatedIncidentId(''); setService(''); setEnvironment(''); }}>
                    <option value="">Select one project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.code})
                      </option>
                    ))}
                  </select>
                </label>
<label className="label">
                  Service
                  <select className="input" value={service} onChange={(event) => applyService(event.target.value)} disabled={!projectId}>
                    <option value="">{projectId ? 'Select a service' : 'Select a project first'}</option>
                    {projectId ? scopedServices.map((item) => (
                      <option key={item.id} value={item.service}>
                        {item.service}
                        {item.environment ? ` · ${item.environment}` : ''}
                      </option>
                    )) : null}
                  </select>
                </label>
<label className="label">
                  Environment
                  <select className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} disabled={!projectId}>
                    <option value="">{projectId ? 'Select an environment' : 'Select a project first'}</option>
                    {projectId ? (projects.find((project) => String(project.id) === projectId)?.environments?.length
                      ? projects.find((project) => String(project.id) === projectId)?.environments
                      : Array.from(new Set(scopedServices.map((item) => item.environment).filter(Boolean)))
                    )?.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    )) : null}
                  </select>
                </label>
                </div>
              </fieldset>
              <fieldset className="form-section">
                <legend className="form-section__title">Check existing problems</legend>
                <label className="label">
                  Search this project <span className="onboard-optional">Optional</span>
                  <input className="input" value={problemQuery} onChange={(event) => setProblemQuery(event.target.value)} placeholder="Search before creating a new problem" disabled={!projectId} />
                </label>
                {!projectId ? <p className="onboard-unavailable">Select a project above before this search can match existing problems.</p> : null}
                {projectId && matchingProblems.length > 0 ? (
                  <ul>
                    {matchingProblems.slice(0, 8).map((item) => (
                      <li key={item.id}><Link href={`/problems/${item.id}`}>{item.title}</Link></li>
                    ))}
                  </ul>
                ) : null}
                {projectId && query && matchingProblems.length === 0 ? <p className="form-section__copy">No matching problem in this project.</p> : null}
              </fieldset>
              <fieldset className="form-section">
                <legend className="form-section__title">What happened</legend>
                <div className="portal-form-grid">
<label className="label">
                  Short description<span className="form-req" aria-hidden="true"> *</span>
                  <input id="problem-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Recurring 5xx on checkout after deploy" required />
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
                  State
                  <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                    {PROBLEM_STATES.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
<label className="label">
                  Category
                  <select className="input" value={category} onChange={(event) => { setCategory(event.target.value); setSubcategory(''); }}>
                    {categories.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
<label className="label">
                  Subcategory
                  <select className="input" value={subcategory} onChange={(event) => setSubcategory(event.target.value)}>
                    <option value="">Select subcategory</option>
                    {subcategoriesFor(categories, category).map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                </div>
              </fieldset>
              <details className="onboard-advanced">
                <summary>Ownership <span className="onboard-optional">Optional</span></summary>
                <div className="portal-form-grid">
<label className="label">
                  Assignment group
                  <select className="input" value={assignmentGroupId} onChange={(event) => setAssignmentGroupId(event.target.value)}>
                    <option value="">No group</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </label>
<label className="label">
                  Assignee
                  <select className="input" value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)}>
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username}
                      </option>
                    ))}
                  </select>
                </label>
<label className="label">
                  Caller
                  <select className="input" value={callerUserId} onChange={(event) => setCallerUserId(event.target.value)}>
                    <option value="">Unknown caller</option>
                    {users.map((user) => (
                      <option key={`caller-${user.id}`} value={user.id}>
                        {user.username}
                      </option>
                    ))}
                  </select>
                </label>
<label className="label">
                  Related incident
                  <select className="input" value={relatedIncidentId} onChange={(event) => setRelatedIncidentId(event.target.value)}>
                    <option value="">None</option>
                    {scopedIncidents.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.incident_number || `INC${String(item.id).padStart(7, '0')}`}
                        {item.summary ? ` · ${item.summary}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                </div>
              </details>
              <fieldset className="form-section">
                <legend className="form-section__title">Cause</legend>
              <label className="label">
                Cause
                <select className="input" value={causeState} onChange={(event) => setCauseState(event.target.value === 'confirmed' ? 'confirmed' : 'suspected')}>
                  <option value="suspected">Suspected</option>
                  <option value="confirmed">Confirmed</option>
                </select>
              </label>
              <label className="label">
                Cause evidence
                <textarea className="input" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is recurring, when it started, and the evidence for the cause." />
              </label>
              <label className="label">
                Workaround
                <textarea className="input" rows={3} value={workaround} onChange={(event) => setWorkaround(event.target.value)} placeholder="Required before this can be marked a known error." />
              </label>
              <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={knownError} onChange={(event) => setKnownError(event.target.checked)} />
                Known error — requires cause evidence and a workaround
              </label>
              {(status === 'resolved' || status === 'closed') ? (
                <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={fixVerified} onChange={(event) => setFixVerified(event.target.checked)} />
                  Fix verified. Closure needs this confirmation.
                </label>
              ) : null}
              </fieldset>
              <div className="portal-form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving || !title.trim() || !projectId}>
                  {saving ? 'Creating...' : 'Create problem'}
                </button>
                <Link href="/problems" className="btn btn-secondary">Cancel</Link>
              </div>
            </form>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
