import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
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

interface RollbackSummary {
  candidate_count: number;
  ready_count: number;
  operation_count: number;
  production_candidates: number;
  incident_linked_count: number;
}

interface RollbackSnapshot {
  id: number;
  created_at: string;
  note: string;
  preview: string;
}

interface RollbackCandidate {
  request_id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  team: string;
  environment: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  client_name: string;
  updated_at: string;
  pr_url?: string;
  snapshot_count: number;
  incident_count: number;
  runbook_count: number;
  rollback_count: number;
  eligible: boolean;
  eligibility_reason: string;
  snapshots: RollbackSnapshot[];
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

interface RollbackPayload {
  projects: ProjectSummary[];
  summary: RollbackSummary;
  items: RollbackCandidate[];
  focus_request_id?: number;
  focus_candidate?: RollbackCandidate | null;
  recent_operations: RollbackOperation[];
}

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

export default function RollbackConsolePage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [consoleData, setConsoleData] = useState<RollbackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectId, setProjectId] = useState('');
  const [focusRequestId, setFocusRequestId] = useState('');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    const queryProjectId = router.query.project_id;
    const queryRequestId = router.query.request_id;
    if (typeof queryProjectId === 'string' && queryProjectId.trim()) setProjectId(queryProjectId.trim());
    if (typeof queryRequestId === 'string' && queryRequestId.trim()) setFocusRequestId(queryRequestId.trim());
  }, [router.isReady, router.query.project_id, router.query.request_id]);

  const loadConsole = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect(router);
      return;
    }
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (focusRequestId) params.set('request_id', focusRequestId);
    try {
      const response = await fetch(`${apiUrl}/api/devops/rollback-console?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect(router);
        return;
      }
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to load rollback console'));
      }
      const nextConsole = payload.console && typeof payload.console === 'object'
        ? (payload.console as RollbackPayload)
        : null;
      setConsoleData(nextConsole);
      if (nextConsole?.focus_request_id) {
        setFocusRequestId(String(nextConsole.focus_request_id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rollback console');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConsole();
  }, [apiUrl, focusRequestId, projectId, router]);

  const focusCandidate = useMemo(() => {
    return consoleData?.focus_candidate || consoleData?.items?.[0] || null;
  }, [consoleData]);

  const hasActiveScope = Boolean(projectId || focusRequestId);

  useEffect(() => {
    if (!focusCandidate) {
      setSelectedSnapshotId('');
      return;
    }
    if (focusCandidate.snapshots.length > 0) {
      setSelectedSnapshotId(String(focusCandidate.snapshots[0].id));
    } else {
      setSelectedSnapshotId('');
    }
  }, [focusCandidate]);

  const submitRollback = async () => {
    if (!focusCandidate) {
      setError('Select a rollback candidate first.');
      return;
    }
    if (!focusCandidate.eligible) {
      setError(focusCandidate.eligibility_reason || 'This request is not eligible for rollback.');
      return;
    }
    if (!reason.trim()) {
      setError('A rollback reason is required.');
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect(router);
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/rollback-console`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_request_id: focusCandidate.request_id,
          history_id: selectedSnapshotId ? Number(selectedSnapshotId) : 0,
          reason,
          notes,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect(router);
        return;
      }
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to create rollback request'));
      }
      const rollbackRequest = payload.rollback_request && typeof payload.rollback_request === 'object'
        ? asRecord(payload.rollback_request)
        : {};
      const rollbackRequestId = typeof rollbackRequest.id === 'number' ? rollbackRequest.id : '';
      setNotice(`Prepared rollback draft request #${rollbackRequestId}.`);
      setReason('');
      setNotes('');
      await loadConsole();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rollback request');
    } finally {
      setSubmitting(false);
    }
  };

  const summary = consoleData?.summary;
  const projects = consoleData?.projects || [];

  return (
    <DevOpsLayout>
      <Head>
        <title>Rollback Console - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Recovery Control</span>
            <h1 className="portal-page__title">Rollback Console</h1>
            <p className="portal-page__subtitle">
              Prepare controlled rollback requests from saved configuration snapshots, preserve the approval trail, and keep recovery actions visible inside the delivery workflow.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/promotions" className="btn btn-secondary">Promotion Center</Link>
            <Link href="/incident-workspace" className="btn btn-secondary">Incident Workspace</Link>
            <Link href="/projects" className="btn btn-primary">Projects</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading rollback console...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        {!loading && !error && summary ? (
          <>
            <section className="portal-surface rollback-console__surface-gap">
              <div className="rollback-console__summary-actions">
                <div className="portal-pill-row">
                  <span className="portal-pill">Candidates {summary.candidate_count}</span>
                  <span className="portal-pill">Ready now {summary.ready_count}</span>
                  <span className="portal-pill">Recent ops {summary.operation_count}</span>
                  <span className="portal-pill">Production {summary.production_candidates}</span>
                  <span className="portal-pill">Incident-linked {summary.incident_linked_count}</span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters((current) => !current)}>
                  {showFilters ? 'Hide scope' : 'Show scope'}
                </button>
              </div>
            </section>

            {hasActiveScope ? (
              <div className="alert alert-info rollback-console__scope-alert">
                Viewing a focused rollback slice.
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setProjectId('');
                    setFocusRequestId('');
                  }}
                >
                  Clear scope
                </button>
              </div>
            ) : null}

            {showFilters ? (
            <section className="portal-surface rollback-console__surface-gap">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Scope</span>
                  <h2 className="portal-surface__title">Filter the rollback queue</h2>
                  <p className="portal-surface__subtitle">Focus on one project or request when you are preparing a specific recovery action.</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(false)}>
                  Close
                </button>
              </div>
              <div className="portal-toolbar">
                <div className="portal-toolbar__group">
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="rollback-project-filter">Project</label>
                    <select id="rollback-project-filter" className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                      <option value="">All projects</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}{project.code ? ` (${project.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>
            ) : null}

            <div className="portal-grid rollback-console__grid">
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Candidates</span>
                    <h2 className="portal-surface__title">Eligible request history</h2>
                  </div>
                </div>
                <div className="rollback-console__candidate-list">
                  {(consoleData?.items || []).length === 0 ? (
                    <div className="empty-state">No rollback candidates are available for the current filters.</div>
                  ) : (
                    (consoleData?.items || []).map((item) => (
                      <button
                        key={`rollback-candidate-${item.request_id}`}
                        type="button"
                        className={`portal-surface rollback-console__candidate-card${focusCandidate?.request_id === item.request_id ? ' rollback-console__candidate-card--active' : ''}`}
                        onClick={() => setFocusRequestId(String(item.request_id))}
                      >
                        <div className="rollback-console__candidate-head">
                          <strong>#{item.request_id} · {item.client_name}</strong>
                          <span className="portal-pill">{item.eligible ? 'ready' : 'review'}</span>
                        </div>
                        <div className="rollback-console__candidate-meta">
                          {item.project_name ? `${item.project_name} (${item.project_code})` : 'No project'} · {item.environment}/{item.service}
                        </div>
                        <div className="rollback-console__candidate-meta rollback-console__candidate-meta--minor">
                          Snapshots: {item.snapshot_count} · Incidents: {item.incident_count} · Rollbacks: {item.rollback_count}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Focused candidate</span>
                    <h2 className="portal-surface__title">
                      {focusCandidate ? `#${focusCandidate.request_id} · ${focusCandidate.client_name}` : 'Select a request'}
                    </h2>
                    <p className="portal-surface__subtitle">{focusCandidate?.eligibility_reason || 'Choose a candidate to inspect available snapshots and prepare rollback.'}</p>
                  </div>
                </div>

                {focusCandidate ? (
                  <div className="rollback-console__detail-stack">
                    <div className="rollback-console__focus-pills">
                      <span className="portal-pill">Status: {focusCandidate.status}</span>
                      <span className="portal-pill">Priority: {focusCandidate.priority}</span>
                      <span className="portal-pill">Env: {focusCandidate.environment}</span>
                      <span className="portal-pill">Cloud: {focusCandidate.cloud}</span>
                      <span className="portal-pill">Service: {focusCandidate.service}</span>
                    </div>

                    <div className="portal-grid rollback-console__grid">
                      <div className="portal-surface rollback-console__subsurface">
                        <h3 className="portal-surface__title rollback-console__section-title">Configuration snapshots</h3>
                        {focusCandidate.snapshots.length === 0 ? (
                          <div className="empty-state rollback-console__empty-inline">No configuration snapshots are available for this request.</div>
                        ) : (
                          <div className="rollback-console__stack">
                            <div>
                              <label className="credential-audit-label" htmlFor="rollback-snapshot">Snapshot</label>
                              <select id="rollback-snapshot" className="input" value={selectedSnapshotId} onChange={(event) => setSelectedSnapshotId(event.target.value)}>
                                {focusCandidate.snapshots.map((snapshot) => (
                                  <option key={snapshot.id} value={snapshot.id}>
                                    #{snapshot.id} · {formatDateTime(snapshot.created_at)} · {snapshot.note || 'Snapshot'}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {focusCandidate.snapshots.map((snapshot) => (
                              <article key={`snapshot-${snapshot.id}`} className="rollback-console__record-card">
                                <div className="rollback-console__record-head">
                                  <strong>Snapshot #{snapshot.id}</strong>
                                  <span className="rollback-console__record-time">{formatDateTime(snapshot.created_at)}</span>
                                </div>
                                {snapshot.note ? <div className="rollback-console__record-copy">{snapshot.note}</div> : null}
                                <pre className="rollback-console__record-preview">{snapshot.preview}</pre>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="portal-surface rollback-console__subsurface">
                        <h3 className="portal-surface__title rollback-console__section-title">Prepare rollback request</h3>
                        <div className="rollback-console__stack">
                          <div>
                            <label className="credential-audit-label" htmlFor="rollback-reason">Reason</label>
                            <textarea id="rollback-reason" className="input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
                          </div>
                          <div>
                            <label className="credential-audit-label" htmlFor="rollback-notes">Notes</label>
                            <textarea id="rollback-notes" className="input" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
                          </div>
                          <div className="rollback-console__action-row">
                            <button type="button" className="btn btn-primary" disabled={submitting || !focusCandidate.eligible} onClick={() => void submitRollback()}>
                              {submitting ? 'Preparing...' : 'Prepare rollback draft'}
                            </button>
                            {focusCandidate.project_id ? (
                              <Link href={`/incident-workspace?project_id=${focusCandidate.project_id}`} className="btn btn-secondary btn-sm">
                                Open incident workspace
                              </Link>
                            ) : null}
                            {focusCandidate.project_id ? <Link href={`/projects/${focusCandidate.project_id}`} className="btn btn-secondary btn-sm">Open project</Link> : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="portal-surface rollback-console__subsurface">
                      <h3 className="portal-surface__title rollback-console__section-title">Recent rollback operations</h3>
                      {(consoleData?.recent_operations || []).length === 0 ? (
                        <div className="empty-state rollback-console__empty-inline">No rollback operations have been recorded yet.</div>
                      ) : (
                        <div className="rollback-console__stack">
                          {(consoleData?.recent_operations || []).map((operation) => (
                            <article key={`rollback-operation-${operation.id}`} className="rollback-console__record-card">
                              <div className="rollback-console__record-head">
                                <strong>Rollback draft #{operation.rollback_request_id}</strong>
                                <span className="rollback-console__record-time">{formatDateTime(operation.created_at)}</span>
                              </div>
                              <div className="rollback-console__record-copy">{operation.reason}</div>
                              {operation.notes ? <div className="rollback-console__record-copy rollback-console__record-copy--minor">Notes: {operation.notes}</div> : null}
                              <div className="rollback-console__record-copy rollback-console__record-copy--minor">Prepared by {operation.approved_by_username || 'manager'}</div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">Select a rollback candidate to review history and prepare the rollback draft request.</div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
