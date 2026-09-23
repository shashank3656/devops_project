import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { DataTable, formatRelativeTime, type DataTableColumn } from '@infragate/ui';
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

function requestHref(request: ApprovalRequest): string {
  return `/requests?id=${request.id}${request.project_id ? `&project_id=${request.project_id}` : ''}`;
}

const approvalColumns: DataTableColumn<ApprovalRequest>[] = [
  {
    id: 'request',
    header: 'Request',
    cell: (request) => (
      <div className="ig-cell-stack">
        <span className="ig-cell-title">
          <span className="ig-mono">#{request.id}</span> {request.service}
        </span>
        <span className="ig-cell-meta">
          {isAccessRequest(request) ? 'Access request · ' : ''}
          {request.created_by_username || 'Unknown requester'}
        </span>
      </div>
    ),
  },
  {
    id: 'project',
    header: 'Project',
    cell: (request) => (
      <div className="ig-cell-stack">
        <span>{request.project_name || 'Unscoped'}</span>
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
    id: 'stage',
    header: 'Stage',
    cell: (request) => <span className="ig-chip ig-chip--info">{formatStatus(request.status)}</span>,
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
      <Link href={requestHref(request)} className="btn btn-secondary btn-sm">
        Open
      </Link>
    ),
  },
];

export default function AdminApprovalCenter() {
  const router = useRouter();
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
  const activeFilterCount = projectId ? 1 : 0;

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

          <section className="approval-summary-strip">
            <div className="approval-summary-pill">
              <span className="approval-summary-pill__label">Pending approvals</span>
              <strong className="approval-summary-pill__value">{summary.total}</strong>
            </div>
            <div className="approval-summary-pill">
              <span className="approval-summary-pill__label">Manager stage</span>
              <strong className="approval-summary-pill__value">{summary.manager}</strong>
            </div>
            <div className="approval-summary-pill">
              <span className="approval-summary-pill__label">DevOps stage</span>
              <strong className="approval-summary-pill__value">{summary.devops}</strong>
            </div>
            <div className="approval-summary-pill">
              <span className="approval-summary-pill__label">Final stage</span>
              <strong className="approval-summary-pill__value">{summary.final}</strong>
            </div>
          </section>

          <section className="portal-surface approval-filter-surface">
            <div className="admin-request-filter admin-request-filter--compact">
              <div className="admin-request-filter__bar">
                <label className="admin-request-filter__pill">
                  <span className="admin-request-filter__key">Project</span>
                  <select className="admin-request-filter__control" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}{project.code ? ` (${project.code})` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="admin-request-filter__actions">
                  {activeFilterCount > 0 ? <span className="filters-bar__badge">{activeFilterCount} active</span> : null}
                  {projectId ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProjectId('')}>
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="admin-request-filter__footer">
                <div className="admin-request-filter__footer-meta">
                  <span className="admin-request-filter__hint">Use project scope only when you want to review one project at a time.</span>
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
            <DataTable<ApprovalRequest>
              label="Pending approvals"
              columns={approvalColumns}
              rows={requests}
              rowKey={(request) => request.id}
              loading={loading}
              skeletonRows={6}
              onRowOpen={(request) => router.push(requestHref(request))}
              empty={
                <div className="ig-table-empty">
                  <strong>Nothing waiting on approval</strong>
                  <p>{projectId ? 'No pending approvals in this project.' : 'Every request in scope has been decided.'}</p>
                </div>
              }
            />
          </section>
        </div>
      </AdminLayout>
    </>
  );
}
