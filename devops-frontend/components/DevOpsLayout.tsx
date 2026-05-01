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
  IconProjects,
  IconUsers,
  IconMenu,
  IconShield,
  IconBookOpen,
  IconAlertTriangle,
  IconKey,
  IconArrowUpRight,
  IconRefreshCw,
  IconK8s,
  IconHelpCircle,
  IconFileText,
  IconChevronRight,
  IconChevronDown,
  IconLeaf,
} from './Icons';
import SupportHub from './SupportHub';
import { supportArticles, supportQuickPrompts } from '../lib/supportContent';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const DEVOPS_THEME_KEY = 'infra-portal-theme';
const SIDEBAR_COLLAPSED_KEY = 'devops-sidebar-collapsed';
const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@setuops.example';

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
  '/dashboard': 'Overview',
  '/approval-center': 'Approvals',
  '/approval-sla': 'Approval Timing',
  '/project-operations': 'Project Work',
  '/service-heatmap': 'Service Health',
  '/ops-command-center': 'Operations',
  '/k8s/onboard': 'Onboard Cluster',
  '/k8s/pods': 'Pods',
  '/k8s/logs': 'Logs',
  '/k8s/events': 'Events',
  '/k8s/namespaces': 'Namespace',
  '/k8s/rollouts': 'Rollouts',
  '/k8s/workloads': 'Workloads',
  '/k8s/services': 'Services',
  '/k8s/ingresses': 'Ingress',
  '/k8s/secrets': 'Secrets',
  '/k8s/configmaps': 'ConfigMaps',
  '/k8s/storage': 'Storage',
  '/k8s/certificates': 'TLS & Certificates',
  '/k8s/clusters': 'K8s Cluster',
  '/k8s': 'K8s Cluster',
  '/runbooks': 'Guides',
  '/incidents': 'Incidents',
  '/incident-workspace': 'Incident Notes',
  '/access-overrides': 'Access Exceptions',
  '/promotions': 'Promotions',
  '/rollback-console': 'Rollback',
  '/gate-approvals': 'Approval History',
  '/gate-policies': 'Approval Rules',
  '/notification-settings': 'Alert Settings',
  '/approval-notification-analytics': 'Analytics',
  '/retry-center': 'Delivery Retries',
  '/workload': 'Workload',
  '/tickets': 'Requests',
  '/templates': 'Request Templates',
  '/projects': 'Projects',
  '/team': 'Team',
  '/credential-audit': 'Secrets',
  '/profile': 'Profile',
  '/idle-resources': 'Idle Resources',
  '/idle-resources/accounts/new': 'Connect Cloud Account',
  '/idle-resources/settings': 'Idle Resources Settings',
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
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
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
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTab, setSupportTab] = useState<'chat' | 'docs'>('chat');
  const [advancedNavOpen, setAdvancedNavOpen] = useState(false);
  const [k8sNavOpen, setK8sNavOpen] = useState(pathname.startsWith('/k8s'));
  const notifyRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const clearSessionAndRedirect = useCallback(() => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
      return;
    }
    router.replace('/login');
  }, [router]);

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

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    fetch(`${apiUrl}/api/devops/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        if (!response.ok) {
          return null;
        }
        return response.json().catch(() => null);
      })
      .then((data) => {
        if (data?.user) {
          setUser(data.user);
          localStorage.setItem(DEVOPS_USER_KEY, JSON.stringify(data.user));
          if (typeof data.token === 'string' && data.token.trim()) {
            localStorage.setItem(DEVOPS_TOKEN_KEY, data.token.trim());
          }
        }
      })
      .catch(() => {});
  }, [apiUrl, clearSessionAndRedirect]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const refreshSession = () => {
      const currentToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
      if (!currentToken) return;
      fetch(`${apiUrl}/api/devops/me`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      })
        .then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            clearSessionAndRedirect();
            return null;
          }
          if (!response.ok) {
            return null;
          }
          return response.json().catch(() => null);
        })
        .then((data) => {
          if (data?.user) {
            setUser(data.user);
            localStorage.setItem(DEVOPS_USER_KEY, JSON.stringify(data.user));
            if (typeof data.token === 'string' && data.token.trim()) {
              localStorage.setItem(DEVOPS_TOKEN_KEY, data.token.trim());
            }
          }
        })
        .catch(() => {});
    };
    const interval = window.setInterval(refreshSession, 20 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [apiUrl, clearSessionAndRedirect]);

  const isManager = user?.devops_profile?.is_manager ?? false;

  const refreshPendingCount = useCallback(() => {
    if (!isManager) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((data) => {
        if (data?.status === 'ok' && typeof data.pending_approval_count === 'number')
          setPendingCount(data.pending_approval_count);
      })
      .catch(() => {});
  }, [isManager, apiUrl, clearSessionAndRedirect]);

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
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((data) => {
        setPendingApprovals(Array.isArray(data?.requests) ? data.requests : []);
      })
      .catch(() => setPendingApprovals([]))
      .finally(() => setPendingApprovalsLoading(false));
  }, [apiUrl, isManager, clearSessionAndRedirect]);

  useEffect(() => {
    if (notifyOpen) refreshPendingApprovals();
  }, [notifyOpen, refreshPendingApprovals]);

  useEffect(() => {
    setNotifyOpen(false);
    setProfileOpen(false);
    setSupportOpen(false);
  }, [pathname]);

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
          ? 'Shortcuts: ? help, g then d = Overview, g then t = Requests, g then a = Approvals'
          : 'Shortcuts: ? help, g then d = Overview';
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
        } else if (e.key === 'a' && isManager) {
          e.preventDefault();
          router.push('/approval-center');
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

const primaryNavItems: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
    { href: '/dashboard', label: 'Overview', Icon: IconTickets },
    { href: '/tickets', label: 'Requests', Icon: IconTickets },
    { href: '/templates', label: 'Request Templates', Icon: IconTemplates },
    { href: '/credential-audit', label: 'Secrets', Icon: IconShield },
    { href: '/idle-resources', label: 'Idle Resources', Icon: IconLeaf },
  ];
  if (isManager) {
    primaryNavItems.splice(1, 0, { href: '/approval-center', label: 'Approvals', Icon: IconShield });
    primaryNavItems.splice(2, 0, { href: '/promotions', label: 'Promotions', Icon: IconArrowUpRight });
    primaryNavItems.splice(3, 0, { href: '/incidents', label: 'Incidents', Icon: IconAlertTriangle });
    primaryNavItems.push({ href: '/projects', label: 'Projects', Icon: IconProjects });
    primaryNavItems.push({ href: '/team', label: 'Teams', Icon: IconUsers });
  }

  const advancedNavItems: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = isManager
    ? [
        { href: '/approval-sla', label: 'Approval Timing', Icon: IconShield },
        { href: '/ops-command-center', label: 'Operations', Icon: IconAlertTriangle },
        { href: '/runbooks', label: 'Guides', Icon: IconBookOpen },
        { href: '/access-overrides', label: 'Access Exceptions', Icon: IconKey },
        { href: '/rollback-console', label: 'Rollback', Icon: IconRefreshCw },
        { href: '/gate-approvals', label: 'Approval History', Icon: IconShield },
        { href: '/gate-policies', label: 'Approval Rules', Icon: IconShield },
        { href: '/notification-settings', label: 'Alert Settings', Icon: IconBell },
        { href: '/retry-center', label: 'Delivery Retries', Icon: IconRefreshCw },
      ]
    : [];
  const advancedNavActive = advancedNavItems.some(
    ({ href }) => pathname === href || (href !== '/dashboard' && pathname.startsWith(href)),
  );
  const k8sNavActive = pathname === '/k8s' || pathname.startsWith('/k8s/');
  const k8sNavItems = [
    { href: '/k8s', label: 'K8s Cluster' },
    { href: '/k8s/pods', label: 'Pods' },
    { href: '/k8s/logs', label: 'Logs' },
    { href: '/k8s/events', label: 'Events' },
    { href: '/k8s/rollouts', label: 'Rollouts' },
    { href: '/k8s/workloads', label: 'Workloads' },
    { href: '/k8s/services', label: 'Services' },
    { href: '/k8s/ingresses', label: 'Ingress' },
    { href: '/k8s/secrets', label: 'Secrets' },
    { href: '/k8s/configmaps', label: 'ConfigMaps' },
    { href: '/k8s/storage', label: 'Storage' },
    { href: '/k8s/certificates', label: 'TLS & Certificates' },
    { href: '/k8s/onboard', label: 'Onboard Cluster' },
  ];

  useEffect(() => {
    if (advancedNavActive) setAdvancedNavOpen(true);
  }, [advancedNavActive]);

  useEffect(() => {
    if (k8sNavActive) setK8sNavOpen(true);
  }, [k8sNavActive]);

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
              <span className="devops-sidebar-new__brand-word devops-sidebar-new__brand-word--primary">SetuOps</span>
              <span className="devops-sidebar-new__brand-word">DevOps</span>
            </Link>
          )}
        </div>
        <div className="devops-sidebar-new__body">
          <nav className="devops-sidebar-new__nav">
            {!sidebarCollapsed && <span className="devops-sidebar-new__nav-title">Modules</span>}
            {primaryNavItems.filter((item) => item.href === '/dashboard').map(({ href, label, Icon }) => {
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
            {!sidebarCollapsed && (
              <div className="devops-sidebar-new__expandable">
                <button
                  type="button"
                  className={`devops-sidebar-new__link devops-sidebar-new__expandable-trigger ${k8sNavActive ? 'devops-sidebar-new__link--active' : ''}`}
                  onClick={() => setK8sNavOpen((open) => !open)}
                  aria-expanded={k8sNavOpen}
                >
                  <IconK8s className="devops-sidebar-new__icon" />
                  <span className="devops-sidebar-new__label">K8s Cluster</span>
                  <span className="devops-sidebar-new__chevron">
                    {k8sNavOpen ? <IconChevronDown /> : <IconChevronRight />}
                  </span>
                </button>

                {k8sNavOpen && (
                  <div className="devops-sidebar-new__sub">
                    {k8sNavItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`devops-sidebar-new__sublink ${pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'devops-sidebar-new__sublink--active' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            {primaryNavItems.filter((item) => item.href !== '/dashboard').map(({ href, label, Icon }) => {
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
            {sidebarCollapsed && (
              <Link
                href="/k8s"
                className={`devops-sidebar-new__link ${k8sNavActive ? 'devops-sidebar-new__link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
                title="K8s Cluster"
              >
                <IconK8s className="devops-sidebar-new__icon" />
              </Link>
            )}
            {!sidebarCollapsed && advancedNavItems.length > 0 && (
              <div className="devops-sidebar-new__section">
                <button
                  type="button"
                  className={`devops-sidebar-new__section-toggle ${advancedNavOpen ? 'devops-sidebar-new__section-toggle--open' : ''}`}
                  onClick={() => setAdvancedNavOpen((open) => !open)}
                  aria-expanded={advancedNavOpen}
                >
                  <span>More tools</span>
                  <span className="devops-sidebar-new__section-meta">{advancedNavOpen ? 'Hide' : 'Show'}</span>
                </button>
                {advancedNavOpen && (
                  <div className="devops-sidebar-new__section-body">
                    <p className="devops-sidebar-new__section-copy">
                      Extra tools stay here so the main menu stays simple.
                    </p>
                    {advancedNavItems.map(({ href, label, Icon }) => {
                      const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={`devops-sidebar-new__link ${isActive ? 'devops-sidebar-new__link--active' : ''}`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <Icon className="devops-sidebar-new__icon" />
                          <span className="devops-sidebar-new__label">{label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
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
            <button
              type="button"
              className="devops-sidebar-new__link"
              onClick={() => {
                setNotifyOpen(false);
                setProfileOpen(false);
                setSupportTab('chat');
                setSupportOpen(true);
                setMobileMenuOpen(false);
              }}
              title="Support"
            >
              <IconHelpCircle className="devops-sidebar-new__icon" />
              {!sidebarCollapsed && <span className="devops-sidebar-new__label">Support</span>}
            </button>
            <button
              type="button"
              className="devops-sidebar-new__link"
              onClick={() => {
                setNotifyOpen(false);
                setProfileOpen(false);
                setSupportTab('docs');
                setSupportOpen(true);
                setMobileMenuOpen(false);
              }}
              title="Documentation"
            >
              <IconFileText className="devops-sidebar-new__icon" />
              {!sidebarCollapsed && <span className="devops-sidebar-new__label">Documentation</span>}
            </button>
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
              <span className="devops-navbar__kicker">SetuOps</span>
              <h1 className="devops-navbar__title">{pageTitle}</h1>
            </div>
            <span className={`devops-navbar__status-chip ${isManager && pendingCount > 0 ? 'devops-navbar__status-chip--alert' : ''}`}>
              {statusLabel}
            </span>
          </div>
          <div className="devops-navbar__right">
            <div className="devops-navbar__actions">
              <button
                type="button"
                className="devops-navbar__assist-btn"
                onClick={() => {
                  setSupportTab('chat');
                  setSupportOpen(true);
                  setNotifyOpen(false);
                  setProfileOpen(false);
                }}
              >
                <IconHelpCircle />
                <span>Help</span>
              </button>
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
                      setSupportOpen(false);
                    }}
                    title={pendingCount > 0 ? `${pendingCount} pending approvals` : 'Pending approvals'}
                    aria-expanded={notifyOpen}
                    aria-haspopup="true"
                  >
                    <IconBell />
                    {pendingCount > 0 && <span className="devops-navbar__badge devops-navbar__badge--dot" aria-hidden />}
                  </button>

                  {notifyOpen && (
                    <div className="devops-navbar__notify-panel">
                      <div className="devops-navbar__notify-header">
                        <h3 className="devops-navbar__notify-title">Pending Approvals</h3>
                        <button type="button" className="devops-navbar__notify-close" onClick={() => setNotifyOpen(false)} aria-label="Close">
                          Close
                        </button>
                      </div>
                      <div className="devops-navbar__notify-summary">
                        <strong>{pendingCount > 99 ? '99+' : pendingCount}</strong>
                        <span>
                          {pendingCount > 0
                            ? 'Approval work is waiting across projects and release flows.'
                            : 'No approval tickets are waiting right now.'}
                        </span>
                      </div>
                      <div className="devops-navbar__notify-links">
                        <Link href="/tickets" className="devops-navbar__notify-link" onClick={() => setNotifyOpen(false)}>
                          Open tickets
                        </Link>
                      </div>
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
                              {request.project_name ? (
                                <span>
                                  {request.project_name}
                                  {request.project_code ? ` (${request.project_code})` : ''}
                                </span>
                              ) : null}
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
                  setSupportOpen(false);
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
      <SupportHub
        open={supportOpen}
        initialTab={supportTab}
        onClose={() => setSupportOpen(false)}
        portalName="DevOps Portal"
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
          { label: 'Open command center', href: '/ops-command-center' },
        ]}
      />
    </div>
  );
}
