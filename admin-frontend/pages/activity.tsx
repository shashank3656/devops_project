import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '../components/AdminLayout';
import CalendarDateInput from '../components/CalendarDateInput';

interface AuditEntry {
  id: number;
  admin_user_id: number | null;
  admin_username?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
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
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  created_at: string;
}

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

export default function ActivityPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [userEntries, setUserEntries] = useState<UserActivityEntry[]>([]);
  const [tab, setTab] = useState<'audit' | 'user'>('audit');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
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
      if (projectId) params.set('project_id', projectId);
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
      if (projectId) params.set('project_id', projectId);
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
  }, [token, router, offset, actionFilter, projectId, fromDate, toDate, tab]);

  useEffect(() => {
    if (!token) return;
    fetch(`${apiUrl}/api/admin/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProjects(Array.isArray(data?.projects) ? data.projects : []))
      .catch(() => setProjects([]));
  }, [apiUrl, token]);

  const userActionLabel = (a: string) => {
    const labels: Record<string, string> = {
      request_create: 'Created request',
      request_submit: 'Submitted draft',
      request_comment: 'Added comment',
      request_resubmit: 'Resubmitted request',
      request_clone: 'Cloned request',
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
      project_create: 'Project created',
      project_update: 'Project updated',
      request_approve: 'Request approved',
      request_reject: 'Request rejected',
      request_plan_output: 'Terraform output updated',
    };
    return labels[a] || a;
  };

  return (
    <>
      <Head>
        <title>Activity - SetuOps Governance</title>
      </Head>
      <AdminLayout>
        <div className="portal-page portal-page--narrow">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Activity</span>
              <h1 className="portal-page__title">Activity Log</h1>
              <p className="portal-page__subtitle">
                Switch between admin audit records and end-user activity to understand who changed what and when.
              </p>
            </div>
          </div>

          <div className="portal-page__actions">
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
            <div className="portal-surface">
              <div className="portal-page__actions" style={{ justifyContent: 'space-between' }}>
                <div className="portal-page__actions">
                  <label className="label" htmlFor="activity-action-filter">Action</label>
                  <select
                    id="activity-action-filter"
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
                    <option value="project_create">Project created</option>
                    <option value="project_update">Project updated</option>
                    <option value="request_approve">Request approved</option>
                    <option value="request_reject">Request rejected</option>
                  </select>
                  <label className="label" htmlFor="activity-project-filter">Project</label>
                  <select
                    id="activity-project-filter"
                    value={projectId}
                    onChange={(e) => { setProjectId(e.target.value); setOffset(0); }}
                    className="input"
                    style={{ minWidth: 200 }}
                  >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                    ))}
                  </select>
                  <label className="label" htmlFor="activity-from-date">From</label>
                  <div style={{ width: 180 }}>
                    <CalendarDateInput
                      id="activity-from-date"
                      value={fromDate}
                      onChange={(value) => { setFromDate(value); setOffset(0); }}
                    />
                  </div>
                  <label className="label" htmlFor="activity-to-date">To</label>
                  <div style={{ width: 180 }}>
                    <CalendarDateInput
                      id="activity-to-date"
                      value={toDate}
                      onChange={(value) => { setToDate(value); setOffset(0); }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const params = new URLSearchParams({ format: 'csv', limit: '10000' });
                    if (actionFilter) params.set('action', actionFilter);
                    if (projectId) params.set('project_id', projectId);
                    if (fromDate) params.set('from', fromDate);
                    if (toDate) params.set('to', toDate);
                    fetch(`${apiUrl}/api/admin/audit-log?${params}`, { headers: { Authorization: `Bearer ${token}` } })
                      .then((res) => res.text())
                      .then((csv) => {
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      })
                      .catch(() => {});
                  }}
                >
                  Export CSV
                </button>
              </div>
            </div>
          )}

          {tab === 'user' && (
            <div className="portal-surface">
              <div className="portal-page__actions">
                <label className="label">Project</label>
                <select
                  value={projectId}
                  onChange={(e) => { setProjectId(e.target.value); setOffset(0); }}
                  className="input"
                  style={{ minWidth: 200 }}
                >
                  <option value="">All projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="portal-surface portal-surface--table">
            {loading ? (
              <div className="empty-state" style={{ padding: 24 }}>Loading...</div>
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
                      <th>Project</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td style={{ fontSize: 13 }}>{e.admin_username || (e.admin_user_id ? `User #${e.admin_user_id}` : '-')}</td>
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
                        <td style={{ fontSize: 13 }}>
                          {e.project_name ? (
                            <>
                              <strong>{e.project_name}</strong>
                              {e.project_code ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{e.project_code}</div> : null}
                            </>
                          ) : '-'}
                        </td>
                        <td style={{ fontSize: 13, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.details}>
                          {e.details || '-'}
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
                      <th>Project</th>
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
                        <td style={{ fontSize: 13 }}>
                          {e.project_name ? (
                            <>
                              <strong>{e.project_name}</strong>
                              {e.project_code ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{e.project_code}</div> : null}
                            </>
                          ) : '-'}
                        </td>
                        <td style={{ fontSize: 13, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.details}>
                          {e.details || '-'}
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
