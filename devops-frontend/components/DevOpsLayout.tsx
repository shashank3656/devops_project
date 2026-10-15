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
  IconWorkload,
  IconMenu,
  IconShield,
  IconBookOpen,
  IconAlertTriangle,
  IconK8s,
  IconHelpCircle,
  IconFileText,
  IconChevronDown,
  IconUser,
} from './Icons';
import { SupportHub } from '@infragate/ui';
import { supportArticles, supportQuickPrompts } from '../lib/supportContent';
import { rememberReturn } from '../lib/returnPath';
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
  type WorkspaceScope,
} from '@infragate/ui';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const SIDEBAR_COLLAPSED_KEY = 'devops-sidebar-collapsed';
const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';
const supportEmailReady = supportEmail.includes('@') && !supportEmail.includes('example');

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
  '/my-work': 'My work',
  '/reports-automation': 'Reports and automation',
  '/on-call': 'On-call',
  '/maintenance': 'Maintenance',
  '/service-desk': 'Service desk',
  '/approval-center': 'Approval queue',
  '/approval-sla': 'Approval timing',
  '/gate-policies': 'Promotion rules',
  '/gitops-projects': 'GitOps',
  '/gitops-control': 'GitOps control',
  '/project-operations': 'Project Work',
  '/service-heatmap': 'Service Health',
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
  '/k8s/workspace': 'Kubernetes workspace',
  '/runbooks': 'Guides',
  '/incidents': 'Incidents',
  '/incident-workspace': 'Incident Notes',
  '/promotions': 'Promotions',
  '/changes': 'Changes',
  '/changes/new': 'Create change request',
  '/change-calendar': 'Change calendar',
  '/release-notes': 'Release notes',
  '/previews': 'Preview environments',
  '/scorecards': 'Scorecards',
  '/evidence': 'Evidence',
  '/services': 'Services',
  '/services/new': 'Add service',
  '/problems': 'Problems',
  '/problems/new': 'Create problem',
  '/knowledge': 'Knowledge',
  '/activity': 'Operator activity',
  '/deploy-intelligence': 'Deploy intelligence',
  '/deploy-intelligence/onboard': 'Onboard repository',
  '/gate-approvals': 'Promotion history',
  '/notification-settings': 'Alert Settings',
  '/approval-notification-analytics': 'Analytics',
  '/retry-center': 'Delivery Retries',
  '/workload': 'Workload',
  '/tickets': 'Requests',
  '/templates': 'Request Templates',
  '/projects': 'Projects',
  '/team': 'Team',
  '/credential-audit': 'Secrets',
  '/security/cloud-scan': 'Cloud scan',
  '/security/code-scan': 'Code scan',
  '/security/findings': 'Findings',
  '/profile': 'Profile',
  '/cloud-accounts': 'Cloud accounts',
  '/cloud-resources': 'Cloud inventory',
  '/cloud-resources/account': 'Cloud account inventory',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/dashboard' && pathname.startsWith(path)) return title;
  }
  return 'Home';
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
  const [sessionReady, setSessionReady] = useState(false);
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
  const [catalogEnvironments, setCatalogEnvironments] = useState<string[]>([]);
  const { scope, updateScope } = useWorkspaceScope();
  const scopeHydrated = useRef(false);
  const notifyRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const [keyboardHelp, setKeyboardHelp] = useState('');
  const keyboardHelpTimer = useRef<number | null>(null);

  const clearSessionAndRedirect = useCallback(() => {
    rememberReturn(router.asPath || '');
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
          return {};
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
          setSessionReady(true);
          return;
        }
        if (data !== null) setSessionReady(true);
      })
      .catch(() => setSessionReady(true));
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
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !scope.projectId) {
      setCatalogEnvironments([]);
      return;
    }
    const params = new URLSearchParams({ project_id: scope.projectId });
    fetch(`${apiUrl}/api/devops/environment-catalog?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const names = Array.isArray(data?.environments)
          ? data.environments.map((row: { name?: string }) => String(row?.name || '').trim()).filter(Boolean)
          : [];
        setCatalogEnvironments(names);
      })
      .catch(() => setCatalogEnvironments([]));
  }, [apiUrl, scope.projectId]);

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

  const writeScopeQuery = (next: WorkspaceScope) => {
    const query = { ...router.query };
    if (next.projectId) query.project_id = next.projectId;
    else delete query.project_id;
    if (next.environment) query.environment = next.environment;
    else delete query.environment;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

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
    if (!notifyOpen && !profileOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (notifyRef.current && !notifyRef.current.contains(e.target as Node)) setNotifyOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
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
          ? 'Shortcuts: ? help, g then d = Home, g then t = Requests, g then a = Approval queue'
          : 'Shortcuts: ? help, g then d = Home';
        setKeyboardHelp(msg);
        if (keyboardHelpTimer.current) window.clearTimeout(keyboardHelpTimer.current);
        keyboardHelpTimer.current = window.setTimeout(() => setKeyboardHelp(''), 10000);
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

  /** Service desk hub: unified INC / CHG / PRB / requests landing. */
  const serviceDeskHref = '/service-desk';

  const serviceDeskChildren: NavChild[] = [
    { href: '/service-desk', label: 'All tickets' },
    { href: '/incidents', label: 'Incidents' },
    { href: '/changes', label: 'Change requests' },
    { href: '/problems', label: 'Problems' },
    { href: '/tickets', label: 'Requests' },
    { href: '/knowledge', label: 'Knowledge' },
  ];

  const leafIsActive = (href: string) => {
    if (href === '/k8s') return pathname === '/k8s' || pathname.startsWith('/k8s/');
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
    if (href === serviceDeskHref) {
      return (
        pathname === '/service-desk' ||
        serviceDeskChildren.some((child) => child.href !== '/service-desk' && (pathname === child.href || pathname.startsWith(`${child.href}/`)))
      );
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const itemIsActive = (item: NavItem) =>
    Boolean(item.children?.some((child) => leafIsActive(child.href))) || leafIsActive(item.href);

  const primaryNavItems: NavItem[] = [
    { href: '/dashboard', label: 'Overview', Icon: IconWorkload },
    { href: '/my-work', label: 'My work', Icon: IconBookOpen },
    {
      href: serviceDeskHref,
      label: 'Service desk',
      Icon: IconTickets,
      children: serviceDeskChildren,
    },
    { href: '/services', label: 'Services', Icon: IconProjects },
  ];
  if (isManager) {
    primaryNavItems.push({
      href: '/projects',
      label: 'Infrastructure',
      Icon: IconK8s,
      children: [
        { href: '/projects', label: 'Projects' },
        { href: '/environments', label: 'Environments' },
        { href: '/cloud-accounts', label: 'Cloud accounts' },
        { href: '/cloud-resources', label: 'Cloud inventory' },
        { href: '/k8s', label: 'Kubernetes' },
        { href: '/promotions', label: 'Releases' },
      ],
    });
    primaryNavItems.push({
      href: '/credential-audit',
      label: 'Security',
      Icon: IconShield,
      children: [
        { href: '/credential-audit', label: 'Secrets' },
        { href: '/security/cloud-scan', label: 'Cloud scan' },
        { href: '/security/code-scan', label: 'Code scan' },
        { href: '/security/findings', label: 'Findings' },
      ],
    });
  } else {
    primaryNavItems.push({ href: '/k8s', label: 'Infrastructure', Icon: IconK8s });
    primaryNavItems.push({
      href: '/security/cloud-scan',
      label: 'Security',
      Icon: IconShield,
      children: [
        { href: '/security/cloud-scan', label: 'Cloud scan' },
        { href: '/security/code-scan', label: 'Code scan' },
        { href: '/security/findings', label: 'Findings' },
      ],
    });
  }

  const advancedNavItems: NavItem[] = isManager
    ? [
        { href: '/previews', label: 'Previews', Icon: IconFileText },
        { href: '/scorecards', label: 'Scorecards', Icon: IconFileText },
        { href: '/evidence', label: 'Evidence', Icon: IconFileText },
        { href: '/on-call', label: 'On-call', Icon: IconBell },
        { href: '/maintenance', label: 'Maintenance', Icon: IconAlertTriangle },
        { href: '/runbooks', label: 'Guides', Icon: IconBookOpen },
        { href: '/templates', label: 'Request templates', Icon: IconTemplates },
        {
          href: '/notification-settings',
          label: 'Alerts',
          Icon: IconBell,
          children: [
            { href: '/notification-settings', label: 'Settings' },
            { href: '/reports-automation', label: 'Reports and automation' },
            { href: '/retry-center', label: 'Retries' },
            { href: '/approval-notification-analytics', label: 'Analytics' },
          ],
        },
      ]
    : [
        { href: '/on-call', label: 'On-call', Icon: IconBell },
        { href: '/maintenance', label: 'Maintenance', Icon: IconAlertTriangle },
        { href: '/reports-automation', label: 'Reports and automation', Icon: IconFileText },
      ];
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
  const roleLabel = !sessionReady ? '' : isManager ? 'Manager' : 'Operator';
  const statusLabel = !sessionReady
    ? 'Checking session'
    : isManager
    ? pendingCount > 0
      ? `${pendingCount} pending approvals`
      : 'No pending approvals'
    : 'Active session';
  const getSidebarBadge = (href: string): string | null => {
    if ((href === '/service-desk' || href === '/tickets') && isManager && pendingCount > 0) {
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
  const mobileTabs: MobileTab[] = [
    { href: '/dashboard', label: 'Overview', Icon: IconWorkload },
    { href: '/service-desk', label: 'Service desk', Icon: IconFileText },
    { href: '/services', label: 'Services', Icon: IconProjects },
    { href: '/k8s', label: 'Infra', Icon: IconK8s },
  ].map((tab) => ({ ...tab, active: isNavActive(tab.href), badge: getSidebarBadge(tab.href) }));

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
              <span className="devops-sidebar-new__brand-mark" aria-hidden>S</span>
              <span className="devops-sidebar-new__brand-word devops-sidebar-new__brand-word--primary">SetuOps</span>
            </Link>
          )}
        </div>
        <div className="devops-sidebar-new__body">
          <nav className="devops-sidebar-new__nav" aria-label="Primary">
            {!sidebarCollapsed && <span className="devops-sidebar-new__nav-title">Workspace</span>}
            {sessionReady ? primaryNavItems.map((item) => renderNavItem(item)) : null}
            {sessionReady && !sidebarCollapsed && advancedNavItems.length > 0 && (
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
            <Link href="/profile" className="devops-sidebar-new__link" onClick={() => setMobileMenuOpen(false)}>
              <IconUser className="devops-sidebar-new__icon" />
              {!sidebarCollapsed && <span className="devops-sidebar-new__label">Settings</span>}
            </Link>
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
              title="Help"
            >
              <IconHelpCircle className="devops-sidebar-new__icon" />
              {!sidebarCollapsed && <span className="devops-sidebar-new__label">Help & guides</span>}
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
              catalogEnvironments={catalogEnvironments}
              onChange={(partial) => writeScopeQuery(updateScope(partial))}
              onClear={() => writeScopeQuery(updateScope({ projectId: '', environment: '' }))}
            />
            <span className={`devops-navbar__status-chip ${isManager && pendingCount > 0 ? 'devops-navbar__status-chip--alert' : ''}`}>
              {statusLabel}
            </span>
          </div>
          <div className="devops-navbar__right">
            <SearchTrigger placeholder="Search tickets, services, infrastructure, people…" />
            <div className="devops-navbar__actions">
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
                <span className="devops-navbar__profile-copy">
                  <span className="devops-navbar__profile-label">{sessionReady ? user?.username || 'DevOps' : '…'}</span>
                  {roleLabel ? <span className="devops-navbar__role">{roleLabel}</span> : null}
                </span>
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
          {sessionReady ? null : <p className="v3-muted">Checking session…</p>}
          {sessionReady && keyboardHelp ? (
            <div className="devops-keyboard-hint" role="status">
              <span>{keyboardHelp}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKeyboardHelp('')}>
                Dismiss
              </button>
            </div>
          ) : null}
          {sessionReady ? children : null}
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
          { id: 'home', label: 'Home', href: '/dashboard' },
          { id: 'requests', label: 'Requests', href: '/tickets' },
          { id: 'approval-queue', label: 'Approval queue', href: '/approval-center' },
          { id: 'promotion-history', label: 'Promotion history', href: '/gate-approvals' },
          { id: 'promotion-rules', label: 'Promotion rules', href: '/gate-policies' },
          { id: 'approval-timing', label: 'Approval timing', href: '/approval-sla' },
          { id: 'itsm', label: 'ITSM (changes catalog)', href: '/changes' },
          { id: 'changes', label: 'Changes', href: '/changes' },
          { id: 'deployments', label: 'Deployments', href: '/promotions' },
          { id: 'k8s', label: 'Kubernetes', href: '/k8s' },
          { id: 'gitops', label: 'GitOps', href: '/gitops-projects' },
          { id: 'gitops-control', label: 'GitOps control', href: '/gitops-control' },
          { id: 'projects', label: 'Projects', href: '/projects' },
          { id: 'promotions', label: 'Promotions', href: '/promotions' },
          { id: 'create-change', label: 'Create change request', href: '/changes/new' },
          { id: 'change-calendar', label: 'Change calendar', href: '/change-calendar' },
          { id: 'release-notes', label: 'Release notes', href: '/release-notes' },
          { id: 'services', label: 'Services', href: '/services' },
          { id: 'add-service', label: 'Add service', href: '/services/new' },
          { id: 'operator-activity', label: 'Operator activity', href: '/activity' },
          { id: 'incidents', label: 'Incidents', href: '/incidents' },
          { id: 'incident-notes', label: 'Incident notes', href: '/incident-workspace' },
          { id: 'problems', label: 'Problems', href: '/problems' },
          { id: 'create-problem', label: 'Create problem', href: '/problems/new' },
          { id: 'knowledge', label: 'Knowledge', href: '/knowledge' },
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
        remapIncidentCitationLinks
        externalDocsHref={process.env.NEXT_PUBLIC_DOCS_URL || ''}
        escalationActions={[
          ...(supportEmailReady
            ? [{
                label: 'Email platform support',
                externalHref: `mailto:${supportEmail}?subject=${encodeURIComponent(`SetuOps support: ${pageTitle}`)}`,
              }]
            : []),
          { label: 'Open incidents', href: '/incidents' },
        ]}
      />
    </div>
  );
}
