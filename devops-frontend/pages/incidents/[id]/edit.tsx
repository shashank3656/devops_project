import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
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
  major?: boolean;
  status_note?: string;
  problem_id?: number;
  silenced_until?: string;
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
    major: item.major === true,
    status_note: typeof item.status_note === 'string' ? item.status_note : '',
    problem_id: typeof item.problem_id === 'number' ? item.problem_id : 0,
    silenced_until: typeof item.silenced_until === 'string' ? item.silenced_until : '',
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
  const [silencing, setSilencing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
      if (incidentId) {
        const matched = nextIncidents.find((incident) => incident.id === incidentId);
        if (!matched) {
          throw new Error('Incident not found');
        }
        setCurrentIncidentNumber(getIncidentReference(matched));
        setRequestId(matched.request_id > 0 ? String(matched.request_id) : '');
        setTeamId(matched.team_id ? String(matched.team_id) : '');
        setSeverity(matched.severity);
        setStatus(matched.status);
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

  return (
    <DevOpsLayout>
      <Head>
        <title>Edit Incident - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Incident Editor</span>
            <h1 className="portal-page__title">Edit incident</h1>
            <p className="portal-page__subtitle">
              Update the incident on its own page so the queue remains focused on monitoring.
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
              <span className="portal-surface__eyebrow">Incident details</span>
              <h2 className="portal-surface__title">Update incident</h2>
              {currentIncidentNumber ? (
                <p className="portal-surface__subtitle">
                  Incident reference: <strong>{currentIncidentNumber}</strong>
                </p>
              ) : null}
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading incident...</div>
          ) : (
            <>
              <div className="portal-form-grid">
                <label className="label">
                  Incident reference
                  <input className="input" value={currentIncidentNumber} readOnly />
                </label>
                <label className="label">
                  Linked request
                  <input className="input" value={requestId ? `#${requestId}` : 'Not linked'} readOnly />
                </label>
                <label className="label">
                  Source
                  <input className="input" readOnly value={source === 'alert' ? `${alertSource || 'alert'}${fingerprint ? ` · ${fingerprint}` : ''}` : source} />
                </label>
                <label className="label">
                  Suspected change
                  {suspectedChangeId ? (
                    <Link href={`/changes/${suspectedChangeId}`} className="input" style={{ display: 'flex', alignItems: 'center' }}>
                      {suspectedChangeNumber || `CHG${suspectedChangeId}`}
                    </Link>
                  ) : (
                    <input className="input" readOnly value="Not linked" />
                  )}
                </label>
                {source === 'change_regression' ? (
                  <p className="portal-surface__subtitle">Opened by the post-deploy watcher. Check the linked change for the previous SHA rollback hint.</p>
                ) : null}
                <label className="label">
                  Severity
                  <select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label className="label">
                  Status
                  <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="draft">Draft</option>
                    <option value="open">Open</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="investigating">Investigating</option>
                    <option value="mitigating">Mitigating</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <p className="portal-surface__subtitle">
                  Acknowledge when someone owns it. Resolve when service is back. Close after review. Cancel a false alarm.
                </p>
                <label className="label">
                  Incident team
                  <select className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                    <option value="">Select team</option>
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
                  Assigned member
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
                  Summary
                  <input className="input" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Production deployment degraded" />
                </label>
              </div>

              {problemId ? (
                <p className="portal-surface__subtitle">
                  Recurring problem: <Link href={`/problems/${problemId}`}>open problem</Link>
                </p>
              ) : null}
              {silencedUntil ? (
                <p className="portal-surface__subtitle">Silenced until {new Date(silencedUntil).toLocaleString()}</p>
              ) : null}
              <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={major} onChange={(event) => setMajor(event.target.checked)} />
                Major incident — page on-call and post a Slack status note
              </label>
              <label className="label">
                Status note
                <input className="input" value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder="Payments checkout is degraded. Investigating." />
              </label>
              <label className="label">
                Notes
                <textarea className="input" rows={6} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Operational notes, mitigations, and update timeline..." />
              </label>

              <div className="portal-form-actions">
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
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !teamId || (status !== 'draft' && (!ownerUserId || !summary.trim()))}
                  onClick={() => void submit()}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
