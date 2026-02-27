import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AppLayout from '../components/AppLayout';

interface Notification {
  id: number;
  request_id: number | null;
  kind: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markingRead, setMarkingRead] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const fetchNotifications = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/me/notifications?limit=50`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data.notifications) setNotifications(data.notifications);
        if (data.error) setError(data.error);
      })
      .catch(() => setError('Failed to load notifications'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchNotifications();
  }, [token, router]);

  const markAllRead = () => {
    if (!token || markingRead) return;
    setMarkingRead(true);
    fetch(`${apiUrl}/api/me/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mark_read: 'all' }),
    })
      .then((res) => (res.ok ? fetchNotifications() : null))
      .finally(() => setMarkingRead(false));
  };

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <AppLayout>
      <Head>
        <title>Notifications - InfraGate</title>
      </Head>
      <div className="notifications-page">
        <div className="notifications-page__header">
          <h1>Notifications</h1>
          {unreadCount > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={markAllRead}
              disabled={markingRead}
            >
              {markingRead ? 'Marking…' : `Mark all read (${unreadCount})`}
            </button>
          )}
        </div>

        {loading && <p className="notifications-page__loading">Loading…</p>}
        {error && <p className="notifications-page__error">{error}</p>}

        {!loading && !error && (
          <ul className="notifications-list">
            {notifications.length === 0 ? (
              <li className="notifications-list__empty">No notifications yet.</li>
            ) : (
              notifications.map((n) => (
                <li
                  key={n.id}
                  className={`notifications-list__item ${!n.read_at ? 'notifications-list__item--unread' : ''}`}
                >
                  <div className="notifications-list__content">
                    <span className="notifications-list__kind">{n.kind}</span>
                    <span className="notifications-list__message">{n.message}</span>
                    <span className="notifications-list__time">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                  {n.request_id && (
                    <Link href={`/history?id=${n.request_id}`} className="notifications-list__link">
                      View request →
                    </Link>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <style jsx>{`
        .notifications-page { padding: 1rem; max-width: 720px; margin: 0 auto; }
        .notifications-page__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.75rem; }
        .notifications-page__loading, .notifications-page__error { padding: 1rem; }
        .notifications-page__error { color: var(--color-error, #dc2626); }
        .notifications-list { list-style: none; padding: 0; margin: 0; }
        .notifications-list__empty { padding: 2rem; text-align: center; color: var(--muted, #6b7280); }
        .notifications-list__item { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: 1rem; border-bottom: 1px solid var(--border, #e5e7eb); }
        .notifications-list__item--unread { background: var(--unread-bg, rgba(13, 148, 136, 0.06)); }
        .notifications-list__content { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; min-width: 0; }
        .notifications-list__kind { font-size: 0.75rem; text-transform: uppercase; color: var(--muted, #6b7280); }
        .notifications-list__message { font-size: 0.9375rem; }
        .notifications-list__time { font-size: 0.8125rem; color: var(--muted, #6b7280); }
        .notifications-list__link { font-size: 0.875rem; color: var(--primary, #0d9488); white-space: nowrap; }
      `}</style>
    </AppLayout>
  );
}
