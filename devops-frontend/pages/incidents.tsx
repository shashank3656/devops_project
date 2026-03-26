import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { downloadCSV } from '../lib/csv';
import { asRecord, getString } from '../lib/payload';

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
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  request_team?: string;
  request_env?: string;
  request_service?: string;
  request_cloud?: string;
  request_status?: string;
  team_id?: number | null;
  team_name?: string;
  severity: string;
  status: string;
  escalation_level: string;
  owner_user_id?: number | null;
  owner_username?: string;
  summary: string;
  notes: string;
}

function normalizeIncident(incident: unknown): Incident {
  const item = incident && typeof incident === 'object' ? (incident as Record<string, unknown>) : {};
  return {
    id: typeof item.id === 'number' ? item.id : 0,
    incident_number: typeof item.incident_number === 'string' ? item.incident_number : '',
    request_id: typeof item.request_id === 'number' ? item.request_id : 0,
    project_id: typeof item.project_id === 'number' ? item.project_id : null,
    project_name: typeof item.project_name === 'string' ? item.project_name : '',
    project_code: typeof item.project_code === 'string' ? item.project_code : '',
    request_team: typeof item.request_team === 'string' ? item.request_team : '',
    request_env: typeof item.request_env === 'string' ? item.request_env : '',
    request_service: typeof item.request_service === 'string' ? item.request_service : '',
    request_cloud: typeof item.request_cloud === 'string' ? item.request_cloud : '',
    request_status: typeof item.request_status === 'string' ? item.request_status : '',
    team_id: typeof item.team_id === 'number' ? item.team_id : null,
    team_name: typeof item.team_name === 'string' ? item.team_name : '',
    severity: typeof item.severity === 'string' ? item.severity : 'medium',
    status: typeof item.status === 'string' ? item.status : 'open',
    escalation_level: typeof item.escalation_level === 'string' ? item.escalation_level : 'monitoring',
    owner_user_id: typeof item.owner_user_id === 'number' ? item.owner_user_id : null,
    owner_username: typeof item.owner_username === 'string' ? item.owner_username : '',
    summary: typeof item.summary === 'string' ? item.summary : '',
    notes: typeof item.notes === 'string' ? item.notes : '',
  };
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

function normalizeIncidents(value: unknown): Incident[] {
  if (!Array.isArray(value)) return [];
  return value.map((incident) => normalizeIncident(incident));
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

function normalizeQueryValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export default function DevOpsIncidentsPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [activePanel, setActivePanel] = useState<'editor' | null>(null);
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [currentIncidentNumber, setCurrentIncidentNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const displayedIncidentNumber =
    currentIncidentNumber || (editingId ? `INC${String(editingId).padStart(7, '0')}` : '');

  const selectedTeamMembers = useMemo(() => {
    const parsedTeamID = Number(teamId);
    if (!Number.isFinite(parsedTeamID) || parsedTeamID <= 0) return [];
    return membersByTeam[parsedTeamID] || [];
  }, [membersByTeam, teamId]);

  const exportIncidents = () => {
    downloadCSV(
      `incidents-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'incident_number',
        'request_id',
        'project_name',
        'project_code',
        'team_name',
        'environment',
        'service',
        'cloud',
        'severity',
        'status',
        'escalation_level',
        'owner',
        'summary',
        'notes',
      ],
      filteredIncidents.map((incident) => [
        incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`,
        incident.request_id,
        incident.project_name || '',
        incident.project_code || '',
        incident.team_name || incident.request_team || '',
        incident.request_env || '',
        incident.request_service || '',
        incident.request_cloud || '',
        incident.severity,
        incident.status,
        incident.escalation_level,
        incident.owner_username || '',
        incident.summary,
        incident.notes,
      ]),
    );
  };

  const activeProjectID = useMemo(() => parsePositiveIntQuery(router.query.project_id), [router.query.project_id]);
  const activeRequestID = useMemo(() => parsePositiveIntQuery(router.query.request_id), [router.query.request_id]);
  const activeSeverityFilter = useMemo(() => normalizeQueryValue(router.query.severity), [router.query.severity]);
  const activeStatusFilter = useMemo(() => normalizeQueryValue(router.query.status), [router.query.status]);
  const activeEnvironmentFilter = useMemo(() => normalizeQueryValue(router.query.environment), [router.query.environment]);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      if (activeProjectID && incident.project_id !== activeProjectID) return false;
      if (activeRequestID && incident.request_id !== activeRequestID) return false;
      if (activeSeverityFilter && incident.severity.trim().toLowerCase() !== activeSeverityFilter) return false;
      if (activeStatusFilter && incident.status.trim().toLowerCase() !== activeStatusFilter) return false;
      if (activeEnvironmentFilter && incident.request_env?.trim().toLowerCase() !== activeEnvironmentFilter) return false;
      return true;
    });
  }, [activeEnvironmentFilter, activeProjectID, activeRequestID, activeSeverityFilter, activeStatusFilter, incidents]);

  const hasActiveFilters = Boolean(
    activeProjectID || activeRequestID || activeSeverityFilter || activeStatusFilter || activeEnvironmentFilter,
  );

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
        throw new Error(getString(data.error, 'Failed to load incidents'));
      }
      setTeams(normalizeTeams(data.teams));
      setMembersByTeam(normalizeMembersByTeam(data.team_members_by_team));
      setIncidents(normalizeIncidents(data.incidents));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiUrl]);

  const resetForm = () => {
    setEditingId(null);
    setCurrentIncidentNumber('');
    setRequestId('');
    setTeamId('');
    setSeverity('medium');
    setStatus('open');
    setEscalationLevel('monitoring');
    setOwnerUserId('');
    setSummary('');
    setNotes('');
    setActivePanel(null);
  };

  const openCreatePanel = () => {
    setEditingId(null);
    setCurrentIncidentNumber('');
    setRequestId('');
    setTeamId('');
    setSeverity('medium');
    setStatus('open');
    setEscalationLevel('monitoring');
    setOwnerUserId('');
    setSummary('');
    setNotes('');
    setError('');
    setNotice('');
    setActivePanel('editor');
  };

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
      const normalizedStatus = mode === 'draft'
        ? 'draft'
        : status === 'draft'
          ? 'open'
          : status;
      const response = await fetch(
        editingId ? `${apiUrl}/api/devops/incidents/${editingId}` : `${apiUrl}/api/devops/incidents`,
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            request_id: Number(requestId),
            team_id: teamId ? Number(teamId) : null,
            severity,
            status: normalizedStatus,
            escalation_level: escalationLevel,
            owner_user_id: ownerUserId ? Number(ownerUserId) : null,
            summary,
            notes,
          }),
        },
      );
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to save incident'));
      }
      const savedIncident = normalizeIncident(data.incident);
      setEditingId(savedIncident.id || editingId);
      setCurrentIncidentNumber(savedIncident.incident_number || `INC${String(savedIncident.id).padStart(7, '0')}`);
      setRequestId(savedIncident.request_id ? String(savedIncident.request_id) : requestId);
      setTeamId(savedIncident.team_id ? String(savedIncident.team_id) : teamId);
      setSeverity(savedIncident.severity || severity);
      setStatus(savedIncident.status || normalizedStatus);
      setEscalationLevel(savedIncident.escalation_level || escalationLevel);
      setOwnerUserId(savedIncident.owner_user_id ? String(savedIncident.owner_user_id) : ownerUserId);
      setSummary(savedIncident.summary || summary);
      setNotes(savedIncident.notes || notes);
      if (mode === 'draft') {
        setNotice(
          `${editingId ? 'Incident draft saved' : 'Incident draft created'}: ${savedIncident.incident_number || `INC${String(savedIncident.id).padStart(7, '0')}`}.`,
        );
      } else {
        setNotice(
          `${editingId ? 'Incident updated' : 'Incident submitted'}: ${savedIncident.incident_number || `INC${String(savedIncident.id).padStart(7, '0')}`}.`,
        );
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save incident');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Incident Panel - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations Control</span>
            <h1 className="portal-page__title">Incident / Escalation Panel</h1>
            <p className="portal-page__subtitle">
              Link requests to incidents, assign severity and escalation level, and track who owns the operational response.
            </p>
          </div>
          <div className="portal-page__actions">
            <button type="button" className="btn btn-secondary" onClick={exportIncidents} disabled={filteredIncidents.length === 0}>
              Export CSV
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreatePanel}>
              Create incident
            </button>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {hasActiveFilters ? (
          <div className="alert alert-info">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                Showing incidents
                {activeProjectID ? ` for project #${activeProjectID}` : ''}
                {activeRequestID ? ` for request #${activeRequestID}` : ''}
                {activeSeverityFilter ? ` with ${activeSeverityFilter} severity` : ''}
                {activeStatusFilter ? ` in ${activeStatusFilter} status` : ''}
                {activeEnvironmentFilter ? ` for ${activeEnvironmentFilter.toUpperCase()}` : ''}.
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void router.push('/incidents')}>
                Clear filters
              </button>
            </div>
          </div>
        ) : null}

        {!activePanel ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Incident management</span>
                <h2 className="portal-surface__title">Start from the incident queue</h2>
                <p className="portal-surface__subtitle">
                  Use <strong>Create incident</strong> only when you want to raise a new incident. Editing an existing incident will open the same incident editor.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {activePanel === 'editor' ? (
        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Incident Editor</span>
              <h2 className="portal-surface__title">{editingId ? 'Update incident' : 'Create / link incident'}</h2>
            </div>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Close
              </button>
            </div>
          </div>
          {displayedIncidentNumber ? (
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>
                  Incident reference: <strong>{displayedIncidentNumber}</strong>
                  {requestId.trim() ? <> · Linked request <strong>#{requestId.trim()}</strong></> : null}
                  {status === 'draft' ? ' (draft)' : ''}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={resetForm}>
                  Start another incident
                </button>
              </div>
            </div>
          ) : null}
          <div className="portal-form-grid">
            <label className="label">
              Request ID
              <input className="input" value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="123" />
            </label>
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
                <option value="investigating">Investigating</option>
                <option value="mitigating">Mitigating</option>
                <option value="resolved">Resolved</option>
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
              disabled={saving || !requestId.trim() || !teamId}
              onClick={() => void submit('draft')}
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !requestId.trim() || !teamId || !ownerUserId || !summary.trim()}
              onClick={() => void submit('submit')}
            >
              {saving ? 'Saving...' : editingId && status !== 'draft' ? 'Save Changes' : 'Submit Incident'}
            </button>
            {editingId ? <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancel edit</button> : null}
          </div>
        </section>
        ) : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Incident Queue</span>
              <h2 className="portal-surface__title">Open and recent incidents</h2>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading incidents...</div>
          ) : filteredIncidents.length === 0 ? (
            <div className="empty-state">
              {hasActiveFilters ? 'No incidents match the current filters.' : 'No incidents recorded yet.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Project</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Team</th>
                    <th>Escalation</th>
                    <th>Assigned</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIncidents.map((incident) => (
                    <tr key={incident.id}>
                      <td>
                        <div>
                          <strong>{incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                            Request #{incident.request_id} · {incident.request_service || 'service'}
                          </div>
                        </div>
                      </td>
                      <td>{incident.project_name ? `${incident.project_name} (${incident.project_code})` : 'No project'}</td>
                      <td>{incident.severity}</td>
                      <td>{incident.status}</td>
                      <td>{incident.team_name || incident.request_team || 'No team'}</td>
                      <td>{incident.escalation_level}</td>
                      <td>{incident.owner_username || 'Unassigned'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            const matchedTeam =
                              incident.team_id
                                ? String(incident.team_id)
                                : String(
                                    teams.find((team) => team.name === incident.request_team || team.slug === incident.request_team)?.id || '',
                                  );
                            setEditingId(incident.id);
                            setCurrentIncidentNumber(incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`);
                            setRequestId(String(incident.request_id));
                            setTeamId(matchedTeam);
                            setSeverity(incident.severity);
                            setStatus(incident.status);
                            setEscalationLevel(incident.escalation_level);
                            setOwnerUserId(incident.owner_user_id ? String(incident.owner_user_id) : '');
                            setSummary(incident.summary);
                            setNotes(incident.notes);
                            setActivePanel('editor');
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
