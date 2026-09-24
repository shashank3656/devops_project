import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
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
  const [severity, setSeverity] = useState('medium');
  const [status, setStatus] = useState('open');
  const [escalationLevel, setEscalationLevel] = useState('monitoring');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
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
      if (!linkedRequestID) {
        throw new Error('Enter a valid request number before saving this incident');
      }
      const normalizedStatus = mode === 'draft' ? 'draft' : status === 'draft' ? 'open' : status;
      const response = await fetch(`${apiUrl}/api/devops/incidents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_id: linkedRequestID,
          team_id: teamId ? Number(teamId) : null,
          severity,
          status: normalizedStatus,
          escalation_level: escalationLevel,
          owner_user_id: ownerUserId ? Number(ownerUserId) : null,
          summary,
          notes,
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
              Use a dedicated page to create an incident without losing the queue context.
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
                    Request number
                    <input
                      className="input"
                      value={requestId}
                      onChange={(event) => setRequestId(event.target.value)}
                      placeholder="Enter the request number for this incident"
                    />
                  </label>
                )}
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

              <label className="label">
                Notes
                <textarea className="input" rows={6} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Operational notes, mitigations, and update timeline..." />
              </label>

              <div className="portal-form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving || !resolvedLinkedRequestId || !teamId}
                  onClick={() => void submit('draft')}
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !resolvedLinkedRequestId || !teamId || !ownerUserId || !summary.trim()}
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
