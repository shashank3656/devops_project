import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import ITSMClock from '../../../components/ITSMClock';
import ITSMJournal from '../../../components/ITSMJournal';
import { FALLBACK_ITSM_CATEGORIES, INCIDENT_STATES, ITSMCategory, ITSMJournalEntry, IncidentSLA, ITSM_PRIORITIES, incidentCanFinish, incidentStateValue, normalizeCategories, normalizeJournal, normalizeSLA, severityToPriority, subcategoriesFor } from '../../../lib/itsm';
import { asRecord, getString } from '../../../lib/payload';

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
  team_id?: number | null;
  severity: string;
  status: string;
  escalation_level: string;
  owner_user_id?: number | null;
  summary: string;
  notes: string;
  source?: string;
  fingerprint?: string;
  alert_source?: string;
  suspected_change_id?: number;
  suspected_change_number?: string;
  rollback_plan?: { allowed?: boolean; previous_sha?: string; block_reason?: string };
  review?: {
    generated?: boolean;
    caused_by_change?: string;
    previous_sha?: string;
    watch_result?: string;
    impact_summary?: string;
  };
  major?: boolean;
  status_note?: string;
  problem_id?: number;
  silenced_until?: string;
  external_provider?: string;
  external_id?: string;
  caller_user_id?: number | null;
  caller_username?: string;
  category?: string;
  subcategory?: string;
  parent_incident_id?: number | null;
  parent_incident_number?: string;
  child_incidents?: { id: number; incident_number?: string; summary?: string; status?: string }[];
  conference_url?: string;
  conference_notes?: string;
  sla?: IncidentSLA | null;
}

function normalizeIncident(incident: unknown): Incident {
  const item = incident && typeof incident === 'object' ? (incident as Record<string, unknown>) : {};
  return {
    id: typeof item.id === 'number' ? item.id : 0,
    incident_number: typeof item.incident_number === 'string' ? item.incident_number : '',
    request_id: typeof item.request_id === 'number' ? item.request_id : 0,
    team_id: typeof item.team_id === 'number' ? item.team_id : null,
    severity: typeof item.severity === 'string' ? item.severity : 'medium',
    status: typeof item.status === 'string' ? item.status : 'open',
    escalation_level: typeof item.escalation_level === 'string' ? item.escalation_level : 'monitoring',
    owner_user_id: typeof item.owner_user_id === 'number' ? item.owner_user_id : null,
    summary: typeof item.summary === 'string' ? item.summary : '',
    notes: typeof item.notes === 'string' ? item.notes : '',
    source: typeof item.source === 'string' ? item.source : 'ticket',
    fingerprint: typeof item.fingerprint === 'string' ? item.fingerprint : '',
    alert_source: typeof item.alert_source === 'string' ? item.alert_source : '',
    suspected_change_id: typeof item.suspected_change_id === 'number' ? item.suspected_change_id : 0,
    suspected_change_number: typeof item.suspected_change_number === 'string' ? item.suspected_change_number : '',
    rollback_plan: item.rollback_plan && typeof item.rollback_plan === 'object' ? (item.rollback_plan as Incident['rollback_plan']) : undefined,
    major: item.major === true,
    status_note: typeof item.status_note === 'string' ? item.status_note : '',
    problem_id: typeof item.problem_id === 'number' ? item.problem_id : 0,
    silenced_until: typeof item.silenced_until === 'string' ? item.silenced_until : '',
    external_provider: typeof item.external_provider === 'string' ? item.external_provider : '',
    external_id: typeof item.external_id === 'string' ? item.external_id : '',
    caller_user_id: typeof item.caller_user_id === 'number' ? item.caller_user_id : null,
    caller_username: typeof item.caller_username === 'string' ? item.caller_username : '',
    category: typeof item.category === 'string' ? item.category : '',
    subcategory: typeof item.subcategory === 'string' ? item.subcategory : '',
    parent_incident_id: typeof item.parent_incident_id === 'number' ? item.parent_incident_id : null,
    parent_incident_number: typeof item.parent_incident_number === 'string' ? item.parent_incident_number : '',
    child_incidents: Array.isArray(item.child_incidents) ? item.child_incidents as Incident['child_incidents'] : [],
    conference_url: typeof item.conference_url === 'string' ? item.conference_url : '',
    conference_notes: typeof item.conference_notes === 'string' ? item.conference_notes : '',
    sla: normalizeSLA(item.sla),
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
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

function getIncidentReference(incident: Pick<Incident, 'id' | 'incident_number'>): string {
  return incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`;
}

function parseIncidentId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function EditIncidentPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [membersByTeam, setMembersByTeam] = useState<Record<number, TeamMemberOption[]>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [requestId, setRequestId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [status, setStatus] = useState('open');
  const [escalationLevel, setEscalationLevel] = useState('monitoring');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [currentIncidentNumber, setCurrentIncidentNumber] = useState('');
  const [source, setSource] = useState('ticket');
  const [fingerprint, setFingerprint] = useState('');
  const [alertSource, setAlertSource] = useState('');
  const [suspectedChangeId, setSuspectedChangeId] = useState(0);
  const [suspectedChangeNumber, setSuspectedChangeNumber] = useState('');
  const [major, setMajor] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [problemId, setProblemId] = useState(0);
  const [silencedUntil, setSilencedUntil] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [silencing, setSilencing] = useState(false);
  const [rollbackPlan, setRollbackPlan] = useState<Incident['rollback_plan']>();
  const [rollingBack, setRollingBack] = useState(false);
  const [review, setReview] = useState<Incident['review']>();
  const [generatingReview, setGeneratingReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState<'close' | 'cancel' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [callers, setCallers] = useState<TeamMemberOption[]>([]);
  const [categories, setCategories] = useState<ITSMCategory[]>(FALLBACK_ITSM_CATEGORIES);
  const [callerUserId, setCallerUserId] = useState('');
  const [category, setCategory] = useState('software');
  const [subcategory, setSubcategory] = useState('');
  const [parentIncidentId, setParentIncidentId] = useState('');
  const [conferenceURL, setConferenceURL] = useState('');
  const [conferenceNotes, setConferenceNotes] = useState('');
  const [childIncidents, setChildIncidents] = useState<NonNullable<Incident['child_incidents']>>([]);
  const [sla, setSla] = useState<IncidentSLA | null>(null);
  const [journal, setJournal] = useState<ITSMJournalEntry[]>([]);

  const incidentId = useMemo(() => parseIncidentId(router.query.id), [router.query.id]);

  const selectedTeamMembers = useMemo(() => {
    const parsedTeamID = Number(teamId);
    if (!Number.isFinite(parsedTeamID) || parsedTeamID <= 0) return [];
    return membersByTeam[parsedTeamID] || [];
  }, [membersByTeam, teamId]);

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
        throw new Error(getString(data.error, 'Failed to load incident'));
      }
      const nextTeams = normalizeTeams(data.teams);
      const nextMembers = normalizeMembersByTeam(data.team_members_by_team);
      const nextIncidents = normalizeIncidents(data.incidents);
      setTeams(nextTeams);
      setMembersByTeam(nextMembers);
      setIncidents(nextIncidents);
      const callerList = Array.isArray(data.callers) ? data.callers : [];
      setCallers(callerList.filter((item: { id?: number }) => typeof item.id === 'number').map((item: { id: number; username?: string; email?: string }) => ({
        id: item.id,
        team_id: 0,
        user_id: item.id,
        role: 'caller',
        username: item.username || 'unknown',
        email: item.email || '',
      })));
      setCategories(normalizeCategories(data.categories));
      if (incidentId) {
        const matched = nextIncidents.find((incident) => incident.id === incidentId);
        if (!matched) {
          throw new Error('Incident not found');
        }
        setCurrentIncidentNumber(getIncidentReference(matched));
        setRequestId(matched.request_id > 0 ? String(matched.request_id) : '');
        setTeamId(matched.team_id ? String(matched.team_id) : '');
        setSeverity(severityToPriority(matched.severity));
        setStatus(incidentStateValue(matched.status));
        setEscalationLevel(matched.escalation_level);
        setOwnerUserId(matched.owner_user_id ? String(matched.owner_user_id) : '');
        setSummary(matched.summary);
        setNotes(matched.notes);
        setSource(matched.source || 'ticket');
        setFingerprint(matched.fingerprint || '');
        setAlertSource(matched.alert_source || '');
        setSuspectedChangeId(matched.suspected_change_id || 0);
        setSuspectedChangeNumber(matched.suspected_change_number || '');
        setMajor(Boolean(matched.major));
        setStatusNote(matched.status_note || '');
        setProblemId(matched.problem_id || 0);
        setSilencedUntil(matched.silenced_until || '');
        setExternalRef(matched.external_provider && matched.external_id ? `${matched.external_provider} · ${matched.external_id}` : '');
        setCallerUserId(matched.caller_user_id ? String(matched.caller_user_id) : '');
        setCategory(matched.category || 'software');
        setSubcategory(matched.subcategory || '');
        setParentIncidentId(matched.parent_incident_id ? String(matched.parent_incident_id) : '');
        setConferenceURL(matched.conference_url || '');
        setConferenceNotes(matched.conference_notes || '');
        setChildIncidents(matched.child_incidents || []);
        setSla(matched.sla || null);
        setRollbackPlan(matched.rollback_plan);
        const detail = await fetch(`${apiUrl}/api/devops/incidents/${incidentId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (detail.ok) {
          const body = asRecord(await detail.json().catch(() => ({})));
          const plan = body.rollback && typeof body.rollback === 'object' ? (body.rollback as Incident['rollback_plan']) : normalizeIncident(body.incident).rollback_plan;
          if (plan) setRollbackPlan(plan);
          if (body.review && typeof body.review === 'object') {
            setReview(body.review as Incident['review']);
          }
          const detailIncident = normalizeIncident(body.incident);
          if (detailIncident.id) {
            setCallerUserId(detailIncident.caller_user_id ? String(detailIncident.caller_user_id) : callerUserId);
            setCategory(detailIncident.category || category);
            setSubcategory(detailIncident.subcategory || subcategory);
            setParentIncidentId(detailIncident.parent_incident_id ? String(detailIncident.parent_incident_id) : parentIncidentId);
            setConferenceURL(detailIncident.conference_url || conferenceURL);
            setConferenceNotes(detailIncident.conference_notes || conferenceNotes);
            setChildIncidents(detailIncident.child_incidents || []);
            setSla(detailIncident.sla || sla);
            setMajor(Boolean(detailIncident.major || matched.major));
          }
          setJournal(normalizeJournal(body.journal));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incident');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    if (!incidentId) {
      setError('Invalid incident id');
      setLoading(false);
      return;
    }
    void loadData();
  }, [apiUrl, incidentId, router.isReady]);

  useEffect(() => {
    if (!teamId || !ownerUserId) return;
    const ownerStillInTeam = selectedTeamMembers.some((member) => String(member.user_id) === ownerUserId);
    if (!ownerStillInTeam) {
      setOwnerUserId('');
    }
  }, [ownerUserId, selectedTeamMembers, teamId]);

  const submit = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!incidentId) {
      setError('Invalid incident id');
      return;
    }
    if ((status === 'resolved' || status === 'closed') && !statusNote.trim()) {
      setError('Resolve needs fresh recovery evidence in the status note.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/incidents/${incidentId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          team_id: teamId ? Number(teamId) : null,
          severity,
          status,
          escalation_level: escalationLevel,
          owner_user_id: ownerUserId ? Number(ownerUserId) : null,
          summary,
          notes,
          major,
          status_note: statusNote,
          caller_user_id: callerUserId ? Number(callerUserId) : 0,
          category,
          subcategory,
          parent_incident_id: parentIncidentId ? Number(parentIncidentId) : 0,
          conference_url: conferenceURL,
          conference_notes: conferenceNotes,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to save incident'));
      }
      const savedIncident = normalizeIncident(data.incident);
      setCurrentIncidentNumber(getIncidentReference(savedIncident));
      setRequestId(savedIncident.request_id > 0 ? String(savedIncident.request_id) : requestId);
      setNotice('Incident updated.');
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save incident');
    } finally {
      setSaving(false);
    }
  };

  const finish = async (action: 'close' | 'cancel') => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !incidentId) {
      clearSessionAndRedirect();
      return;
    }
    setFinishing(action);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/incidents/${incidentId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: statusNote.trim() }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Could not update the incident'));
      }
      setStatus(action === 'close' ? 'closed' : 'cancelled');
      setNotice(action === 'close' ? 'Incident closed.' : 'Incident cancelled.');
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the incident');
    } finally {
      setFinishing('');
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Edit Incident - OpsTrellis</title>
      </Head>
      <div className="work-page">
        <header className="work-page__head">
          <div>
            <p className="ops-kicker">{currentIncidentNumber || 'Incident'}</p>
            <h1>{summary.trim() || 'Incident'}</h1>
            <p>{loading ? 'Loading this incident.' : 'Update state, assignment, and notes. The queue stays on the list.'}</p>
          </div>
          <div className="request-actions" style={{ marginTop: 0 }}>
            {problemId > 0 ? (
              <Link href={`/problems/${problemId}`} className="btn btn-secondary">
                Open problem
              </Link>
            ) : (
              <Link
                href={`/problems/new?incident_id=${incidentId || ''}&title=${encodeURIComponent(summary || currentIncidentNumber)}&priority=${encodeURIComponent(severity)}`}
                className="btn btn-primary"
              >
                Create problem
              </Link>
            )}
            <Link href="/incidents" className="btn btn-secondary">Back to incidents</Link>
          </div>
        </header>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        {loading ? (
          <p className="work-empty">Loading incident…</p>
        ) : (
          <section className="work-board">
            <div className="request-facts">
              <div><span>Reference</span><strong>{currentIncidentNumber || '—'}</strong></div>
              <div><span>Linked request</span><strong>{requestId ? `#${requestId}` : 'Not linked'}</strong></div>
              <div>
                <span>Source</span>
                <strong>{source === 'alert' ? `${alertSource || 'alert'}${fingerprint ? ` · ${fingerprint}` : ''}` : source || 'Unknown'}</strong>
              </div>
              <div><span>External IRM</span><strong>{externalRef || '—'}</strong></div>
              <div>
                <span>Suspected change</span>
                <strong>
                  {suspectedChangeId ? (
                    <Link href={`/changes/${suspectedChangeId}`}>{suspectedChangeNumber || `CHG${suspectedChangeId}`}</Link>
                  ) : 'Not linked'}
                </strong>
              </div>
              <ITSMClock sla={sla} />
            </div>
            {source === 'change_regression' ? (
              <p className="chg-detail__hint">Opened by the post-deploy watcher. The linked change has the previous SHA.</p>
            ) : null}
            <div className="portal-form-grid" style={{ marginTop: 16 }}>
                <label className="label">
                  Priority
                  <select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                    {ITSM_PRIORITIES.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
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
                  Escalation level
                  <select className="input" value={escalationLevel} onChange={(event) => setEscalationLevel(event.target.value)}>
                    <option value="monitoring">Monitoring</option>
                    <option value="team_lead">Team lead</option>
                    <option value="manager">Manager</option>
                    <option value="executive">Executive</option>
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
                </label>
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
                    {incidents.filter((item) => item.id !== incidentId).map((item) => (
                      <option key={item.id} value={item.id}>{getIncidentReference(item)}</option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Summary
                  <input className="input" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Production deployment degraded" />
                </label>
              </div>

              {rollbackPlan?.previous_sha ? (
                <p className="portal-surface__subtitle">
                  Watcher recovery: {rollbackPlan.allowed ? `record an emergency CHG to ${rollbackPlan.previous_sha}` : rollbackPlan.block_reason || 'rollback blocked'}.
                </p>
              ) : null}
              {review?.caused_by_change || review?.impact_summary ? (
                <p className="portal-surface__subtitle">
                  Review draft{review.caused_by_change ? ` · ${review.caused_by_change}` : ''}
                  {review.watch_result ? ` · Watch ${review.watch_result}` : ''}
                  {review.previous_sha ? ` · previous SHA ${review.previous_sha}` : ''}
                </p>
              ) : null}
              {problemId ? (
                <p className="portal-surface__subtitle">
                  Recurring problem: <Link href={`/problems/${problemId}`}>open problem</Link>
                </p>
              ) : null}
              {silencedUntil ? (
                <p className="portal-surface__subtitle">Silenced until {new Date(silencedUntil).toLocaleString()}</p>
              ) : null}
              {childIncidents.length ? (
                <p className="portal-surface__subtitle">
                  Child incidents:{' '}
                  {childIncidents.map((child, index) => (
                    <span key={child.id}>
                      {index > 0 ? ', ' : ''}
                      <Link href={`/incidents/${child.id}/edit`}>{child.incident_number || `INC${String(child.id).padStart(7, '0')}`}</Link>
                    </span>
                  ))}
                </p>
              ) : null}
              <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={major} onChange={(event) => setMajor(event.target.checked)} />
                Major incident — page on-call and open a conference
              </label>
              {major ? (
                <>
                  <label className="label">
                    Conference URL
                    <input className="input" value={conferenceURL} onChange={(event) => setConferenceURL(event.target.value)} placeholder="https://meet.example.com/major-inc" />
                  </label>
                  <label className="label">
                    Conference notes
                    <input className="input" value={conferenceNotes} onChange={(event) => setConferenceNotes(event.target.value)} placeholder="Bridge pin, war-room channel, next update" />
                  </label>
                </>
              ) : null}
              <label className="label">
                Status note
                <input className="input" value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder="Recovery evidence is required before Resolved or Closed." />
              </label>
              <label className="label">
                Summary notes
                <textarea className="input" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Sticky incident description. Use the journal below for work notes vs customer comments." />
              </label>

              <div className="portal-form-actions">
                <Link href={`/incident-workspace?incident_id=${incidentId}`} className="btn btn-secondary">
                  Open review workspace
                </Link>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={generatingReview || !incidentId}
                  onClick={() => {
                    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                    if (!token || !incidentId) return;
                    setGeneratingReview(true);
                    setError('');
                    fetch(`${apiUrl}/api/devops/incidents/${incidentId}/review`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({}),
                    })
                      .then(async (res) => {
                        const data = asRecord(await res.json().catch(() => ({})));
                        if (!res.ok) throw new Error(getString(data.error, 'Failed to generate review'));
                        if (data.review && typeof data.review === 'object') {
                          setReview(data.review as Incident['review']);
                        }
                        setNotice('Review draft filled from the incident timeline.');
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to generate review'))
                      .finally(() => setGeneratingReview(false));
                  }}
                >
                  {generatingReview ? 'Generating…' : 'Generate from timeline'}
                </button>
                {rollbackPlan?.allowed && rollbackPlan.previous_sha ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={rollingBack}
                    onClick={() => {
                      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                      if (!token || !incidentId) return;
                      setRollingBack(true);
                      fetch(`${apiUrl}/api/devops/incidents/${incidentId}/rollback`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` },
                      })
                        .then(async (res) => {
                          const data = asRecord(await res.json().catch(() => ({})));
                          if (!res.ok) throw new Error(getString(data.error, 'Failed to record rollback'));
                          const change = data.change && typeof data.change === 'object' ? (data.change as { id?: number }) : {};
                          if (change.id) {
                            void router.push(`/changes/${change.id}`);
                          }
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to record rollback'))
                        .finally(() => setRollingBack(false));
                    }}
                  >
                    {rollingBack ? 'Recording…' : `Roll back to ${rollbackPlan.previous_sha.slice(0, 7)}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving || silencing}
                  onClick={() => {
                    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                    if (!token || !incidentId) return;
                    setSilencing(true);
                    fetch(`${apiUrl}/api/devops/incidents/${incidentId}`, {
                      method: 'PATCH',
                      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        team_id: teamId ? Number(teamId) : null,
                        severity,
                        status,
                        escalation_level: escalationLevel,
                        owner_user_id: ownerUserId ? Number(ownerUserId) : null,
                        summary,
                        notes,
                        silence_minutes: 120,
                      }),
                    })
                      .then(async (res) => {
                        const data = asRecord(await res.json().catch(() => ({})));
                        if (!res.ok) throw new Error(getString(data.error, 'Failed to silence'));
                        const saved = normalizeIncident(data.incident);
                        setSilencedUntil(saved.silenced_until || '');
                        setNotice('Alert fingerprint silenced for 2 hours.');
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to silence'))
                      .finally(() => setSilencing(false));
                  }}
                >
                  {silencing ? 'Silencing...' : 'Silence 2 hours'}
                </button>
                {incidentCanFinish(status) ? (
                  <>
                    <button type="button" className="btn btn-primary" disabled={Boolean(finishing) || saving} onClick={() => void finish('close')}>
                      {finishing === 'close' ? 'Closing...' : 'Close'}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={Boolean(finishing) || saving} onClick={() => void finish('cancel')}>
                      {finishing === 'cancel' ? 'Cancelling...' : 'Cancel'}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving || !summary.trim() || Boolean(finishing)}
                  onClick={() => void submit()}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
              {incidentId ? (
                <ITSMJournal
                  apiUrl={apiUrl}
                  path={`/api/devops/incidents/${incidentId}/journal`}
                  entries={journal}
                  onPosted={setJournal}
                />
              ) : null}
          </section>
        )}
      </div>
    </DevOpsLayout>
  );
}
