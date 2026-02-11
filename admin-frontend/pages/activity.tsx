import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '../components/AdminLayout';

interface AuditEntry {
  id: number;
  admin_user_id: number | null;
  admin_username?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string;
  created_at: string;
}

interface UserActivityEntry {
  id: number;
  user_id: number | null;
  username: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string;
  created_at: string;
}

export default function ActivityPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [userEntries, setUserEntries] = useState<UserActivityEntry[]>([]);
  const [tab, setTab] = useState<'audit' | 'user'>('audit');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 30;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    if (tab === 'audit') {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (actionFilter) params.set('action', actionFilter);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      fetch(`${apiUrl}/api/admin/audit-log?${params}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => {
          if (res.status === 401 || res.status === 403) router.replace('/login');
          return res.json();
        })
        .then((data) => {
          if (data.error) {
            setError(data.error);
            setEntries([]);
          } else if (data.status === 'ok' || Array.isArray(data.entries)) {
            setEntries(Array.isArray(data.entries) ? data.entries : []);
            setError('');
          } else {
            setError('Failed to load audit log');
            setEntries([]);
          }
        })
        .catch(() => {
          setError('Failed to load audit log');
          setEntries([]);
        })
        .finally(() => setLoading(false));
    } else {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      fetch(`${apiUrl}/api/admin/user-activity?${params}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => {
          if (res.status === 401 || res.status === 403) router.replace('/login');
          return res.json();
        })
        .then((data) => {
          if (data.status === 'ok' || Array.isArray(data.entries)) {
            setUserEntries(Array.isArray(data.entries) ? data.entries : []);
            setError('');
          } else {
            setUserEntries([]);
            setError('');
          }
        })
        .catch(() => {
          setUserEntries([]);
          setError('');
        })
        .finally(() => setLoading(false));
    }
  }, [token, router, offset, actionFilter, fromDate, toDate, tab]);

  const userActionLabel = (a: string) => {
    const labels: Record<string, string> = {
      request_create: 'Created request',
      request_submit: 'Submitted draft',
      request_comment: 'Added comment',
      request_resubmit: 'Resubmitted request',
      request_approved_by_manager: 'Manager approved',
      request_cancel: 'Cancelled request',
    };
    return labels[a] || a;
  };

  const actionLabel = (a: string) => {
    const labels: Record<string, string> = {
      user_create: 'User created',
      user_update: 'User updated',
      user_delete: 'User deleted',
      team_create: 'Team created',
      team_member_add: 'Member added to team',
      team_member_remove: 'Member removed from team',
      team_member_role_update: 'Member role updated',
      request_approve: 'Request approved',
      request_reject: 'Request rejected',
      db_query: 'DB query executed',
      db_query_approve: 'DB query approved',
      db_query_reject: 'DB query rejected',
      db_connection_create: 'DB connection created',
      db_connection_update: 'DB connection updated',
      db_connection_delete: 'DB connection deleted',
    };
    return labels[a] || a;
  };

  return (
    <>
      <Head>
        <title>Activity - InfraGate Admin</title>
      </Head>
      <AdminLayout>
        <div className="container" style={{ maxWidth: 1000 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>Activity</h1>
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button
              type="button"
              className={`btn ${tab === 'audit' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('audit')}
            >
              Admin audit log
            </button>
            <button
              type="button"
              className={`btn ${tab === 'user' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('user')}
            >
              User activity
            </button>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">{error}</div>
          )}

          {tab === 'audit' && (
          <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <label style={{ fontWeight: 500 }}>Action</label>
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
              className="input"
              style={{ minWidth: 180 }}
            >
              <option value="">All actions</option>
              <option value="user_create">User created</option>
              <option value="user_update">User updated</option>
              <option value="user_delete">User deleted</option>
              <option value="team_create">Team created</option>
              <option value="team_member_add">Member added</option>
              <option value="team_member_remove">Member removed</option>
              <option value="team_member_role_update">Member role updated</option>
              <option value="request_approve">Request approved</option>
              <option value="request_reject">Request rejected</option>
            </select>
            <label style={{ fontWeight: 500, marginLeft: 8 }}>From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setOffset(0); }}
              className="input"
              style={{ width: 140 }}
            />
            <label style={{ fontWeight: 500 }}>To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setOffset(0); }}
              className="input"
              style={{ width: 140 }}
            />
          </div>
          )}

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : tab === 'audit' ? (
              entries.length === 0 ? (
              <div className="empty-state">No audit entries found.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Admin</th>
                      <th>Action</th>
                      <th>Resource</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td style={{ fontSize: 13 }}>{e.admin_username || (e.admin_user_id ? `User #${e.admin_user_id}` : '—')}</td>
                        <td>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: e.action.includes('reject') ? 'var(--color-danger-bg)' :
                              e.action.includes('approve') ? 'var(--color-success-bg)' :
                              'var(--color-bg)',
                            color: e.action.includes('reject') ? 'var(--color-danger)' :
                              e.action.includes('approve') ? 'var(--color-success)' : 'var(--color-text)',
                          }}>
                            {actionLabel(e.action)}
                          </span>
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {e.resource_type} {e.resource_id && `#${e.resource_id}`}
                        </td>
                        <td style={{ fontSize: 13, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.details}>
                          {e.details || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )) : userEntries.length === 0 ? (
              <div className="empty-state">No user activity yet.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Resource</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userEntries.map((e) => (
                      <tr key={e.id}>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td>{e.username || `User #${e.user_id}`}</td>
                        <td>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: 'var(--color-bg)',
                            color: 'var(--color-text)',
                          }}>
                            {userActionLabel(e.action)}
                          </span>
                        </td>
                        <td style={{ fontSize: 13 }}>{e.resource_type} {e.resource_id && `#${e.resource_id}`}</td>
                        <td style={{ fontSize: 13, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.details}>
                          {e.details || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && ((tab === 'audit' && entries.length >= limit) || (tab === 'user' && userEntries.length >= limit)) && (
              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setOffset((o) => o + limit)}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
