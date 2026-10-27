import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { CopyButton, DataTable, InspectorDrawer, SavedViews, type DataTableColumn, type SavedView } from '@infragate/ui';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { downloadCSV } from '../lib/csv';
import { INCIDENT_STATES, ITSM_PRIORITIES, IncidentSLA, incidentCanFinish, incidentStateLabel, incidentStateValue, normalizeSLA, priorityLabel, severityToPriority, slaClockLabel, slaClockTone } from '../lib/itsm';
import { asRecord, getString } from '../lib/payload';
import { expireSession } from '../lib/sessionExpiry';
import BlockedAction from '../components/BlockedAction';

type IncidentView = { severity: string; status: string; environment: string; mine: string };

const INCIDENT_VIEW_PRESETS: SavedView<IncidentView>[] = [
  { name: 'Active & owned', filters: { severity: '', status: 'in_progress', environment: '', mine: '1' } },
  { name: 'Assigned to me', filters: { severity: '', status: '', environment: '', mine: '1' } },
  { name: 'Open incidents', filters: { severity: '', status: 'new', environment: '', mine: '' } },
  { name: 'My production incidents', filters: { severity: '', status: '', environment: 'prod', mine: '1' } },
];

function slaBadgeClass(tone: ReturnType<typeof slaClockTone>): string | undefined {
  if (tone === 'danger') return 'ig-badge ig-badge--danger';
  if (tone === 'stale') return 'ig-badge ig-badge--medium';
  if (tone === 'ok') return 'ig-badge ig-badge--ok';
  return undefined;
}

function incidentStateBadge(status: string): string {
  const value = status.toLowerCase();
  if (value.includes('cancel') || value.includes('fail')) return 'ig-badge ig-badge--danger';
  if (value.includes('resolv') || value.includes('close')) return 'ig-badge ig-badge--ok';
  if (value.includes('progress') || value.includes('watch')) return 'ig-badge ig-badge--medium';
  return 'ig-badge ig-badge--info';
}

function currentUsername(): string {
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    const user = raw ? JSON.parse(raw) as { username?: string } : null;
    return typeof user?.username === 'string' ? user.username : '';
  } catch {
    return '';
  }
}

function incidentNeedsAck(status: string): boolean {
  return incidentStateValue(status) === 'new';
}

function incidentPageable(severity: string): boolean {
  const key = severityToPriority(severity);
  return key === 'p1' || key === 'p2';
}

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
  source?: string;
  fingerprint?: string;
  alert_source?: string;
  suspected_change_number?: string;
  sla?: IncidentSLA | null;
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
    request_env: typeof item.request_env === 'string' && item.request_env
      ? item.request_env
      : typeof item.environment === 'string' ? item.environment : '',
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
    source: typeof item.source === 'string' ? item.source : 'ticket',
    fingerprint: typeof item.fingerprint === 'string' ? item.fingerprint : '',
    alert_source: typeof item.alert_source === 'string' ? item.alert_source : '',
    suspected_change_number: typeof item.suspected_change_number === 'string' ? item.suspected_change_number : '',
    sla: normalizeSLA(item.sla),
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

function storedIsAdmin(): boolean {
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    const user = raw ? JSON.parse(raw) as { role?: string } : null;
    return user?.role === 'admin';
  } catch {
    return false;
  }
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

function normalizeQueryValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
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
  const [finishingId, setFinishingId] = useState<number | null>(null);
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
        'project_name',
        'project_code',
        'team_name',
        'environment',
        'service',
        'cloud',
        'source',
        'fingerprint',
        'severity',
        'status',
        'escalation_level',
        'owner',
        'response_sla',
        'resolve_sla',
        'summary',
        'notes',
      ],
      filteredIncidents.map((incident) => [
        getIncidentReference(incident),
        incident.project_name || '',
        incident.project_code || '',
        incident.team_name || incident.request_team || '',
        incident.request_env || '',
        incident.request_service || '',
        incident.request_cloud || '',
        incident.source || 'ticket',
        incident.fingerprint || '',
        incident.severity,
        incident.status,
        incident.escalation_level,
        incident.owner_username || '',
        slaClockLabel(incident.sla, 'response'),
        slaClockLabel(incident.sla, 'resolve'),
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
  const activeMine = router.query.mine === '1';
  const [preview, setPreview] = useState<Incident | null>(null);
  const activeFilterCount = [
    activeRequestID ? String(activeRequestID) : '',
    activeSeverityFilter,
    activeStatusFilter,
    activeEnvironmentFilter,
    activeMine ? 'mine' : '',
  ].filter(Boolean).length;

  const environmentOptions = useMemo(() => {
    return Array.from(
      new Set(
        incidents
          .map((incident) => incident.request_env?.trim().toLowerCase())
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort();
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      if (activeRequestID && incident.request_id !== activeRequestID) return false;
      if (activeSeverityFilter && severityToPriority(incident.severity) !== activeSeverityFilter) return false;
      if (activeStatusFilter && incidentStateValue(incident.status) !== incidentStateValue(activeStatusFilter)) return false;
      if (activeEnvironmentFilter) {
        const env = incident.request_env?.trim().toLowerCase() || '';
        const matches = activeEnvironmentFilter === 'prod' ? env.startsWith('prod') : env === activeEnvironmentFilter;
        if (!matches) return false;
      }
      if (activeMine) {
        const owner = (incident.owner_username || '').trim().toLowerCase();
        if (!owner || owner !== currentUsername().toLowerCase()) return false;
      }
      return true;
    });
  }, [activeEnvironmentFilter, activeMine, activeRequestID, activeSeverityFilter, activeStatusFilter, incidents]);

  const hasActiveFilters = Boolean(
    activeRequestID || activeSeverityFilter || activeStatusFilter || activeEnvironmentFilter || activeMine,
  );
  const resolvedIncidentRequestId = useMemo(() => resolveIncidentReferenceInput(requestId, incidents), [incidents, requestId]);

  const visibleIncidentSummary = useMemo(() => {
    const active = filteredIncidents.filter((incident) => ['new', 'in_progress', 'on_hold'].includes(incidentStateValue(incident.status))).length;
    const urgent = filteredIncidents.filter((incident) => ['p1', 'p2'].includes(severityToPriority(incident.severity))).length;
    const assigned = filteredIncidents.filter((incident) => Boolean(incident.owner_user_id || incident.owner_username)).length;
    return {
      total: filteredIncidents.length,
      active,
      urgent,
      assigned,
    };
  }, [filteredIncidents]);

  const queueIncidentAction = async (incident: Incident, action: 'acknowledge' | 'page' | 'close' | 'cancel') => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    let body: Record<string, string> = {};
    if (action === 'close') {
      if (!incident.owner_user_id) {
        setError('Assign an owner before closing this incident.');
        return;
      }
      const note = window.prompt('Recovery notes are required to close this incident.');
      if (!note || !note.trim()) return;
      body = { note: note.trim() };
    }
    setFinishingId(incident.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/incidents/${incident.id}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Could not update the incident'));
      }
      const saved = data.incident ? normalizeIncident(data.incident) : incident;
      setIncidents((current) => current.map((item) => (item.id === incident.id ? { ...item, ...saved } : item)));
      if (action === 'acknowledge') setNotice('Incident acknowledged. Response SLA is now running.');
      else if (action === 'page') {
        const page = data.page && typeof data.page === 'object' ? data.page as { paged?: boolean; count?: number; team?: string } : {};
        setNotice(page.paged ? `On-call paged${page.team ? ` for ${page.team}` : ''}${typeof page.count === 'number' ? ` · ${page.count} people` : ''}.` : 'No on-call page was sent. Coverage may be missing or this priority is below P2.');
      } else if (action === 'close') setNotice('Incident closed.');
      else setNotice('Incident cancelled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the incident');
    } finally {
      setFinishingId(null);
    }
  };

  const incidentQueueColumns: DataTableColumn<Incident>[] = useMemo(
    () => [
      {
        id: 'reference',
        header: 'Incident',
        width: '46%',
        className: 'ig-col-title',
        cell: (incident) => {
          const context = [incident.request_service, incident.project_name, incident.request_env, incident.owner_username || incident.team_name].filter(Boolean).join(' · ');
          return (
            <div className="ig-cell-stack">
              <span className="ig-cell-title">{incident.summary || getIncidentReference(incident)}</span>
              <span className="ig-cell-meta">
                {getIncidentReference(incident)}
                <CopyButton value={getIncidentReference(incident)} label="incident number" />
                {context ? ` · ${context}` : ''}
              </span>
            </div>
          );
        },
      },
      { id: 'priority', header: 'Priority', cell: (incident) => priorityLabel(incident.severity) },
      { id: 'state', header: 'State', cell: (incident) => <span className={incidentStateBadge(incident.status)}>{incidentStateLabel(incident.status)}</span> },
      {
        id: 'response_sla',
        header: 'Response',
        align: 'right',
        className: 'ig-col-num',
        cell: (incident) => (
          <span className={slaBadgeClass(slaClockTone(incident.sla, 'response'))}>
            {slaClockLabel(incident.sla, 'response')}
          </span>
        ),
      },
      {
        id: 'resolve_sla',
        header: 'Resolve',
        align: 'right',
        className: 'ig-col-num',
        cell: (incident) => (
          <span className={slaBadgeClass(slaClockTone(incident.sla, 'resolve'))}>
            {slaClockLabel(incident.sla, 'resolve')}
          </span>
        ),
      },
      {
        id: 'action',
        header: 'Action',
        cell: (incident) => (
          <div className="portal-page__actions">
            {incidentNeedsAck(incident.status) ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={finishingId === incident.id}
                onClick={(event) => {
                  event.stopPropagation();
                  void queueIncidentAction(incident, 'acknowledge');
                }}
              >
                Acknowledge
              </button>
            ) : null}
            {incidentPageable(incident.severity) && incidentCanFinish(incident.status) ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={finishingId === incident.id}
                onClick={(event) => {
                  event.stopPropagation();
                  void queueIncidentAction(incident, 'page');
                }}
              >
                Page
              </button>
            ) : null}
            <Link
              className="btn btn-secondary btn-sm"
              href={`/incident-workspace?incident_id=${incident.id}`}
              onClick={(event) => event.stopPropagation()}
            >
              Workspace
            </Link>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={(event) => {
                event.stopPropagation();
                void router.push(`/incidents/${incident.id}/edit`);
              }}
            >
              Edit
            </button>
            {incidentCanFinish(incident.status) ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={finishingId === incident.id || !incident.owner_user_id}
                  title={!incident.owner_user_id ? 'Assign an owner before closing this incident.' : 'Close with recovery notes'}
                  onClick={(event) => {
                    event.stopPropagation();
                    void queueIncidentAction(incident, 'close');
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={finishingId === incident.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void queueIncidentAction(incident, 'cancel');
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {incidentPageable(incident.severity) ? (
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={`/incident-workspace?incident_id=${incident.id}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    Complete postmortem
                  </Link>
                ) : null}
                <Link
                  className="btn btn-secondary btn-sm"
                  href={`/problems/new?incident_id=${incident.id}&title=${encodeURIComponent(incident.summary || incident.incident_number || '')}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  Mark recurring
                </Link>
              </>
            )}
          </div>
        ),
      },
    ],
    [router, finishingId, apiUrl],
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
      const params = new URLSearchParams();
      if (activeStatusFilter) params.set('status', activeStatusFilter);
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(`${apiUrl}/api/devops/incidents${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (storedIsAdmin()) {
        const adminResponse = await fetch(`${apiUrl}/api/admin/incidents${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (adminResponse.ok) {
          const adminData = asRecord(await adminResponse.json().catch(() => ({})));
          data.incidents = adminData.incidents;
        }
      }
      if (!response.ok && !Array.isArray(data.incidents)) {
        if (response.status === 403) {
          clearSessionAndRedirect();
          return;
        }
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
  }, [apiUrl, activeStatusFilter]);

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
      if (!response.ok) {
        return;
      }
      const nextNumber = getString(data.incident_number);
      if (nextNumber) {
        setCurrentIncidentNumber(nextNumber);
      }
    } catch {
      // Keep the editor usable even if preview generation is temporarily unavailable.
    }
  };

  const openCreatePanel = () => {
    setEditingId(null);
    setCurrentIncidentNumber('');
    setRequestId(activeRequestID ? String(activeRequestID) : '');
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
    void loadPreviewIncidentNumber();
  };

  const updateQueueFilters = (next: Partial<IncidentView>) => {
    const query: Record<string, string> = {};
    if (activeProjectID) query.project_id = String(activeProjectID);
    if (activeRequestID) query.request_id = String(activeRequestID);
    const nextSeverity = next.severity ?? activeSeverityFilter;
    const nextStatus = next.status ?? activeStatusFilter;
    const nextEnvironment = next.environment ?? activeEnvironmentFilter;
    const nextMine = next.mine ?? (activeMine ? '1' : '');
    if (nextSeverity) query.severity = nextSeverity;
    if (nextStatus) query.status = nextStatus;
    if (nextEnvironment) query.environment = nextEnvironment;
    if (nextMine === '1') query.mine = '1';
    void router.push({ pathname: '/incidents', query }, undefined, { shallow: true });
  };

  const clearQueueFilters = () => {
    const query: Record<string, string> = {};
    if (activeProjectID) query.project_id = String(activeProjectID);
    if (activeRequestID) query.request_id = String(activeRequestID);
    void router.push({ pathname: '/incidents', query }, undefined, { shallow: true });
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
      const linkedRequestID = resolveIncidentReferenceInput(requestId, incidents);
      if (!linkedRequestID) {
        throw new Error('Enter a valid incident reference');
      }
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
            request_id: linkedRequestID,
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
      setRequestId(savedIncident.id ? getIncidentReference(savedIncident) : requestId);
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
        <title>Incidents - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <h1 className="portal-page__title">Incidents</h1>
          </div>
          <div className="portal-page__actions">
            <BlockedAction blocked={filteredIncidents.length === 0} reason="No incidents match this view, so there is nothing to export.">
              <button type="button" className="btn btn-secondary" onClick={exportIncidents} disabled={filteredIncidents.length === 0} title={filteredIncidents.length === 0 ? 'No incidents match this view, so there is nothing to export.' : 'Export the visible incidents'}>
                Export CSV
              </button>
            </BlockedAction>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void router.push(activeRequestID ? `/incidents/new?request_id=${activeRequestID}` : '/incidents/new')}
            >
              Create incident
            </button>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        <section className="devops-incident-strip">
          <div className="devops-incident-pill">
            <span className="devops-incident-pill__label">Visible incidents</span>
            <strong className="devops-incident-pill__value">{visibleIncidentSummary.total}</strong>
          </div>
          <div className="devops-incident-pill">
            <span className="devops-incident-pill__label">Active response</span>
            <strong className="devops-incident-pill__value">{visibleIncidentSummary.active}</strong>
          </div>
          <div className="devops-incident-pill">
            <span className="devops-incident-pill__label">High priority</span>
            <strong className="devops-incident-pill__value">{visibleIncidentSummary.urgent}</strong>
          </div>
          <div className="devops-incident-pill">
            <span className="devops-incident-pill__label">Assigned owner</span>
            <strong className="devops-incident-pill__value">{visibleIncidentSummary.assigned}</strong>
          </div>
        </section>

        <SavedViews<IncidentView>
          storageKey="opstrellis.incidents.views"
          current={{ severity: activeSeverityFilter, status: activeStatusFilter, environment: activeEnvironmentFilter, mine: activeMine ? '1' : '' }}
          onApply={updateQueueFilters}
          presets={INCIDENT_VIEW_PRESETS}
          canSave={activeFilterCount > 0}
        />

        <section className="devops-incident-filter-surface">
          <div className="devops-incident-filter-row">
            <label className="devops-incident-filter-chip">
              <span className="devops-incident-filter-chip__label">Priority</span>
              <select
                className="devops-incident-filter-chip__control"
                value={activeSeverityFilter}
                onChange={(event) => updateQueueFilters({ severity: event.target.value })}
              >
                <option value="">All priorities</option>
                {ITSM_PRIORITIES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="devops-incident-filter-chip">
              <span className="devops-incident-filter-chip__label">State</span>
              <select
                className="devops-incident-filter-chip__control"
                value={activeStatusFilter}
                onChange={(event) => updateQueueFilters({ status: event.target.value })}
              >
                <option value="">All states</option>
                {INCIDENT_STATES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="devops-incident-filter-chip">
              <span className="devops-incident-filter-chip__label">Environment</span>
              <select
                className="devops-incident-filter-chip__control"
                value={activeEnvironmentFilter}
                onChange={(event) => updateQueueFilters({ environment: event.target.value })}
              >
                <option value="">All environments</option>
                {environmentOptions.map((environment) => (
                  <option key={environment} value={environment}>
                    {environment.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <div className="devops-incident-filter-row__actions">
              {activeFilterCount > 0 ? <span className="devops-incident-filter-row__badge">{activeFilterCount} active</span> : null}
              {hasActiveFilters ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearQueueFilters}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Incident Queue</span>
              <h2 className="portal-surface__title">Open and recent incidents</h2>
              <p className="portal-surface__subtitle">
                Create and edit incidents on dedicated pages so the queue stays easier to scan.
              </p>
            </div>
          </div>
          <DataTable
            columns={incidentQueueColumns}
            rows={filteredIncidents}
            rowKey={(incident) => incident.id}
            label="Incident queue"
            loading={loading}
            empty={
              <div className="empty-state">
                <p>{hasActiveFilters ? 'No incidents match the current filters.' : 'No incidents recorded yet. Acknowledging assigns you and starts the response clock.'}</p>
                {!hasActiveFilters ? (
                  <Link href="/incidents/new" className="btn btn-primary btn-sm">Create incident</Link>
                ) : null}
              </div>
            }
            onRowOpen={(incident) => setPreview(incident)}
          />
        </section>
        <InspectorDrawer
          open={Boolean(preview)}
          onClose={() => setPreview(null)}
          resetKey={preview?.id}
          label="Incident preview"
          eyebrow="Incident"
          title={preview ? getIncidentReference(preview) : 'Incident'}
          subtitle={preview ? [preview.project_name || 'Project unknown', preview.request_env || 'Environment unknown', preview.request_service || 'Service unknown'].join(' · ') : undefined}
          headerActions={preview ? <CopyButton value={getIncidentReference(preview)} label="incident reference" /> : null}
          footer={preview ? (
            <div className="portal-page__actions">
              <Link className="btn btn-secondary" href={`/incident-workspace?incident_id=${preview.id}`}>Open workspace</Link>
              <Link className="btn btn-primary" href={`/incidents/${preview.id}/edit`}>Open incident</Link>
            </div>
          ) : null}
        >
          {preview ? (
            <div className="portal-stack">
              <p>{preview.summary || 'No summary was saved.'}</p>
              <p>State: {incidentStateLabel(preview.status)} · Priority: {priorityLabel(preview.severity)}</p>
              <p>Owner: {preview.owner_username || 'Unassigned'}</p>
              {preview.request_id ? <p>Request #{preview.request_id} <CopyButton value={String(preview.request_id)} label="request reference" /></p> : null}
            </div>
          ) : null}
        </InspectorDrawer>
      </div>
    </DevOpsLayout>
  );
}
