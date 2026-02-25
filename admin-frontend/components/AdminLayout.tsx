import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useRef, useState } from 'react';
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
  IconActivity,
  IconTemplates,
  IconWebhook,
  IconSearch,
  IconMenu,
} from './Icons';

const THEME_KEY = 'infra-portal-theme';
const SIDEBAR_COLLAPSED_KEY = 'infra-admin-sidebar-collapsed';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/requests': 'PR Requests',
  '/teams': 'Teams',
  '/users': 'Users',
  '/activity': 'Activity',
  '/templates': 'Templates',
  '/webhooks': 'Webhooks',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/dashboard' && pathname.startsWith(path)) return title;
  }
  return 'Dashboard';
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

const NAV_ITEMS: { href: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { href: '/dashboard', label: 'Dashboard', Icon: IconDashboard },
  { href: '/requests', label: 'PR Requests', Icon: IconRequests },
  { href: '/teams', label: 'Teams', Icon: IconTeams },
  { href: '/users', label: 'Users', Icon: IconUsers },
  { href: '/activity', label: 'Activity', Icon: IconActivity },
  { href: '/templates', label: 'Templates', Icon: IconTemplates },
  { href: '/webhooks', label: 'Webhooks', Icon: IconWebhook },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    try {
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setSidebarCollapsed(c === 'true');
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

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch (_) {}
  };

  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

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

  // Sync search box with URL when on /requests
  useEffect(() => {
    const q = router.query.q;
    const val = typeof q === 'string' ? q : '';
    setSearchQuery(val);
  }, [router.query.q]);

  // Cmd/Ctrl+K to focus search, ? help, g+t tickets, g+d dashboard
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
        const msg = 'Shortcuts: ? help, ⌘K search, g then d = Dashboard, g then t = Tickets';
        if (typeof window !== 'undefined' && (window as any).adminToast) {
          (window as any).adminToast(msg, 'success');
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
        } else if (e.key === 't') {
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

  const handleSearchSubmit = (e: React.FormEvent) => {
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

  return (
    <div className="admin-layout admin-layout-sidebar">
      {/* Left Sidebar - Dark, fixed */}
      <aside className={`admin-sidebar ${sidebarCollapsed ? 'admin-sidebar--collapsed' : ''} ${mobileMenuOpen ? 'admin-sidebar--mobile-open' : ''}`}>
        <div className="admin-sidebar__header">
          <button
            type="button"
            className="admin-sidebar__hamburger"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <IconMenu />
          </button>
          <Link href="/dashboard" className="admin-sidebar__brand">
            <img src="/logo.svg" alt="" width={36} height={36} className="admin-sidebar__logo" />
            {!sidebarCollapsed && <span className="admin-sidebar__brand-text">{ADMIN_SITE_NAME}</span>}
          </Link>
        </div>
        <nav className="admin-sidebar__nav">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`admin-sidebar__link ${isActive ? 'admin-sidebar__link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon className="admin-sidebar__icon" />
                {!sidebarCollapsed && <span className="admin-sidebar__label">{label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="admin-sidebar__footer">
          <button
            type="button"
            className="admin-sidebar__link"
            onClick={handleLogout}
          >
            <IconLogout className="admin-sidebar__icon" />
            {!sidebarCollapsed && <span className="admin-sidebar__label">Logout</span>}
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="admin-sidebar-overlay"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden
        />
      )}

      {/* Main content wrapper */}
      <div className="admin-main-wrapper">
        {/* Top Navbar - White, 60px */}
        <header className="admin-navbar">
          <div className="admin-navbar__left">
            <button
              type="button"
              className="admin-navbar__menu-btn"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <IconMenu />
            </button>
            <h1 className="admin-navbar__title">{pageTitle}</h1>
            <form className="admin-navbar__search" onSubmit={handleSearchSubmit} role="search">
              <IconSearch className="admin-navbar__search-icon" />
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Search requests (team, cloud, service…)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="admin-navbar__search-input"
                aria-label="Search requests"
              />
            </form>
          </div>
          <div className="admin-navbar__right">
            <div className="admin-navbar__actions admin-navbar__notify-wrap" ref={notifyRef}>
              <button
                type="button"
                className="admin-navbar__icon-btn"
                onClick={() => setNotifyOpen((o) => !o)}
                title={newRequestsCount > 0 ? `${newRequestsCount} new request(s) pending` : 'Notifications'}
                aria-expanded={notifyOpen}
                aria-haspopup="true"
              >
                <IconBell />
                {newRequestsCount > 0 && (
                  <span className="admin-navbar__badge" aria-label={`${newRequestsCount} new requests`}>
                    {newRequestsCount > 99 ? '99+' : newRequestsCount}
                  </span>
                )}
              </button>
              {notifyOpen && (
                <div className="admin-notify-panel admin-notify-panel--navbar">
                  <div className="admin-notify-panel-header">
                    <h3 className="admin-notify-panel-title">Notifications</h3>
                    <button type="button" className="admin-notify-panel-close" onClick={() => setNotifyOpen(false)} aria-label="Close">
                      ×
                    </button>
                  </div>
                  <Link href="/requests" className="admin-notify-panel-more" onClick={() => setNotifyOpen(false)}>
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
              <button
                type="button"
                className="admin-navbar__icon-btn"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              >
                {theme === 'dark' ? <IconSun /> : <IconMoon />}
              </button>
            </div>
            <div className="admin-navbar__profile-wrap" ref={profileRef}>
              <button
                type="button"
                className="admin-navbar__profile-btn"
                onClick={() => setProfileOpen((o) => !o)}
                aria-expanded={profileOpen}
                aria-haspopup="true"
                title="Profile"
              >
                <span className="admin-navbar__avatar">{profileInitials}</span>
                <span className="admin-navbar__profile-label">Admin</span>
              </button>
              {profileOpen && (
                <div className="admin-navbar__dropdown">
                  <div className="admin-navbar__dropdown-header">
                    <span className="admin-navbar__dropdown-avatar">{profileInitials}</span>
                    <span className="admin-navbar__dropdown-label">Admin</span>
                  </div>
                  <button type="button" className="admin-navbar__dropdown-item" onClick={handleLogout}>
                    <IconLogout />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main content area */}
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
