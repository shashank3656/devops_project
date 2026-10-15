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

interface ReviewDraft {
  generated?: boolean;
  impact_summary?: string;
  root_cause?: string;
  detection_summary?: string;
  mitigation_summary?: string;
  corrective_actions?: string;
  review_notes?: string;
  caused_by_change?: string;
  previous_sha?: string;
  watch_result?: string;
  acknowledged_by?: string;
}

interface WorkspaceDetail {
  incident: IncidentItem;
  request?: RequestSummary | null;
  timeline: TimelineEvent[];
  review?: ReviewDraft | null;
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

function getIncidentReference(incident?: Pick<IncidentItem, 'id' | 'incident_number'> | null): string {
  if (!incident) return 'No incident selected';
  return incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`;
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
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectId, setProjectId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [form, setForm] = useState<PostmortemFormState>(defaultPostmortemForm);
  const [showFilters, setShowFilters] = useState(false);

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

  const hasActiveScope = Boolean(projectId || statusFilter || incidentId);

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

  const generateReview = async () => {
    if (!workspace?.detail?.incident?.id) {
      setError('Select an incident before generating the review.');
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect(router);
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/incidents/${workspace.detail.incident.id}/review`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect(router);
        return;
      }
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to generate incident review'));
      }
      setNotice('Review draft filled from the incident timeline.');
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate incident review');
    } finally {
      setGenerating(false);
    }
  };

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
        <title>Incident Review - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Incident Response</span>
            <h1 className="portal-page__title">Incident Review</h1>
            <p className="portal-page__subtitle">
              Review the incident history, linked delivery events, approvals, and rollback activity in one place, then save the follow-up notes with the same record.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/incidents" className="btn btn-secondary">Incidents</Link>
            <Link href="/promotions" className="btn btn-secondary">Promotion Center</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading incident review...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        {!loading && !error && summary ? (
          <>
            <section className="portal-surface incident-workspace__surface-gap">
              <div className="portal-page__actions incident-workspace__summary-actions">
                <div className="portal-pill-row">
                  <span className="portal-pill">Open incidents {summary.open_incidents}</span>
                  <span className="portal-pill">Critical {summary.critical_incidents}</span>
                  <span className="portal-pill">Draft follow-ups {summary.postmortem_drafts}</span>
                  <span className="portal-pill">Completed follow-ups {summary.completed_postmortems}</span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters((current) => !current)}>
                  {showFilters ? 'Hide scope' : 'Show scope'}
                </button>
              </div>
            </section>

            {hasActiveScope ? (
              <div className="alert alert-info incident-workspace__scope-alert">
                You are viewing a filtered incident list.
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setProjectId('');
                    setStatusFilter('');
                    setIncidentId('');
                  }}
                >
                  Clear scope
                </button>
              </div>
            ) : null}

            {showFilters ? (
            <section className="portal-surface incident-workspace__surface-gap">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Scope</span>
                  <h2 className="portal-surface__title">Filter incidents</h2>
                  <p className="portal-surface__subtitle">Limit the view to a project, one incident, or a status when you need to focus.</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(false)}>
                  Close
                </button>
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
            ) : null}

            <div className="portal-grid incident-workspace__grid">
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Incident list</span>
                    <h2 className="portal-surface__title">Matching incidents</h2>
                  </div>
                </div>
                <div className="incident-workspace__list">
                  {incidents.length === 0 ? (
                    <div className="empty-state">No incidents match the current workspace filters.</div>
                  ) : (
                    incidents.map((incident) => (
                      <button
                        key={`incident-${incident.id}`}
                        type="button"
                        className={`portal-surface incident-workspace__incident-card${
                          String(workspace?.focus_incident_id) === String(incident.id) ? ' incident-workspace__incident-card--active' : ''
                        }`}
                        onClick={() => setIncidentId(String(incident.id))}
                      >
                        <div className="incident-workspace__incident-card-head">
                          <strong>{getIncidentReference(incident)} · {incident.summary}</strong>
                          <span className="portal-pill">{incident.severity.toUpperCase()} · {incident.status}</span>
                        </div>
                        <div className="incident-workspace__incident-card-meta">
                          {incident.project_name ? `${incident.project_name} (${incident.project_code})` : 'No project'} · {incident.request_env || 'No environment'} · {incident.request_service ? `Target: ${incident.request_service}` : 'No target'}
                        </div>
                        <div className="incident-workspace__incident-card-meta incident-workspace__incident-card-meta--minor">
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
                      {getIncidentReference(detail?.incident)} · {detail?.incident?.project_name ? `${detail.incident.project_name} (${detail.incident.project_code})` : 'No project'}{detail?.incident?.request_service ? ` · Target: ${detail.incident.request_service}` : ''}
                    </p>
                  </div>
                </div>

                {detail ? (
                  <div className="incident-workspace__detail-stack">
                    <div className="incident-workspace__focus-pills">
                      <span className="portal-pill">Severity: {detail.incident.severity}</span>
                      <span className="portal-pill">Status: {detail.incident.status}</span>
                      <span className="portal-pill">Escalation: {detail.incident.escalation_level}</span>
                      <span className="portal-pill">Owner: {detail.incident.owner_username || 'Unassigned'}</span>
                    </div>

                    <div className="portal-grid incident-workspace__grid">
                      <div className="portal-surface incident-workspace__subsurface">
                        <h3 className="portal-surface__title incident-workspace__section-title">Incident history</h3>
                        <div className="incident-workspace__timeline">
                          {detail.timeline.length === 0 ? (
                            <div className="empty-state incident-workspace__empty-inline">No updates recorded yet.</div>
                          ) : (
                            detail.timeline.map((event) => (
                              <article key={event.key} className="incident-workspace__timeline-item">
                                <div className="incident-workspace__timeline-head">
                                  <strong>{event.title}</strong>
                                  <span className="incident-workspace__timeline-time">{formatDateTime(event.timestamp)}</span>
                                </div>
                                <div className="incident-workspace__timeline-meta">{event.detail}</div>
                                <div className="incident-workspace__timeline-meta incident-workspace__timeline-meta--minor">
                                  {event.kind}{event.actor ? ` · ${event.actor}` : ''}
                                </div>
                              </article>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="portal-surface incident-workspace__subsurface">
                        <h3 className="portal-surface__title incident-workspace__section-title">Post-incident notes</h3>
                        {detail.review?.caused_by_change || detail.review?.previous_sha ? (
                          <p className="portal-surface__subtitle">
                            {detail.review.caused_by_change ? `Caused by ${detail.review.caused_by_change}` : 'No linked change'}
                            {detail.review.watch_result ? ` · Watch ${detail.review.watch_result}` : ''}
                            {detail.review.previous_sha ? ` · previous SHA ${detail.review.previous_sha}` : ''}
                          </p>
                        ) : (
                          <p className="portal-surface__subtitle">Generate fills this draft from the INC timeline, linked CHG, and watch samples. It does not create a new ticket.</p>
                        )}
                        <div className="incident-workspace__form">
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-status">Status</label>
                            <select id="postmortem-status" className="input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                              <option value="draft">Draft</option>
                              <option value="review">Review</option>
                              <option value="completed">Completed</option>
                            </select>
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-impact">Impact</label>
                            <textarea id="postmortem-impact" className="input" rows={3} value={form.impact_summary} onChange={(event) => setForm((current) => ({ ...current, impact_summary: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-root-cause">Why it happened</label>
                            <textarea id="postmortem-root-cause" className="input" rows={3} value={form.root_cause} onChange={(event) => setForm((current) => ({ ...current, root_cause: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-detection">How it was detected</label>
                            <textarea id="postmortem-detection" className="input" rows={3} value={form.detection_summary} onChange={(event) => setForm((current) => ({ ...current, detection_summary: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-mitigation">What we did</label>
                            <textarea id="postmortem-mitigation" className="input" rows={3} value={form.mitigation_summary} onChange={(event) => setForm((current) => ({ ...current, mitigation_summary: event.target.value }))} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="postmortem-actions">Follow-up actions</label>
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
                          <div className="incident-workspace__save-row">
                            <button type="button" className="btn btn-secondary" disabled={generating || saving} onClick={() => void generateReview()}>
                              {generating ? 'Generating...' : 'Generate from timeline'}
                            </button>
                            <button type="button" className="btn btn-primary" disabled={saving || generating} onClick={() => void savePostmortem()}>
                              {saving ? 'Saving...' : 'Save notes'}
                            </button>
                            {detail.postmortem?.updated_at ? (
                              <span className="incident-workspace__updated">
                                Last updated {formatDateTime(detail.postmortem.updated_at)} by {detail.postmortem.updated_by_username || 'reviewer'}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="portal-grid incident-workspace__grid">
                      <div className="portal-surface incident-workspace__subsurface">
                        <h3 className="portal-surface__title incident-workspace__section-title">Helpful runbooks</h3>
                        {detail.runbooks.length === 0 ? (
                          <div className="empty-state incident-workspace__empty-inline">No runbooks linked to this project yet.</div>
                        ) : (
                          <div className="incident-workspace__resource-list">
                            {detail.runbooks.map((runbook) => (
                              <article key={runbook.id} className="incident-workspace__resource-card">
                                <strong>{runbook.title}</strong>
                                <div className="incident-workspace__resource-meta">{runbook.service || 'General'} runbook</div>
                                {runbook.link_url ? (
                                  <div className="incident-workspace__resource-actions">
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

                      <div className="portal-surface incident-workspace__subsurface">
                        <h3 className="portal-surface__title incident-workspace__section-title">Approvals and recovery</h3>
                        <div className="incident-workspace__recovery-stack">
                          <div>
                            <strong className="incident-workspace__subheading">Approval records</strong>
                            {detail.gate_approvals.length === 0 ? (
                              <div className="empty-state incident-workspace__empty-inline">No gate approvals linked to this incident.</div>
                            ) : (
                              detail.gate_approvals.map((approval) => (
                                <article key={approval.id} className="incident-workspace__recovery-card">
                                  <div className="incident-workspace__recovery-head">
                                    <strong>{approval.source_environment} → {approval.target_environment}</strong>
                                    <span className="portal-pill">{approval.state}</span>
                                  </div>
                                  <div className="incident-workspace__recovery-meta">{approval.summary}</div>
                                  <div className="incident-workspace__recovery-meta incident-workspace__recovery-meta--minor">
                                    {approval.approved_by_username} · {formatDateTime(approval.approved_at)}
                                  </div>
                                </article>
                              ))
                            )}
                          </div>
                          <div>
                            <strong className="incident-workspace__subheading">Rollback history</strong>
                            {detail.rollback_operations.length === 0 ? (
                              <div className="empty-state incident-workspace__empty-inline">No rollback activity recorded for the linked request.</div>
                            ) : (
                              detail.rollback_operations.map((operation) => (
                                <article key={operation.id} className="incident-workspace__recovery-card">
                                  <div className="incident-workspace__recovery-head">
                                    <strong>Rollback draft #{operation.rollback_request_id}</strong>
                                    <span className="incident-workspace__timeline-time">{formatDateTime(operation.created_at)}</span>
                                  </div>
                                  <div className="incident-workspace__recovery-meta">{operation.reason}</div>
                                  {operation.notes ? <div className="incident-workspace__recovery-meta incident-workspace__recovery-meta--minor">Notes: {operation.notes}</div> : null}
                                </article>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">Select an incident to review its history and follow-up notes.</div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
