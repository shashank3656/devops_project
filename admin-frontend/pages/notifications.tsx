import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../components/AdminLayout';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

interface NotificationItem {
  id: string;
  kind: 'pending_request' | 'project_event';
  title: string;
  message: string;
  created_at: string;
  request_id?: number | null;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  status?: string;
  action?: string;
}

interface CountsByKind {
  all: number;
  pending_request: number;
  project_event: number;
}

const PAGE_SIZE = 20;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

function kindLabel(kind: NotificationItem['kind'] | 'all'): string {
  switch (kind) {
    case 'pending_request':
      return 'Pending Requests';
    case 'project_event':
      return 'Project Events';
    default:
      return 'All';
  }
}

function kindTone(kind: NotificationItem['kind']): string {
  switch (kind) {
    case 'pending_request':
      return 'warning';
    default:
      return 'primary';
  }
}

export default function AdminNotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [counts, setCounts] = useState<CountsByKind>({ all: 0, pending_request: 0, project_event: 0 });
  const [projectId, setProjectId] = useState('all');
  const [kind, setKind] = useState<'all' | 'pending_request' | 'project_event'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      window.location.href = '/login';
      return;
    }
    void fetchProjects(token);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    void fetchNotifications(token);
  }, [kind, page, projectId]);

  const fetchProjects = async (token: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      }
    } catch {
      // ignore
    }
  };

  const fetchNotifications = async (token: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        kind,
      });
      if (projectId !== 'all') params.set('project_id', projectId);
      const res = await fetch(`${apiUrl}/api/admin/notifications?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/login';
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to load notifications');
        setItems([]);
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setCounts(data.counts_by_kind || { all: 0, pending_request: 0, project_event: 0 });
    } catch {
      setError('Failed to load notifications');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const totalForPage = kind === 'all' ? counts.all : counts[kind];
  const pageCount = Math.max(1, Math.ceil(totalForPage / PAGE_SIZE));

  return (
    <>
      <Head>
        <title>Notifications - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Notifications Center</span>
              <h1 className="portal-page__title">Admin Notifications</h1>
              <p className="portal-page__subtitle">
                Track pending approvals and project governance changes with project-scoped filters and direct deep links.
              </p>
            </div>
          </div>

          <section className="portal-stat-grid notification-summary-grid">
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">All items</span>
              <span className="portal-stat-card__value">{counts.all}</span>
              <p className="portal-stat-card__copy">Combined approval queue and project governance events.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Pending Requests</span>
              <span className="portal-stat-card__value">{counts.pending_request}</span>
              <p className="portal-stat-card__copy">Requests waiting on an approval action.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Project Events</span>
              <span className="portal-stat-card__value">{counts.project_event}</span>
              <p className="portal-stat-card__copy">Project create, update, and lifecycle events with project context.</p>
            </article>
          </section>

          <section className="portal-surface notification-center-surface">
            <div className="notification-center-toolbar">
              <div className="notification-center-filters">
                {(['all', 'pending_request', 'project_event'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`notification-filter-chip ${kind === value ? 'notification-filter-chip--active' : ''}`}
                    onClick={() => {
                      setKind(value);
                      setPage(0);
                    }}
                  >
                    <span>{kindLabel(value)}</span>
                    <strong>{value === 'all' ? counts.all : counts[value]}</strong>
                  </button>
                ))}
              </div>

              <div className="notification-center-actions">
                <select
                  className="input notification-center-select"
                  value={projectId}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={String(project.id)}>
                      {project.name} ({project.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loading && <div className="empty-state">Loading notifications...</div>}
            {error && <div className="alert alert-error">{error}</div>}

            {!loading && !error && (
              items.length === 0 ? (
                <div className="empty-state">
                  <p>No admin notifications found for this filter.</p>
                  <Link href="/requests" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
                    Open requests
                  </Link>
                </div>
              ) : (
                <>
                  <div className="notification-list-header">
                    <span className="notification-list-header__meta">
                      Showing {page * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE + items.length, totalForPage)} of {totalForPage}
                    </span>
                  </div>

                  <div className="notification-list">
                    {items.map((item) => (
                      <article key={item.id} className="notification-row notification-row--unread">
                        <div className="notification-row__body">
                          <div className="notification-row__meta">
                            <span className={`notification-kind-pill notification-kind-pill--${kindTone(item.kind)}`}>
                              {kindLabel(item.kind)}
                            </span>
                            {item.project_name ? (
                              <span className="notification-kind-pill notification-kind-pill--info">
                                {item.project_name}
                                {item.project_code ? ` (${item.project_code})` : ''}
                              </span>
                            ) : null}
                            <span className="notification-row__time">{new Date(item.created_at).toLocaleString()}</span>
                          </div>
                          <strong className="notification-row__title">{item.title}</strong>
                          <p className="notification-row__message">{item.message}</p>
                        </div>
                        <div className="notification-row__actions">
                          {item.request_id ? (
                            <Link href={`/requests?id=${item.request_id}${item.project_id ? `&project_id=${item.project_id}` : ''}`} className="btn btn-secondary btn-sm">
                              View request
                            </Link>
                          ) : null}
                          {item.project_id ? (
                            <Link href={`/projects/${item.project_id}`} className="btn btn-secondary btn-sm">
                              View project
                            </Link>
                          ) : null}
                          {item.project_id ? (
                            <Link href={`/project-governance?project_id=${item.project_id}`} className="btn btn-secondary btn-sm">
                              Governance
                            </Link>
                          ) : null}
                          <Link href={`/activity${item.project_id ? `?project_id=${item.project_id}` : ''}`} className="btn btn-secondary btn-sm">
                            Open activity
                          </Link>
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="notification-pagination">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page === 0}
                      onClick={() => setPage((current) => Math.max(current - 1, 0))}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page + 1} of {pageCount}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page + 1 >= pageCount}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                    </button>
                  </div>
                </>
              )
            )}
          </section>
        </div>
      </AdminLayout>
    </>
  );
}
