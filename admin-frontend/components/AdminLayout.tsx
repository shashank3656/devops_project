import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ComponentType, FormEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  IconLogout,
  IconBell,
  IconDashboard,
  IconRequests,
  IconTeams,
  IconUsers,
  IconUser,
  IconActivity,
  IconTemplates,
  IconProjects,
  IconWebhook,
  IconShield,
  IconLayers,
  IconSearch,
  IconMenu,
  IconTrendingUp,
} from './Icons';

const THEME_KEY = 'infra-portal-theme';
const SIDEBAR_COLLAPSED_KEY = 'infra-admin-sidebar-collapsed';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Governance Overview',
  '/approval-center': 'Approval Center',
  '/project-governance': 'Project Governance',
  '/requests': 'Requests',
  '/sla': 'SLA Dashboard',
  '/teams': 'Teams',
  '/users': 'Users',
  '/projects': 'Projects',
  '/team-ownership': 'Team Ownership',
  '/activity': 'Activity',
  '/templates': 'Templates',
  '/access-review': 'Access Review',
  '/webhooks': 'Webhooks',
  '/profile': 'Profile',
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

const NAV_ITEMS: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { href: '/dashboard', label: 'Dashboard', Icon: IconDashboard },
  { href: '/approval-center', label: 'Approval Center', Icon: IconShield },
  { href: '/project-governance', label: 'Project Governance', Icon: IconTrendingUp },
  { href: '/requests', label: 'Requests', Icon: IconRequests },
  { href: '/sla', label: 'SLA Dashboard', Icon: IconTrendingUp },
  { href: '/teams', label: 'Teams', Icon: IconTeams },
  { href: '/team-ownership', label: 'Team Ownership', Icon: IconLayers },
  { href: '/users', label: 'Users', Icon: IconUsers },
  { href: '/projects', label: 'Projects', Icon: IconProjects },
  { href: '/access-review', label: 'Access Review', Icon: IconShield },
  { href: '/activity', label: 'Activity', Icon: IconActivity },
  { href: '/templates', label: 'Templates', Icon: IconTemplates },
  { href: '/webhooks', label: 'Webhooks', Icon: IconWebhook },
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

function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = (localStorage.getItem('admin_token') || '').trim();
  if (!raw || raw === 'undefined' || raw === 'null') return null;
  // Backend session token format is "<userID>:<unixTimestamp>".
  if (!/^\d+:\d+$/.test(raw)) return null;
  return raw;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = router.pathname;
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
      localStorage.setItem(THEME_KEY, 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setSidebarCollapsed(c === 'true');
    } catch (_) {}
  }, []);

  const token = getAdminToken();

  useEffect(() => {
    const currentToken = getAdminToken();
    if (currentToken) return;
    try {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
    } catch (_) {}
    if (router.pathname !== '/login') {
      router.replace('/login');
    }
  }, [router, router.pathname]);

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
    setNotifyOpen(false);
    setProfileOpen(false);
  }, [pathname]);

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
        const msg = 'Shortcuts: ? help, Ctrl/Cmd+K search, g then d = Dashboard, g then r = Requests';
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
  const statusLabel = newRequestsCount > 0 ? `${newRequestsCount} pending requests` : 'No pending requests';
  const sidebarStatusItems = [
    { label: 'request-queue', tone: newRequestsCount > 0 ? 'warn' : 'ok', meta: newRequestsCount > 0 ? `${newRequestsCount} open` : 'clear' },
    { label: 'access-control', tone: 'ok', meta: 'live' },
    { label: 'webhook-relay', tone: 'ok', meta: 'ready' },
  ];

  const getSidebarBadge = (href: string): string | null => {
    if (href === '/requests' && newRequestsCount > 0) {
      return newRequestsCount > 99 ? '99+' : String(newRequestsCount);
    }
    return null;
  };

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
          {!sidebarCollapsed && (
            <Link href="/dashboard" className="admin-sidebar-shell__brand">
              <span className="admin-sidebar-shell__brand-word admin-sidebar-shell__brand-word--primary">InfraGate</span>
              <span className="admin-sidebar-shell__brand-word">Governance</span>
            </Link>
          )}
        </div>
        <div className="admin-sidebar-shell__body">
          <nav className="admin-sidebar-shell__nav">
            {!sidebarCollapsed && <span className="admin-sidebar-shell__nav-title">Modules</span>}
            {NAV_ITEMS.map(({ href, label, Icon }) => {
              const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
              const badge = getSidebarBadge(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`admin-sidebar-shell__link ${isActive ? 'admin-sidebar-shell__link--active' : ''}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="admin-sidebar-shell__icon" />
                  {!sidebarCollapsed && <span className="admin-sidebar-shell__label">{label}</span>}
                  {!sidebarCollapsed && badge && <span className="admin-sidebar-shell__badge">{badge}</span>}
                </Link>
              );
            })}
          </nav>

          {!sidebarCollapsed && (
            <div className="admin-sidebar-shell__status-panel">
              <span className="admin-sidebar-shell__status-title">Control Health</span>
              <div className="admin-sidebar-shell__status-list">
                {sidebarStatusItems.map((item) => (
                  <div key={item.label} className="admin-sidebar-shell__status-item">
                    <span className={`admin-sidebar-shell__status-dot admin-sidebar-shell__status-dot--${item.tone}`} aria-hidden />
                    <span className="admin-sidebar-shell__status-name">{item.label}</span>
                    <span className="admin-sidebar-shell__status-meta">{item.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="admin-sidebar-shell__footer">
            <button type="button" className="admin-sidebar-shell__link" onClick={handleLogout}>
              <IconLogout className="admin-sidebar-shell__icon" />
              {!sidebarCollapsed && <span className="admin-sidebar-shell__label">Logout</span>}
            </button>
          </div>
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
              <span className="admin-topbar__kicker">Admin Portal</span>
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
                onClick={() => {
                  setNotifyOpen((o) => !o);
                  setProfileOpen(false);
                }}
                title={newRequestsCount > 0 ? `${newRequestsCount} new request(s) pending` : 'Notifications'}
                aria-expanded={notifyOpen}
                aria-haspopup="true"
              >
                <IconBell />
                {newRequestsCount > 0 && <span className="admin-topbar__badge admin-topbar__badge--dot" aria-hidden />}
              </button>

              {notifyOpen && (
                <div className="admin-topbar__notify-panel">
                  <div className="admin-topbar__notify-header">
                    <h3 className="admin-topbar__notify-title">Pending Requests</h3>
                    <button type="button" className="admin-topbar__notify-close" onClick={() => setNotifyOpen(false)} aria-label="Close">
                      Close
                    </button>
                  </div>
                  <div className="admin-topbar__notify-summary">
                    <strong>{newRequestsCount > 99 ? '99+' : newRequestsCount}</strong>
                    <span>
                      {newRequestsCount > 0
                        ? 'Requests are waiting for admin review right now.'
                        : 'No pending request tickets at the moment.'}
                    </span>
                  </div>
                  <div className="admin-topbar__notify-links">
                    <Link href="/requests" className="admin-topbar__notify-link" onClick={() => setNotifyOpen(false)}>
                      Open requests
                    </Link>
                  </div>
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
