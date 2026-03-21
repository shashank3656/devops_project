import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface OwnerOption {
  id: number;
  username: string;
  email?: string;
}

interface IncidentWorkspaceSummary {
  total_incidents: number;
  open_incidents: number;
  critical_incidents: number;
  postmortem_drafts: number;
  completed_postmortems: number;
}

interface IncidentItem {
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
  severity: string;
  status: string;
  escalation_level: string;
  owner_user_id?: number | null;
  owner_username?: string;
  summary: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface TimelineEvent {
  key: string;
  timestamp: string;
  kind: string;
  title: string;
  detail: string;
  actor?: string;
}

interface RunbookItem {
  id: number;
  project_id: number;
  service: string;
  title: string;
  content: string;
  link_url: string;
}

interface GateApproval {
  id: number;
  source_environment: string;
  target_environment: string;
  gate_status: string;
  summary: string;
  note: string;
  approved_by_username: string;
  approved_at: string;
  expires_at?: string | null;
  state: string;
  revoked_at?: string | null;
  revoked_by_username?: string;
  revoke_note?: string;
}

interface RollbackOperation {
  id: number;
  source_request_id: number;
  rollback_request_id: number;
  reason: string;
  notes: string;
  approved_by_username: string;
  created_at: string;
}

interface PostmortemRecord {
  id: number;
  incident_id: number;
  request_id: number;
  status: string;
  impact_summary: string;
  root_cause: string;
  detection_summary: string;
  mitigation_summary: string;
  corrective_actions: string;
  follow_up_owner_user_id?: number | null;
  follow_up_owner_username?: string;
  review_notes: string;
  updated_by_username?: string;
  created_at: string;
  updated_at: string;
}

interface RequestSummary {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  client_name?: string;
  updated_at?: string;
}

interface WorkspaceDetail {
  incident: IncidentItem;
  request?: RequestSummary | null;
  timeline: TimelineEvent[];
  postmortem?: PostmortemRecord | null;
  runbooks: RunbookItem[];
  gate_approvals: GateApproval[];
  rollback_operations: RollbackOperation[];
}

interface WorkspacePayload {
  projects: ProjectSummary[];
  owners: OwnerOption[];
  summary: IncidentWorkspaceSummary;
  incidents: IncidentItem[];
  focus_incident_id?: number;
  detail?: WorkspaceDetail | null;
}

interface PostmortemFormState {
  status: string;
  impact_summary: string;
  root_cause: string;
  detection_summary: string;
  mitigation_summary: string;
  corrective_actions: string;
  follow_up_owner_user_id: string;
  review_notes: string;
}

const defaultPostmortemForm: PostmortemFormState = {
  status: 'draft',
  impact_summary: '',
  root_cause: '',
  detection_summary: '',
  mitigation_summary: '',
  corrective_actions: '',
  follow_up_owner_user_id: '',
  review_notes: '',
};

function clearSessionAndRedirect(router: ReturnType<typeof useRouter>) {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  router.replace('/login');
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function buildPostmortemForm(detail?: WorkspaceDetail | null): PostmortemFormState {
  if (!detail?.postmortem) return defaultPostmortemForm;
  return {
    status: detail.postmortem.status || 'draft',
    impact_summary: detail.postmortem.impact_summary || '',
    root_cause: detail.postmortem.root_cause || '',
    detection_summary: detail.postmortem.detection_summary || '',
    mitigation_summary: detail.postmortem.mitigation_summary || '',
    corrective_actions: detail.postmortem.corrective_actions || '',
    follow_up_owner_user_id: detail.postmortem.follow_up_owner_user_id ? String(detail.postmortem.follow_up_owner_user_id) : '',
    review_notes: detail.postmortem.review_notes || '',
  };
}

export default function IncidentWorkspacePage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectId, setProjectId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [form, setForm] = useState<PostmortemFormState>(defaultPostmortemForm);

  useEffect(() => {
    if (!router.isReady) return;
    const queryProjectId = router.query.project_id;
    const queryStatus = router.query.status;
    const queryIncidentId = router.query.incident_id;
    if (typeof queryProjectId === 'string' && queryProjectId.trim()) setProjectId(queryProjectId.trim());
    if (typeof queryStatus === 'string' && queryStatus.trim()) setStatusFilter(queryStatus.trim());
    if (typeof queryIncidentId === 'string' && queryIncidentId.trim()) setIncidentId(queryIncidentId.trim());
  }, [router.isReady, router.query.incident_id, router.query.project_id, router.query.status]);

  useEffect(() => {
    setForm(buildPostmortemForm(workspace?.detail));
  }, [workspace?.detail]);

  const loadWorkspace = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect(router);
      return;
    }
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (statusFilter) params.set('status', statusFilter);
    if (incidentId) params.set('incident_id', incidentId);
    try {
      const response = await fetch(`${apiUrl}/api/devops/incident-workspace?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect(router);
        return;
      }
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to load incident workspace'));
      }
      const nextWorkspace = payload.workspace && typeof payload.workspace === 'object'
        ? (payload.workspace as WorkspacePayload)
        : null;
      setWorkspace(nextWorkspace);
      if (nextWorkspace?.focus_incident_id) {
        setIncidentId(String(nextWorkspace.focus_incident_id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incident workspace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, [apiUrl, incidentId, projectId, router, statusFilter]);

  const savePostmortem = async () => {
    if (!workspace?.detail?.incident?.id) {
      setError('Select an incident before saving the postmortem workspace.');
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect(router);
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/incident-workspace`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          incident_id: workspace.detail.incident.id,
          status: form.status,
          impact_summary: form.impact_summary,
          root_cause: form.root_cause,
          detection_summary: form.detection_summary,
          mitigation_summary: form.mitigation_summary,
          corrective_actions: form.corrective_actions,
          follow_up_owner_user_id: form.follow_up_owner_user_id ? Number(form.follow_up_owner_user_id) : null,
          review_notes: form.review_notes,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect(router);
        return;
      }
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to save postmortem workspace'));
      }
      setNotice('Incident postmortem workspace saved.');
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save postmortem workspace');
    } finally {
      setSaving(false);
    }
  };

  const projects = workspace?.projects || [];
  const owners = workspace?.owners || [];
  const summary = workspace?.summary;
  const incidents = workspace?.incidents || [];
  const detail = workspace?.detail;

  return (
    <DevOpsLayout>
      <Head>
        <title>Incident Workspace - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Phase 2</span>
            <h1 className="portal-page__title">Incident Timeline and Postmortem Workspace</h1>
            <p className="portal-page__subtitle">
              Review incident history, delivery events, gate approvals, and rollback actions in one place, then capture postmortem notes that stay tied to the release record.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/incidents" className="btn btn-secondary">Incident Panel</Link>
            <Link href="/promotions" className="btn btn-secondary">Promotion Center</Link>
            <Link href="/rollback-console" className="btn btn-primary">Rollback Console</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading incident workspace...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        {!loading && !error && summary ? (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Open incidents</span>
                <strong className="portal-stat-card__value">{summary.open_incidents}</strong>
                <p className="portal-stat-card__copy">Incidents still active and likely to influence release or remediation decisions.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Critical incidents</span>
                <strong className="portal-stat-card__value">{summary.critical_incidents}</strong>
                <p className="portal-stat-card__copy">Critical incidents requiring focused response and stronger review discipline.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Postmortem drafts</span>
                <strong className="portal-stat-card__value">{summary.postmortem_drafts}</strong>
                <p className="portal-stat-card__copy">Incident records with a started but incomplete postmortem workspace.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Completed postmortems</span>
                <strong className="portal-stat-card__value">{summary.completed_postmortems}</strong>
                <p className="portal-stat-card__copy">Incidents that already have a completed review narrative and follow-up path.</p>
              </article>
            </section>

            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Scope</span>
                  <h2 className="portal-surface__title">Filter the workspace</h2>
                  <p className="portal-surface__subtitle">Narrow the workspace to a project, incident, or incident status when you need focus.</p>
                </div>
              </div>
              <div className="portal-toolbar">
                <div className="portal-toolbar__group">
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="incident-workspace-project-filter">Project</label>
                    <select id="incident-workspace-project-filter" className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                      <option value="">All projects</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}{project.code ? ` (${project.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="incident-workspace-status-filter">Status</label>
                    <select id="incident-workspace-status-filter" className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                      <option value="">All statuses</option>
                      <option value="open">Open</option>
                      <option value="mitigated">Mitigated</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="incident-workspace-incident-filter">Incident</label>
                    <select id="incident-workspace-incident-filter" className="input" value={incidentId} onChange={(event) => setIncidentId(event.target.value)}>
                      <option value="">Auto focus</option>
                      {incidents.map((incident) => (
                        <option key={incident.id} value={incident.id}>
                          {incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`} · {incident.summary}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <div className="portal-grid" style={{ alignItems: 'start' }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Incident list</span>
                    <h2 className="portal-surface__title">Active workspace items</h2>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {incidents.length === 0 ? (
                    <div className="empty-state">No incidents match the current workspace filters.</div>
                  ) : (
                    incidents.map((incident) => (
                      <button
                        key={`incident-${incident.id}`}
                        type="button"
                        className="portal-surface"
                        style={{
                          padding: 16,
                          textAlign: 'left',
                          borderColor: String(workspace?.focus_incident_id) === String(incident.id) ? 'var(--color-primary)' : 'var(--color-border)',
                          background: String(workspace?.focus_incident_id) === String(incident.id) ? 'rgba(59, 130, 246, 0.08)' : 'var(--color-surface)',
                        }}
                        onClick={() => setIncidentId(String(incident.id))}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                          <strong>{incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`} · {incident.summary}</strong>
                          <span className="portal-pill">{incident.severity.toUpperCase()} · {incident.status}</span>
                        </div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                          {incident.project_name ? `${incident.project_name} (${incident.project_code})` : 'No project'} · {incident.request_env}/{incident.request_service}
                        </div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 6 }}>
                          Owner: {incident.owner_username || 'Unassigned'} · Updated {formatDateTime(incident.updated_at)}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Focused incident</span>
                    <h2 className="portal-surface__title">{detail?.incident?.summary || 'Select an incident'}</h2>
                    <p className="portal-surface__subtitle">
                      {detail?.incident?.incident_number || 'No incident selected'} · {detail?.incident?.project_name ? `${detail.incident.project_name} (${detail.incident.project_code})` : 'No project'} · Request #{detail?.incident?.request_id || '—'}
                    </p>
                  </div>
                </div>

                {detail ? (
                  <div style={{ display: 'grid', gap: 24 }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span className="portal-pill">Severity: {detail.incident.severity}</span>
                      <span className="portal-pill">Status: {detail.incident.status}</span>
                      <span className="portal-pill">Escalation: {detail.incident.escalation_level}</span>
                      <span className="portal-pill">Owner: {detail.incident.owner_username || 'Unassigned'}</span>
                    </div>

                    <div className="portal-grid" style={{ alignItems: 'start' }}>
                      <div className="portal-surface" style={{ padding: 16 }}>
                        <h3 className="portal-surface__title" style={{ fontSize: 18, marginBottom: 12 }}>Timeline</h3>
                        <div style={{ display: 'grid', gap: 12 }}>
                          {detail.timeline.length === 0 ? (
                            <div className="empty-state" style={{ padding: 0 }}>No incident timeline events yet.</div>
                          ) : (
                            detail.timeline.map((event) => (
                              <article key={event.key} style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                  <strong>{event.title}</strong>
                                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{formatDateTime(event.timestamp)}</span>
                                </div>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 4 }}>{event.detail}</div>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 4 }}>
                                  {event.kind}{event.actor ? ` · ${event.actor}` : ''}
                                </div>
                              </article>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="portal-surface" style={{ padding: 16 }}>
                        <h3 className="portal-surface__title" style={{ fontSize: 18, marginBottom: 12 }}>Postmortem workspace</h3>
                        <div style={{ display: 'grid', gap: 12 }}>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-status">Status</label>
                            <select id="postmortem-status" className="input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                              <option value="draft">Draft</option>
                              <option value="review">Review</option>
                              <option value="completed">Completed</option>
                            </select>
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-impact">Impact summary</label>
                            <textarea id="postmortem-impact" className="input" rows={3} value={form.impact_summary} onChange={(event) => setForm((current) => ({ ...current, impact_summary: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-root-cause">Root cause</label>
                            <textarea id="postmortem-root-cause" className="input" rows={3} value={form.root_cause} onChange={(event) => setForm((current) => ({ ...current, root_cause: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-detection">Detection summary</label>
                            <textarea id="postmortem-detection" className="input" rows={3} value={form.detection_summary} onChange={(event) => setForm((current) => ({ ...current, detection_summary: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-mitigation">Mitigation summary</label>
                            <textarea id="postmortem-mitigation" className="input" rows={3} value={form.mitigation_summary} onChange={(event) => setForm((current) => ({ ...current, mitigation_summary: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-actions">Corrective actions</label>
                            <textarea id="postmortem-actions" className="input" rows={4} value={form.corrective_actions} onChange={(event) => setForm((current) => ({ ...current, corrective_actions: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-owner">Follow-up owner</label>
                            <select id="postmortem-owner" className="input" value={form.follow_up_owner_user_id} onChange={(event) => setForm((current) => ({ ...current, follow_up_owner_user_id: event.target.value }))}>
                              <option value="">Unassigned</option>
                              {owners.map((owner) => (
                                <option key={owner.id} value={owner.id}>
                                  {owner.username}{owner.email ? ` (${owner.email})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-review-notes">Review notes</label>
                            <textarea id="postmortem-review-notes" className="input" rows={3} value={form.review_notes} onChange={(event) => setForm((current) => ({ ...current, review_notes: event.target.value }))} />
                          </div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void savePostmortem()}>
                              {saving ? 'Saving...' : 'Save postmortem'}
                            </button>
                            {detail.postmortem?.updated_at ? (
                              <span style={{ color: 'var(--color-text-muted)', fontSize: 12, alignSelf: 'center' }}>
                                Last updated {formatDateTime(detail.postmortem.updated_at)} by {detail.postmortem.updated_by_username || 'reviewer'}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="portal-grid" style={{ alignItems: 'start' }}>
                      <div className="portal-surface" style={{ padding: 16 }}>
                        <h3 className="portal-surface__title" style={{ fontSize: 18, marginBottom: 12 }}>Runbooks</h3>
                        {detail.runbooks.length === 0 ? (
                          <div className="empty-state" style={{ padding: 0 }}>No runbooks linked to this project yet.</div>
                        ) : (
                          <div style={{ display: 'grid', gap: 12 }}>
                            {detail.runbooks.map((runbook) => (
                              <article key={runbook.id} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14 }}>
                                <strong>{runbook.title}</strong>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 4 }}>{runbook.service || 'General'} runbook</div>
                                {runbook.link_url ? (
                                  <div style={{ marginTop: 8 }}>
                                    <a href={runbook.link_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                                      Open link
                                    </a>
                                  </div>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="portal-surface" style={{ padding: 16 }}>
                        <h3 className="portal-surface__title" style={{ fontSize: 18, marginBottom: 12 }}>Gate and rollback activity</h3>
                        <div style={{ display: 'grid', gap: 12 }}>
                          <div>
                            <strong style={{ display: 'block', marginBottom: 8 }}>Gate approvals</strong>
                            {detail.gate_approvals.length === 0 ? (
                              <div className="empty-state" style={{ padding: 0 }}>No gate approvals linked to this incident.</div>
                            ) : (
                              detail.gate_approvals.map((approval) => (
                                <article key={approval.id} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                    <strong>{approval.source_environment} → {approval.target_environment}</strong>
                                    <span className="portal-pill">{approval.state}</span>
                                  </div>
                                  <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 4 }}>{approval.summary}</div>
                                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 4 }}>
                                    {approval.approved_by_username} · {formatDateTime(approval.approved_at)}
                                  </div>
                                </article>
                              ))
                            )}
                          </div>
                          <div>
                            <strong style={{ display: 'block', marginBottom: 8 }}>Rollback operations</strong>
                            {detail.rollback_operations.length === 0 ? (
                              <div className="empty-state" style={{ padding: 0 }}>No rollback operations recorded for this request.</div>
                            ) : (
                              detail.rollback_operations.map((operation) => (
                                <article key={operation.id} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                    <strong>Rollback draft #{operation.rollback_request_id}</strong>
                                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{formatDateTime(operation.created_at)}</span>
                                  </div>
                                  <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 4 }}>{operation.reason}</div>
                                  {operation.notes ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 4 }}>Notes: {operation.notes}</div> : null}
                                </article>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">Select an incident to open the timeline and postmortem workspace.</div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
