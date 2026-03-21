import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface CredentialAuditEntry {
  id: number;
  request_id?: number;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  cloud: string;
  credential_type: string;
  team: string;
  env: string;
  created_by_user_id?: number;
  created_by_username?: string;
  approved_by_user_id?: number;
  approved_by_username?: string;
  created_at: string;
}

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface ExpiryTrackerSummary {
  total_items: number;
  actionable_count: number;
  acknowledged_count: number;
  in_progress_count: number;
  rotated_count: number;
  credential_items: number;
  secret_items: number;
  certificate_items: number;
  expired_count: number;
  expiring_within_30_days: number;
  expiring_within_60_days: number;
  healthy_count: number;
}

interface ExpiryTrackerItem {
  item_key: string;
  category: string;
  source: string;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  cloud?: string;
  environment?: string;
  cluster_name?: string;
  namespace?: string;
  resource_name: string;
  resource_type: string;
  owner?: string;
  created_at?: string;
  expires_at?: string;
  days_remaining: number;
  status: string;
  recommendation: string;
  workflow_state: string;
  workflow_note?: string;
  workflow_updated_at?: string;
  workflow_updated_by_username?: string;
}

interface ExpiryTrackerPayload {
  summary: ExpiryTrackerSummary;
  items: ExpiryTrackerItem[];
}

const CLOUD_BADGES: Record<string, { bg: string; color: string }> = {
  AWS: { bg: '#ea580c', color: '#fff' },
  GCP: { bg: '#2563eb', color: '#fff' },
  Azure: { bg: '#0078d4', color: '#fff' },
};

export default function CredentialAuditPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [entries, setEntries] = useState<CredentialAuditEntry[]>([]);
  const [expiryTracker, setExpiryTracker] = useState<ExpiryTrackerPayload | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [workflowSavingKey, setWorkflowSavingKey] = useState('');
  const [cloudFilter, setCloudFilter] = useState('');
  const [projectId, setProjectId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchEntries = useCallback(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    setExpiryTracker(null);
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (cloudFilter) params.set('cloud', cloudFilter);
    if (projectId) params.set('project_id', projectId);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    fetch(`${apiUrl}/api/devops/credential-audit?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return null;
        }
        return res.json().catch(() => ({}));
      })
      .then((rawData) => {
        const data = asRecord(rawData);
        setEntries(Array.isArray(data.entries) ? (data.entries as CredentialAuditEntry[]) : []);
        const tracker = data.expiry_tracker;
        setExpiryTracker(tracker && typeof tracker === 'object' ? (tracker as ExpiryTrackerPayload) : null);
        const nextError = getString(data.error);
        if (nextError) setError(nextError);
      })
      .catch(() => setError('Failed to load credential audit'))
      .finally(() => setLoading(false));
  }, [router, apiUrl, cloudFilter, projectId, fromDate, toDate]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((rawData) => {
        const data = asRecord(rawData);
        setProjects(Array.isArray(data.projects) ? (data.projects as ProjectSummary[]) : []);
      })
      .catch(() => setProjects([]));
  }, [apiUrl]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const exportCsv = () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const params = new URLSearchParams();
    params.set('format', 'csv');
    if (cloudFilter) params.set('cloud', cloudFilter);
    if (projectId) params.set('project_id', projectId);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    fetch(`${apiUrl}/api/devops/credential-audit?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.text())
      .then((csv) => {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `credential-audit-${new Date().toISOString().slice(0, 10)}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
  };

  const statusTone = (status?: string): { background: string; color: string } => {
    switch (status) {
      case 'expired':
        return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
      case 'expiring_30d':
        return { background: 'rgba(250, 204, 21, 0.18)', color: '#facc15' };
      case 'expiring_60d':
        return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
      default:
        return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
    }
  };

  const workflowTone = (state?: string): { background: string; color: string } => {
    switch (state) {
      case 'acknowledged':
        return { background: 'rgba(59, 130, 246, 0.18)', color: '#93c5fd' };
      case 'in_progress':
        return { background: 'rgba(250, 204, 21, 0.18)', color: '#fde68a' };
      case 'rotated':
        return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
      default:
        return { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' };
    }
  };

  const workflowLabel = (state?: string): string => {
    switch (state) {
      case 'acknowledged':
        return 'Acknowledged';
      case 'in_progress':
        return 'In progress';
      case 'rotated':
        return 'Rotated';
      default:
        return 'Open';
    }
  };

  const updateWorkflow = async (item: ExpiryTrackerItem, nextState: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }

    const nextLabel = workflowLabel(nextState);
    const defaultNote =
      nextState === 'rotated'
        ? 'Rotation completed'
        : nextState === 'in_progress'
          ? 'Rotation work started'
          : nextState === 'acknowledged'
            ? 'Owner notified'
            : 'Reopened for follow-up';
    const note = window.prompt(`Add a note for "${nextLabel}"`, item.workflow_note || defaultNote);
    if (note === null) {
      return;
    }

    setWorkflowSavingKey(item.item_key);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/expiry-tracker/actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          item_key: item.item_key,
          workflow_state: nextState,
          note,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        router.replace('/login');
        return;
      }
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to update expiry workflow'));
      }
      setNotice(`Workflow updated: ${item.resource_name} is now ${nextLabel.toLowerCase()}.`);
      fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update expiry workflow');
    } finally {
      setWorkflowSavingKey('');
    }
  };

  return (
    <>
      <Head>
        <title>Credential Audit - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Credential Audit</span>
              <h1 className="portal-page__title">Credential Audit</h1>
              <p className="portal-page__subtitle">
                Existing audit features remain unchanged, but the page now uses a clearer filtering and evidence-review pattern.
              </p>
            </div>
          </header>

          <section className="portal-stat-grid">
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Entries</span>
              <strong className="portal-stat-card__value">{entries.length}</strong>
              <p className="portal-stat-card__copy">Credential-related approvals currently in the visible audit window.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Cloud filter</span>
              <strong className="portal-stat-card__value">{cloudFilter || 'All'}</strong>
              <p className="portal-stat-card__copy">Cloud-specific audit slicing without changing backend behavior.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Project filter</span>
              <strong className="portal-stat-card__value">
                {projectId ? (projects.find((project) => String(project.id) === projectId)?.code || 'Scoped') : 'All'}
              </strong>
              <p className="portal-stat-card__copy">Project-scoped credential review for governance and evidence tracking.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Date range</span>
              <strong className="portal-stat-card__value">{fromDate || toDate ? 'Filtered' : 'Open'}</strong>
              <p className="portal-stat-card__copy">Time-bound review mode for access-key and service-account creation.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Export</span>
              <strong className="portal-stat-card__value">CSV</strong>
              <p className="portal-stat-card__copy">One-click export is preserved for handoff and governance workflows.</p>
            </article>
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Filters</span>
                <h2 className="portal-surface__title">Scope the evidence</h2>
                <p className="portal-surface__subtitle">
                  Track who created AWS access keys, GCP service account keys, and similar credentials via approved requests.
                </p>
              </div>
            </div>

            <div className="portal-toolbar">
              <div className="portal-toolbar__group">
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="credential-audit-cloud-filter">Cloud</label>
                  <select
                    id="credential-audit-cloud-filter"
                    value={cloudFilter}
                    onChange={(event) => setCloudFilter(event.target.value)}
                    className="input"
                  >
                    <option value="">All</option>
                    <option value="AWS">AWS</option>
                    <option value="GCP">GCP</option>
                    <option value="Azure">Azure</option>
                  </select>
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="credential-audit-project-filter">Project</label>
                  <select
                    id="credential-audit-project-filter"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    className="input"
                  >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}{project.code ? ` (${project.code})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="credential-audit-from-date">From date</label>
                  <input
                    id="credential-audit-from-date"
                    type="date"
                    value={fromDate}
                    onChange={(event) => setFromDate(event.target.value)}
                    className="input"
                  />
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="credential-audit-to-date">To date</label>
                  <input
                    id="credential-audit-to-date"
                    type="date"
                    value={toDate}
                    onChange={(event) => setToDate(event.target.value)}
                    className="input"
                  />
                </div>
              </div>
              <div className="portal-page__actions">
                <button type="button" className="btn btn-secondary" onClick={fetchEntries}>
                  Refresh
                </button>
                <button type="button" className="btn btn-primary" onClick={exportCsv}>
                  Export CSV
                </button>
              </div>
            </div>
          </section>

          {error && <div className="alert alert-error">{error}</div>}
          {notice && <div className="alert alert-success">{notice}</div>}

          {expiryTracker ? (
            <>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Expiry Tracker</span>
                    <h2 className="portal-surface__title">Secrets and certificate review windows</h2>
                    <p className="portal-surface__subtitle">
                      Phase-one expiry visibility combines real credential events with project cluster connection review windows.
                    </p>
                  </div>
                </div>
                <div className="portal-stat-grid">
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Tracked items</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.total_items}</strong>
                    <p className="portal-stat-card__copy">Credentials {expiryTracker.summary.credential_items} · Secrets {expiryTracker.summary.secret_items} · Certificates {expiryTracker.summary.certificate_items}</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Expired</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.expired_count}</strong>
                    <p className="portal-stat-card__copy">Items already outside the safe review or rotation window.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Next 30 days</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.expiring_within_30_days}</strong>
                    <p className="portal-stat-card__copy">Immediate rotation and certificate review attention required.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Next 60 days</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.expiring_within_60_days}</strong>
                    <p className="portal-stat-card__copy">Upcoming rotation pressure that should enter planning now.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Healthy</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.healthy_count}</strong>
                    <p className="portal-stat-card__copy">Tracked items still outside the active risk window.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Actionable</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.actionable_count}</strong>
                    <p className="portal-stat-card__copy">Non-healthy items still waiting for completion.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Acknowledged</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.acknowledged_count}</strong>
                    <p className="portal-stat-card__copy">Items that have an owner but no active rotation work yet.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">In progress</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.in_progress_count}</strong>
                    <p className="portal-stat-card__copy">Items currently being rotated or reviewed.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Rotated</span>
                    <strong className="portal-stat-card__value">{expiryTracker.summary.rotated_count}</strong>
                    <p className="portal-stat-card__copy">Completed items kept for operational history.</p>
                  </article>
                </div>
              </section>

              <section className="portal-surface portal-surface--table">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Rotation Queue</span>
                    <h2 className="portal-surface__title">Expiry watchlist</h2>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="credential-audit-table">
                    <thead>
                      <tr>
                        <th>Resource</th>
                        <th>Category</th>
                        <th>Project</th>
                        <th>Cloud / Env</th>
                        <th>Namespace</th>
                        <th>Expires</th>
                        <th>Days left</th>
                        <th>Status</th>
                        <th>Workflow</th>
                        <th>Workflow updated</th>
                        <th>Recommendation</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expiryTracker.items.map((item) => {
                        const tone = statusTone(item.status);
                        const workflow = workflowTone(item.workflow_state);
                        const saving = workflowSavingKey === item.item_key;
                        return (
                          <tr key={`${item.category}-${item.resource_name}-${item.namespace || item.project_code || 'global'}`}>
                            <td>
                              <strong>{item.resource_name}</strong>
                              <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.resource_type}</div>
                            </td>
                            <td>{item.category}</td>
                            <td>
                              {item.project_name ? (
                                <div>
                                  <strong>{item.project_name}</strong>
                                  {item.project_code ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_code}</div> : null}
                                </div>
                              ) : '—'}
                            </td>
                            <td>{[item.cloud, item.environment].filter(Boolean).join(' / ') || '—'}</td>
                            <td>{item.namespace || item.cluster_name || '—'}</td>
                            <td>{item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '—'}</td>
                            <td>{item.days_remaining}</td>
                            <td>
                              <span style={{ ...tone, padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                                {item.status}
                              </span>
                            </td>
                            <td>
                              <span style={{ ...workflow, padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                                {workflowLabel(item.workflow_state)}
                              </span>
                              {item.workflow_note ? (
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 6 }}>
                                  {item.workflow_note}
                                </div>
                              ) : null}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {item.workflow_updated_at ? (
                                <div>
                                  <div>{new Date(item.workflow_updated_at).toLocaleString()}</div>
                                  {item.workflow_updated_by_username ? (
                                    <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                                      by {item.workflow_updated_by_username}
                                    </div>
                                  ) : null}
                                </div>
                              ) : '—'}
                            </td>
                            <td style={{ minWidth: 260 }}>{item.recommendation}</td>
                            <td style={{ minWidth: 220 }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {item.workflow_state !== 'acknowledged' ? (
                                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => updateWorkflow(item, 'acknowledged')}>
                                    {saving ? 'Saving...' : 'Acknowledge'}
                                  </button>
                                ) : null}
                                {item.workflow_state !== 'in_progress' ? (
                                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => updateWorkflow(item, 'in_progress')}>
                                    {saving ? 'Saving...' : 'Start rotation'}
                                  </button>
                                ) : null}
                                {item.workflow_state !== 'rotated' ? (
                                  <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => updateWorkflow(item, 'rotated')}>
                                    {saving ? 'Saving...' : 'Mark rotated'}
                                  </button>
                                ) : null}
                                {item.workflow_state !== 'open' ? (
                                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => updateWorkflow(item, 'open')}>
                                    {saving ? 'Saving...' : 'Reopen'}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}

          {loading ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>Loading credential audit...</p>
              </div>
            </section>
          ) : entries.length === 0 ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>No credential audit entries yet.</p>
              </div>
            </section>
          ) : (
            <section className="portal-surface portal-surface--table">
              <div className="table-wrap">
                <table className="credential-audit-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Cloud</th>
                      <th>Project</th>
                      <th>Credential type</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Request author</th>
                      <th>Approved by</th>
                      <th>Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const cloudStyle = CLOUD_BADGES[entry.cloud] || { bg: 'var(--color-primary)', color: '#fff' };
                      return (
                        <tr key={entry.id}>
                          <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 13 }}>
                            {new Date(entry.created_at).toLocaleString()}
                          </td>
                          <td>
                            <span className="credential-audit-cloud-badge" style={{ background: cloudStyle.bg, color: cloudStyle.color }}>
                              {entry.cloud}
                            </span>
                          </td>
                          <td>
                            {entry.project_name ? (
                              <div>
                                <strong>{entry.project_name}</strong>
                                {entry.project_code ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{entry.project_code}</div> : null}
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>{entry.credential_type}</td>
                          <td>{entry.team || '-'}</td>
                          <td>{entry.env || '-'}</td>
                          <td>{entry.created_by_username || '-'}</td>
                          <td>{entry.approved_by_username || '-'}</td>
                          <td>
                            {entry.request_id ? (
                              <Link
                                href={`/tickets?id=${entry.request_id}${entry.project_id ? `&project_id=${entry.project_id}` : ''}`}
                                className="credential-audit-link"
                                title="View in Tickets"
                              >
                                #{entry.request_id}
                              </Link>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
