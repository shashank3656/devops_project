import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  IconLogout,
  IconBell,
  IconTickets,
  IconWorkload,
  IconTemplates,
  IconGitOps,
  IconUsers,
  IconMenu,
  IconShield,
} from './Icons';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const DEVOPS_THEME_KEY = 'infra-portal-theme';
const SIDEBAR_COLLAPSED_KEY = 'devops-sidebar-collapsed';

interface DevopsUser {
  id: number;
  username: string;
  email?: string;
  user_type?: string;
  devops_profile?: { is_manager: boolean; level: string; position?: string; onboard_date?: string };
}

function getProfileInitials(): string {
  if (typeof window === 'undefined') return 'D';
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    if (!raw) return 'D';
    const user = JSON.parse(raw) as { username?: string; email?: string };
    const name = user?.username || user?.email || '';
    if (!name) return 'D';
    const parts = name.trim().split(/[\s@.]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    return name.slice(0, 2).toUpperCase();
  } catch {
    return 'D';
  }
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/workload': 'Workload',
  '/tickets': 'Tickets',
  '/templates': 'Templates',
  '/gitops-projects': 'GitOps Projects',
  '/gitops-control': 'Project Structure',
  '/team': 'Teams',
  '/credential-audit': 'Credential Audit',
  '/profile': 'Profile',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/dashboard' && pathname.startsWith(path)) return title;
  }
  return 'Dashboard';
}

interface PendingApprovalItem {
  id: number;
  team?: string;
  cloud?: string;
  service?: string;
  created_at: string;
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

export default function DevOpsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const pathname = router.pathname;
  const [user, setUser] = useState<DevopsUser | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitials, setProfileInitials] = useState('D');
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalItem[]>([]);
  const [pendingApprovalsLoading, setPendingApprovalsLoading] = useState(false);
  const notifyRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProfileInitials(getProfileInitials());
  }, []);

  useEffect(() => {
    try {
      const u = localStorage.getItem(DEVOPS_USER_KEY);
      if (u) setUser(JSON.parse(u));
      localStorage.setItem(DEVOPS_THEME_KEY, 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setSidebarCollapsed(c === 'true');
    } catch (_) {}
  }, []);

  const isManager = user?.devops_profile?.is_manager ?? false;

  const refreshPendingCount = useCallback(() => {
    if (!isManager) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.status === 'ok' && typeof data.pending_approval_count === 'number')
          setPendingCount(data.pending_approval_count);
      })
      .catch(() => {});
  }, [isManager, apiUrl]);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  useEffect(() => {
    if (!isManager) return;
    const onRefresh = () => refreshPendingCount();
    window.addEventListener('devops-notifications-refresh', onRefresh);
    return () => window.removeEventListener('devops-notifications-refresh', onRefresh);
  }, [isManager, refreshPendingCount]);

  const refreshPendingApprovals = useCallback(() => {
    if (!isManager) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setPendingApprovalsLoading(true);
    fetch(`${apiUrl}/api/devops/pending-approvals`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setPendingApprovals(Array.isArray(data?.requests) ? data.requests : []);
      })
      .catch(() => setPendingApprovals([]))
      .finally(() => setPendingApprovalsLoading(false));
  }, [apiUrl, isManager]);

  useEffect(() => {
    if (notifyOpen) refreshPendingApprovals();
  }, [notifyOpen, refreshPendingApprovals]);

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

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch (_) {}
  };

  useEffect(() => {
    let gPressedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        e.preventDefault();
        const msg = isManager
          ? 'Shortcuts: ? help, g then d = Dashboard, g then t = Tickets, g then w = Workload'
          : 'Shortcuts: ? help, g then d = Dashboard';
        alert(msg);
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
        } else if (e.key === 't' && isManager) {
          e.preventDefault();
          router.push('/tickets');
        } else if (e.key === 'w' && isManager) {
          e.preventDefault();
          router.push('/workload');
        }
        gPressedAt = 0;
      } else {
        gPressedAt = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, isManager]);

  const handleLogout = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.replace('/login');
  };

  const baseNavItems: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
    { href: '/dashboard', label: 'Dashboard', Icon: IconTickets },
  ];
  if (isManager) {
    baseNavItems.push({ href: '/workload', label: 'Workload', Icon: IconWorkload });
    baseNavItems.push({ href: '/tickets', label: 'Tickets', Icon: IconTickets });
    baseNavItems.push({ href: '/gitops-control', label: 'Project Structure', Icon: IconGitOps });
  }
  baseNavItems.push({ href: '/gitops-projects', label: 'GitOps Projects', Icon: IconGitOps });
  baseNavItems.push({ href: '/templates', label: 'Templates', Icon: IconTemplates });
  baseNavItems.push({ href: '/credential-audit', label: 'Credential Audit', Icon: IconShield });
  if (isManager) baseNavItems.push({ href: '/team', label: 'Teams', Icon: IconUsers });

  const pageTitle = getPageTitle(pathname);
  const roleLabel = isManager ? 'Manager' : 'Contributor';
  const statusLabel = isManager
    ? pendingCount > 0
      ? `${pendingCount} pending approvals`
      : 'No pending approvals'
    : 'Active session';
  const sidebarStatusItems = isManager
    ? [
        { label: 'approval-queue', tone: pendingCount > 0 ? 'warn' : 'ok', meta: pendingCount > 0 ? `${pendingCount} open` : 'clear' },
        { label: 'template-registry', tone: 'ok', meta: 'ready' },
        { label: 'audit-stream', tone: 'ok', meta: 'live' },
      ]
    : [
        { label: 'session-scope', tone: 'ok', meta: 'live' },
        { label: 'template-registry', tone: 'ok', meta: 'ready' },
        { label: 'audit-stream', tone: 'idle', meta: 'view' },
      ];

  const getSidebarBadge = (href: string): string | null => {
    if (href === '/tickets' && isManager && pendingCount > 0) {
      return pendingCount > 99 ? '99+' : String(pendingCount);
    }
    return null;
  };

  return (
    <div className="devops-layout devops-layout-sidebar">
      <aside
        className={`devops-sidebar-new ${sidebarCollapsed ? 'devops-sidebar-new--collapsed' : ''} ${mobileMenuOpen ? 'devops-sidebar-new--mobile-open' : ''}`}
      >
        <div className="devops-sidebar-new__header">
          <button
            type="button"
            className="devops-sidebar-new__hamburger"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <IconMenu />
          </button>
          {!sidebarCollapsed && (
            <Link href="/dashboard" className="devops-sidebar-new__brand">
              <>
                <span className="devops-sidebar-new__brand-word devops-sidebar-new__brand-word--primary">DevOps</span>
                <span className="devops-sidebar-new__brand-word">Portal</span>
              </>
            </Link>
          )}
        </div>
        <div className="devops-sidebar-new__body">
          <nav className="devops-sidebar-new__nav">
            {!sidebarCollapsed && <span className="devops-sidebar-new__nav-title">Modules</span>}
            {baseNavItems.map(({ href, label, Icon }) => {
              const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
              const badge = getSidebarBadge(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`devops-sidebar-new__link ${isActive ? 'devops-sidebar-new__link--active' : ''}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="devops-sidebar-new__icon" />
                  {!sidebarCollapsed && <span className="devops-sidebar-new__label">{label}</span>}
                  {!sidebarCollapsed && badge && <span className="devops-sidebar-new__badge">{badge}</span>}
                </Link>
              );
            })}
          </nav>
          {!sidebarCollapsed && (
            <div className="devops-sidebar-new__status-panel">
              <span className="devops-sidebar-new__status-title">System Health</span>
              <div className="devops-sidebar-new__status-list">
                {sidebarStatusItems.map((item) => (
                  <div key={item.label} className="devops-sidebar-new__status-item">
                    <span className={`devops-sidebar-new__status-dot devops-sidebar-new__status-dot--${item.tone}`} aria-hidden />
                    <span className="devops-sidebar-new__status-name">{item.label}</span>
                    <span className="devops-sidebar-new__status-meta">{item.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="devops-sidebar-new__footer">
            <button type="button" className="devops-sidebar-new__link" onClick={handleLogout}>
              <IconLogout className="devops-sidebar-new__icon" />
              {!sidebarCollapsed && <span className="devops-sidebar-new__label">Logout</span>}
            </button>
          </div>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="devops-sidebar-new-overlay" onClick={() => setMobileMenuOpen(false)} aria-hidden />
      )}

      <div className="devops-main-wrapper-new">
        <header className="devops-navbar">
          <div className="devops-navbar__left">
            <button
              type="button"
              className="devops-navbar__menu-btn"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <IconMenu />
            </button>
            <div className="devops-navbar__title-wrap">
              <span className="devops-navbar__kicker">DevOps Portal</span>
              <h1 className="devops-navbar__title">{pageTitle}</h1>
            </div>
            <span className={`devops-navbar__status-chip ${isManager && pendingCount > 0 ? 'devops-navbar__status-chip--alert' : ''}`}>
              {statusLabel}
            </span>
          </div>
          <div className="devops-navbar__right">
            <div className="devops-navbar__actions">
              {user && <span className="devops-navbar__username">{user.username}</span>}
              <span className="devops-navbar__role">{roleLabel}</span>
              {isManager && (
                <div className="devops-navbar__notify-wrap" ref={notifyRef}>
                  <button
                    type="button"
                    className="devops-navbar__icon-btn"
                    onClick={() => {
                      setNotifyOpen((open) => !open);
                      setProfileOpen(false);
                    }}
                    title={pendingCount > 0 ? `${pendingCount} pending approvals` : 'Pending approvals'}
                    aria-expanded={notifyOpen}
                    aria-haspopup="true"
                  >
                    <IconBell />
                    {pendingCount > 0 && (
                      <span className="devops-navbar__badge" aria-label={`${pendingCount} pending approvals`}>
                        {pendingCount > 99 ? '99+' : pendingCount}
                      </span>
                    )}
                  </button>

                  {notifyOpen && (
                    <div className="devops-navbar__notify-panel">
                      <div className="devops-navbar__notify-header">
                        <h3 className="devops-navbar__notify-title">Pending Approvals</h3>
                        <button type="button" className="devops-navbar__notify-close" onClick={() => setNotifyOpen(false)} aria-label="Close">
                          x
                        </button>
                      </div>
                      <Link href="/tickets" className="devops-navbar__notify-link" onClick={() => setNotifyOpen(false)}>
                        Open tickets
                      </Link>
                      <div className="devops-navbar__notify-list">
                        {pendingApprovalsLoading ? (
                          <p className="devops-navbar__notify-empty">Loading...</p>
                        ) : pendingApprovals.length === 0 ? (
                          <p className="devops-navbar__notify-empty">No pending approval tickets.</p>
                        ) : (
                          pendingApprovals.slice(0, 8).map((request) => (
                            <Link
                              key={request.id}
                              href={`/tickets?id=${request.id}`}
                              className="devops-navbar__notify-ticket"
                              onClick={() => setNotifyOpen(false)}
                            >
                              <strong>Ticket #{request.id}</strong>
                              <span>{request.team || 'Team'} / {request.cloud || 'Cloud'} / {request.service || 'Service'}</span>
                              <small>{formatTime(request.created_at)}</small>
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="devops-navbar__profile-wrap" ref={profileRef}>
              <button
                type="button"
                className="devops-navbar__profile-btn"
                onClick={() => {
                  setProfileOpen((o) => !o);
                  setNotifyOpen(false);
                }}
                aria-expanded={profileOpen}
                aria-haspopup="true"
                title="Profile"
              >
                <span className="devops-navbar__avatar">{profileInitials}</span>
                <span className="devops-navbar__profile-label">{user?.username || 'DevOps'}</span>
              </button>
              {profileOpen && (
                <div className="devops-navbar__dropdown">
                  <div className="devops-navbar__dropdown-header">
                    <span className="devops-navbar__dropdown-avatar">{profileInitials}</span>
                    <span className="devops-navbar__dropdown-label">{user?.username || 'DevOps'}</span>
                  </div>
                  <Link href="/profile" className="devops-navbar__dropdown-item" onClick={() => setProfileOpen(false)}>
                    Profile
                  </Link>
                  <button type="button" className="devops-navbar__dropdown-item" onClick={handleLogout}>
                    <IconLogout />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="devops-main-new">{children}</main>
      </div>
    </div>
  );
}
