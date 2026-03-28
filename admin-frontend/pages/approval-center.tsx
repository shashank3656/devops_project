import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../components/AdminLayout';
import { asRecord, getString } from '../lib/payload';

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface ApprovalRequest {
  id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  team: string;
  env: string;
  cloud: string;
  service: string;
  config?: string;
  status: string;
  created_at: string;
  created_by_username?: string;
}

function isAccessRequest(request: ApprovalRequest | null | undefined): boolean {
  if (!request?.config) return false;
  try {
    const parsed = JSON.parse(request.config) as { request_type?: unknown };
    return typeof parsed.request_type === 'string' && parsed.request_type.trim().toLowerCase() === 'iam';
  } catch {
    return false;
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'pending_user_manager_approval':
      return 'Pending manager';
    case 'pending_devops_approval':
      return 'Pending DevOps';
    case 'pending_approval':
      return 'Final approval';
    default:
      return status;
  }
}

export default function AdminApprovalCenter() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`${apiUrl}/api/admin/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((rawData) => {
        const data = asRecord(rawData);
        setProjects(Array.isArray(data.projects) ? (data.projects as ProjectSummary[]) : []);
      })
      .catch(() => setProjects([]));
  }, [apiUrl, token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('status', 'pending_any');
    params.set('limit', '100');
    params.set('sort_by', 'created_at');
    params.set('sort_order', 'desc');
    if (projectId) params.set('project_id', projectId);
    fetch(`${apiUrl}/api/admin/requests?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((rawData) => {
        const data = asRecord(rawData);
        if (Array.isArray(data.requests)) setRequests(data.requests as ApprovalRequest[]);
        else setRequests([]);
        const nextError = getString(data.error);
        if (nextError) setError(nextError);
      })
      .catch(() => setError('Failed to load approval queue'))
      .finally(() => setLoading(false));
  }, [apiUrl, token, projectId]);

  const summary = useMemo(() => ({
    total: requests.length,
    manager: requests.filter((request) => request.status === 'pending_user_manager_approval').length,
    devops: requests.filter((request) => request.status === 'pending_devops_approval').length,
    final: requests.filter((request) => request.status === 'pending_approval').length,
  }), [requests]);

  return (
    <>
      <Head>
        <title>Approval Center - SetuOps Governance</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Approval Center</span>
              <h1 className="portal-page__title">Approval Center</h1>
              <p className="portal-page__subtitle">
                Review every request that is waiting on manager, DevOps, or final approval with clear project context first.
              </p>
            </div>
          </header>

          <section className="portal-stat-grid">
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Pending approvals</span>
              <strong className="portal-stat-card__value">{summary.total}</strong>
              <p className="portal-stat-card__copy">All currently open approval gates.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Manager stage</span>
              <strong className="portal-stat-card__value">{summary.manager}</strong>
              <p className="portal-stat-card__copy">Requests waiting on user-manager review.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">DevOps stage</span>
              <strong className="portal-stat-card__value">{summary.devops}</strong>
              <p className="portal-stat-card__copy">Requests waiting on DevOps review.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Final stage</span>
              <strong className="portal-stat-card__value">{summary.final}</strong>
              <p className="portal-stat-card__copy">Requests at the last approval handoff.</p>
            </article>
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Filters</span>
                <h2 className="portal-surface__title">Project scope</h2>
              </div>
            </div>
            <div className="portal-toolbar">
              <div className="portal-toolbar__group">
                <div className="portal-toolbar__item">
                  <label className="label">Project</label>
                  <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
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

          {error ? <div className="alert alert-error">{error}</div> : null}

          <section className="portal-surface portal-surface--table">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Queue</span>
                <h2 className="portal-surface__title">Pending requests</h2>
                <p className="portal-surface__subtitle">Open any request directly in the admin Requests workspace.</p>
              </div>
            </div>
            {loading ? (
              <div className="portal-empty"><p>Loading approval queue...</p></div>
            ) : requests.length === 0 ? (
              <div className="portal-empty"><p>No pending approvals in this scope.</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Project</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Cloud / Target</th>
                      <th>Stage</th>
                      <th>Requester</th>
                      <th>Created</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((request) => {
                      const href = `/requests?id=${request.id}${request.project_id ? `&project_id=${request.project_id}` : ''}`;
                      return (
                        <tr key={request.id}>
                          <td>#{request.id}</td>
                          <td>
                            {request.project_name ? (
                              <div>
                                <strong>{request.project_name}</strong>
                                {request.project_code ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{request.project_code}</div> : null}
                              </div>
                            ) : (
                              'Unscoped'
                            )}
                          </td>
                          <td>{request.team}</td>
                          <td>{request.env}</td>
                          <td>
                            <div>{request.cloud} / {request.service}</div>
                            {isAccessRequest(request) ? (
                              <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Access request</div>
                            ) : null}
                          </td>
                          <td>{formatStatus(request.status)}</td>
                          <td>{request.created_by_username || '-'}</td>
                          <td>{new Date(request.created_at).toLocaleString()}</td>
                          <td>
                            <Link href={href} className="btn btn-secondary btn-sm">
                              Open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </AdminLayout>
    </>
  );
}
