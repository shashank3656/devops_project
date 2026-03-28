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
  const activeFilterCount = projectId ? 1 : 0;

  return (
    <>
      <Head>
        <title>Approval Center - SetuOps DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Review Queue</span>
              <h1 className="portal-page__title">Requests waiting for review</h1>
              <p className="portal-page__subtitle">
                Open requests that are waiting for platform review and check the project before you act.
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
                  Clear project
                </button>
              ) : null}
            </div>
          </header>

          <section className="devops-approval-strip">
            <div className="devops-approval-pill">
              <span className="devops-approval-pill__label">Pending</span>
              <strong className="devops-approval-pill__value">{summary.total}</strong>
            </div>
            <div className="devops-approval-pill">
              <span className="devops-approval-pill__label">Overdue</span>
              <strong className="devops-approval-pill__value">{summary.overdue}</strong>
            </div>
            <div className="devops-approval-pill">
              <span className="devops-approval-pill__label">Due soon</span>
              <strong className="devops-approval-pill__value">{summary.dueSoon}</strong>
            </div>
          </section>

          <section className="portal-surface portal-surface--tight devops-approval-filter-surface">
            <div className="devops-approval-filter-bar">
              <div className="devops-approval-filter-bar__copy">
                <span className="portal-surface__eyebrow">Scope</span>
                <h2 className="portal-surface__title">Filter the review queue</h2>
                <p className="portal-surface__subtitle">Use project scope only when you want to focus on one project at a time.</p>
              </div>
              <div className="devops-approval-filter-bar__controls">
                {activeFilterCount > 0 ? <span className="devops-approval-filter-bar__badge">{activeFilterCount} active</span> : null}
                <select
                  id="approval-center-project-filter"
                  className="input devops-approval-filter-bar__select"
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
                {projectId ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setProjectId('');
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {error ? <div className="alert alert-error">{error}</div> : null}
          {projectId ? (
            <div className="alert alert-info">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>
                  Showing requests for{' '}
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
                <h2 className="portal-surface__title">Requests waiting for platform review</h2>
                <p className="portal-surface__subtitle">
                  Open request details from here{selectedProject ? `, filtered to ${selectedProject.name}` : ''}.
                </p>
              </div>
            </div>
            {loading ? (
              <div className="portal-empty"><p>Loading requests...</p></div>
            ) : requests.length === 0 ? (
              <div className="portal-empty"><p>No requests are waiting in this view.</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Request #</th>
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
                              'No project'
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
                              View details
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
