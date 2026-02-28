import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface Request {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  pr_url: string;
  application_id: string;
  updated_at: string;
  created_at?: string;
}

interface WorkloadItem {
  request: Request;
  assignee_id: number;
  assignee_username: string;
}

interface WorkloadSummaryRow {
  key: string;
  open: number;
  in_progress: number;
  completed_this_week: number;
}

interface DevopsUser {
  id: number;
  username: string;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'pending_approval', label: 'Pending approval' },
];

function normalizePriority(priority: string): 'critical' | 'high' | 'medium' | 'low' {
  const value = (priority || '').toLowerCase();
  if (value.includes('critical') || value.includes('p0')) return 'critical';
  if (value.includes('high') || value.includes('urgent') || value.includes('p1')) return 'high';
  if (value.includes('medium') || value.includes('normal') || value.includes('p2')) return 'medium';
  return 'low';
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    pending_approval: 'Pending approval',
    pending_user_manager_approval: 'Pending user manager',
    pending_devops_approval: 'Pending DevOps',
    in_progress: 'In progress',
    completed: 'Completed',
    rejected: 'Rejected',
  };
  return map[status] || status.replace(/_/g, ' ');
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'ticket-status ticket-status--success';
    case 'rejected':
      return 'ticket-status ticket-status--danger';
    case 'in_progress':
      return 'ticket-status ticket-status--info';
    case 'pending_approval':
    case 'pending_user_manager_approval':
    case 'pending_devops_approval':
      return 'ticket-status ticket-status--warning';
    default:
      return 'ticket-status ticket-status--default';
  }
}

function getPriorityClass(priority: string): string {
  return `devops-ticket-priority devops-ticket-priority--${normalizePriority(priority)}`;
}

function getCloudClass(cloud: string): string {
  const normalized = (cloud || '').toLowerCase();
  if (normalized === 'aws' || normalized === 'gcp' || normalized === 'azure') {
    return `devops-ticket-cloud devops-ticket-cloud--${normalized}`;
  }
  return 'portal-badge portal-badge--neutral';
}

export default function DevOpsWorkload() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [pendingApprovals, setPendingApprovals] = useState<Request[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [workload, setWorkload] = useState<WorkloadItem[]>([]);
  const [byTeam, setByTeam] = useState<WorkloadSummaryRow[]>([]);
  const [byPerson, setByPerson] = useState<WorkloadSummaryRow[]>([]);
  const [devopsUsers, setDevopsUsers] = useState<DevopsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);
  const [filterUserId, setFilterUserId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const userStats = useMemo(() => {
    const byUser: Record<number, { username: string; total: number; byStatus: Record<string, number> }> = {};
    workload.forEach((item) => {
      const id = item.assignee_id;
      const name = item.assignee_username;
      if (!byUser[id]) {
        byUser[id] = { username: name, total: 0, byStatus: {} };
      }
      byUser[id].total += 1;
      const status = item.request.status || 'unknown';
      byUser[id].byStatus[status] = (byUser[id].byStatus[status] || 0) + 1;
    });
    return Object.entries(byUser)
      .map(([id, data]) => ({ userId: Number(id), ...data }))
      .sort((left, right) => right.total - left.total);
  }, [workload]);

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const fetchPending = useCallback(() => {
    if (!token) return;
    setPendingLoading(true);
    fetch(`${apiUrl}/api/devops/pending-approvals`, { headers })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data?.requests) setPendingApprovals(data.requests);
      })
      .catch(() => {})
      .finally(() => setPendingLoading(false));
  }, [token, apiUrl, router]);

  const fetchWorkload = useCallback(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${apiUrl}/api/devops/workload`, { headers })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data?.workload) setWorkload(data.workload);
        if (Array.isArray(data?.by_team)) setByTeam(data.by_team);
        if (Array.isArray(data?.by_person)) setByPerson(data.by_person);
        if (data?.error) setError(data.error);
      })
      .catch(() => setError('Failed to load workload'))
      .finally(() => setLoading(false));
  }, [token, apiUrl, router]);

  const fetchDevopsUsers = useCallback(() => {
    if (!token) return;
    fetch(`${apiUrl}/api/devops/users`, { headers })
      .then((res) => {
        if (res.status === 401 || res.status === 403) return null;
        return res.json();
      })
      .then((data) => {
        if (data?.users) setDevopsUsers(data.users);
      })
      .catch(() => {});
  }, [token, apiUrl]);

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchPending();
    fetchWorkload();
    fetchDevopsUsers();
  }, [token, router, fetchPending, fetchWorkload, fetchDevopsUsers]);

  const handleApprove = (id: number) => {
    setActioningId(id);
    fetch(`${apiUrl}/api/devops/requests/${id}/approve`, { method: 'POST', headers })
      .then((res) => res.json())
      .then((data) => {
        if (data?.status === 'ok') {
          setPendingApprovals((previous) => previous.filter((request) => request.id !== id));
          fetchPending();
          fetchWorkload();
          window.dispatchEvent(new CustomEvent('devops-notifications-refresh'));
        } else {
          setError(data?.error || 'Approve failed');
        }
      })
      .catch(() => setError('Approve request failed'))
      .finally(() => setActioningId(null));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === pendingApprovals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingApprovals.map((request) => request.id)));
    }
  };

  const handleBulkApprove = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkActioning(true);
    fetch(`${apiUrl}/api/devops/requests/bulk-approve`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.status === 'ok') {
          setPendingApprovals((previous) => previous.filter((request) => !ids.includes(request.id)));
          setSelectedIds(new Set());
          fetchPending();
          fetchWorkload();
          window.dispatchEvent(new CustomEvent('devops-notifications-refresh'));
          if (data?.errors?.length) setError(data.errors.join('; '));
        } else {
          setError(data?.error || 'Bulk approve failed');
        }
      })
      .catch(() => setError('Bulk approve failed'))
      .finally(() => setBulkActioning(false));
  };

  const handleBulkReject = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkActioning(true);
    fetch(`${apiUrl}/api/devops/requests/bulk-reject`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, reason: '' }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.status === 'ok') {
          setPendingApprovals((previous) => previous.filter((request) => !ids.includes(request.id)));
          setSelectedIds(new Set());
          fetchPending();
          fetchWorkload();
          window.dispatchEvent(new CustomEvent('devops-notifications-refresh'));
          if (data?.errors?.length) setError(data.errors.join('; '));
        } else {
          setError(data?.error || 'Bulk reject failed');
        }
      })
      .catch(() => setError('Bulk reject failed'))
      .finally(() => setBulkActioning(false));
  };

  const handleReject = (id: number, reason?: string) => {
    setActioningId(id);
    fetch(`${apiUrl}/api/devops/requests/${id}/reject`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || '' }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.status === 'ok') {
          setPendingApprovals((previous) => previous.filter((request) => request.id !== id));
          fetchPending();
          fetchWorkload();
          window.dispatchEvent(new CustomEvent('devops-notifications-refresh'));
        } else {
          setError(data?.error || 'Reject failed');
        }
      })
      .catch(() => setError('Reject request failed'))
      .finally(() => setActioningId(null));
  };

  const filteredWorkload = workload.filter((item) => {
    if (filterUserId && item.assignee_id !== Number(filterUserId)) return false;
    if (filterStatus && item.request.status !== filterStatus) return false;
    return true;
  });

  return (
    <>
      <Head>
        <title>Workload - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Operations Board</span>
              <h1 className="portal-page__title">Workload and approval flow</h1>
              <p className="portal-page__subtitle">
                The existing manager workflows stay intact while the page shifts into a clearer command-center layout for approvals and delivery load.
              </p>
            </div>
          </header>

          <section className="portal-stat-grid">
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Pending approvals</span>
              <strong className="portal-stat-card__value">{pendingApprovals.length}</strong>
              <p className="portal-stat-card__copy">Requests approved by managers and waiting for DevOps sign-off.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Tracked workload</span>
              <strong className="portal-stat-card__value">{workload.length}</strong>
              <p className="portal-stat-card__copy">In-flight tickets across assigned and unassigned DevOps work.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Visible users</span>
              <strong className="portal-stat-card__value">{devopsUsers.length}</strong>
              <p className="portal-stat-card__copy">Assignable DevOps users currently returned by the backend.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Filters</span>
              <strong className="portal-stat-card__value">{filterUserId || filterStatus ? 'Active' : 'Open'}</strong>
              <p className="portal-stat-card__copy">Current filter state for reviewing the in-progress queue.</p>
            </article>
          </section>

          {(byTeam.length > 0 || byPerson.length > 0) && (
            <section className="portal-grid">
              {byTeam.length > 0 && (
                <article className="portal-surface portal-surface--table">
                  <div className="portal-surface__header" style={{ padding: '24px 24px 0' }}>
                    <div>
                      <span className="portal-surface__eyebrow">Capacity</span>
                      <h2 className="portal-surface__title">By team</h2>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>Open</th>
                          <th>In progress</th>
                          <th>Done this week</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byTeam.map((row) => (
                          <tr key={row.key}>
                            <td>{row.key}</td>
                            <td>{row.open}</td>
                            <td>{row.in_progress}</td>
                            <td>{row.completed_this_week}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}

              {byPerson.length > 0 && (
                <article className="portal-surface portal-surface--table">
                  <div className="portal-surface__header" style={{ padding: '24px 24px 0' }}>
                    <div>
                      <span className="portal-surface__eyebrow">Capacity</span>
                      <h2 className="portal-surface__title">By person</h2>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th>Open</th>
                          <th>In progress</th>
                          <th>Done this week</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byPerson.map((row) => (
                          <tr key={row.key}>
                            <td>{row.key}</td>
                            <td>{row.open}</td>
                            <td>{row.in_progress}</td>
                            <td>{row.completed_this_week}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}
            </section>
          )}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Approval queue</span>
                <h2 className="portal-surface__title">Pending your approval</h2>
                <p className="portal-surface__subtitle">
                  Requests approved by user managers and waiting for DevOps manager approval.
                </p>
              </div>
            </div>

            {selectedIds.size > 0 && (
              <div className="portal-selection-bar">
                <span className="portal-selection-bar__count">{selectedIds.size} selected</span>
                <button type="button" className="btn btn-primary btn-sm" disabled={bulkActioning} onClick={handleBulkApprove}>
                  {bulkActioning ? 'Working...' : 'Approve selected'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={bulkActioning} onClick={handleBulkReject}>
                  Reject selected
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </button>
              </div>
            )}

            {pendingLoading ? (
              <div className="portal-empty">
                <p>Loading approvals...</p>
              </div>
            ) : pendingApprovals.length === 0 ? (
              <div className="portal-empty">
                <p>No requests pending approval.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          checked={pendingApprovals.length > 0 && selectedIds.size === pendingApprovals.length}
                          onChange={selectAll}
                          title="Select all"
                        />
                      </th>
                      <th>Ticket</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Cloud</th>
                      <th>Service</th>
                      <th>Priority</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingApprovals.map((request) => (
                      <tr key={request.id}>
                        <td>
                          <input type="checkbox" checked={selectedIds.has(request.id)} onChange={() => toggleSelect(request.id)} />
                        </td>
                        <td>
                          <code>#{request.id}</code>
                        </td>
                        <td>{request.team}</td>
                        <td>{request.env}</td>
                        <td>
                          <span className={getCloudClass(request.cloud)}>{request.cloud}</span>
                        </td>
                        <td>{request.service}</td>
                        <td>
                          <span className={getPriorityClass(request.priority)}>{request.priority}</span>
                        </td>
                        <td className="devops-ticket-updated">{new Date(request.updated_at).toLocaleString()}</td>
                        <td>
                          <div className="portal-page__actions">
                            <button type="button" className="btn btn-primary btn-sm" disabled={actioningId === request.id} onClick={() => handleApprove(request.id)}>
                              {actioningId === request.id ? 'Working...' : 'Approve'}
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={actioningId === request.id} onClick={() => handleReject(request.id)}>
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="portal-grid portal-grid--wide">
            {!loading && workload.length > 0 && (
              <article className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Allocation</span>
                    <h2 className="portal-surface__title">Tickets by user</h2>
                    <p className="portal-surface__subtitle">
                      Click a user row to filter the queue by ownership and inspect status distribution.
                    </p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Total</th>
                        <th>In progress</th>
                        <th>Completed</th>
                        <th>Rejected</th>
                        <th>Other</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userStats.map(({ userId, username, total, byStatus }) => (
                        <tr
                          key={userId}
                          style={{
                            cursor: 'pointer',
                            background: filterUserId === String(userId) ? 'rgba(13, 148, 136, 0.12)' : undefined,
                          }}
                          onClick={() => setFilterUserId(filterUserId === String(userId) ? '' : String(userId))}
                        >
                          <td>{userId === 0 ? 'Unassigned' : username}</td>
                          <td>{total}</td>
                          <td>{byStatus.in_progress ?? 0}</td>
                          <td>{byStatus.completed ?? 0}</td>
                          <td>{byStatus.rejected ?? 0}</td>
                          <td style={{ color: 'var(--color-text-muted)' }}>
                            {Object.entries(byStatus)
                              .filter(([status]) => !['in_progress', 'completed', 'rejected'].includes(status))
                              .map(([status, count]) => `${status}: ${count}`)
                              .join(', ') || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            )}

            <article className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Filters</span>
                  <h2 className="portal-surface__title">Refine in-flight work</h2>
                  <p className="portal-surface__subtitle">
                    Filter by assignee or status without changing the underlying workload feature set.
                  </p>
                </div>
              </div>
              <div className="portal-stack">
                <div className="portal-toolbar__group">
                  <div className="portal-toolbar__item portal-toolbar__item--grow">
                    <label className="label" htmlFor="workload-user-filter">
                      DevOps user
                    </label>
                    <select id="workload-user-filter" className="input" value={filterUserId} onChange={(event) => setFilterUserId(event.target.value)}>
                      <option value="">All users ({workload.length})</option>
                      {workload.some((item) => item.assignee_id === 0) && (
                        <option value="0">Unassigned ({workload.filter((item) => item.assignee_id === 0).length})</option>
                      )}
                      {devopsUsers.map((user) => {
                        const count = userStats.find((stat) => stat.userId === user.id)?.total ?? 0;
                        return (
                          <option key={user.id} value={String(user.id)}>
                            {user.username} ({count})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="label" htmlFor="workload-status-filter">
                      Status
                    </label>
                    <select id="workload-status-filter" className="input" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value || 'all'} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {(filterUserId || filterStatus) && (
                  <div className="portal-form-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setFilterUserId(''); setFilterStatus(''); }}>
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </article>
          </section>

          {error && <div className="alert alert-error">{error}</div>}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Execution queue</span>
                <h2 className="portal-surface__title">All in-progress tickets</h2>
                <p className="portal-surface__subtitle">
                  Unassigned tickets stay visible until a matching DevOps user is available for the work.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="portal-empty">
                <p>Loading workload...</p>
              </div>
            ) : filteredWorkload.length === 0 ? (
              <div className="portal-empty">
                <p>{workload.length === 0 ? 'No in-progress tickets.' : 'No tickets match the selected filters.'}</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Assignee</th>
                      <th>Ticket</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Cloud</th>
                      <th>Service</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>PR</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWorkload.map((item) => (
                      <tr key={item.request.id}>
                        <td>{item.assignee_id === 0 ? 'Unassigned' : item.assignee_username}</td>
                        <td>
                          <code>#{item.request.id}</code>
                        </td>
                        <td>{item.request.team}</td>
                        <td>{item.request.env}</td>
                        <td>
                          <span className={getCloudClass(item.request.cloud)}>{item.request.cloud}</span>
                        </td>
                        <td>{item.request.service}</td>
                        <td>
                          <span className={getPriorityClass(item.request.priority)}>{item.request.priority}</span>
                        </td>
                        <td>
                          <span className={getStatusBadgeClass(item.request.status)}>{formatStatus(item.request.status)}</span>
                        </td>
                        <td>
                          {item.request.pr_url ? (
                            <a href={item.request.pr_url} target="_blank" rel="noopener noreferrer" className="devops-ticket-pr-link">
                              Open PR
                            </a>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="devops-ticket-updated">{new Date(item.request.updated_at).toLocaleString()}</td>
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
