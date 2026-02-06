import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { ADMIN_SITE_NAME } from '../lib/site';
import { IconDashboard, IconRequests, IconTeams, IconUsers, IconLogout, IconBell, IconChevronLeft, IconChevronRight, IconActivity } from './Icons';

const SIDEBAR_STORAGE_KEY = 'admin_sidebar_collapsed';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour(s) ago`;
  return d.toLocaleDateString();
}

interface PendingRequest {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority?: string;
  due_date?: string | null;
  created_at: string;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = router.pathname;
  const [collapsed, setCollapsed] = useState(false);
  const [newRequestsCount, setNewRequestsCount] = useState(0);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [pendingTickets, setPendingTickets] = useState<PendingRequest[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [actioningId, setActioningId] = useState<number | null>(null);
  const notifyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch (_) {}
  }, []);

  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  const fetchCount = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/admin/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data && typeof data.new_requests === 'number') setNewRequestsCount(data.new_requests); })
      .catch(() => {});
  };

  useEffect(() => {
    if (!token) return;
    fetchCount();
    const interval = setInterval(fetchCount, NOTIFY_POLL_MS);
    return () => clearInterval(interval);
  }, [token]);

  const fetchPendingTickets = () => {
    if (!token) return;
    setTicketsLoading(true);
    fetch(`${apiUrl}/api/admin/requests?status=pending_approval&limit=15`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.requests) setPendingTickets(data.requests);
      })
      .catch(() => setPendingTickets([]))
      .finally(() => setTicketsLoading(false));
  };

  useEffect(() => {
    if (notifyOpen) fetchPendingTickets();
  }, [notifyOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifyRef.current && !notifyRef.current.contains(e.target as Node)) setNotifyOpen(false);
    };
    if (notifyOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [notifyOpen]);

  const handleApprove = async (id: number) => {
    if (!token) return;
    setActioningId(id);
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setPendingTickets((prev) => prev.filter((r) => r.id !== id));
        fetchCount();
      }
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (id: number) => {
    if (!token) return;
    const reasonInput = window.prompt('Reject this request? Add a reason (optional, visible to the user):');
    if (reasonInput === null) return;
    setActioningId(id);
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: reasonInput.trim() }),
      });
      if (res.ok) {
        setPendingTickets((prev) => prev.filter((r) => r.id !== id));
        fetchCount();
      }
    } finally {
      setActioningId(null);
    }
  };

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch (_) {}
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };

  const navLink = (href: string, label: string, icon: ReactNode) => {
    const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
    return (
      <Link href={href} className={isActive ? 'active' : ''} title={collapsed ? label : undefined}>
        <span className="admin-sidebar-icon" aria-hidden>{icon}</span>
        <span className="admin-sidebar-label">{label}</span>
      </Link>
    );
  };

  return (
    <div className="admin-layout">
      <aside className={`admin-sidebar ${collapsed ? 'admin-sidebar-collapsed' : ''}`}>
        <div className="admin-sidebar-header">
          <Link href="/dashboard" className="admin-sidebar-brand">
            <img src="/logo.svg" alt="" width={36} height={36} />
            <span className="admin-sidebar-brand-text">{ADMIN_SITE_NAME}</span>
          </Link>
          <button
            type="button"
            className="admin-sidebar-toggle"
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>
        <nav className="admin-sidebar-nav">
          {navLink('/dashboard', 'Dashboard', <IconDashboard />)}
          {navLink('/requests', 'PR Requests', <IconRequests />)}
          {navLink('/teams', 'Teams', <IconTeams />)}
          {navLink('/users', 'Users', <IconUsers />)}
          {navLink('/activity', 'Activity', <IconActivity />)}
        </nav>
      </aside>
      <div className="admin-main-wrap">
        <header className="admin-topbar">
          <div className="admin-topbar-spacer" />
          <div className="admin-topbar-actions" ref={notifyRef}>
            <div className="admin-topbar-notify-wrap">
              <button
                type="button"
                className="admin-topbar-notify"
                onClick={() => setNotifyOpen((o) => !o)}
                title={newRequestsCount > 0 ? `${newRequestsCount} new request(s) pending` : 'Notifications'}
                aria-expanded={notifyOpen}
                aria-haspopup="true"
              >
                <IconBell />
                {newRequestsCount > 0 && (
                  <span className="admin-topbar-badge" aria-label={`${newRequestsCount} new requests`}>
                    {newRequestsCount > 99 ? '99+' : newRequestsCount}
                  </span>
                )}
              </button>
              {notifyOpen && (
                <div className="admin-notify-panel">
                  <div className="admin-notify-panel-header">
                    <h3 className="admin-notify-panel-title">Notifications</h3>
                    <button type="button" className="admin-notify-panel-close" onClick={() => setNotifyOpen(false)} aria-label="Close">
                      ×
                    </button>
                  </div>
                  <Link href="/requests" className="admin-notify-panel-more">
                    Request tickets → View all in PR Requests
                  </Link>
                  <div className="admin-notify-panel-list">
                    {ticketsLoading ? (
                      <p className="admin-notify-panel-loading">Loading…</p>
                    ) : pendingTickets.length === 0 ? (
                      <p className="admin-notify-panel-empty">No pending request tickets.</p>
                    ) : (
                      pendingTickets.map((req) => (
                        <div key={req.id} className="admin-notify-ticket">
                          <div className="admin-notify-ticket-main">
                            <span className="admin-notify-ticket-id">PR #{req.id}</span>
                            <span className="admin-notify-ticket-meta">{req.team} / {req.env} · {req.cloud} · {req.service}</span>
                            {(req.priority || req.due_date) && (
                              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                {req.priority && `Priority: ${req.priority}`}
                                {req.priority && req.due_date && ' · '}
                                {req.due_date && `Due: ${new Date(req.due_date).toLocaleDateString()}`}
                              </span>
                            )}
                            <span className="admin-notify-ticket-time">{formatTime(req.created_at)}</span>
                          </div>
                          <div className="admin-notify-ticket-actions">
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '6px 12px', fontSize: 13 }}
                              disabled={actioningId !== null}
                              onClick={() => handleApprove(req.id)}
                            >
                              {actioningId === req.id ? '…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ padding: '6px 12px', fontSize: 13 }}
                              disabled={actioningId !== null}
                              onClick={() => handleReject(req.id)}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button type="button" className="admin-topbar-logout btn btn-ghost" onClick={handleLogout} title="Logout">
              <IconLogout />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
