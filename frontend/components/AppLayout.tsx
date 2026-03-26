import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ComponentType, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import {
  IconAlertCircle,
  IconLogout,
  IconBell,
  IconHome,
  IconPlus,
  IconTemplates,
  IconProjects,
  IconHistory,
  IconUsers,
  IconChevronRight,
  IconChevronDown,
  IconMenu,
  IconHelpCircle,
  IconFileText,
} from './Icons';
import SupportHub from './SupportHub';
import { supportArticles, supportQuickPrompts } from '../lib/supportContent';

const THEME_KEY = 'user-portal-theme';
const SIDEBAR_COLLAPSED_KEY = 'user-portal-sidebar-collapsed';
const HISTORY_LAST_SEEN_KEY = 'user_history_last_seen';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@setuops.example';

export function getApiUrl(): string {
  return apiUrl;
}

export function getStoredTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined') {
    localStorage.setItem(THEME_KEY, 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  return 'dark';
}

export function setStoredTheme(_theme: 'light' | 'dark') {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THEME_KEY, 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
}

const PAGE_TITLES: Record<string, string> = {
  '/home': 'Workspace',
  '/create-infrastructure': 'Create Infrastructure',
  '/templates': 'Templates',
  '/my-projects': 'My Projects',
  '/history': 'Request History',
  '/incidents': 'Incidents',
  '/my-teams': 'My Teams',
  '/profile': 'Profile',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/home' && pathname.startsWith(path)) return title;
  }
  return 'Dashboard';
}

function getUserIdentity(): { initials: string; label: string } {
  if (typeof window === 'undefined') {
    return { initials: 'U', label: 'Portal User' };
  }

  try {
    const raw = localStorage.getItem('user');
    if (!raw) return { initials: 'U', label: 'Portal User' };

    const user = JSON.parse(raw) as { username?: string; email?: string; name?: string };
    const label = user?.name || user?.username || user?.email || 'Portal User';
    const parts = label.trim().split(/[\s@.]/).filter(Boolean);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2)
      : label.slice(0, 2).toUpperCase() || 'U';

    return { initials, label };
  } catch {
    return { initials: 'U', label: 'Portal User' };
  }
}

interface UserNotificationItem {
  id: number;
  request_id: number | null;
  kind: string;
  message: string;
  read_at: string | null;
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

function formatNotificationKind(kind: string): string {
  return (kind || 'notification')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const pathname = router.pathname;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitials, setProfileInitials] = useState('U');
  const [profileLabel, setProfileLabel] = useState('Portal User');
  const [newRequestExpanded, setNewRequestExpanded] = useState(false);
  const [teamCheck, setTeamCheck] = useState<'loading' | 'ok' | 'forbidden'>('loading');
  const [updatedRequestsCount, setUpdatedRequestsCount] = useState(0);
  const [pendingManagerApprovalCount, setPendingManagerApprovalCount] = useState(0);
  const [hasManagedTeams, setHasManagedTeams] = useState(false);
  const [recentNotifications, setRecentNotifications] = useState<UserNotificationItem[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTab, setSupportTab] = useState<'chat' | 'docs'>('chat');
  const notifyRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const identity = getUserIdentity();
    setProfileInitials(identity.initials);
    setProfileLabel(identity.label);
  }, []);

  useEffect(() => {
    getStoredTheme();
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

  const refreshUserNotifications = (showLoading = false) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || token === 'undefined') return;
    if (showLoading) setNotificationsLoading(true);
    try {
      const since = localStorage.getItem(HISTORY_LAST_SEEN_KEY);
      const sinceParam = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      fetch(`${apiUrl}/api/me/notifications?limit=8&since=${encodeURIComponent(sinceParam)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          if (Array.isArray(data.notifications)) setRecentNotifications(data.notifications);
          if (typeof data.unread_count === 'number') setUnreadNotificationsCount(data.unread_count);
          if (typeof data.updated_count === 'number') setUpdatedRequestsCount(data.updated_count);
        })
        .catch(() => {})
        .finally(() => {
          if (showLoading) setNotificationsLoading(false);
        });
    } catch (_) {
      if (showLoading) setNotificationsLoading(false);
    }
  };

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || token === 'undefined') return;
    refreshUserNotifications();
    const interval = setInterval(() => refreshUserNotifications(), NOTIFY_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (notifyOpen) refreshUserNotifications(true);
  }, [notifyOpen]);

  useEffect(() => {
    setNotifyOpen(false);
    setProfileOpen(false);
    setSupportOpen(false);
  }, [pathname]);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || token === 'undefined') return;

    const fetchPendingApproval = () => {
      const t = localStorage.getItem('token');
      if (!t) return;
      fetch(`${apiUrl}/api/me/pending-manager-approval`, { headers: { Authorization: `Bearer ${t}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.pending_manager_approval_count === 'number') {
            setPendingManagerApprovalCount(data.pending_manager_approval_count);
          }
        })
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
      if (notifyRef.current && !notifyRef.current.contains(e.target as Node)) {
        setNotifyOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };

    if (notifyOpen || profileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [notifyOpen, profileOpen]);

  useEffect(() => {
    let gPressedAt = 0;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        e.preventDefault();
        toast('Shortcuts: ? help, g then h = Dashboard, g then t = Request History, g then n = Create Infrastructure', 'success');
        return;
      }
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        gPressedAt = Date.now();
        return;
      }
      if (gPressedAt && Date.now() - gPressedAt < 800) {
        if (e.key === 'h') {
          e.preventDefault();
          router.push('/home');
        } else if (e.key === 't') {
          e.preventDefault();
          router.push('/history');
        } else if (e.key === 'n') {
          e.preventDefault();
          router.push('/create-infrastructure');
        }
        gPressedAt = 0;
      } else {
        gPressedAt = 0;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast, router]);

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch (_) {}
  };

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    toast('Logged out successfully', 'success');
    router.push('/login');
  };

  const newRequestExpandedByPath = pathname.startsWith('/create-infrastructure');
  const effectiveNewRequestExpanded = newRequestExpanded || newRequestExpandedByPath;
  const baseNavItems: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
    { href: '/home', label: 'Dashboard', Icon: IconHome },
    { href: '/my-projects', label: 'My Projects', Icon: IconProjects },
    { href: '/templates', label: 'Templates', Icon: IconTemplates },
    { href: '/history', label: 'Request History', Icon: IconHistory },
    { href: '/incidents', label: 'Incidents', Icon: IconAlertCircle },
  ];

  if (hasManagedTeams) {
    baseNavItems.push({ href: '/my-teams', label: 'My Teams', Icon: IconUsers });
  }

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
  const summaryLabel = pendingManagerApprovalCount > 0
    ? 'Pending Approvals'
    : updatedRequestsCount > 0
      ? 'Request Updates'
      : 'System Status';
  const statusLabel = pendingManagerApprovalCount > 0
    ? `${pendingManagerApprovalCount} approvals pending`
    : updatedRequestsCount > 0
      ? `${updatedRequestsCount} request updates`
      : 'No new updates';
  const requestActivityBadge = pendingManagerApprovalCount > 0
    ? (pendingManagerApprovalCount > 99 ? '99+' : String(pendingManagerApprovalCount))
    : updatedRequestsCount > 0
      ? (updatedRequestsCount > 99 ? '99+' : String(updatedRequestsCount))
      : null;
  const sidebarStatusItems = [
    {
      label: hasManagedTeams ? 'manager-queue' : 'request-feed',
      tone: pendingManagerApprovalCount > 0 ? 'warn' : 'ok',
      meta: pendingManagerApprovalCount > 0 ? `${pendingManagerApprovalCount} open` : 'clear',
    },
    { label: 'template-library', tone: 'ok', meta: 'ready' },
    { label: 'team-access', tone: hasManagedTeams ? 'ok' : 'idle', meta: hasManagedTeams ? 'lead' : 'member' },
  ];
  const notifyBadgeCount = pendingManagerApprovalCount > 0
    ? pendingManagerApprovalCount
    : unreadNotificationsCount > 0
      ? unreadNotificationsCount
      : updatedRequestsCount;
  const notificationSummary = notifyBadgeCount > 0
    ? hasManagedTeams
      ? `${notifyBadgeCount} updates are waiting across approvals and personal notifications.`
      : `${notifyBadgeCount} unread updates are waiting in your inbox.`
    : hasManagedTeams
      ? 'You are caught up on approvals and recent notifications.'
      : 'No fresh updates right now.';

  return (
    <div className="user-layout user-layout-sidebar user-shell">
      <aside className={`user-sidebar-shell ${sidebarCollapsed ? 'user-sidebar-shell--collapsed' : ''} ${mobileMenuOpen ? 'user-sidebar-shell--mobile-open' : ''}`}>
        <div className="user-sidebar-shell__header">
          <button
            type="button"
            className="user-sidebar-shell__hamburger"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <IconMenu />
          </button>
          {!sidebarCollapsed && (
            <Link href="/home" className="user-sidebar-shell__brand">
              <span className="user-sidebar-shell__brand-word user-sidebar-shell__brand-word--primary">SetuOps</span>
              <span className="user-sidebar-shell__brand-word">User Portal</span>
            </Link>
          )}
        </div>
        <div className="user-sidebar-shell__body">
          <nav className="user-sidebar-shell__nav">
            {!sidebarCollapsed && <span className="user-sidebar-shell__nav-title">Modules</span>}
            {baseNavItems.filter((item) => item.href === '/home').map(({ href, label, Icon }) => {
              const isActive = pathname === href || (href !== '/home' && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={`user-sidebar-shell__link ${isActive ? 'user-sidebar-shell__link--active' : ''}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="user-sidebar-shell__icon" />
                  {!sidebarCollapsed && <span className="user-sidebar-shell__label">{label}</span>}
                </Link>
              );
            })}

            {!sidebarCollapsed && (
              <div className="user-sidebar-shell__expandable">
                <button
                  type="button"
                  className={`user-sidebar-shell__link user-sidebar-shell__expandable-trigger ${pathname.startsWith('/create-infrastructure') ? 'user-sidebar-shell__link--active' : ''}`}
                  onClick={() => setNewRequestExpanded(!effectiveNewRequestExpanded)}
                >
                  <IconPlus className="user-sidebar-shell__icon" />
                  <span className="user-sidebar-shell__label">Create Infrastructure</span>
                  <span className="user-sidebar-shell__chevron">
                    {effectiveNewRequestExpanded ? <IconChevronDown /> : <IconChevronRight />}
                  </span>
                </button>

                {effectiveNewRequestExpanded && (
                  <div className="user-sidebar-shell__sub">
                    <Link
                      href="/create-infrastructure/iam"
                      className={`user-sidebar-shell__sublink ${pathname === '/create-infrastructure/iam' || pathname.startsWith('/create-infrastructure/iam/') ? 'user-sidebar-shell__sublink--active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      IAM
                    </Link>
                    <Link
                      href="/create-infrastructure/new"
                      className={`user-sidebar-shell__sublink ${pathname === '/create-infrastructure/new' || pathname.startsWith('/create-infrastructure/new') || pathname === '/select-service' || pathname === '/custom-json' || pathname === '/aws' ? 'user-sidebar-shell__sublink--active' : ''}`}
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
                className={`user-sidebar-shell__link ${pathname.startsWith('/create-infrastructure') ? 'user-sidebar-shell__link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
                title="Create Infrastructure"
              >
                <IconPlus className="user-sidebar-shell__icon" />
              </Link>
            )}

            {baseNavItems.filter((item) => item.href !== '/home').map(({ href, label, Icon }) => {
              const isActive = pathname === href || (href !== '/home' && pathname.startsWith(href));
              const badge = href === '/history' ? requestActivityBadge : null;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`user-sidebar-shell__link ${isActive ? 'user-sidebar-shell__link--active' : ''}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="user-sidebar-shell__icon" />
                  {!sidebarCollapsed && <span className="user-sidebar-shell__label">{label}</span>}
                  {!sidebarCollapsed && badge && <span className="user-sidebar-shell__badge">{badge}</span>}
                </Link>
              );
            })}
          </nav>

          {!sidebarCollapsed && (
            <div className="user-sidebar-shell__status-panel">
              <span className="user-sidebar-shell__status-title">{summaryLabel}</span>
              <div className="user-sidebar-shell__status-list">
                {sidebarStatusItems.map((item) => (
                  <div key={item.label} className="user-sidebar-shell__status-item">
                    <span className={`user-sidebar-shell__status-dot user-sidebar-shell__status-dot--${item.tone}`} aria-hidden />
                    <span className="user-sidebar-shell__status-name">{item.label}</span>
                    <span className="user-sidebar-shell__status-meta">{item.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="user-sidebar-shell__footer">
            <button
              type="button"
              className="user-sidebar-shell__link"
              onClick={() => {
                setNotifyOpen(false);
                setProfileOpen(false);
                setSupportTab('chat');
                setSupportOpen(true);
                setMobileMenuOpen(false);
              }}
              title="Support"
            >
              <IconHelpCircle className="user-sidebar-shell__icon" />
              {!sidebarCollapsed && <span className="user-sidebar-shell__label">Support</span>}
            </button>
            <button
              type="button"
              className="user-sidebar-shell__link"
              onClick={() => {
                setNotifyOpen(false);
                setProfileOpen(false);
                setSupportTab('docs');
                setSupportOpen(true);
                setMobileMenuOpen(false);
              }}
              title="Documentation"
            >
              <IconFileText className="user-sidebar-shell__icon" />
              {!sidebarCollapsed && <span className="user-sidebar-shell__label">Documentation</span>}
            </button>
            <button type="button" className="user-sidebar-shell__link" onClick={handleLogout}>
              <IconLogout className="user-sidebar-shell__icon" />
              {!sidebarCollapsed && <span className="user-sidebar-shell__label">Logout</span>}
            </button>
          </div>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="user-sidebar-shell-overlay" onClick={() => setMobileMenuOpen(false)} aria-hidden />
      )}

      <div className="user-main-shell">
        <header className="user-topbar">
          <div className="user-topbar__left">
            <button
              type="button"
              className="user-topbar__menu-btn"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <IconMenu />
            </button>
            <div className="user-topbar__title-wrap">
              <span className="user-topbar__kicker">User Portal</span>
              <h1 className="user-topbar__title">{pageTitle}</h1>
            </div>
            <span className={`user-topbar__status-chip ${pendingManagerApprovalCount > 0 ? 'user-topbar__status-chip--alert' : ''}`}>
              {statusLabel}
            </span>
          </div>

          <div className="user-topbar__right">
            <div className="user-topbar__actions">
              <button
                type="button"
                className="user-topbar__assist-btn"
                onClick={() => {
                  setSupportTab('chat');
                  setSupportOpen(true);
                  setNotifyOpen(false);
                  setProfileOpen(false);
                }}
              >
                <IconHelpCircle />
                <span>Ask SetuOps</span>
              </button>
              <span className="user-topbar__workspace">{profileLabel}</span>
              <span className="user-topbar__role">{hasManagedTeams ? 'Lead' : 'Requester'}</span>
              <div className="user-topbar__notify-wrap" ref={notifyRef}>
                <button
                  type="button"
                  className="user-topbar__icon-btn"
                  onClick={() => {
                    setNotifyOpen((open) => !open);
                    setProfileOpen(false);
                    setSupportOpen(false);
                  }}
                  title={notifyBadgeCount > 0 ? `${notifyBadgeCount} notifications` : 'Notifications'}
                  aria-expanded={notifyOpen}
                  aria-haspopup="true"
                >
                  <IconBell />
                  {notifyBadgeCount > 0 && <span className="user-topbar__badge user-topbar__badge--dot" aria-hidden />}
                </button>

                {notifyOpen && (
                  <div className="user-topbar__notify-panel">
                    <div className="user-topbar__notify-header">
                      <h3 className="user-topbar__notify-title">Notifications</h3>
                      <button type="button" className="user-topbar__notify-close" onClick={() => setNotifyOpen(false)} aria-label="Close">
                        Close
                      </button>
                    </div>
                    <div className="user-topbar__notify-summary">
                      <strong>{notifyBadgeCount > 99 ? '99+' : notifyBadgeCount}</strong>
                      <span>{notificationSummary}</span>
                    </div>
                    <div className="user-topbar__notify-links">
                      <Link href="/history" className="user-topbar__notify-link" onClick={() => setNotifyOpen(false)}>
                        Open request history
                      </Link>
                      {hasManagedTeams && (
                        <Link href="/history" className="user-topbar__notify-link" onClick={() => setNotifyOpen(false)}>
                          Review approvals
                        </Link>
                      )}
                    </div>
                    <div className="user-topbar__notify-list">
                      {hasManagedTeams && pendingManagerApprovalCount > 0 && (
                        <Link href="/history" className="user-topbar__notify-ticket" onClick={() => setNotifyOpen(false)}>
                          <strong>Manager approvals</strong>
                          <span>{pendingManagerApprovalCount} request(s) are waiting for your review.</span>
                          <small>Open request history</small>
                        </Link>
                      )}
                      {notificationsLoading ? (
                        <p className="user-topbar__notify-empty">Loading...</p>
                      ) : recentNotifications.length === 0 && pendingManagerApprovalCount === 0 ? (
                        <p className="user-topbar__notify-empty">No recent notifications.</p>
                      ) : (
                        recentNotifications.map((notification) => (
                          <Link
                            key={notification.id}
                            href={notification.request_id ? `/history?id=${notification.request_id}` : '/history'}
                            className="user-topbar__notify-ticket"
                            onClick={() => setNotifyOpen(false)}
                          >
                            <strong>{formatNotificationKind(notification.kind)}</strong>
                            <span>{notification.message}</span>
                            <small>{formatTime(notification.created_at)}</small>
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="user-topbar__profile-wrap" ref={profileRef}>
              <button
                type="button"
                className="user-topbar__profile-btn"
                onClick={() => {
                  setProfileOpen((o) => !o);
                  setNotifyOpen(false);
                  setSupportOpen(false);
                }}
                aria-expanded={profileOpen}
                aria-haspopup="true"
                title="Profile"
              >
                <span className="user-topbar__avatar">{profileInitials}</span>
                <span className="user-topbar__profile-label">{profileLabel}</span>
              </button>

              {profileOpen && (
                <div className="user-topbar__dropdown">
                  <div className="user-topbar__dropdown-header">
                    <span className="user-topbar__dropdown-avatar">{profileInitials}</span>
                    <span className="user-topbar__dropdown-label">{profileLabel}</span>
                  </div>
                  <Link href="/profile" className="user-topbar__dropdown-item" onClick={() => setProfileOpen(false)}>
                    Profile
                  </Link>
                  <button type="button" className="user-topbar__dropdown-item" onClick={handleLogout}>
                    <IconLogout />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="user-main-shell__content">{children}</main>
      </div>
      <SupportHub
        open={supportOpen}
        initialTab={supportTab}
        onClose={() => setSupportOpen(false)}
        portalName="User Portal"
        currentPath={pathname}
        currentTitle={pageTitle}
        articles={supportArticles}
        quickPrompts={supportQuickPrompts}
        externalDocsHref={process.env.NEXT_PUBLIC_DOCS_URL || ''}
        escalationActions={[
          {
            label: 'Email platform support',
            externalHref: `mailto:${supportEmail}?subject=${encodeURIComponent(`SetuOps support: ${pageTitle}`)}`,
          },
          { label: 'Open incidents', href: '/incidents' },
          { label: 'Open request history', href: '/history' },
        ]}
      />
    </div>
  );
}
