import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  IconLogout,
  IconBell,
  IconTickets,
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
  IconChevronDown,
} from './Icons';
import SupportHub from './SupportHub';
import { supportArticles, supportQuickPrompts } from '../lib/supportContent';
import {
  CommandPalette,
  MobileTabBar,
  SearchTrigger,
  ScopeBar,
  ThemeToggle,
  normalizeScopeProjects,
  queryToScope,
  readWorkspaceScope,
  scopeToQuery,
  useWorkspaceScope,
  type MobileTab,
  type ScopeProject,
} from '@infragate/ui';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
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
  '/approval-center': 'Approval Queue',
  '/approval-sla': 'Approval Timing',
  '/gate-policies': 'Approval Rules',
  '/project-operations': 'Project Work',
  '/service-heatmap': 'Service Health',
  '/ops-command-center': 'Operations',
  '/k8s/onboard': 'Cluster connections',
  '/k8s/onboard/new': 'Onboard Cluster',
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
  '/changes': 'Changes',
  '/change-calendar': 'Change calendar',
  '/release-notes': 'Release notes',
  '/services': 'Service map',
  '/services/new': 'Add service',
  '/problems': 'Problems',
  '/health': 'Health',
  '/health/slo/new': 'Define SLO',
  '/deploy-intelligence': 'Deploy intelligence',
  '/deploy-intelligence/onboard': 'Onboard repository',
  '/rollback-console': 'Rollback',
  '/gate-approvals': 'Approval History',
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
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>({});
  const [scopeProjects, setScopeProjects] = useState<ScopeProject[]>([]);
  const { scope, updateScope } = useWorkspaceScope();
  const scopeHydrated = useRef(false);
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
    fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setScopeProjects(normalizeScopeProjects(data?.projects)))
      .catch(() => setScopeProjects([]));
  }, [apiUrl]);

  useEffect(() => {
    if (!router.isReady || scopeHydrated.current) return;
    scopeHydrated.current = true;
    const fromQuery = queryToScope(router.query);
    if (fromQuery.projectId || fromQuery.environment) {
      updateScope(fromQuery);
      return;
    }
    const stored = readWorkspaceScope();
    if (stored.projectId || stored.environment) {
      void router.replace({ pathname: router.pathname, query: { ...router.query, ...scopeToQuery(stored) } }, undefined, { shallow: true });
    }
  }, [router.isReady]);

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

  type NavChild = { href: string; label: string };
  type NavItem = {
    href: string;
    label: string;
    Icon: ComponentType<{ className?: string }>;
    children?: NavChild[];
  };

  const leafIsActive = (href: string) => {
    if (href === '/k8s') return pathname === '/k8s' || pathname.startsWith('/k8s/clusters');
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const itemIsActive = (item: NavItem) =>
    Boolean(item.children?.some((child) => leafIsActive(child.href))) || leafIsActive(item.href);

  const primaryNavItems: NavItem[] = [
    { href: '/dashboard', label: 'Overview', Icon: IconTickets },
    { href: '/tickets', label: 'Requests', Icon: IconTickets },
  ];
  if (isManager) {
    primaryNavItems.push({
      href: '/approval-center',
      label: 'Approvals',
      Icon: IconShield,
      children: [
        { href: '/approval-center', label: 'Queue' },
        { href: '/gate-approvals', label: 'History' },
        { href: '/gate-policies', label: 'Rules' },
        { href: '/approval-sla', label: 'Timing' },
      ],
    });
    primaryNavItems.push({
      href: '/incidents',
      label: 'Incidents',
      Icon: IconAlertTriangle,
      children: [
        { href: '/incidents', label: 'Open' },
        { href: '/incident-workspace', label: 'Notes' },
        { href: '/problems', label: 'Problems' },
      ],
    });
    primaryNavItems.push({
      href: '/changes',
      label: 'Changes',
      Icon: IconFileText,
      children: [
        { href: '/changes', label: 'Catalog' },
        { href: '/change-calendar', label: 'Calendar' },
        { href: '/release-notes', label: 'Release notes' },
      ],
    });
  }
  primaryNavItems.push({ href: '/k8s', label: 'Kubernetes', Icon: IconK8s });
  primaryNavItems.push({ href: '/health', label: 'Health', Icon: IconArrowUpRight });
  if (isManager) {
    primaryNavItems.push({
      href: '/projects',
      label: 'Projects',
      Icon: IconProjects,
      children: [
        { href: '/projects', label: 'Catalog' },
        { href: '/team', label: 'Teams' },
        { href: '/services', label: 'Service map' },
      ],
    });
  }

  const advancedNavItems: NavItem[] = isManager
    ? [
        { href: '/promotions', label: 'Promotions', Icon: IconArrowUpRight },
        { href: '/deploy-intelligence', label: 'Deploy intel', Icon: IconArrowUpRight },
        { href: '/credential-audit', label: 'Secrets', Icon: IconShield },
        { href: '/ops-command-center', label: 'Operations', Icon: IconAlertTriangle },
        { href: '/runbooks', label: 'Guides', Icon: IconBookOpen },
        { href: '/templates', label: 'Request Templates', Icon: IconTemplates },
        { href: '/access-overrides', label: 'Access Exceptions', Icon: IconKey },
        { href: '/rollback-console', label: 'Rollback', Icon: IconRefreshCw },
        {
          href: '/notification-settings',
          label: 'Alerts',
          Icon: IconBell,
          children: [
            { href: '/notification-settings', label: 'Settings' },
            { href: '/retry-center', label: 'Retries' },
            { href: '/approval-notification-analytics', label: 'Analytics' },
          ],
        },
      ]
    : [];
  const advancedNavActive = advancedNavItems.some((item) => itemIsActive(item));
  const k8sNavActive = pathname === '/k8s' || pathname.startsWith('/k8s/');

  useEffect(() => {
    if (advancedNavActive) setAdvancedNavOpen(true);
  }, [advancedNavActive]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const item of [...primaryNavItems, ...advancedNavItems]) {
      if (item.children && itemIsActive(item)) next[item.href] = true;
    }
    if (Object.keys(next).length === 0) return;
    setOpenNavGroups((current) => ({ ...current, ...next }));
  }, [pathname]);

  const pageTitle = getPageTitle(pathname);
  const roleLabel = isManager ? 'Manager' : 'Contributor';
  const statusLabel = isManager
    ? pendingCount > 0
      ? `${pendingCount} pending approvals`
      : 'No pending approvals'
    : 'Active session';
  const getSidebarBadge = (href: string): string | null => {
    if (href === '/tickets' && isManager && pendingCount > 0) {
      return pendingCount > 99 ? '99+' : String(pendingCount);
    }
    return null;
  };

  const isNavActive = (href: string) => {
    const item = [...primaryNavItems, ...advancedNavItems].find((entry) => entry.href === href);
    if (item) return itemIsActive(item);
    return href === '/k8s' ? k8sNavActive : leafIsActive(href);
  };

  const renderNavItem = (item: NavItem) => {
    const { href, label, Icon, children } = item;
    const groupActive = itemIsActive(item);
    const badge = getSidebarBadge(href);
    const hasChildren = Boolean(children?.length) && !sidebarCollapsed;
    const groupOpen = Boolean(openNavGroups[href]);

    return (
      <div key={href} className="devops-sidebar-new__expandable">
        <div className="devops-sidebar-new__group-row">
          <Link
            href={href}
            className={`devops-sidebar-new__link ${leafIsActive(href) ? 'devops-sidebar-new__link--active' : groupActive ? 'devops-sidebar-new__link--current' : ''}`}
            onClick={() => {
              if (hasChildren) setOpenNavGroups((current) => ({ ...current, [href]: true }));
              setMobileMenuOpen(false);
            }}
            aria-current={leafIsActive(href) ? 'page' : undefined}
            aria-label={sidebarCollapsed ? label : undefined}
            title={sidebarCollapsed ? label : undefined}
          >
            <Icon className="devops-sidebar-new__icon" />
            {!sidebarCollapsed && <span className="devops-sidebar-new__label">{label}</span>}
            {!sidebarCollapsed && badge && <span className="devops-sidebar-new__badge">{badge}</span>}
          </Link>
          {hasChildren ? (
            <button
              type="button"
              className={`devops-sidebar-new__chevron ${groupOpen ? 'devops-sidebar-new__chevron--open' : ''}`}
              aria-label={groupOpen ? `Collapse ${label}` : `Expand ${label}`}
              aria-expanded={groupOpen}
              onClick={() => setOpenNavGroups((current) => ({ ...current, [href]: !current[href] }))}
            >
              <IconChevronDown />
            </button>
          ) : null}
        </div>
        {hasChildren && groupOpen ? (
          <div className="devops-sidebar-new__sub">
            {children!.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                className={`devops-sidebar-new__sublink ${leafIsActive(child.href) ? 'devops-sidebar-new__sublink--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
                aria-current={leafIsActive(child.href) ? 'page' : undefined}
              >
                {child.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    );
  };
  const mobileTabs: MobileTab[] = (isManager
    ? [
        { href: '/dashboard', label: 'Overview', Icon: IconTickets },
        { href: '/tickets', label: 'Requests', Icon: IconTickets },
        { href: '/approval-center', label: 'Approvals', Icon: IconShield },
        { href: '/incidents', label: 'Incidents', Icon: IconAlertTriangle },
      ]
    : [
        { href: '/dashboard', label: 'Overview', Icon: IconTickets },
        { href: '/tickets', label: 'Requests', Icon: IconTickets },
        { href: '/k8s', label: 'Kubernetes', Icon: IconK8s },
        { href: '/health', label: 'Health', Icon: IconArrowUpRight },
      ]
  ).map((tab) => ({ ...tab, active: isNavActive(tab.href), badge: getSidebarBadge(tab.href) }));

  return (
    <div className="devops-layout devops-layout-sidebar">
      <a className="ig-skip-link" href="#main-content">
        Skip to content
      </a>
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
          <nav className="devops-sidebar-new__nav" aria-label="Primary">
            {!sidebarCollapsed && <span className="devops-sidebar-new__nav-title">Modules</span>}
            {primaryNavItems.map((item) => renderNavItem(item))}
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
                    {advancedNavItems.map((item) => renderNavItem(item))}
                  </div>
                )}
              </div>
            )}
          </nav>
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
            <ScopeBar
              projects={scopeProjects}
              scope={scope}
              onChange={(partial) => {
                const next = updateScope(partial);
                const query = { ...router.query };
                if (next.projectId) query.project_id = next.projectId;
                else delete query.project_id;
                if (next.environment) query.environment = next.environment;
                else delete query.environment;
                void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
              }}
            />
            <span className={`devops-navbar__status-chip ${isManager && pendingCount > 0 ? 'devops-navbar__status-chip--alert' : ''}`}>
              {statusLabel}
            </span>
          </div>
          <div className="devops-navbar__right">
            <SearchTrigger placeholder="Search tickets, services, pods…" />
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
              <ThemeToggle />
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
        <main id="main-content" tabIndex={-1} className="devops-main-new ig-page">
          {children}
        </main>
      </div>
      <MobileTabBar
        tabs={mobileTabs}
        onMore={() => setMobileMenuOpen((open) => !open)}
        moreOpen={mobileMenuOpen}
        MoreIcon={IconMenu}
      />
      <CommandPalette
        apiUrl={apiUrl}
        token={typeof window === 'undefined' ? null : localStorage.getItem(DEVOPS_TOKEN_KEY)}
        commands={[
          { id: 'overview', label: 'Overview', href: '/dashboard' },
          { id: 'requests', label: 'Requests', href: '/tickets' },
          { id: 'approvals', label: 'Approvals', href: '/approval-center' },
          { id: 'approval-history', label: 'Approval History', href: '/gate-approvals' },
          { id: 'approval-rules', label: 'Approval Rules', href: '/gate-policies' },
          { id: 'approval-timing', label: 'Approval Timing', href: '/approval-sla' },
          { id: 'incidents', label: 'Incidents', href: '/incidents' },
          { id: 'k8s', label: 'Kubernetes', href: '/k8s' },
          { id: 'k8s-onboard', label: 'K8s Connections', href: '/k8s/onboard' },
          { id: 'pods', label: 'Pods', href: '/k8s/pods' },
          { id: 'logs', label: 'Logs', href: '/k8s/logs' },
          { id: 'rollback', label: 'Rollback', href: '/rollback-console' },
          { id: 'promotions', label: 'Promotions', href: '/promotions' },
          { id: 'changes', label: 'Changes', href: '/changes' },
          { id: 'create-change', label: 'Create change request', href: '/changes/new' },
          { id: 'change-calendar', label: 'Change calendar', href: '/change-calendar' },
          { id: 'release-notes', label: 'Release notes', href: '/release-notes' },
          { id: 'services', label: 'Service map', href: '/services' },
          { id: 'problems', label: 'Problems', href: '/problems' },
          { id: 'health', label: 'Health', href: '/health' },
          { id: 'deploy-intel', label: 'Deploy intelligence', href: '/deploy-intelligence' },
        ]}
      />
      <SupportHub
        open={supportOpen}
        initialTab={supportTab}
        onClose={() => setSupportOpen(false)}
        portalName="DevOps Portal"
        currentPath={pathname}
        currentTitle={pageTitle}
        articles={supportArticles}
        quickPrompts={supportQuickPrompts}
        apiUrl={apiUrl}
        token={typeof window === 'undefined' ? null : localStorage.getItem(DEVOPS_TOKEN_KEY)}
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
