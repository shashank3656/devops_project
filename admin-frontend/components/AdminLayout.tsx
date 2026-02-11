import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { ADMIN_SITE_NAME } from '../lib/site';
import { IconLogout, IconBell, IconSun, IconMoon } from './Icons';

const THEME_KEY = 'infra-portal-theme';
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

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/requests', label: 'PR Requests' },
  { href: '/teams', label: 'Teams' },
  { href: '/users', label: 'Users' },
  { href: '/activity', label: 'Activity' },
  { href: '/templates', label: 'Templates' },
  { href: '/webhooks', label: 'Webhooks' },
  { href: '/db-query', label: 'DB Query' },
  { href: '/db-connections', label: 'DB Connections' },
];

function getProfileInitials(): string {
  if (typeof window === 'undefined') return 'A';
  try {
    const raw = localStorage.getItem('admin_user');
    if (!raw) return 'A';
    const user = JSON.parse(raw) as { username?: string; email?: string };
    const name = user?.username || user?.email || '';
    if (!name) return 'A';
    const parts = name.trim().split(/[\s@.]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    return name.slice(0, 2).toUpperCase();
  } catch {
    return 'A';
  }
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = router.pathname;
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [newRequestsCount, setNewRequestsCount] = useState(0);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pendingTickets, setPendingTickets] = useState<PendingRequest[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [profileInitials, setProfileInitials] = useState('A');
  const notifyRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProfileInitials(getProfileInitials());
  }, []);

  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      const resolved = t === 'dark' ? 'dark' : 'light';
      setTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    } catch (_) {}
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
      document.documentElement.setAttribute('data-theme', next);
    } catch (_) {}
  };

  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  const fetchCount = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/admin/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data && typeof data.new_requests === 'number') setNewRequestsCount(data.new_requests);
      })
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
    fetch(`${apiUrl}/api/admin/requests?status=pending_any&limit=15`, { headers: { Authorization: `Bearer ${token}` } })
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
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    if (notifyOpen || profileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [notifyOpen, profileOpen]);

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };

  return (
    <div className="admin-layout admin-layout-topbar">
      <header className="admin-topbar-new">
        <div className="admin-topbar-left">
          <Link href="/dashboard" className="admin-topbar-brand">
            <img src="/logo.svg" alt="" width={40} height={40} className="admin-topbar-logo" />
            <span className="admin-topbar-brand-text">{ADMIN_SITE_NAME}</span>
          </Link>
          <nav className="admin-topbar-nav">
            {NAV_ITEMS.map(({ href, label }) => {
              const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={`admin-topbar-nav-link ${isActive ? 'active' : ''}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="admin-topbar-right">
          <div className="admin-topbar-actions" ref={notifyRef}>
            <div className="admin-topbar-notify-wrap">
              <button
                type="button"
                className="admin-topbar-icon-btn"
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
                        <Link
                          key={req.id}
                          href={`/requests?id=${req.id}`}
                          className="admin-notify-ticket admin-notify-ticket-link"
                          onClick={() => setNotifyOpen(false)}
                        >
                          <span className="admin-notify-ticket-id">Ticket #{req.id}</span>
                          <span className="admin-notify-ticket-time">{formatTime(req.created_at)}</span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              className="admin-topbar-icon-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
          </div>
          <div className="admin-topbar-profile-wrap" ref={profileRef}>
            <button
              type="button"
              className="admin-topbar-profile-btn"
              onClick={() => setProfileOpen((o) => !o)}
              aria-expanded={profileOpen}
              aria-haspopup="true"
              title="Profile"
            >
              <span className="admin-topbar-avatar" aria-hidden>
                {profileInitials}
              </span>
            </button>
            {profileOpen && (
              <div className="admin-profile-dropdown">
                <div className="admin-profile-dropdown-header">
                  <span className="admin-profile-dropdown-avatar">{profileInitials}</span>
                  <span className="admin-profile-dropdown-label">Admin</span>
                </div>
                <button
                  type="button"
                  className="admin-profile-dropdown-item"
                  onClick={handleLogout}
                >
                  <IconLogout />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
