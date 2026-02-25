import { useEffect, useState } from 'react';
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
    pending_user_manager_approval: 'Pending user mgr',
    pending_devops_approval: 'Pending DevOps',
    in_progress: 'In progress',
    completed: 'Completed',
    rejected: 'Rejected',
  };
  return map[status] || status;
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
  const limit = 20;

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;

  const hasActiveFilters = idFilter || team || cloud || status || search || requester || atRisk;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
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
  }, [token, router, apiUrl, idFilter, team, cloud, status, search, requester, sortBy, sortOrder, atRisk, offset]);

  useEffect(() => {
    setRecentIds(getRecentRequestIds());
  }, []);
  useEffect(() => {
    if (requests.length === 1 && idFilter.trim()) {
      const id = parseInt(idFilter.trim(), 10);
      if (!isNaN(id) && requests[0].id === id) addRecentRequestId(id);
    }
  }, [requests, idFilter]);

  const goToRecent = (id: number) => {
    setIdFilter(String(id));
    setTeam('');
    setCloud('');
    setStatus('');
    setSearch('');
    setRequester('');
    setAtRisk(false);
    setOffset(0);
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
        <title>All tickets - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="devops-tickets-page">
          <div className="devops-tickets-header">
            <div>
              <h1 className="devops-tickets-title">All tickets</h1>
              {recentIds.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Recent:</span>
                  {recentIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: 13 }}
                      onClick={() => goToRecent(id)}
                      title={`Filter by ticket #${id}`}
                    >
                      #{id}
                    </button>
                  ))}
                </div>
              )}
              <p className="devops-tickets-subtitle">
                Search and filter by ticket #, team, cloud, status, or requester. Sort by created, updated, priority, or due date.
              </p>
            </div>
          </div>

          {/* Filter card */}
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
                    {CLOUDS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="input devops-tickets-filter-input">
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="devops-tickets-filter-group">
                  <label className="devops-tickets-filter-label">Requester</label>
                  <input
                    type="text"
                    placeholder="Username or ID"
                    value={requester}
                    onChange={(e) => setRequester(e.target.value)}
                    className="input devops-tickets-filter-input"
                  />
                </div>
                <div className="devops-tickets-filter-group devops-tickets-filter-group--wide">
                  <label className="devops-tickets-filter-label">Search</label>
                  <input
                    type="text"
                    placeholder="Search across fields..."
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

          {/* Results */}
          {loading ? (
            <div className="devops-tickets-loading">
              <div className="devops-tickets-spinner" />
              <p>Loading tickets…</p>
            </div>
          ) : (
            <>
              <div className="devops-tickets-summary">
                <span>Showing {requests.length} of {total} tickets</span>
              </div>
              <div className="devops-tickets-table-card card">
                {requests.length === 0 ? (
                  <div className="devops-tickets-empty">
                    <div className="devops-tickets-empty__icon">📋</div>
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
                          <tr key={req.id} onClick={() => { addRecentRequestId(req.id); setRecentIds(getRecentRequestIds()); }} style={{ cursor: 'pointer' }}>
                            <td><code className="devops-ticket-id">#{req.id}</code></td>
                            <td>{req.team}</td>
                            <td><span className="devops-ticket-env">{req.env}</span></td>
                            <td><span className={`devops-ticket-cloud devops-ticket-cloud--${(req.cloud || '').toLowerCase()}`}>{req.cloud}</span></td>
                            <td>{req.service}</td>
                            <td>{req.created_by_username || '—'}</td>
                            <td><span className={`devops-ticket-priority devops-ticket-priority--${(req.priority || 'medium').toLowerCase()}`}>{req.priority}</span></td>
                            <td>
                              <span className="devops-ticket-due">
                                {req.due_date ? new Date(req.due_date).toLocaleDateString() : '—'}
                                {req.due_status === 'overdue' && <span className="devops-ticket-due-badge devops-ticket-due-badge--overdue">Overdue</span>}
                                {req.due_status === 'due_soon' && <span className="devops-ticket-due-badge devops-ticket-due-badge--soon">Due in 24h</span>}
                              </span>
                            </td>
                            <td><span className={`ticket-status ${getStatusBadgeClass(req.status)}`}>{formatStatus(req.status)}</span></td>
                            <td>{req.pr_url ? <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="devops-ticket-pr-link">View PR</a> : '—'}</td>
                            <td className="devops-ticket-updated">{new Date(req.updated_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {requests.length > 0 && total > limit && (
                <div className="devops-tickets-pagination">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
                    Previous
                  </button>
                  <span className="devops-tickets-pagination-info">
                    Page {Math.floor(offset / limit) + 1} of {Math.ceil(total / limit)}
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={offset + limit >= total} onClick={() => setOffset((o) => o + limit)}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
