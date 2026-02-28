import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ComponentType, FormEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ADMIN_SITE_NAME } from '../lib/site';
import {
  IconLogout,
  IconBell,
  IconSun,
  IconMoon,
  IconDashboard,
  IconRequests,
  IconTeams,
  IconUsers,
  IconUser,
  IconActivity,
  IconTemplates,
  IconWebhook,
  IconSearch,
  IconMenu,
  IconTrendingUp,
} from './Icons';

const THEME_KEY = 'infra-portal-theme';
const SIDEBAR_COLLAPSED_KEY = 'infra-admin-sidebar-collapsed';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Ops Command',
  '/requests': 'Request Control',
  '/sla': 'SLA Watch',
  '/teams': 'Team Directory',
  '/users': 'Identity Center',
  '/activity': 'Audit Trail',
  '/templates': 'Template Forge',
  '/webhooks': 'Event Relay',
  '/profile': 'Profile',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/dashboard' && pathname.startsWith(path)) return title;
  }
  return 'Ops Command';
}

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

const NAV_ITEMS: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { href: '/dashboard', label: 'Ops Command', Icon: IconDashboard },
  { href: '/requests', label: 'Request Control', Icon: IconRequests },
  { href: '/sla', label: 'SLA Watch', Icon: IconTrendingUp },
  { href: '/teams', label: 'Team Directory', Icon: IconTeams },
  { href: '/users', label: 'Identity Center', Icon: IconUsers },
  { href: '/activity', label: 'Audit Trail', Icon: IconActivity },
  { href: '/templates', label: 'Template Forge', Icon: IconTemplates },
  { href: '/webhooks', label: 'Event Relay', Icon: IconWebhook },
];

function getAdminIdentity(): { initials: string; label: string } {
  if (typeof window === 'undefined') return { initials: 'A', label: 'Admin Operator' };
  try {
    const raw = localStorage.getItem('admin_user');
    if (!raw) return { initials: 'A', label: 'Admin Operator' };
    const user = JSON.parse(raw) as { username?: string; email?: string };
    const label = user?.username || user?.email || 'Admin Operator';
    const parts = label.trim().split(/[\s@.]/).filter(Boolean);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2)
      : label.slice(0, 2).toUpperCase() || 'A';
    return { initials, label };
  } catch {
    return { initials: 'A', label: 'Admin Operator' };
  }
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = router.pathname;
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newRequestsCount, setNewRequestsCount] = useState(0);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pendingTickets, setPendingTickets] = useState<PendingRequest[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [profileInitials, setProfileInitials] = useState('A');
  const [profileLabel, setProfileLabel] = useState('Admin Operator');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notifyRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const identity = getAdminIdentity();
    setProfileInitials(identity.initials);
    setProfileLabel(identity.label);
  }, []);

  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      const resolved = t === 'light' ? 'light' : 'dark';
      setTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setSidebarCollapsed(c === 'true');
    } catch (_) {}
  }, []);

  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
      document.documentElement.setAttribute('data-theme', next);
    } catch (_) {}
  };

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch (_) {}
  };

  const fetchCount = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/admin/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
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
      .then((res) => (res.ok ? res.json() : null))
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
    const q = router.query.q;
    const val = typeof q === 'string' ? q : '';
    setSearchQuery(val);
  }, [router.query.q]);

  useEffect(() => {
    let gPressedAt = 0;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        e.preventDefault();
        const msg = 'Shortcuts: ? help, Ctrl/Cmd+K search, g then d = Ops Command, g then r = Request Control';
        if (typeof window !== 'undefined' && (window as { adminToast?: (message: string, type?: string) => void }).adminToast) {
          (window as { adminToast?: (message: string, type?: string) => void }).adminToast?.(msg, 'success');
        } else {
          alert(msg);
        }
        return;
      }
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        gPressedAt = Date.now();
        return;
      }
      if (gPressedAt && Date.now() - gPressedAt < 800) {
        if (e.key === 'd') {
          e.preventDefault();
          router.push('/dashboard');
        } else if (e.key === 'r') {
          e.preventDefault();
          router.push('/requests');
        }
        gPressedAt = 0;
      } else {
        gPressedAt = 0;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q) {
      router.push(`/requests?q=${encodeURIComponent(q)}`);
    } else {
      router.push('/requests');
    }
  };

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

  const pageTitle = getPageTitle(pathname);
  const statusLabel = newRequestsCount > 0 ? `${newRequestsCount} fresh tickets` : 'Queue stable';

  return (
    <div className="admin-layout admin-layout-sidebar admin-shell">
      <aside className={`admin-sidebar-shell ${sidebarCollapsed ? 'admin-sidebar-shell--collapsed' : ''} ${mobileMenuOpen ? 'admin-sidebar-shell--mobile-open' : ''}`}>
        <div className="admin-sidebar-shell__header">
          <button
            type="button"
            className="admin-sidebar-shell__hamburger"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <IconMenu />
          </button>
          <Link href="/dashboard" className="admin-sidebar-shell__brand">
            <img src="/logo.svg" alt="" width={36} height={36} className="admin-sidebar-shell__logo" />
            {!sidebarCollapsed && (
              <span className="admin-sidebar-shell__brand-copy">
                <span className="admin-sidebar-shell__eyebrow">Control Room</span>
                <span className="admin-sidebar-shell__brand-text">{ADMIN_SITE_NAME}</span>
              </span>
            )}
          </Link>
        </div>

        {!sidebarCollapsed && (
          <div className="admin-sidebar-shell__summary">
            <span className="admin-sidebar-shell__summary-label">Command radar</span>
            <strong className="admin-sidebar-shell__summary-value">{newRequestsCount || '0'}</strong>
            <p className="admin-sidebar-shell__summary-copy">
              {newRequestsCount > 0
                ? 'New request traffic needs review in the control queue.'
                : 'No new escalations detected across the admin backlog.'}
            </p>
          </div>
        )}

        <nav className="admin-sidebar-shell__nav">
          {!sidebarCollapsed && <span className="admin-sidebar-shell__nav-title">Operations</span>}
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`admin-sidebar-shell__link ${isActive ? 'admin-sidebar-shell__link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon className="admin-sidebar-shell__icon" />
                {!sidebarCollapsed && <span className="admin-sidebar-shell__label">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar-shell__footer">
          <button type="button" className="admin-sidebar-shell__link" onClick={handleLogout}>
            <IconLogout className="admin-sidebar-shell__icon" />
            {!sidebarCollapsed && <span className="admin-sidebar-shell__label">Logout</span>}
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="admin-sidebar-shell-overlay" onClick={() => setMobileMenuOpen(false)} aria-hidden />
      )}

      <div className="admin-main-shell">
        <header className="admin-topbar">
          <div className="admin-topbar__left">
            <button
              type="button"
              className="admin-topbar__menu-btn"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <IconMenu />
            </button>
            <div className="admin-topbar__title-wrap">
              <span className="admin-topbar__kicker">Platform command</span>
              <h1 className="admin-topbar__title">{pageTitle}</h1>
            </div>
            <span className={`admin-topbar__status-chip ${newRequestsCount > 0 ? 'admin-topbar__status-chip--alert' : ''}`}>
              {statusLabel}
            </span>
          </div>

          <div className="admin-topbar__right">
            <form className="admin-topbar__search" onSubmit={handleSearchSubmit} role="search">
              <IconSearch className="admin-topbar__search-icon" />
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Search requests, teams, clouds, services"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="admin-topbar__search-input"
                aria-label="Search requests"
              />
            </form>

            <div className="admin-topbar__actions">
              <span className="admin-topbar__workspace">{profileLabel}</span>
              <span className="admin-topbar__role">Admin</span>
            </div>

            <div className="admin-topbar__notify-wrap" ref={notifyRef}>
              <button
                type="button"
                className="admin-topbar__icon-btn"
                onClick={() => setNotifyOpen((o) => !o)}
                title={newRequestsCount > 0 ? `${newRequestsCount} new request(s) pending` : 'Notifications'}
                aria-expanded={notifyOpen}
                aria-haspopup="true"
              >
                <IconBell />
                {newRequestsCount > 0 && (
                  <span className="admin-topbar__badge" aria-label={`${newRequestsCount} new requests`}>
                    {newRequestsCount > 99 ? '99+' : newRequestsCount}
                  </span>
                )}
              </button>

              {notifyOpen && (
                <div className="admin-topbar__notify-panel">
                  <div className="admin-topbar__notify-header">
                    <h3 className="admin-topbar__notify-title">Fresh tickets</h3>
                    <button type="button" className="admin-topbar__notify-close" onClick={() => setNotifyOpen(false)} aria-label="Close">
                      x
                    </button>
                  </div>
                  <Link href="/requests" className="admin-topbar__notify-link" onClick={() => setNotifyOpen(false)}>
                    Open full queue
                  </Link>
                  <div className="admin-topbar__notify-list">
                    {ticketsLoading ? (
                      <p className="admin-topbar__notify-empty">Loading...</p>
                    ) : pendingTickets.length === 0 ? (
                      <p className="admin-topbar__notify-empty">No pending request tickets.</p>
                    ) : (
                      pendingTickets.map((req) => (
                        <Link
                          key={req.id}
                          href={`/requests?id=${req.id}`}
                          className="admin-topbar__notify-ticket"
                          onClick={() => setNotifyOpen(false)}
                        >
                          <strong>Ticket #{req.id}</strong>
                          <span>{req.team} / {req.cloud} / {req.service}</span>
                          <small>{formatTime(req.created_at)}</small>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="admin-topbar__theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>

            <div className="admin-topbar__profile-wrap" ref={profileRef}>
              <button
                type="button"
                className="admin-topbar__profile-btn"
                onClick={() => setProfileOpen((o) => !o)}
                aria-expanded={profileOpen}
                aria-haspopup="true"
                title="Profile"
              >
                <span className="admin-topbar__avatar">{profileInitials}</span>
                <span className="admin-topbar__profile-label">{profileLabel}</span>
              </button>

              {profileOpen && (
                <div className="admin-topbar__dropdown">
                  <div className="admin-topbar__dropdown-header">
                    <span className="admin-topbar__dropdown-avatar">{profileInitials}</span>
                    <span className="admin-topbar__dropdown-label">{profileLabel}</span>
                  </div>
                  <Link href="/profile" className="admin-topbar__dropdown-item" onClick={() => setProfileOpen(false)}>
                    <IconUser />
                    Profile
                  </Link>
                  <button type="button" className="admin-topbar__dropdown-item" onClick={handleLogout}>
                    <IconLogout />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="admin-main-shell__content">{children}</main>
      </div>
    </div>
  );
}
