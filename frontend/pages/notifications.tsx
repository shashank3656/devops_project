import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AppLayout from '../components/AppLayout';
import { useToast } from '../context/ToastContext';

interface Notification {
  id: number;
  request_id: number | null;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  kind: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

type NotificationKind = 'all' | 'approved' | 'rejected' | 'pr_created' | 'assigned' | 'sla_breach';

const PAGE_SIZE = 20;

const KIND_LABELS: Record<string, string> = {
  all: 'All',
  approved: 'Approved',
  rejected: 'Rejected',
  pr_created: 'PR Created',
  assigned: 'Assigned',
  sla_breach: 'SLA Breach',
};

function formatNotificationKind(kind: string): string {
  return KIND_LABELS[kind] || kind.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function getNotificationTone(kind: string): string {
  switch (kind) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'pr_created':
      return 'primary';
    case 'assigned':
      return 'info';
    case 'sla_breach':
      return 'warning';
    default:
      return 'neutral';
  }
}

export default function NotificationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markingRead, setMarkingRead] = useState(false);
  const [activeKind, setActiveKind] = useState<NotificationKind>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [countsByKind, setCountsByKind] = useState<Record<string, number>>({});
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const hasUnreadSelection = useMemo(
    () => notifications.some((notification) => selectedIds.includes(notification.id) && !notification.read_at),
    [notifications, selectedIds]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchNotifications = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (activeKind !== 'all') params.set('kind', activeKind);
      if (unreadOnly) params.set('unread_only', 'true');

      const res = await fetch(`${apiUrl}/api/me/notifications?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to load notifications');
        setNotifications([]);
        return;
      }
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(typeof data.unread_count === 'number' ? data.unread_count : 0);
      setCountsByKind(data.counts_by_kind || {});
      setTotalCount(typeof data.total_count === 'number' ? data.total_count : 0);
    } catch (_) {
      setError('Failed to load notifications');
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchNotifications();
  }, [token, router, page, activeKind, unreadOnly]);

  useEffect(() => {
    setSelectedIds([]);
  }, [notifications]);

  const markNotificationsRead = async (ids?: number[]) => {
    if (!token || markingRead) return;
    setMarkingRead(true);
    try {
      const body = ids && ids.length > 0
        ? { ids }
        : { mark_read: 'all' };
      const res = await fetch(`${apiUrl}/api/me/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast('Failed to update notifications', 'error');
        return;
      }
      if (ids && ids.length > 0) {
        toast('Selected notifications marked as read', 'success');
      } else {
        toast('All notifications marked as read', 'success');
      }
      setSelectedIds([]);
      await fetchNotifications();
    } catch (_) {
      toast('Failed to update notifications', 'error');
    } finally {
      setMarkingRead(false);
    }
  };

  const toggleSelection = (id: number) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : current.concat(id)
    );
  };

  const toggleSelectAllVisible = () => {
    const selectableIds = notifications.map((notification) => notification.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : selectableIds);
  };

  return (
    <AppLayout>
      <Head>
        <title>Notifications - InfraGate</title>
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Notifications Center</span>
            <h1 className="portal-page__title">Notification Inbox</h1>
            <p className="portal-page__subtitle">
              Track approvals, rejections, PR creation, assignments, and delivery alerts in one place.
            </p>
          </div>
        </div>

        <section className="portal-stat-grid notification-summary-grid">
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Unread</span>
            <span className="portal-stat-card__value">{unreadCount}</span>
            <p className="portal-stat-card__copy">Notifications that still need attention.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Approved</span>
            <span className="portal-stat-card__value">{countsByKind.approved || 0}</span>
            <p className="portal-stat-card__copy">Requests moved forward or completed review.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">PR Created</span>
            <span className="portal-stat-card__value">{countsByKind.pr_created || 0}</span>
            <p className="portal-stat-card__copy">Notifications tied to Git-backed delivery work.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Assigned / Alerts</span>
            <span className="portal-stat-card__value">{(countsByKind.assigned || 0) + (countsByKind.sla_breach || 0)}</span>
            <p className="portal-stat-card__copy">Assignments and escalation-worthy updates.</p>
          </article>
        </section>

        <section className="portal-surface notification-center-surface">
          <div className="notification-center-toolbar">
            <div className="notification-center-filters">
              {(Object.keys(KIND_LABELS) as NotificationKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`notification-filter-chip ${activeKind === kind ? 'notification-filter-chip--active' : ''}`}
                  onClick={() => {
                    setActiveKind(kind);
                    setPage(0);
                  }}
                >
                  <span>{KIND_LABELS[kind]}</span>
                  <strong>{kind === 'all' ? countsByKind.all || 0 : countsByKind[kind] || 0}</strong>
                </button>
              ))}
            </div>

            <div className="notification-center-actions">
              <label className="notification-checkbox-row">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => {
                    setUnreadOnly(e.target.checked);
                    setPage(0);
                  }}
                />
                <span>Unread only</span>
              </label>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={markingRead || !hasUnreadSelection}
                  onClick={() => void markNotificationsRead(selectedIds)}
                >
                  {markingRead ? 'Updating…' : `Mark selected read (${selectedIds.length})`}
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={markingRead}
                  onClick={() => void markNotificationsRead()}
                >
                  {markingRead ? 'Updating…' : `Mark all read (${unreadCount})`}
                </button>
              )}
            </div>
          </div>

          {loading && <div className="empty-state">Loading notifications…</div>}
          {error && <div className="alert alert-error">{error}</div>}

          {!loading && !error && (
            <>
              {notifications.length === 0 ? (
                <div className="empty-state">
                  <p>No notifications found for this filter.</p>
                  <Link href="/history" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
                    Open request history
                  </Link>
                </div>
              ) : (
                <>
                  <div className="notification-list-header">
                    <label className="notification-checkbox-row">
                      <input
                        type="checkbox"
                        checked={notifications.length > 0 && notifications.every((notification) => selectedIds.includes(notification.id))}
                        onChange={toggleSelectAllVisible}
                      />
                      <span>Select visible</span>
                    </label>
                    <span className="notification-list-header__meta">
                      Showing {page * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE + notifications.length, totalCount)} of {totalCount}
                    </span>
                  </div>

                  <div className="notification-list">
                    {notifications.map((notification) => {
                      const tone = getNotificationTone(notification.kind);
                      return (
                        <article
                          key={notification.id}
                          className={`notification-row ${!notification.read_at ? 'notification-row--unread' : ''}`}
                        >
                          <label className="notification-checkbox-row notification-checkbox-row--top">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(notification.id)}
                              onChange={() => toggleSelection(notification.id)}
                            />
                          </label>
                          <div className="notification-row__body">
                            <div className="notification-row__meta">
                              <span className={`notification-kind-pill notification-kind-pill--${tone}`}>
                                {formatNotificationKind(notification.kind)}
                              </span>
                              {notification.project_name && (
                                <span className="notification-kind-pill notification-kind-pill--info">
                                  {notification.project_name}
                                  {notification.project_code ? ` (${notification.project_code})` : ''}
                                </span>
                              )}
                              {!notification.read_at && <span className="notification-unread-pill">Unread</span>}
                              <span className="notification-row__time">
                                {new Date(notification.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p className="notification-row__message">{notification.message}</p>
                          </div>
                          <div className="notification-row__actions">
                            {notification.project_id && (
                              <Link href={`/my-projects/${notification.project_id}`} className="btn btn-secondary btn-sm">
                                View project
                              </Link>
                            )}
                            {notification.request_id && (
                              <Link href={`/history?id=${notification.request_id}`} className="btn btn-secondary btn-sm">
                                View request
                              </Link>
                            )}
                            {!notification.read_at && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={markingRead}
                                onClick={() => void markNotificationsRead([notification.id])}
                              >
                                Mark read
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
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
                      Page {page + 1} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page + 1 >= totalPages}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
