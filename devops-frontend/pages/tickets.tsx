import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { getRecentRequestIds, addRecentRequestId } from '../lib/recentRequests';

const DEVOPS_TOKEN_KEY = 'devops_token';

const CLOUDS = ['AWS', 'GCP', 'Azure'];
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'pending_user_manager_approval', label: 'Pending user manager' },
  { value: 'pending_devops_approval', label: 'Pending DevOps approval' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
];

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'completed': return 'ticket-status--success';
    case 'rejected': return 'ticket-status--danger';
    case 'in_progress': return 'ticket-status--info';
    case 'pending_approval':
    case 'pending_user_manager_approval':
    case 'pending_devops_approval':
      return 'ticket-status--warning';
    default: return 'ticket-status--default';
  }
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    pending_approval: 'Pending approval',
    pending_user_manager_approval: 'Pending user manager',
    pending_devops_approval: 'Pending DevOps approval',
    in_progress: 'In progress',
    completed: 'Completed',
    rejected: 'Rejected',
  };
  return map[status] || status;
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDateOnly(value?: string | null): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

interface TicketRow {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  due_date: string | null;
  due_status: '' | 'overdue' | 'due_soon';
  pr_url: string;
  created_at: string;
  updated_at: string;
  created_by_username?: string;
}

interface BlockedByItem {
  id: number;
  status: string;
}

interface TicketDetail extends TicketRow {
  client_name?: string;
  application_id?: string;
  branch?: string;
  file_path?: string;
  config?: string;
  reject_reason?: string;
  terraform_plan_output?: string;
  jira_ticket_id?: string;
  depends_on?: number[];
  blocked_by?: number[];
  blocked_by_with_status?: BlockedByItem[];
}

interface RequestComment {
  id: number;
  request_id: number;
  user_id: number;
  username: string;
  body: string;
  created_at: string;
}

interface RequestTimelineEvent {
  id: number;
  kind: string;
  action: string;
  username: string;
  details: string;
  body?: string;
  created_at: string;
}

export default function DevOpsTickets() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [requests, setRequests] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [idFilter, setIdFilter] = useState('');
  const [team, setTeam] = useState('');
  const [cloud, setCloud] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [requester, setRequester] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [atRisk, setAtRisk] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filterExpanded, setFilterExpanded] = useState(true);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailRequest, setDetailRequest] = useState<TicketDetail | null>(null);
  const [detailComments, setDetailComments] = useState<RequestComment[]>([]);
  const [detailTimeline, setDetailTimeline] = useState<RequestTimelineEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailNotice, setDetailNotice] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actioning, setActioning] = useState<'approve' | 'reject' | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const limit = 20;

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;

  const hasActiveFilters = Boolean(idFilter || team || cloud || status || search || requester || atRisk);
  const canActOnDetail = detailRequest?.status === 'pending_devops_approval';

  const fetchTickets = () => {
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (idFilter.trim()) params.set('id', idFilter.trim());
    if (team) params.set('team', team);
    if (cloud) params.set('cloud', cloud);
    if (status) params.set('status', status);
    if (search) params.set('q', search);
    if (requester) params.set('requester', requester);
    params.set('sort_by', sortBy);
    params.set('sort_order', sortOrder);
    if (atRisk) params.set('at_risk', 'true');
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    fetch(`${apiUrl}/api/devops/requests?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data?.requests) setRequests(data.requests);
        if (typeof data?.total_count === 'number') setTotal(data.total_count);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadDetail = async (id: number, syncUrl = true) => {
    if (!token) return;
    setDetailId(id);
    setDetailLoading(true);
    setDetailError('');
    setDetailNotice('');
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const [detailRes, commentsRes, timelineRes] = await Promise.all([
        fetch(`${apiUrl}/api/devops/requests/${id}`, { headers }),
        fetch(`${apiUrl}/api/devops/requests/${id}/comments`, { headers }),
        fetch(`${apiUrl}/api/devops/requests/${id}/timeline`, { headers }),
      ]);

      if (!detailRes.ok) {
        const data = await detailRes.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to load ticket');
      }

      const detailData = await detailRes.json();
      const commentsData = commentsRes.ok ? await commentsRes.json().catch(() => ({})) : {};
      const timelineData = timelineRes.ok ? await timelineRes.json().catch(() => ({})) : {};

      setDetailRequest(detailData?.request || null);
      setDetailComments(commentsData?.comments || []);
      setDetailTimeline(timelineData?.timeline || []);
      setRejectReason(detailData?.request?.reject_reason || '');
      setCommentBody('');

      addRecentRequestId(id);
      setRecentIds(getRecentRequestIds());

      if (syncUrl) {
        router.replace(`/tickets?id=${id}`, undefined, { shallow: true });
      }

      setTimeout(() => {
        workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load ticket';
      setDetailError(message);
      setDetailRequest(null);
      setDetailComments([]);
      setDetailTimeline([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailId(null);
    setDetailRequest(null);
    setDetailComments([]);
    setDetailTimeline([]);
    setDetailError('');
    setDetailNotice('');
    setCommentBody('');
    setRejectReason('');
    router.replace('/tickets', undefined, { shallow: true });
  };

  const refreshDetail = async () => {
    if (!detailId) return;
    await loadDetail(detailId, false);
  };

  const submitComment = async () => {
    if (!token || !detailRequest || !commentBody.trim()) return;
    setCommentSubmitting(true);
    setDetailError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/requests/${detailRequest.id}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetailError(data?.error || 'Failed to add comment');
        return;
      }
      setCommentBody('');
      setDetailNotice('Comment added.');
      await loadDetail(detailRequest.id, false);
    } catch (_) {
      setDetailError('Failed to add comment');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleDecision = async (action: 'approve' | 'reject') => {
    if (!token || !detailRequest) return;
    setActioning(action);
    setDetailError('');
    setDetailNotice('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/requests/${detailRequest.id}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: action === 'reject' ? JSON.stringify({ reason: rejectReason.trim() }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetailError(data?.error || `Failed to ${action} request`);
        return;
      }
      setDetailNotice(data?.message || `Request ${action}d.`);
      if (action === 'reject') setRejectReason('');
      fetchTickets();
      await loadDetail(detailRequest.id, false);
      window.dispatchEvent(new CustomEvent('devops-notifications-refresh'));
    } catch (_) {
      setDetailError(`Failed to ${action} request`);
    } finally {
      setActioning(null);
    }
  };

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchTickets();
  }, [token, router, apiUrl, idFilter, team, cloud, status, search, requester, sortBy, sortOrder, atRisk, offset]);

  useEffect(() => {
    setRecentIds(getRecentRequestIds());
  }, []);

  useEffect(() => {
    if (requests.length === 1 && idFilter.trim()) {
      const id = parseInt(idFilter.trim(), 10);
      if (!Number.isNaN(id) && requests[0].id === id) {
        addRecentRequestId(id);
        setRecentIds(getRecentRequestIds());
      }
    }
  }, [requests, idFilter]);

  useEffect(() => {
    if (!router.isReady || !token) return;
    const idParam = router.query.id;
    const parsed = typeof idParam === 'string' ? parseInt(idParam, 10) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0 && parsed !== detailId) {
      loadDetail(parsed, false);
    }
  }, [router.isReady, router.query.id, token, detailId]);

  const goToRecent = (id: number) => {
    setIdFilter(String(id));
    setTeam('');
    setCloud('');
    setStatus('');
    setSearch('');
    setRequester('');
    setAtRisk(false);
    setOffset(0);
    loadDetail(id);
  };

  const clearFilters = () => {
    setIdFilter('');
    setTeam('');
    setCloud('');
    setStatus('');
    setSearch('');
    setRequester('');
    setAtRisk(false);
    setOffset(0);
  };

  return (
    <>
      <Head>
        <title>Tickets - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="devops-tickets-page">
          <div className="devops-tickets-header">
            <div>
              <h1 className="devops-tickets-title">Tickets</h1>
              {recentIds.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Recent:</span>
                  {recentIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: 13 }}
                      onClick={() => goToRecent(id)}
                      title={`Open ticket #${id}`}
                    >
                      #{id}
                    </button>
                  ))}
                </div>
              )}
              <p className="devops-tickets-subtitle">
                Search by ticket, team, cloud, status, or requester. Click a row to open the approval workspace, review context, comment, and decide.
              </p>
            </div>
          </div>

          <div className="devops-tickets-filter-card card">
            <button
              type="button"
              className="devops-tickets-filter-toggle"
              onClick={() => setFilterExpanded(!filterExpanded)}
              aria-expanded={filterExpanded}
            >
              <span className="devops-tickets-filter-toggle__icon">{filterExpanded ? '▼' : '▶'}</span>
              <span>Filters</span>
              {hasActiveFilters && <span className="devops-tickets-filter-badge">{[idFilter, team, cloud, status, search, requester, atRisk].filter(Boolean).length}</span>}
            </button>
            {filterExpanded && (
              <div className="devops-tickets-filter-grid">
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Ticket #</label>
                  <input
                    type="text"
                    placeholder="e.g. 123"
                    value={idFilter}
                    onChange={(e) => setIdFilter(e.target.value)}
                    className="input devops-tickets-filter-input"
                  />
                </div>
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Team</label>
                  <input
                    type="text"
                    placeholder="Team name"
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    className="input devops-tickets-filter-input"
                  />
                </div>
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Cloud</label>
                  <select value={cloud} onChange={(e) => setCloud(e.target.value)} className="input devops-tickets-filter-input">
                    <option value="">All clouds</option>
                    {CLOUDS.map((entry) => (
                      <option key={entry} value={entry}>{entry}</option>
                    ))}
                  </select>
                </div>
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="input devops-tickets-filter-input">
                    {STATUS_OPTIONS.map((entry) => (
                      <option key={entry.value || 'all'} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                </div>
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Requester</label>
                  <input
                    type="text"
                    placeholder="User ID"
                    value={requester}
                    onChange={(e) => setRequester(e.target.value)}
                    className="input devops-tickets-filter-input"
                  />
                </div>
                <div className="devops-tickets-filter-group devops-tickets-filter-group--wide">
                  <label className="devops-tickets-filter-label">Search</label>
                  <input
                    type="text"
                    placeholder="Search across fields"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="input devops-tickets-filter-input"
                  />
                </div>
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Sort by</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="input devops-tickets-filter-input">
                    <option value="created_at">Created</option>
                    <option value="updated_at">Updated</option>
                    <option value="priority">Priority</option>
                    <option value="due_date">Due date</option>
                  </select>
                </div>
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Order</label>
                  <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input devops-tickets-filter-input">
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>
                <div className="devops-tickets-filter-group devops-tickets-filter-group--checkbox">
                  <label className="devops-tickets-filter-checkbox">
                    <input type="checkbox" checked={atRisk} onChange={(e) => setAtRisk(e.target.checked)} />
                    <span>At risk (overdue or due in 24h)</span>
                  </label>
                </div>
                <div className="devops-tickets-filter-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters} disabled={!hasActiveFilters}>
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          {loading ? (
            <div className="devops-tickets-loading">
              <div className="devops-tickets-spinner" />
              <p>Loading tickets...</p>
            </div>
          ) : (
            <>
              <div className="devops-tickets-summary">
                <span>Showing {requests.length} of {total} tickets</span>
                <span>Open a row to work the request without leaving this page.</span>
              </div>
              <div className="devops-tickets-table-card card">
                {requests.length === 0 ? (
                  <div className="devops-tickets-empty">
                    <div className="devops-tickets-empty__icon">[]</div>
                    <p>No tickets match your filters.</p>
                    <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className="devops-tickets-table-wrap">
                    <table className="devops-tickets-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Team</th>
                          <th>Env</th>
                          <th>Cloud</th>
                          <th>Service</th>
                          <th>Requester</th>
                          <th>Priority</th>
                          <th>Due</th>
                          <th>Status</th>
                          <th>PR</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.map((req) => (
                          <tr
                            key={req.id}
                            className={detailId === req.id ? 'devops-tickets-table__row--active' : ''}
                            onClick={() => loadDetail(req.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td><code className="devops-ticket-id">#{req.id}</code></td>
                            <td>{req.team}</td>
                            <td><span className="devops-ticket-env">{req.env}</span></td>
                            <td><span className={`devops-ticket-cloud devops-ticket-cloud--${(req.cloud || '').toLowerCase()}`}>{req.cloud}</span></td>
                            <td>{req.service}</td>
                            <td>{req.created_by_username || 'Not available'}</td>
                            <td><span className={`devops-ticket-priority devops-ticket-priority--${(req.priority || 'medium').toLowerCase()}`}>{req.priority || 'medium'}</span></td>
                            <td>
                              <span className="devops-ticket-due">
                                {formatDateOnly(req.due_date)}
                                {req.due_status === 'overdue' && <span className="devops-ticket-due-badge devops-ticket-due-badge--overdue">Overdue</span>}
                                {req.due_status === 'due_soon' && <span className="devops-ticket-due-badge devops-ticket-due-badge--soon">Due in 24h</span>}
                              </span>
                            </td>
                            <td><span className={`ticket-status ${getStatusBadgeClass(req.status)}`}>{formatStatus(req.status)}</span></td>
                            <td>
                              {req.pr_url ? (
                                <a
                                  href={req.pr_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="devops-ticket-pr-link"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  View PR
                                </a>
                              ) : 'Pending'}
                            </td>
                            <td className="devops-ticket-updated">{formatDateTime(req.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {requests.length > 0 && total > limit && (
                <div className="devops-tickets-pagination">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - limit))}>
                    Previous
                  </button>
                  <span className="devops-tickets-pagination-info">
                    Page {Math.floor(offset / limit) + 1} of {Math.ceil(total / limit)}
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={offset + limit >= total} onClick={() => setOffset((value) => value + limit)}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}

          {(detailId || detailLoading || detailRequest) && (
            <section ref={workspaceRef} className="portal-surface devops-approval-workspace">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Approval Workspace</span>
                  <h2 className="portal-surface__title">
                    {detailRequest ? `Ticket #${detailRequest.id}` : 'Loading ticket'}
                  </h2>
                  <p className="portal-surface__subtitle">
                    Review request context, dependency pressure, comments, and timeline without leaving the tickets queue.
                  </p>
                </div>
                <div className="portal-page__actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={refreshDetail} disabled={detailLoading}>
                    Refresh
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeDetail}>
                    Close
                  </button>
                </div>
              </div>

              {detailLoading && !detailRequest ? (
                <div className="empty-state">Loading approval workspace...</div>
              ) : (
                <>
                  {detailError && <div className="alert alert-error">{detailError}</div>}
                  {detailNotice && <div className="devops-approval-workspace__notice">{detailNotice}</div>}

                  {detailRequest && (
                    <div className="devops-approval-workspace__grid">
                      <section className="portal-surface portal-surface--tight">
                        <div className="portal-surface__header">
                          <div>
                            <span className="portal-surface__eyebrow">Request Summary</span>
                            <h3 className="portal-surface__title">Execution Context</h3>
                          </div>
                          <span className={`ticket-status ${getStatusBadgeClass(detailRequest.status)}`}>
                            {formatStatus(detailRequest.status)}
                          </span>
                        </div>
                        <div className="devops-approval-workspace__meta-grid">
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Team</span>
                            <strong>{detailRequest.team}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Environment</span>
                            <strong>{detailRequest.env}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Cloud</span>
                            <strong>{detailRequest.cloud}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Service</span>
                            <strong>{detailRequest.service}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Requester</span>
                            <strong>{detailRequest.created_by_username || 'Not available'}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Priority</span>
                            <strong>{detailRequest.priority || 'medium'}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Due date</span>
                            <strong>{formatDateOnly(detailRequest.due_date)}</strong>
                            {detailRequest.due_status && (
                              <small className={`devops-approval-workspace__due devops-approval-workspace__due--${detailRequest.due_status}`}>
                                {detailRequest.due_status === 'overdue' ? 'Overdue' : 'Due in 24h'}
                              </small>
                            )}
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Application ID</span>
                            <strong>{detailRequest.application_id || 'Not set'}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Branch</span>
                            <strong>{detailRequest.branch || 'Not set'}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">File path</span>
                            <strong>{detailRequest.file_path || 'Not set'}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Created</span>
                            <strong>{formatDateTime(detailRequest.created_at)}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Updated</span>
                            <strong>{formatDateTime(detailRequest.updated_at)}</strong>
                          </div>
                        </div>

                        <div className="devops-approval-workspace__dependency-strip">
                          <div className="devops-approval-workspace__dependency-card">
                            <span className="devops-approval-workspace__meta-label">Depends on</span>
                            <strong>{detailRequest.depends_on?.length || 0}</strong>
                            <p>{detailRequest.depends_on?.length ? detailRequest.depends_on.map((entry) => `#${entry}`).join(', ') : 'No upstream dependencies'}</p>
                          </div>
                          <div className="devops-approval-workspace__dependency-card">
                            <span className="devops-approval-workspace__meta-label">Blocking</span>
                            <strong>{detailRequest.blocked_by_with_status?.length || 0}</strong>
                            <p>
                              {detailRequest.blocked_by_with_status?.length
                                ? detailRequest.blocked_by_with_status.map((entry) => `#${entry.id} (${formatStatus(entry.status)})`).join(', ')
                                : 'No downstream dependencies'}
                            </p>
                          </div>
                        </div>

                        {detailRequest.reject_reason && (
                          <div className="devops-approval-workspace__reason">
                            <span className="devops-approval-workspace__meta-label">Reject reason</span>
                            <p>{detailRequest.reject_reason}</p>
                          </div>
                        )}

                        <details className="devops-approval-workspace__details" open>
                          <summary>Request configuration</summary>
                          <pre className="devops-approval-workspace__code">{detailRequest.config || '{}'}</pre>
                        </details>

                        {detailRequest.terraform_plan_output && (
                          <details className="devops-approval-workspace__details">
                            <summary>Terraform plan output</summary>
                            <pre className="devops-approval-workspace__code">{detailRequest.terraform_plan_output}</pre>
                          </details>
                        )}
                      </section>

                      <section className="portal-surface portal-surface--tight">
                        <div className="portal-surface__header">
                          <div>
                            <span className="portal-surface__eyebrow">Decision Panel</span>
                            <h3 className="portal-surface__title">Approval Controls</h3>
                          </div>
                          {detailRequest.pr_url ? (
                            <a href={detailRequest.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                              Open PR
                            </a>
                          ) : null}
                        </div>

                        <div className="devops-approval-workspace__decision-copy">
                          <p>
                            {canActOnDetail
                              ? 'This request is waiting for DevOps approval. Review the configuration, comments, and dependency state before deciding.'
                              : 'This request is no longer waiting on DevOps approval. Use this workspace to review context and discussion.'}
                          </p>
                        </div>

                        <label className="label" htmlFor="devops-reject-reason">Reject reason</label>
                        <textarea
                          id="devops-reject-reason"
                          className="input devops-approval-workspace__textarea"
                          rows={4}
                          value={rejectReason}
                          onChange={(event) => setRejectReason(event.target.value)}
                          placeholder="Explain why this request should not move forward"
                        />

                        <div className="devops-approval-workspace__actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => handleDecision('approve')}
                            disabled={!canActOnDetail || actioning !== null}
                          >
                            {actioning === 'approve' ? 'Approving...' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleDecision('reject')}
                            disabled={!canActOnDetail || actioning !== null}
                          >
                            {actioning === 'reject' ? 'Rejecting...' : 'Reject'}
                          </button>
                        </div>
                      </section>

                      <section className="portal-surface portal-surface--tight">
                        <div className="portal-surface__header">
                          <div>
                            <span className="portal-surface__eyebrow">Comments</span>
                            <h3 className="portal-surface__title">Request Discussion</h3>
                          </div>
                        </div>

                        {detailComments.length === 0 ? (
                          <div className="devops-approval-workspace__empty">No comments yet.</div>
                        ) : (
                          <div className="devops-approval-workspace__comment-list">
                            {detailComments.map((comment) => (
                              <article key={comment.id} className="devops-approval-workspace__comment-item">
                                <div className="devops-approval-workspace__comment-meta">
                                  <strong>{comment.username}</strong>
                                  <span>{formatDateTime(comment.created_at)}</span>
                                </div>
                                <p>{comment.body}</p>
                              </article>
                            ))}
                          </div>
                        )}

                        <div className="devops-approval-workspace__comment-form">
                          <label className="label" htmlFor="devops-comment-body">Add comment</label>
                          <textarea
                            id="devops-comment-body"
                            className="input devops-approval-workspace__textarea"
                            rows={4}
                            value={commentBody}
                            onChange={(event) => setCommentBody(event.target.value)}
                            placeholder="Add a decision note, implementation concern, or follow-up"
                          />
                          <div className="devops-approval-workspace__actions">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={submitComment}
                              disabled={!commentBody.trim() || commentSubmitting}
                            >
                              {commentSubmitting ? 'Posting...' : 'Post comment'}
                            </button>
                          </div>
                        </div>
                      </section>

                      <section className="portal-surface portal-surface--tight">
                        <div className="portal-surface__header">
                          <div>
                            <span className="portal-surface__eyebrow">Timeline</span>
                            <h3 className="portal-surface__title">Request Activity</h3>
                          </div>
                        </div>

                        {detailTimeline.length === 0 ? (
                          <div className="devops-approval-workspace__empty">No activity recorded yet.</div>
                        ) : (
                          <div className="devops-approval-workspace__timeline">
                            {detailTimeline.map((event) => (
                              <article key={`${event.kind}-${event.id}`} className="devops-approval-workspace__timeline-item">
                                <div className="devops-approval-workspace__timeline-meta">
                                  <strong>{event.username || 'System'}</strong>
                                  <span>{formatDateTime(event.created_at)}</span>
                                </div>
                                <p>{event.body || event.details || event.action}</p>
                              </article>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
