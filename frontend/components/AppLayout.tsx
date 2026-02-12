import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { SITE_NAME } from '../lib/site';
import { useToast } from '../context/ToastContext';
import {
  IconLogout,
  IconBell,
  IconSun,
  IconMoon,
  IconHome,
  IconPlus,
  IconTemplates,
  IconHistory,
  IconUsers,
  IconChevronRight,
  IconChevronDown,
  IconMenu,
} from './Icons';

const THEME_KEY = 'user-portal-theme';
const SIDEBAR_COLLAPSED_KEY = 'user-portal-sidebar-collapsed';
const HISTORY_LAST_SEEN_KEY = 'user_history_last_seen';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export function getApiUrl(): string {
  return apiUrl;
}

export function getStoredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export function setStoredTheme(theme: 'light' | 'dark') {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

const PAGE_TITLES: Record<string, string> = {
  '/home': 'Home',
  '/create-infrastructure': 'New Request',
  '/templates': 'Templates',
  '/history': 'History',
  '/my-teams': 'My teams',
  '/profile': 'Profile',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/home' && pathname.startsWith(path)) return title;
  }
  return 'Home';
}

function getProfileInitials(): string {
  if (typeof window === 'undefined') return 'U';
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return 'U';
    const user = JSON.parse(raw) as { username?: string; email?: string; name?: string };
    const name = user?.name || user?.username || user?.email || '';
    if (!name) return 'U';
    const parts = name.trim().split(/[\s@.]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    return name.slice(0, 2).toUpperCase();
  } catch {
    return 'U';
  }
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const pathname = router.pathname;
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitials, setProfileInitials] = useState('U');
  const [newRequestExpanded, setNewRequestExpanded] = useState(false);
  const [teamCheck, setTeamCheck] = useState<'loading' | 'ok' | 'forbidden'>('loading');
  const [updatedRequestsCount, setUpdatedRequestsCount] = useState(0);
  const [pendingManagerApprovalCount, setPendingManagerApprovalCount] = useState(0);
  const [hasManagedTeams, setHasManagedTeams] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProfileInitials(getProfileInitials());
  }, []);

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

  useEffect(() => {
    try {
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setSidebarCollapsed(c === 'true');
    } catch (_) {}
  }, []);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || token === 'undefined') {
      setTeamCheck('forbidden');
      return;
    }
    fetch(`${apiUrl}/api/me/teams`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        const teams = data.teams || [];
        setTeamCheck(teams.length > 0 ? 'ok' : 'forbidden');
      })
      .catch(() => setTeamCheck('forbidden'));
  }, []);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || token === 'undefined' || teamCheck !== 'ok') return;
    fetch(`${apiUrl}/api/me/managed-teams`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const teams = data?.teams || [];
        setHasManagedTeams(teams.length > 0);
      })
      .catch(() => {});
  }, [teamCheck]);

  useEffect(() => {
    if (router.pathname === '/history') {
      try {
        localStorage.setItem(HISTORY_LAST_SEEN_KEY, new Date().toISOString());
        setUpdatedRequestsCount(0);
      } catch (_) {}
    }
  }, [router.pathname]);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || token === 'undefined') return;
    const fetchNotifications = () => {
      try {
        const since = localStorage.getItem(HISTORY_LAST_SEEN_KEY);
        const sinceParam = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const t = localStorage.getItem('token');
        if (!t) return;
        fetch(`${apiUrl}/api/me/notifications?since=${encodeURIComponent(sinceParam)}`, { headers: { Authorization: `Bearer ${t}` } })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { if (data && typeof data.updated_count === 'number') setUpdatedRequestsCount(data.updated_count); })
          .catch(() => {});
      } catch (_) {}
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, NOTIFY_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || token === 'undefined') return;
    const fetchPendingApproval = () => {
      const t = localStorage.getItem('token');
      if (!t) return;
      fetch(`${apiUrl}/api/me/pending-manager-approval`, { headers: { Authorization: `Bearer ${t}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => { if (data && typeof data.pending_manager_approval_count === 'number') setPendingManagerApprovalCount(data.pending_manager_approval_count); })
        .catch(() => {});
    };
    fetchPendingApproval();
    const interval = setInterval(fetchPendingApproval, NOTIFY_POLL_MS);
    const onRefresh = () => fetchPendingApproval();
    window.addEventListener('pending-manager-approval-refresh', onRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('pending-manager-approval-refresh', onRefresh);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    if (profileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [profileOpen]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    setTheme(next);
  };

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch (_) {}
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        toast('Shortcuts: ? help, Esc close modal, g then h = History, g then n = New Request', 'success');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast]);

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    toast('Logged out successfully', 'success');
    router.push('/login');
  };

  const newRequestExpandedByPath = pathname.startsWith('/create-infrastructure');
  const effectiveNewRequestExpanded = newRequestExpanded || newRequestExpandedByPath;

  const baseNavItems: { href: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { href: '/home', label: 'Home', Icon: IconHome },
    { href: '/templates', label: 'Templates', Icon: IconTemplates },
    { href: '/history', label: 'History', Icon: IconHistory },
  ];
  if (hasManagedTeams) baseNavItems.push({ href: '/my-teams', label: 'My teams', Icon: IconUsers });

  if (teamCheck === 'loading') {
    return (
      <div className="user-layout-loading">
        <p>Checking access...</p>
      </div>
    );
  }
  if (teamCheck === 'forbidden') {
    return (
      <div className="user-layout-forbidden">
        <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 className="user-forbidden-title">403 Forbidden</h1>
          <p className="user-forbidden-text">
            You are not assigned to any team. Contact your administrator to be added to a team.
          </p>
          <button type="button" className="btn btn-primary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    );
  }

  const pageTitle = getPageTitle(pathname);

  return (
    <div className="user-layout user-layout-sidebar">
      <aside className={`user-sidebar ${sidebarCollapsed ? 'user-sidebar--collapsed' : ''} ${mobileMenuOpen ? 'user-sidebar--mobile-open' : ''}`}>
        <div className="user-sidebar__header">
          <button
            type="button"
            className="user-sidebar__hamburger"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <IconMenu />
          </button>
          <Link href="/home" className="user-sidebar__brand">
            <img src="/logo.svg" alt="" width={36} height={36} className="user-sidebar__logo" />
            {!sidebarCollapsed && <span className="user-sidebar__brand-text">{SITE_NAME}</span>}
          </Link>
        </div>
        <nav className="user-sidebar__nav">
          {!sidebarCollapsed && (
            <div className="user-sidebar__expandable">
              <button
                type="button"
                className={`user-sidebar__link user-sidebar__expandable-trigger ${pathname.startsWith('/create-infrastructure') ? 'user-sidebar__link--active' : ''}`}
                onClick={() => setNewRequestExpanded(!effectiveNewRequestExpanded)}
              >
                <IconPlus className="user-sidebar__icon" />
                <span className="user-sidebar__label">New Request</span>
                <span className="user-sidebar__chevron">
                  {effectiveNewRequestExpanded ? <IconChevronDown /> : <IconChevronRight />}
                </span>
              </button>
              {effectiveNewRequestExpanded && (
                <div className="user-sidebar__sub">
                  <Link
                    href="/create-infrastructure/iam"
                    className={`user-sidebar__sublink ${pathname === '/create-infrastructure/iam' || pathname.startsWith('/create-infrastructure/iam/') ? 'user-sidebar__sublink--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    IAM
                  </Link>
                  <Link
                    href="/create-infrastructure/new"
                    className={`user-sidebar__sublink ${pathname === '/create-infrastructure/new' || pathname.startsWith('/create-infrastructure/new') || pathname === '/select-service' || pathname === '/custom-json' || pathname === '/aws' ? 'user-sidebar__sublink--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Create Infrastructure
                  </Link>
                </div>
              )}
            </div>
          )}
          {sidebarCollapsed && (
            <Link
              href="/create-infrastructure"
              className={`user-sidebar__link ${pathname.startsWith('/create-infrastructure') ? 'user-sidebar__link--active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
              title="New Request"
            >
              <IconPlus className="user-sidebar__icon" />
            </Link>
          )}
          {baseNavItems.map(({ href, label, Icon }) => {
            const isActive = pathname === href || (href !== '/home' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`user-sidebar__link ${isActive ? 'user-sidebar__link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon className="user-sidebar__icon" />
                {!sidebarCollapsed && <span className="user-sidebar__label">{label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="user-sidebar__footer">
          <button type="button" className="user-sidebar__link" onClick={handleLogout}>
            <IconLogout className="user-sidebar__icon" />
            {!sidebarCollapsed && <span className="user-sidebar__label">Logout</span>}
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="user-sidebar-overlay" onClick={() => setMobileMenuOpen(false)} aria-hidden />
      )}

      <div className="user-main-wrapper">
        <header className="user-navbar">
          <div className="user-navbar__left">
            <button
              type="button"
              className="user-navbar__menu-btn"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <IconMenu />
            </button>
            <h1 className="user-navbar__title">{pageTitle}</h1>
          </div>
          <div className="user-navbar__right">
            <div className="user-navbar__actions">
              <Link
                href="/history"
                className="user-navbar__icon-btn"
                title={updatedRequestsCount > 0 ? `${updatedRequestsCount} request update(s)` : 'Notifications'}
              >
                <IconBell />
                {updatedRequestsCount > 0 && (
                  <span className="user-navbar__badge" aria-label={`${updatedRequestsCount} updates`}>
                    {updatedRequestsCount > 99 ? '99+' : updatedRequestsCount}
                  </span>
                )}
              </Link>
              {pendingManagerApprovalCount > 0 && (
                <span className="user-navbar__approval-badge" title={`${pendingManagerApprovalCount} need your approval`}>
                  {pendingManagerApprovalCount > 99 ? '99+' : pendingManagerApprovalCount}
                </span>
              )}
              <button
                type="button"
                className="user-navbar__icon-btn"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              >
                {theme === 'dark' ? <IconSun /> : <IconMoon />}
              </button>
            </div>
            <div className="user-navbar__profile-wrap" ref={profileRef}>
              <button
                type="button"
                className="user-navbar__profile-btn"
                onClick={() => setProfileOpen((o) => !o)}
                aria-expanded={profileOpen}
                aria-haspopup="true"
                title="Profile"
              >
                <span className="user-navbar__avatar">{profileInitials}</span>
                <span className="user-navbar__profile-label">Profile</span>
              </button>
              {profileOpen && (
                <div className="user-navbar__dropdown">
                  <div className="user-navbar__dropdown-header">
                    <span className="user-navbar__dropdown-avatar">{profileInitials}</span>
                    <span className="user-navbar__dropdown-label">Profile</span>
                  </div>
                  <Link href="/profile" className="user-navbar__dropdown-item" onClick={() => setProfileOpen(false)}>
                    Profile
                  </Link>
                  <button type="button" className="user-navbar__dropdown-item" onClick={handleLogout}>
                    <IconLogout />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="user-main">{children}</main>
      </div>
    </div>
  );
}
