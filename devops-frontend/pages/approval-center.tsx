import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { DataTable, formatRelativeTime, type DataTableColumn } from '@infragate/ui';
import ApprovalsSectionNav from '../components/ApprovalsSectionNav';
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

function ticketHref(request: ApprovalRequest): string {
  return `/tickets?id=${request.id}${request.project_id ? `&project_id=${request.project_id}` : ''}`;
}

const DUE_CHIPS: Record<string, { tone: string; label: string }> = {
  overdue: { tone: 'danger', label: 'Overdue' },
  due_soon: { tone: 'medium', label: 'Due soon' },
};

const reviewColumns: DataTableColumn<ApprovalRequest>[] = [
  {
    id: 'request',
    header: 'Request',
    cell: (request) => (
      <div className="ig-cell-stack">
        <span className="ig-cell-title">
          <span className="ig-mono">#{request.id}</span> {request.service}
        </span>
        <span className="ig-cell-meta">{request.created_by_username || 'Unknown requester'}</span>
      </div>
    ),
  },
  {
    id: 'project',
    header: 'Project',
    cell: (request) => (
      <div className="ig-cell-stack">
        <span>{request.project_name || 'No project'}</span>
        <span className="ig-cell-meta">{[request.project_code, request.team].filter(Boolean).join(' · ')}</span>
      </div>
    ),
  },
  {
    id: 'target',
    header: 'Target',
    cell: (request) => (
      <span className="ig-cell-chips">
        <span className="ig-chip">{request.env}</span>
        <span className="ig-chip ig-chip--muted">{request.cloud}</span>
      </span>
    ),
  },
  {
    id: 'due',
    header: 'Due',
    cell: (request) => {
      const due = request.due_status ? DUE_CHIPS[request.due_status] : undefined;
      return due ? <span className={`ig-chip ig-chip--${due.tone}`}>{due.label}</span> : <span className="ig-cell-meta">On track</span>;
    },
  },
  {
    id: 'created_at',
    header: 'Created',
    cell: (request) => (
      <span className="ig-cell-meta" title={new Date(request.created_at).toLocaleString()}>
        {formatRelativeTime(request.created_at)}
      </span>
    ),
  },
  {
    id: 'open',
    header: <span className="ig-sr-only">Open</span>,
    align: 'right',
    cell: (request) => (
      <Link href={ticketHref(request)} className="btn btn-secondary btn-sm">
        Review
      </Link>
    ),
  },
];

export default function DevOpsApprovalCenter() {
  const router = useRouter();
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
    const fromQuery = typeof router.query.project_id === 'string' ? router.query.project_id : '';
    setProjectId(fromQuery);
  }, [router.query.project_id]);

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

          <ApprovalsSectionNav />

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
            <div className="devops-filter-ribbon devops-filter-ribbon--compact">
              <div className="devops-filter-ribbon__bar">
                <label className="devops-filter-ribbon__pill">
                  <span className="devops-filter-ribbon__key">Project</span>
                  <select
                    id="approval-center-project-filter"
                    className="devops-filter-ribbon__control"
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
                </label>
                <div className="devops-filter-ribbon__actions">
                  {activeFilterCount > 0 ? <span className="devops-filter-ribbon__badge">{activeFilterCount} active</span> : null}
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
              <div className="devops-filter-ribbon__footer">
                <span className="devops-filter-ribbon__hint">Use project scope only when you want to focus on one project at a time.</span>
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
            <DataTable<ApprovalRequest>
              label="Requests waiting for platform review"
              columns={reviewColumns}
              rows={requests}
              rowKey={(request) => request.id}
              loading={loading}
              skeletonRows={6}
              onRowOpen={(request) => router.push(ticketHref(request))}
              rowClassName={(request) => (request.due_status === 'overdue' ? 'is-overdue' : undefined)}
              empty={
                <div className="ig-table-empty">
                  <strong>Queue is clear</strong>
                  <p>No requests are waiting for platform review{selectedProject ? ` in ${selectedProject.name}` : ''}.</p>
                </div>
              }
            />
          </section>

        </div>
      </DevOpsLayout>
    </>
  );
}
