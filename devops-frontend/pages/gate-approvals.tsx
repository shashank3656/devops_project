import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface GateApprovalSummary {
  total_count: number;
  active_count: number;
  expired_count: number;
  revoked_count: number;
  production_count: number;
}

interface GateApprovalRecord {
  id: number;
  request_id: number;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  team?: string;
  cloud?: string;
  service?: string;
  request_status?: string;
  source_environment: string;
  target_environment: string;
  gate_status: string;
  summary: string;
  note: string;
  approved_by: number;
  approved_by_username: string;
  approved_at: string;
  expires_at?: string;
  revoked_at?: string;
  revoked_by?: number;
  revoked_by_username?: string;
  revoke_note?: string;
  state: string;
}

const EMPTY_SUMMARY: GateApprovalSummary = {
  total_count: 0,
  active_count: 0,
  expired_count: 0,
  revoked_count: 0,
  production_count: 0,
};

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function stateTone(state: string): { background: string; color: string } {
  switch (state) {
    case 'active':
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
    case 'expired':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    case 'revoked':
      return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
    default:
      return { background: 'var(--color-primary-soft)', color: 'var(--color-primary)' };
  }
}

function gateTone(status: string): { background: string; color: string } {
  switch (status) {
    case 'blocked':
      return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
    case 'attention':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    case 'ready':
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
    default:
      return { background: 'var(--color-primary-soft)', color: 'var(--color-primary)' };
  }
}

export default function GateApprovalsPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [approvals, setApprovals] = useState<GateApprovalRecord[]>([]);
  const [summary, setSummary] = useState<GateApprovalSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [targetEnvironment, setTargetEnvironment] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [approver, setApprover] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expiresWithinDays, setExpiresWithinDays] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const fetchApprovals = useCallback(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }

    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('limit', '200');
    if (projectId) params.set('project_id', projectId);
    if (targetEnvironment) params.set('target_environment', targetEnvironment);
    if (stateFilter) params.set('state', stateFilter);
    if (approver.trim()) params.set('approver', approver.trim());
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (expiresWithinDays) params.set('expires_within_days', expiresWithinDays);

    fetch(`${apiUrl}/api/devops/deployment-gate-approvals?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          router.replace('/login');
          return null;
        }
        return response.ok ? response.json() : response.json().catch(() => null);
      })
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.approvals)) setApprovals(data.approvals);
        else setApprovals([]);
        setSummary(data.summary || EMPTY_SUMMARY);
        if (typeof data.error === 'string' && data.error.trim()) setError(data.error.trim());
      })
      .catch(() => setError('Failed to load gate approvals'))
      .finally(() => setLoading(false));
  }, [apiUrl, approver, expiresWithinDays, fromDate, projectId, router, stateFilter, targetEnvironment, toDate]);

  const exportCSV = useCallback(async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }

    const params = new URLSearchParams();
    params.set('limit', '500');
    params.set('format', 'csv');
    if (projectId) params.set('project_id', projectId);
    if (targetEnvironment) params.set('target_environment', targetEnvironment);
    if (stateFilter) params.set('state', stateFilter);
    if (approver.trim()) params.set('approver', approver.trim());
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (expiresWithinDays) params.set('expires_within_days', expiresWithinDays);

    try {
      const response = await fetch(`${apiUrl}/api/devops/deployment-gate-approvals?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        const payload = asRecord(await response.json().catch(() => ({})));
        throw new Error(getString(payload.error, 'Failed to export gate approvals'));
      }
      const blob = await response.blob();
      const objectURL = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectURL;
      anchor.download = 'deployment-gate-approvals.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectURL);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export gate approvals');
    }
  }, [apiUrl, approver, expiresWithinDays, fromDate, projectId, router, stateFilter, targetEnvironment, toDate]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const payload = asRecord(data);
        setProjects(Array.isArray(payload.projects) ? (payload.projects as ProjectSummary[]) : []);
      })
      .catch(() => setProjects([]));
  }, [apiUrl]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const environmentOptions = useMemo(() => {
    return approvals
      .map((item) => item.target_environment)
      .filter((value, index, list) => value && list.indexOf(value) === index)
      .sort((left, right) => left.localeCompare(right));
  }, [approvals]);

  const hasActiveFilters = Boolean(
    projectId || targetEnvironment || stateFilter || approver.trim() || fromDate || toDate || expiresWithinDays
  );

  return (
    <>
      <Head>
        <title>Gate Approval Audit - SetuOps DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Gate Approval Audit</span>
              <h1 className="portal-page__title">Deployment gate approvals</h1>
              <p className="portal-page__subtitle">
                Review approval history, expiry windows, revoked decisions, and production promotion oversight in one place.
              </p>
            </div>
          </header>

          <section className="portal-surface" style={{ marginBottom: 24 }}>
            <div className="portal-page__actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="portal-pill-row">
                <span className="portal-pill">Approvals {summary.total_count}</span>
                <span className="portal-pill">Active {summary.active_count}</span>
                <span className="portal-pill">Expired {summary.expired_count}</span>
                <span className="portal-pill">Revoked {summary.revoked_count}</span>
                <span className="portal-pill">Production {summary.production_count}</span>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters((current) => !current)}>
                {showFilters ? 'Hide filters' : 'Show filters'}
              </button>
            </div>
          </section>

          {hasActiveFilters ? (
            <div className="alert alert-info" style={{ marginBottom: 24 }}>
              Viewing a filtered approval audit slice.
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 12 }}
                onClick={() => {
                  setProjectId('');
                  setTargetEnvironment('');
                  setStateFilter('');
                  setApprover('');
                  setFromDate('');
                  setToDate('');
                  setExpiresWithinDays('');
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}

          {showFilters ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Filters</span>
                <h2 className="portal-surface__title">Focus the approval history</h2>
                <p className="portal-surface__subtitle">Slice the audit stream by project, environment, state, approver, and review date.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(false)}>
                Close
              </button>
            </div>

            <div className="portal-toolbar">
              <div className="portal-toolbar__group">
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="gate-audit-project-filter">Project</label>
                  <select id="gate-audit-project-filter" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="input">
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}{project.code ? ` (${project.code})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="gate-audit-environment-filter">Target environment</label>
                  <select
                    id="gate-audit-environment-filter"
                    value={targetEnvironment}
                    onChange={(event) => setTargetEnvironment(event.target.value)}
                    className="input"
                  >
                    <option value="">All environments</option>
                    {environmentOptions.map((value) => (
                      <option key={value} value={value}>
                        {value.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="gate-audit-state-filter">State</label>
                  <select id="gate-audit-state-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="input">
                    <option value="">All states</option>
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                    <option value="revoked">Revoked</option>
                  </select>
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="gate-audit-approver-filter">Approver</label>
                  <input
                    id="gate-audit-approver-filter"
                    value={approver}
                    onChange={(event) => setApprover(event.target.value)}
                    className="input"
                    placeholder="e.g. ops-lead"
                  />
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="gate-audit-from-date">From date</label>
                  <input id="gate-audit-from-date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="input" />
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="gate-audit-to-date">To date</label>
                  <input id="gate-audit-to-date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="input" />
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label" htmlFor="gate-audit-expiry-window">Expiring within</label>
                  <select
                    id="gate-audit-expiry-window"
                    value={expiresWithinDays}
                    onChange={(event) => setExpiresWithinDays(event.target.value)}
                    className="input"
                  >
                    <option value="">Any expiry window</option>
                    <option value="1">24 hours</option>
                    <option value="7">7 days</option>
                    <option value="14">14 days</option>
                    <option value="30">30 days</option>
                  </select>
                </div>
              </div>
              <div className="portal-page__actions">
                <button type="button" className="btn btn-secondary" onClick={fetchApprovals}>
                  Refresh
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => void exportCSV()}>
                  Export CSV
                </button>
                <Link href="/promotions" className="btn btn-primary">
                  Open Promotions
                </Link>
              </div>
            </div>
          </section>
          ) : null}

          {error ? <div className="alert alert-error">{error}</div> : null}

          <section className="portal-surface portal-surface--table">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Approval Log</span>
                <h2 className="portal-surface__title">Persisted gate decisions</h2>
              </div>
            </div>

            {loading ? (
              <div className="empty-state">Loading deployment gate approvals...</div>
            ) : approvals.length === 0 ? (
              <div className="empty-state">No gate approvals match the current filters.</div>
            ) : (
              <div className="table-wrap">
                <table className="credential-audit-table">
                  <thead>
                    <tr>
                      <th>Approved</th>
                      <th>Project</th>
                      <th>Request</th>
                      <th>Flow</th>
                      <th>State</th>
                      <th>Gate</th>
                      <th>Approver</th>
                      <th>Expiry / Revocation</th>
                      <th>Notes</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvals.map((item) => (
                      <tr key={item.id}>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 13 }}>
                          {formatDateTime(item.approved_at)}
                        </td>
                        <td>
                          {item.project_name ? (
                            <div>
                              <strong>{item.project_name}</strong>
                              {item.project_code ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_code}</div> : null}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <div>
                            <strong>Request #{item.request_id}</strong>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                              {[item.cloud, item.service, item.team].filter(Boolean).join(' / ') || item.request_status || '—'}
                            </div>
                          </div>
                        </td>
                        <td>{`${item.source_environment || 'n/a'} → ${item.target_environment || 'n/a'}`}</td>
                        <td>
                          <span style={{ ...stateTone(item.state), padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>
                            {item.state}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'grid', gap: 6 }}>
                            <span
                              style={{
                                ...gateTone(item.gate_status),
                                width: 'fit-content',
                                padding: '6px 10px',
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 700,
                                textTransform: 'capitalize',
                              }}
                            >
                              {item.gate_status}
                            </span>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.summary || 'No summary recorded.'}</span>
                          </div>
                        </td>
                        <td>{item.approved_by_username || '—'}</td>
                        <td style={{ minWidth: 220 }}>
                          <div style={{ display: 'grid', gap: 4, color: 'var(--color-text-muted)', fontSize: 12 }}>
                            <span>Expires: {formatDateTime(item.expires_at)}</span>
                            {item.revoked_at ? <span>Revoked: {formatDateTime(item.revoked_at)}</span> : null}
                            {item.revoked_by_username ? <span>Revoked by: {item.revoked_by_username}</span> : null}
                          </div>
                        </td>
                        <td style={{ minWidth: 260 }}>
                          <div style={{ display: 'grid', gap: 6, color: 'var(--color-text-muted)', fontSize: 12 }}>
                            <span>{item.note || 'No approval note.'}</span>
                            {item.revoke_note ? <span>Revoke note: {item.revoke_note}</span> : null}
                          </div>
                        </td>
                        <td>
                          <Link
                            href={`/promotions?request_id=${item.request_id}${item.project_id ? `&project_id=${item.project_id}` : ''}${item.target_environment ? `&next_environment=${encodeURIComponent(item.target_environment)}` : ''}`}
                            className="credential-audit-link"
                          >
                            Open promotion
                          </Link>
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
    </>
  );
}
