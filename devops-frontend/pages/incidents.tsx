import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface OwnerOption {
  id: number;
  username: string;
}

interface Incident {
  id: number;
  request_id: number;
  project_name?: string;
  project_code?: string;
  request_team?: string;
  request_env?: string;
  request_service?: string;
  request_cloud?: string;
  request_status?: string;
  severity: string;
  status: string;
  escalation_level: string;
  owner_user_id?: number | null;
  owner_username?: string;
  summary: string;
  notes: string;
}

function normalizeOwners(value: unknown): OwnerOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((owner) => ({
    id: typeof owner?.id === 'number' ? owner.id : 0,
    username: typeof owner?.username === 'string' ? owner.username : 'unknown',
  }));
}

function normalizeIncidents(value: unknown): Incident[] {
  if (!Array.isArray(value)) return [];
  return value.map((incident) => ({
    id: typeof incident?.id === 'number' ? incident.id : 0,
    request_id: typeof incident?.request_id === 'number' ? incident.request_id : 0,
    project_name: typeof incident?.project_name === 'string' ? incident.project_name : '',
    project_code: typeof incident?.project_code === 'string' ? incident.project_code : '',
    request_team: typeof incident?.request_team === 'string' ? incident.request_team : '',
    request_env: typeof incident?.request_env === 'string' ? incident.request_env : '',
    request_service: typeof incident?.request_service === 'string' ? incident.request_service : '',
    request_cloud: typeof incident?.request_cloud === 'string' ? incident.request_cloud : '',
    request_status: typeof incident?.request_status === 'string' ? incident.request_status : '',
    severity: typeof incident?.severity === 'string' ? incident.severity : 'medium',
    status: typeof incident?.status === 'string' ? incident.status : 'open',
    escalation_level: typeof incident?.escalation_level === 'string' ? incident.escalation_level : 'monitoring',
    owner_user_id: typeof incident?.owner_user_id === 'number' ? incident.owner_user_id : null,
    owner_username: typeof incident?.owner_username === 'string' ? incident.owner_username : '',
    summary: typeof incident?.summary === 'string' ? incident.summary : '',
    notes: typeof incident?.notes === 'string' ? incident.notes : '',
  }));
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export default function DevOpsIncidentsPage() {
  const apiUrl = useApiUrl();
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [requestId, setRequestId] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [status, setStatus] = useState('open');
  const [escalationLevel, setEscalationLevel] = useState('monitoring');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load incidents');
      }
      setOwners(normalizeOwners(data?.owners));
      setIncidents(normalizeIncidents(data?.incidents));
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
    setRequestId('');
    setSeverity('medium');
    setStatus('open');
    setEscalationLevel('monitoring');
    setOwnerUserId('');
    setSummary('');
    setNotes('');
  };

  const submit = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
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
            severity,
            status,
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save incident');
      }
      setNotice(editingId ? 'Incident updated.' : 'Incident linked.');
      resetForm();
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
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Incident Editor</span>
              <h2 className="portal-surface__title">{editingId ? 'Update incident' : 'Create / link incident'}</h2>
            </div>
          </div>
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
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="mitigating">Mitigating</option>
                <option value="resolved">Resolved</option>
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
              Owner
              <select className="input" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
                <option value="">Unassigned</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.username}</option>
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
            <button type="button" className="btn btn-primary" disabled={saving || !requestId.trim()} onClick={() => void submit()}>
              {saving ? 'Saving...' : editingId ? 'Update incident' : 'Link incident'}
            </button>
            {editingId ? <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancel edit</button> : null}
          </div>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Incident Queue</span>
              <h2 className="portal-surface__title">Open and recent incidents</h2>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading incidents...</div>
          ) : incidents.length === 0 ? (
            <div className="empty-state">No incidents recorded yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Project</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Escalation</th>
                    <th>Owner</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr key={incident.id}>
                      <td>#{incident.request_id} · {incident.request_service || 'service'}</td>
                      <td>{incident.project_name ? `${incident.project_name} (${incident.project_code})` : 'No project'}</td>
                      <td>{incident.severity}</td>
                      <td>{incident.status}</td>
                      <td>{incident.escalation_level}</td>
                      <td>{incident.owner_username || 'Unassigned'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEditingId(incident.id);
                            setRequestId(String(incident.request_id));
                            setSeverity(incident.severity);
                            setStatus(incident.status);
                            setEscalationLevel(incident.escalation_level);
                            setOwnerUserId(incident.owner_user_id ? String(incident.owner_user_id) : '');
                            setSummary(incident.summary);
                            setNotes(incident.notes);
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
