import { useEffect, useMemo, useState } from 'react';
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

interface ApprovalRequest {
  id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  due_status?: '' | 'overdue' | 'due_soon';
  created_at: string;
  created_by_username?: string;
}

export default function DevOpsApprovalCenter() {
  const apiUrl = useApiUrl();
  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } })
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
    params.set('status', 'pending_devops_approval');
    params.set('limit', '100');
    params.set('sort_by', 'created_at');
    params.set('sort_order', 'desc');
    if (projectId) params.set('project_id', projectId);
    fetch(`${apiUrl}/api/devops/requests?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((rawData) => {
        const data = asRecord(rawData);
        setRequests(Array.isArray(data.requests) ? (data.requests as ApprovalRequest[]) : []);
        const nextError = getString(data.error);
        if (nextError) setError(nextError);
      })
      .catch(() => setError('Failed to load approval queue'))
      .finally(() => setLoading(false));
  }, [apiUrl, token, projectId]);

  const summary = useMemo(() => ({
    total: requests.length,
    overdue: requests.filter((request) => request.due_status === 'overdue').length,
    dueSoon: requests.filter((request) => request.due_status === 'due_soon').length,
  }), [requests]);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === projectId) || null,
    [projects, projectId],
  );

  return (
    <>
      <Head>
        <title>Approval Center - SetuOps DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Approval Center</span>
              <h1 className="portal-page__title">Approval Center</h1>
              <p className="portal-page__subtitle">
                Review every request that is currently waiting on the DevOps gate with project context before opening the full ticket workspace.
              </p>
            </div>
            <div className="portal-page__actions">
              {projectId ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setProjectId('');
                  }}
                >
                  Clear scope
                </button>
              ) : null}
            </div>
          </header>

          <section className="portal-surface portal-surface--tight">
            <div className="portal-toolbar">
              <div className="portal-toolbar__group">
                <div className="portal-toolbar__item">
                  <label className="label" htmlFor="approval-center-project-filter">Project</label>
                  <select
                    id="approval-center-project-filter"
                    className="input"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}{project.code ? ` (${project.code})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="portal-pill-row">
                <span className="portal-pill">Pending {summary.total}</span>
                <span className="portal-pill">Overdue {summary.overdue}</span>
                <span className="portal-pill">Due soon {summary.dueSoon}</span>
              </div>
            </div>
          </section>

          {error ? <div className="alert alert-error">{error}</div> : null}
          {projectId ? (
            <div className="alert alert-info">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>
                  Showing approvals for{' '}
                  <strong>
                    {selectedProject ? `${selectedProject.name}${selectedProject.code ? ` (${selectedProject.code})` : ''}` : `project #${projectId}`}
                  </strong>.
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setProjectId('');
                  }}
                >
                  Clear filter
                </button>
              </div>
            </div>
          ) : null}

          <section className="portal-surface portal-surface--table">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Queue</span>
                <h2 className="portal-surface__title">Requests waiting on DevOps</h2>
                <p className="portal-surface__subtitle">
                  Open the full ticket workspace directly from here{selectedProject ? `, scoped to ${selectedProject.name}` : ''}.
                </p>
              </div>
            </div>
            {loading ? (
              <div className="portal-empty"><p>Loading approval queue...</p></div>
            ) : requests.length === 0 ? (
              <div className="portal-empty"><p>No DevOps approvals in this scope.</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Project</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Cloud / Service</th>
                      <th>Requester</th>
                      <th>Created</th>
                      <th>Due status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((request) => {
                      const href = `/tickets?id=${request.id}${request.project_id ? `&project_id=${request.project_id}` : ''}`;
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
                          <td>{request.cloud} / {request.service}</td>
                          <td>{request.created_by_username || '-'}</td>
                          <td>{new Date(request.created_at).toLocaleString()}</td>
                          <td>{request.due_status ? (request.due_status === 'overdue' ? 'Overdue' : 'Due soon') : 'On track'}</td>
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
      </DevOpsLayout>
    </>
  );
}
