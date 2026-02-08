import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

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
  const limit = 20;

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;

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

  return (
    <>
      <Head>
        <title>All tickets - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container">
          <h1 className="page-title">All tickets</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Search and filter by ticket #, team, cloud, status, requester. Sort by created, updated, priority, or due date. Use &quot;At risk&quot; for overdue or due in 24h.
          </p>
          <div className="card" style={{ padding: 16, marginBottom: 24 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <input type="text" placeholder="Ticket #" value={idFilter} onChange={(e) => setIdFilter(e.target.value)} style={{ width: 90 }} className="input" />
              <input type="text" placeholder="Team" value={team} onChange={(e) => setTeam(e.target.value)} className="input" style={{ minWidth: 100 }} />
              <input type="text" placeholder="Cloud" value={cloud} onChange={(e) => setCloud(e.target.value)} className="input" style={{ minWidth: 80 }} />
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="input" style={{ minWidth: 160 }}>
                <option value="">All statuses</option>
                <option value="pending_approval">Pending approval</option>
                <option value="pending_user_manager_approval">Pending user manager</option>
                <option value="pending_devops_approval">Pending DevOps approval</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
              </select>
              <input type="text" placeholder="Requester ID" value={requester} onChange={(e) => setRequester(e.target.value)} className="input" style={{ width: 100 }} />
              <input type="text" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="input" style={{ minWidth: 120 }} />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="input">
                <option value="created_at">Sort: Created</option>
                <option value="updated_at">Sort: Updated</option>
                <option value="priority">Sort: Priority</option>
                <option value="due_date">Sort: Due date</option>
              </select>
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input">
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={atRisk} onChange={(e) => setAtRisk(e.target.checked)} />
                At risk
              </label>
            </div>
          </div>
          {loading ? (
            <p className="loading-text">Loading…</p>
          ) : (
            <>
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 12 }}>Showing {requests.length} of {total}</p>
              <div className="card">
                <div className="table-wrap">
                  <table>
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
                        <tr key={req.id}>
                          <td><code>#{req.id}</code></td>
                          <td>{req.team}</td>
                          <td>{req.env}</td>
                          <td>{req.cloud}</td>
                          <td>{req.service}</td>
                          <td>{req.created_by_username || '—'}</td>
                          <td>{req.priority}</td>
                          <td style={{ fontSize: 13 }}>
                            {req.due_date ? new Date(req.due_date).toLocaleDateString() : '—'}
                            {req.due_status === 'overdue' && <span style={{ marginLeft: 6, padding: '2px 6px', borderRadius: 4, fontSize: 11, background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>Overdue</span>}
                            {req.due_status === 'due_soon' && <span style={{ marginLeft: 6, padding: '2px 6px', borderRadius: 4, fontSize: 11, background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>Due in 24h</span>}
                          </td>
                          <td>{req.status}</td>
                          <td>{req.pr_url ? <a href={req.pr_url} target="_blank" rel="noopener noreferrer">PR</a> : '—'}</td>
                          <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(req.updated_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <button type="button" className="btn btn-secondary" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>Previous</button>
                <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>Page {Math.floor(offset / limit) + 1}</span>
                <button type="button" className="btn btn-secondary" disabled={offset + limit >= total} onClick={() => setOffset((o) => o + limit)}>Next</button>
              </div>
            </>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
