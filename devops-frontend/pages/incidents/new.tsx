import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { useEffect, useMemo, useRef, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { focusField } from '../../lib/focusField';
import { scopeListHref, safeReturnPath } from '../../lib/scopeHref';
import { FALLBACK_ITSM_CATEGORIES, IMPACT_URGENCY, INCIDENT_STATES, ITSM_PRIORITIES, ITSMCategory, normalizeCategories, priorityFromImpactUrgency, subcategoriesFor } from '../../lib/itsm';
import { asRecord, getString } from '../../lib/payload';
import { expireSession } from '../../lib/sessionExpiry';
import { forgetAttempt, outcomeForFailedSubmit, rememberAttempt } from '../../lib/submitAttempt';

const INCIDENT_ATTEMPT_KEY = 'opstrellis-incident-attempt';
const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface TeamOption {
  id: number;
  name: string;
  slug: string;
  team_type: string;
}

interface TeamMemberOption {
  id: number;
  team_id: number;
  user_id: number;
  role: string;
  username: string;
  email: string;
}

interface Incident {
  id: number;
  incident_number?: string;
  request_id: number;
}

interface ScopeProject {
  id: number;
  name: string;
  code: string;
  environments: string[];
}

interface ScopeService {
  id: number;
  project_id: number;
  service: string;
  environment: string;
}

function normalizeIncident(incident: unknown): Incident {
  const item = incident && typeof incident === 'object' ? (incident as Record<string, unknown>) : {};
  return {
    id: typeof item.id === 'number' ? item.id : 0,
    incident_number: typeof item.incident_number === 'string' ? item.incident_number : '',
    request_id: typeof item.request_id === 'number' ? item.request_id : 0,
  };
}

function normalizeIncidents(value: unknown): Incident[] {
  if (!Array.isArray(value)) return [];
  return value.map((incident) => normalizeIncident(incident));
}

function normalizeTeams(value: unknown): TeamOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((team) => {
    const item = team && typeof team === 'object' ? (team as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      name: typeof item.name === 'string' ? item.name : 'Unnamed team',
      slug: typeof item.slug === 'string' ? item.slug : '',
      team_type: typeof item.team_type === 'string' ? item.team_type : 'portal',
    };
  });
}

function normalizeMembersByTeam(value: unknown): Record<number, TeamMemberOption[]> {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<number, TeamMemberOption[]> = {};
  for (const [key, rawMembers] of entries) {
    const teamID = Number(key);
    if (!Number.isFinite(teamID) || teamID <= 0 || !Array.isArray(rawMembers)) continue;
    normalized[teamID] = rawMembers.map((member) => {
      const item = member && typeof member === 'object' ? (member as Record<string, unknown>) : {};
      return {
        id: typeof item.id === 'number' ? item.id : 0,
        team_id: typeof item.team_id === 'number' ? item.team_id : teamID,
        user_id: typeof item.user_id === 'number' ? item.user_id : 0,
        role: typeof item.role === 'string' ? item.role : 'member',
        username: typeof item.username === 'string' ? item.username : 'unknown',
        email: typeof item.email === 'string' ? item.email : '',
      };
    });
  }
  return normalized;
}

function clearSessionAndRedirect() {
  expireSession();
}

function parsePositiveIntQuery(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function getIncidentReference(incident: Pick<Incident, 'id' | 'incident_number'>): string {
  return incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`;
}

function resolveIncidentReferenceInput(value: string, incidents: Incident[]): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  const normalized = trimmed.toUpperCase();
  if (!/^INC\d+$/.test(normalized)) return null;
  const matched = incidents.find((incident) => getIncidentReference(incident).toUpperCase() === normalized);
  return matched && matched.request_id > 0 ? matched.request_id : null;
}

export default function NewIncidentPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [membersByTeam, setMembersByTeam] = useState<Record<number, TeamMemberOption[]>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [requestId, setRequestId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [priority, setPriority] = useState('p3');
  const [impact, setImpact] = useState('medium');
  const [urgency, setUrgency] = useState('medium');
  const [status, setStatus] = useState('new');
  const [escalationLevel, setEscalationLevel] = useState('monitoring');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [comment, setComment] = useState('');
  const [callers, setCallers] = useState<TeamMemberOption[]>([]);
  const [categories, setCategories] = useState<ITSMCategory[]>(FALLBACK_ITSM_CATEGORIES);
  const [callerUserId, setCallerUserId] = useState('');
  const [category, setCategory] = useState('software');
  const [subcategory, setSubcategory] = useState('');
  const [parentIncidentId, setParentIncidentId] = useState('');
  const [major, setMajor] = useState(false);
  const [conferenceURL, setConferenceURL] = useState('');
  const [conferenceNotes, setConferenceNotes] = useState('');
  const [currentIncidentNumber, setCurrentIncidentNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { allowLeave } = useUnsavedChanges(Boolean(summary.trim() || notes.trim() || comment.trim() || conferenceNotes.trim()));

  const requestedRequestId = useMemo(() => parsePositiveIntQuery(router.query.request_id), [router.query.request_id]);
  const scopedProjectId = useMemo(() => parsePositiveIntQuery(router.query.project_id) || 0, [router.query.project_id]);
  const scopedEnvironment = useMemo(() => {
    const value = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment;
    return (value || '').trim();
  }, [router.query.environment]);
  const scopedService = useMemo(() => {
    const value = Array.isArray(router.query.service) ? router.query.service[0] : router.query.service;
    return (value || '').trim();
  }, [router.query.service]);
  const scopedServiceId = useMemo(() => parsePositiveIntQuery(router.query.service_id) || 0, [router.query.service_id]);
  const returnPath = safeReturnPath(router.query.return);
  const [scopeProjects, setScopeProjects] = useState<ScopeProject[]>([]);
  const [scopeServices, setScopeServices] = useState<ScopeService[]>([]);
  const [projectChoice, setProjectChoice] = useState('');
  const [incidentEnvironment, setIncidentEnvironment] = useState('');
  const [incidentService, setIncidentService] = useState('');
  const scopeReady = useRef(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('opstrellis-incident-draft');
    if (!raw) {
      const saved = sessionStorage.getItem('opstrellis-incident-note');
      if (saved) setNotes(saved);
      return;
    }
    try {
      const saved = JSON.parse(raw) as { summary?: string; notes?: string; impact?: string; urgency?: string; category?: string; subcategory?: string; projectChoice?: string; incidentEnvironment?: string; incidentService?: string };
      if (saved.summary) setSummary(saved.summary);
      if (saved.notes) setNotes(saved.notes);
      if (saved.impact) setImpact(saved.impact);
      if (saved.urgency) setUrgency(saved.urgency);
      if (saved.category) setCategory(saved.category);
      if (saved.subcategory) setSubcategory(saved.subcategory);
      const params = new URLSearchParams(window.location.search);
      if (!params.get('project_id') && !params.get('service') && !params.get('service_id')) {
        if (saved.projectChoice) setProjectChoice(saved.projectChoice);
        if (saved.incidentEnvironment) setIncidentEnvironment(saved.incidentEnvironment);
        if (saved.incidentService) setIncidentService(saved.incidentService);
      }
    } catch {
      sessionStorage.removeItem('opstrellis-incident-draft');
    }
  }, []);

  useEffect(() => {
    const blob = JSON.stringify({ summary, notes, impact, urgency, category, subcategory, projectChoice, incidentEnvironment, incidentService });
    if (/(password|secret|token)/i.test(blob)) {
      sessionStorage.removeItem('opstrellis-incident-draft');
      sessionStorage.removeItem('opstrellis-incident-note');
      return;
    }
    if (summary.trim() || notes.trim()) sessionStorage.setItem('opstrellis-incident-draft', blob);
    else sessionStorage.removeItem('opstrellis-incident-draft');
  }, [summary, notes, impact, urgency, category, subcategory, projectChoice, incidentEnvironment, incidentService]);

  useEffect(() => {
    if (requestedRequestId && !requestId) {
      setRequestId(String(requestedRequestId));
    }
  }, [requestId, requestedRequestId]);

  const selectedTeamMembers = useMemo(() => {
    const parsedTeamID = Number(teamId);
    if (!Number.isFinite(parsedTeamID) || parsedTeamID <= 0) return [];
    return membersByTeam[parsedTeamID] || [];
  }, [membersByTeam, teamId]);

  const resolvedLinkedRequestId = useMemo(() => {
    if (requestedRequestId) return requestedRequestId;
    return resolveIncidentReferenceInput(requestId, incidents);
  }, [incidents, requestId, requestedRequestId]);

  const loadData = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/incidents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to load incident options'));
      }
      setTeams(normalizeTeams(data.teams));
      setMembersByTeam(normalizeMembersByTeam(data.team_members_by_team));
      setIncidents(normalizeIncidents(data.incidents));
      const callerList = Array.isArray(data.callers) ? data.callers : [];
      setCallers(callerList.filter((item: { id?: number; user_id?: number }) => typeof item.id === 'number' || typeof item.user_id === 'number').map((item: { id?: number; user_id?: number; username?: string; email?: string }) => ({
        id: item.id || 0,
        team_id: 0,
        user_id: item.id || item.user_id || 0,
        role: 'caller',
        username: item.username || 'unknown',
        email: item.email || '',
      })));
      setCategories(normalizeCategories(data.categories));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incident options');
    } finally {
      setLoading(false);
    }
  };

  const loadPreviewIncidentNumber = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/api/devops/incidents?mode=preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) return;
      const nextNumber = getString(data.incident_number);
      if (nextNumber) setCurrentIncidentNumber(nextNumber);
    } catch {
      // Keep the page usable even if preview generation is temporarily unavailable.
    }
  };

  useEffect(() => {
    if (!router.isReady || scopeReady.current) return;
    scopeReady.current = true;
    if (scopedProjectId) setProjectChoice(String(scopedProjectId));
    if (scopedEnvironment) setIncidentEnvironment(scopedEnvironment);
  }, [router.isReady, scopedEnvironment, scopedProjectId]);

  useEffect(() => {
    void loadData();
    void loadPreviewIncidentNumber();
  }, [apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/services`, { headers }).then((res) => res.json().catch(() => ({}))),
    ]).then(([projectBody, serviceBody]) => {
      const projectRows = Array.isArray(projectBody?.projects) ? projectBody.projects : [];
      setScopeProjects(projectRows.map((item: { id?: number; name?: string; code?: string; environments?: unknown }) => ({
        id: typeof item.id === 'number' ? item.id : 0,
        name: item.name || 'Project',
        code: item.code || '',
        environments: Array.isArray(item.environments) ? item.environments.map((value) => String(value)) : [],
      })).filter((item: ScopeProject) => item.id > 0));
      const serviceRows = Array.isArray(serviceBody?.services) ? serviceBody.services : [];
      setScopeServices(serviceRows.map((item: { id?: number; project_id?: number; service?: string; environment?: string }) => ({
        id: typeof item.id === 'number' ? item.id : 0,
        project_id: typeof item.project_id === 'number' ? item.project_id : 0,
        service: item.service || '',
        environment: item.environment || '',
      })).filter((item: ScopeService) => item.service));
    }).catch(() => undefined);
  }, [apiUrl]);

  useEffect(() => {
    setPriority(priorityFromImpactUrgency(impact, urgency));
  }, [impact, urgency]);

  useEffect(() => {
    if (!projectChoice || (!scopedService && !scopedServiceId)) return;
    const match = scopedServiceId
      ? scopeServices.find((item) => item.id === scopedServiceId)
      : scopeServices.find((item) => {
        if (!scopedService || item.service !== scopedService) return false;
        if (projectChoice !== 'cross' && String(item.project_id) !== projectChoice) return false;
        if (incidentEnvironment && item.environment && item.environment !== incidentEnvironment) return false;
        return true;
      });
    if (match) setIncidentService((current) => current || match.service);
  }, [incidentEnvironment, projectChoice, scopeServices, scopedService, scopedServiceId]);

  useEffect(() => {
    if (!teamId || !ownerUserId) return;
    const ownerStillInTeam = selectedTeamMembers.some((member) => String(member.user_id) === ownerUserId);
    if (!ownerStillInTeam) {
      setOwnerUserId('');
    }
  }, [ownerUserId, selectedTeamMembers, teamId]);

  const submit = async (mode: 'draft' | 'submit') => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const linkedRequestID = requestedRequestId || resolveIncidentReferenceInput(requestId, incidents);
      const normalizedStatus = mode === 'draft' ? 'draft' : status === 'draft' ? 'new' : status;
    if (mode !== 'draft' && !summary.trim()) {
      focusField('incident-summary', 'Short description is required');
      throw new Error('Short description is required');
    }
    if (mode !== 'draft' && !projectChoice) {
      focusField('incident-project', 'Select the affected project, or Unknown / cross-project.');
      throw new Error('Select the affected project, or Unknown / cross-project.');
    }
    if (mode !== 'draft' && (normalizedStatus === 'resolved' || normalizedStatus === 'closed') && !notes.trim()) {
      throw new Error('Resolve needs a recovery note before this incident can close.');
    }
      const payload = {
          request_id: linkedRequestID || 0,
          team_id: teamId ? Number(teamId) : null,
          priority,
          impact,
          urgency,
          status: normalizedStatus,
          escalation_level: escalationLevel,
          owner_user_id: ownerUserId ? Number(ownerUserId) : null,
          summary,
          notes,
          comment,
          project_id: projectChoice === 'cross' ? 0 : Number(projectChoice),
          service: incidentService,
          environment: incidentEnvironment,
          caller_user_id: callerUserId ? Number(callerUserId) : 0,
          category,
          subcategory,
          parent_incident_id: parentIncidentId ? Number(parentIncidentId) : 0,
          major,
          conference_url: conferenceURL,
          conference_notes: conferenceNotes,
      };
      const response = await fetch(`${apiUrl}/api/devops/incidents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': rememberAttempt(INCIDENT_ATTEMPT_KEY, JSON.stringify(payload)),
        },
        body: JSON.stringify(payload),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        const outcome = outcomeForFailedSubmit(response.status, getString(data.error, ''));
        if (!outcome.keepAttempt) forgetAttempt(INCIDENT_ATTEMPT_KEY);
        throw new Error(outcome.message);
      }
      forgetAttempt(INCIDENT_ATTEMPT_KEY);
      const savedIncident = normalizeIncident(data.incident);
      setCurrentIncidentNumber(savedIncident.incident_number || `INC${String(savedIncident.id).padStart(7, '0')}`);
      if (!requestedRequestId && savedIncident.request_id > 0) {
        setRequestId(String(savedIncident.request_id));
      }
      setNotice(mode === 'draft' ? 'Incident draft created.' : 'Incident submitted.');
      if (savedIncident.id > 0 && mode === 'submit') {
        sessionStorage.removeItem('opstrellis-incident-draft');
        sessionStorage.removeItem('opstrellis-incident-note');
        allowLeave();
        await router.push(`/incidents/${savedIncident.id}/edit`);
        return;
      }
      void loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save incident';
      if (message === 'Failed to fetch' || message === 'NetworkError when attempting to fetch resource.') {
        setError(outcomeForFailedSubmit(0, '').message);
      } else {
        setError(message);
      }
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Create Incident - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Incident Editor</span>
            <h1 className="portal-page__title">Create incident</h1>
            <p className="portal-page__subtitle">
              {returnPath
                ? 'Project, environment, and service are filled from the service you opened. Change any of them if this incident belongs somewhere else.'
                : 'Record what broke, who is affected, and how urgent it is.'}
            </p>
            <details className="onboard-advanced">
              <summary>How an incident moves</summary>
              <p className="form-section__copy">Impact and urgency suggest a priority. States run from New to In Progress, On Hold, Resolved, and Closed. A number is assigned when you save.</p>
            </details>
          </div>
          <div className="portal-page__actions">
            <Link href={returnPath || scopeListHref('/incidents', router.query)} className="btn btn-secondary">
              {returnPath.startsWith('/services/') ? 'Back to service' : 'Back to incidents'}
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">New incident</span>
              <h2 className="portal-surface__title">Incident details</h2>
              {currentIncidentNumber ? (
                <p className="portal-surface__subtitle">
                  Incident reference: <strong>{currentIncidentNumber}</strong>
                  {status === 'draft' ? ' (draft)' : ''}
                </p>
              ) : null}
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading incident options...</div>
          ) : (
            <>
              <p className="form-req-note"><span aria-hidden="true">*</span> Required</p>
              <fieldset className="form-section">
                <legend className="form-section__title">Affected scope</legend>
                <p className="form-section__copy">
                  {returnPath
                    ? 'These values came from the service. You can change the project, environment, or service.'
                    : 'Choose the project this incident belongs to. Use Unknown / cross-project when it is not one project.'}
                </p>
                <div className="portal-form-grid">
                  <label className="label">
                    Project<span className="form-req" aria-hidden="true"> *</span>
                    <select
                      id="incident-project"
                      className="input"
                      required
                      value={projectChoice}
                      onChange={(event) => {
                        setProjectChoice(event.target.value);
                        setIncidentEnvironment('');
                        setIncidentService('');
                      }}
                    >
                      <option value="">Select a project</option>
                      <option value="cross">Unknown / cross-project</option>
                      {scopeProjects.map((project) => (
                        <option key={project.id} value={project.id}>{project.code ? `${project.name} (${project.code})` : project.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Environment
                    <select className="input" value={incidentEnvironment} onChange={(event) => { setIncidentEnvironment(event.target.value); setIncidentService(''); }} disabled={!projectChoice}>
                      <option value="">{projectChoice ? 'Select an environment' : 'Select a project first'}</option>
                      {(projectChoice === 'cross'
                        ? ['dev', 'uat', 'prod']
                        : (scopeProjects.find((project) => String(project.id) === projectChoice)?.environments?.length
                          ? scopeProjects.find((project) => String(project.id) === projectChoice)?.environments || []
                          : ['dev', 'uat', 'prod'])
                      ).map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Service
                    <select className="input" value={incidentService} onChange={(event) => setIncidentService(event.target.value)} disabled={!projectChoice || projectChoice === 'cross'}>
                      <option value="">{projectChoice === 'cross' ? 'Not tied to one service' : projectChoice ? 'Select a service' : 'Select a project first'}</option>
                      {projectChoice && projectChoice !== 'cross'
                        ? scopeServices
                          .filter((item) => String(item.project_id) === projectChoice && (!incidentEnvironment || !item.environment || item.environment === incidentEnvironment))
                          .map((item) => (
                            <option key={item.id} value={item.service}>{item.service}{item.environment ? ` · ${item.environment}` : ''}</option>
                          ))
                        : null}
                    </select>
                  </label>
                </div>
              </fieldset>
              <fieldset className="form-section">
                <legend className="form-section__title">What happened</legend>
                <label className="label">
                  Short description<span className="form-req" aria-hidden="true"> *</span>
                  <input id="incident-summary" className="input" required value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Production checkout is returning 5xx" />
                </label>
                <div className="portal-form-grid">
                  <label className="label">
                    Impact
                    <select className="input" value={impact} onChange={(event) => setImpact(event.target.value)}>
                      {IMPACT_URGENCY.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    <small>Who is affected.</small>
                  </label>
                  <label className="label">
                    Urgency
                    <select className="input" value={urgency} onChange={(event) => setUrgency(event.target.value)}>
                      {IMPACT_URGENCY.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    <small>How fast a response is needed.</small>
                  </label>
                  <label className="label">
                    Priority
                    <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
                      {ITSM_PRIORITIES.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    <small>Derived from impact and urgency. You can adjust it.</small>
                  </label>
                </div>
                <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={major} onChange={(event) => setMajor(event.target.checked)} />
                  Major incident — open a conference bridge
                </label>
                {major ? (
                  <>
                    <label className="label">
                      Conference URL
                      <input className="input" value={conferenceURL} onChange={(event) => setConferenceURL(event.target.value)} placeholder="https://meet.example.com/major-inc" />
                    </label>
                    <label className="label">
                      Conference notes
                      <input className="input" value={conferenceNotes} onChange={(event) => setConferenceNotes(event.target.value)} placeholder="Bridge pin, war-room channel, next update time" />
                    </label>
                  </>
                ) : null}
              </fieldset>
              <fieldset className="form-section">
                <legend className="form-section__title">Ownership</legend>
                <div className="portal-form-grid">
                  <label className="label">
                    Assignment group
                    <select className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                      <option value="">Select group</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Assignee
                    <select className="input" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} disabled={!teamId}>
                      <option value="">Unassigned</option>
                      {selectedTeamMembers.map((member) => (
                        <option key={member.id} value={member.user_id}>
                          {member.username} ({member.role})
                        </option>
                      ))}
                    </select>
                    <small>Assignment names an owner. It is not acknowledgement.</small>
                  </label>
                  <label className="label">
                    Escalation level
                    <select className="input" value={escalationLevel} onChange={(event) => setEscalationLevel(event.target.value)}>
                      <option value="monitoring">Monitoring</option>
                      <option value="team_lead">Team lead</option>
                      <option value="manager">Manager</option>
                      <option value="executive">Executive</option>
                    </select>
                  </label>
                  <label className="label">
                    State
                    <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                      {INCIDENT_STATES.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>
              <details className="onboard-advanced" open={Boolean(requestId || callerUserId || subcategory || parentIncidentId) || undefined}>
                <summary>More details <span className="onboard-optional">Optional</span></summary>
                <div className="portal-form-grid">
                  <label className="label">
                    Incident reference
                    <input className="input" value={currentIncidentNumber || 'Will be generated when you save'} readOnly />
                  </label>
                  {requestedRequestId ? (
                    <label className="label">
                      Linked request
                      <input className="input" value={`#${requestedRequestId}`} readOnly />
                    </label>
                  ) : (
                    <label className="label">
                      Linked request (optional)
                      <input
                        className="input"
                        value={requestId}
                        onChange={(event) => setRequestId(event.target.value)}
                        placeholder="Optional infra ticket or INC number"
                      />
                    </label>
                  )}
                  <label className="label">
                    Caller
                    <select className="input" value={callerUserId} onChange={(event) => setCallerUserId(event.target.value)}>
                      <option value="">Unknown caller</option>
                      {callers.map((caller) => (
                        <option key={caller.user_id} value={caller.user_id}>
                          {caller.username}
                        </option>
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
                  <label className="label">
                    Parent incident
                    <select className="input" value={parentIncidentId} onChange={(event) => setParentIncidentId(event.target.value)}>
                      <option value="">None — this is the parent</option>
                      {incidents.map((item) => (
                        <option key={item.id} value={item.id}>{getIncidentReference(item)}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>
              <fieldset className="form-section">
                <legend className="form-section__title">Notes <span className="onboard-optional">Optional</span></legend>
                <label className="label">
                  Work note (internal)
                  <textarea className="input" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Internal investigation note" />
                  <small>A draft stays in this browser. The timeline records provenance after save. Resolve or close needs a recovery note.</small>
                </label>
                <label className="label">
                  Customer comment
                  <textarea className="input" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Visible update for the caller" />
                </label>
              </fieldset>

              <div className="portal-form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={() => void submit('draft')}
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !summary.trim()}
                  onClick={() => void submit('submit')}
                >
                  {saving ? 'Saving...' : 'Submit Incident'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
