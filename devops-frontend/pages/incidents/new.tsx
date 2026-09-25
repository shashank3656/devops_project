import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { FALLBACK_ITSM_CATEGORIES, IMPACT_URGENCY, INCIDENT_STATES, ITSM_PRIORITIES, ITSMCategory, normalizeCategories, priorityFromImpactUrgency, subcategoriesFor } from '../../lib/itsm';
import { asRecord, getString } from '../../lib/payload';

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
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const requestedRequestId = useMemo(() => parsePositiveIntQuery(router.query.request_id), [router.query.request_id]);

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
    void loadData();
    void loadPreviewIncidentNumber();
  }, [apiUrl]);

  useEffect(() => {
    setPriority(priorityFromImpactUrgency(impact, urgency));
  }, [impact, urgency]);

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
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const linkedRequestID = requestedRequestId || resolveIncidentReferenceInput(requestId, incidents);
      const normalizedStatus = mode === 'draft' ? 'draft' : status === 'draft' ? 'new' : status;
      if (mode !== 'draft' && !summary.trim()) {
        throw new Error('Short description is required');
      }
      const response = await fetch(`${apiUrl}/api/devops/incidents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
          caller_user_id: callerUserId ? Number(callerUserId) : 0,
          category,
          subcategory,
          parent_incident_id: parentIncidentId ? Number(parentIncidentId) : 0,
          major,
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
      setCurrentIncidentNumber(savedIncident.incident_number || `INC${String(savedIncident.id).padStart(7, '0')}`);
      if (!requestedRequestId && savedIncident.request_id > 0) {
        setRequestId(String(savedIncident.request_id));
      }
      setNotice(mode === 'draft' ? 'Incident draft created.' : 'Incident submitted.');
      if (savedIncident.id > 0 && mode === 'submit') {
        await router.push(`/incidents/${savedIncident.id}/edit`);
        return;
      }
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save incident');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Create Incident - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Incident Editor</span>
            <h1 className="portal-page__title">Create incident</h1>
            <p className="portal-page__subtitle">
              ServiceNow-style intake: short description, impact, urgency, P1–P4, then New → In Progress → On Hold → Resolved → Closed.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/incidents" className="btn btn-secondary">
              Back to incidents
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
                  Impact
                  <select className="input" value={impact} onChange={(event) => setImpact(event.target.value)}>
                    {IMPACT_URGENCY.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Urgency
                  <select className="input" value={urgency} onChange={(event) => setUrgency(event.target.value)}>
                    {IMPACT_URGENCY.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
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
                        {caller.email ? ` · ${caller.email}` : ''}
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
                <label className="label">
                  Short description
                  <input className="input" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Production checkout is returning 5xx" />
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
              <label className="label">
                Work note (internal)
                <textarea className="input" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Internal investigation note" />
              </label>
              <label className="label">
                Customer comment
                <textarea className="input" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Visible update for the caller" />
              </label>

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
