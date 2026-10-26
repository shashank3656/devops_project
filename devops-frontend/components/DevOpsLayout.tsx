import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ComponentType, ReactNode, SyntheticEvent } from 'react';
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
import { supportArticles, supportQuickPromptsForPath } from '../lib/supportContent';
import { homeFor, pageAllowed, pathAllowed, portalGrants } from '../lib/portalAccess';
import { expireSession, readAccessDenied, rememberAccessDenied } from '../lib/sessionExpiry';
import { isRecordDetailPath } from '../lib/scopeHref';
import { readSubmissionResult, type SubmissionResult } from '../lib/submissionResult';
import { buildBreadcrumbs } from '../lib/breadcrumbs';
import {
  CommandPalette,
  MobileTabBar,
  PortalErrorBoundary,
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
const SIDEBAR_OPEN_KEY = 'opstrellis-sidebar-open';
const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';
const supportEmailReady = supportEmail.includes('@') && !supportEmail.includes('example');

interface DevopsUser {
  id: number;
  username: string;
  email?: string;
  role?: string;
  user_type?: string;
  grants?: { records?: boolean; manager?: boolean };
  devops_profile?: { is_manager: boolean; level: string; position?: string; onboard_date?: string };
  maintenance_approver?: boolean;
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
  '/environments': 'Environments',
  '/reports-automation': 'Reports and automation',
  '/on-call': 'On-call',
  '/on-call/handovers': 'Handovers',
  '/certificates': 'Certificates & domains',
  '/cost': 'Cost analysis',
  '/cost/accounts': 'Account spend',
  '/cost/projects': 'Project spend',
  '/cost/cloud': 'Cloud account spend',
  '/cost/explorer': 'Cost explorer',
  '/cost/optimization': 'Cost optimization',
  '/cost/anomalies': 'Cost anomalies',
  '/cost/budgets': 'Cost budgets',
  '/cost/savings': 'Cost savings',
  '/cost/kubernetes': 'Kubernetes cost',
  '/cost/configuration': 'Cost configuration',
  '/operations/webhooks': 'Webhooks',
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
  '/iam': 'Request access',
  '/iam/request': 'Request access',
  '/iam/requests': 'My requests',
  '/iam/approvals': 'Approvals',
  '/iam/permissions': 'Permissions',
  '/iam/audit': 'Audit',
  '/iam/policy': 'Policy',
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
  '/services': 'Service inventory',
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
  '/security/findings': 'Findings',
  '/security/vulnerabilities': 'Vulnerabilities',
  '/security/vulnerabilities/advisories/[id]': 'Advisory',
  '/security/vulnerabilities/findings/[id]': 'Finding',
  '/security/vulnerabilities/policy': 'Repository policy',
  '/security/vulnerabilities/policy/[id]': 'Repository policy',
  '/security/vulnerabilities/services/[id]': 'Service security',
  '/profile': 'Profile',
  '/my-requests': 'My requests',
  '/requests': 'Request',
  '/requests/new': 'New request',
  '/my-projects': 'My projects',
  '/my-teams': 'My teams',
  '/portal-access': 'Portal Access',
  '/portal-access/users': 'People',
  '/portal-access/users/new': 'Add person',
  '/portal-access/teams': 'Groups',
  '/portal-access/teams/new': 'Create group',
  '/portal-access/sso': 'Sign-in',
  '/profile/password': 'Change password',
  '/profile/notifications': 'Signal routing',
  '/profile/api-keys': 'API access',
  '/cloud-accounts': 'Cloud accounts',
  '/cloud-resources': 'Cloud inventory',
  '/cloud-resources/account': 'Cloud account inventory',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  let best = '';
  let title = 'Home';
  for (const [path, label] of Object.entries(PAGE_TITLES)) {
    if (path === '/dashboard') continue;
    if ((pathname === path || pathname.startsWith(`${path}/`) || pathname.startsWith(path)) && path.length > best.length) {
      best = path;
      title = label;
    }
  }
  return title;
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
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DevOpsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const pathname = router.pathname;
  const [user, setUser] = useState<DevopsUser | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingCountKnown, setPendingCountKnown] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitials, setProfileInitials] = useState('D');
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalItem[]>([]);
  const [pendingApprovalsLoading, setPendingApprovalsLoading] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTab, setSupportTab] = useState<'chat' | 'docs'>('chat');
  const [supportSeed, setSupportSeed] = useState('');
  const [supportMode, setSupportMode] = useState<'help' | 'cost'>('help');
  const [supportCostContext, setSupportCostContext] = useState('');
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [scopeProjects, setScopeProjects] = useState<ScopeProject[]>([]);
  const [catalogEnvironments, setCatalogEnvironments] = useState<string[]>([]);
  const { scope, updateScope } = useWorkspaceScope();
  const scopeHydrated = useRef(false);
  const navStateHydrated = useRef(false);
  const [navTooltip, setNavTooltip] = useState<{ text: string; top: number; left: number } | null>(null);
  const notifyRef = useRef<HTMLDivElement>(null);
  const notifyButtonRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [keyboardHelp, setKeyboardHelp] = useState('');
  const [accessNotice, setAccessNotice] = useState('');
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [seenNotifyIds, setSeenNotifyIds] = useState<string[]>([]);
  const [compactRows, setCompactRows] = useState(false);
  const keyboardHelpTimer = useRef<number | null>(null);

  const clearSessionAndRedirect = useCallback(() => {
    expireSession(router.asPath || '');
  }, [router]);

  useEffect(() => {
    const stored = window.localStorage.getItem('opstrellis-density');
    const compact = stored === 'compact';
    setCompactRows(compact);
    document.documentElement.dataset.density = compact ? 'compact' : 'comfortable';
  }, []);

  useEffect(() => {
    const onInvalid = (event: Event) => {
      const field = event.target;
      if (!(field instanceof HTMLElement)) return;
      const form = field.closest('form');
      if (!form || form.dataset.invalidFocused === '1') return;
      form.dataset.invalidFocused = '1';
      field.focus();
      window.setTimeout(() => {
        delete form.dataset.invalidFocused;
      }, 0);
    };
    document.addEventListener('invalid', onInvalid, true);
    return () => document.removeEventListener('invalid', onInvalid, true);
  }, []);

  useEffect(() => {
    setProfileInitials(getProfileInitials());
    setAccessNotice(readAccessDenied());
    setSubmission(readSubmissionResult());
    try {
      const raw = localStorage.getItem('opstrellis-notify-seen');
      setSeenNotifyIds(raw && /^\d+$/.test(raw) ? [raw] : []);
    } catch {
      setSeenNotifyIds([]);
    }
  }, []);

  useEffect(() => {
    if (!notifyOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNotifyOpen(false);
      notifyButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notifyOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    profileMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        profileButtonRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(profileMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
      items[next].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [profileOpen]);

  useEffect(() => {
    try {
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setSidebarCollapsed(c === 'true');
      const saved = JSON.parse(sessionStorage.getItem(SIDEBAR_OPEN_KEY) || '{}');
      if (saved && typeof saved === 'object') {
        if (saved.groups && typeof saved.groups === 'object') setOpenNavGroups(saved.groups);
        if (saved.sections && typeof saved.sections === 'object') setOpenSections(saved.sections);
      }
    } catch (_) {}
    navStateHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!navStateHydrated.current) return;
    try {
      sessionStorage.setItem(SIDEBAR_OPEN_KEY, JSON.stringify({ groups: openNavGroups, sections: openSections }));
    } catch (_) {}
  }, [openNavGroups, openSections]);

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
    const recordDetailPage = isRecordDetailPath(router.pathname);
    if (fromQuery.projectId || fromQuery.environment) {
      updateScope(fromQuery);
      if (recordDetailPage) {
        const query = { ...router.query };
        delete query.project_id;
        delete query.environment;
        void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
      }
      return;
    }
    const stored = readWorkspaceScope();
    if (!(stored.projectId || stored.environment)) return;
    updateScope(stored);
    const folderPage = router.pathname === '/environments' || router.pathname === '/services' || router.pathname === '/on-call' || router.pathname.startsWith('/on-call/');
    if (!folderPage && !recordDetailPage) {
      void router.replace({ pathname: router.pathname, query: { ...router.query, ...scopeToQuery(stored) } }, undefined, { shallow: true });
    }
  }, [router.isReady]);

  const writeScopeQuery = (next: WorkspaceScope) => {
    if (isRecordDetailPath(router.pathname)) return;
    const query = { ...router.query };
    const projectId = typeof next.projectId === 'string' ? next.projectId : '';
    const environment = typeof next.environment === 'string' ? next.environment : '';
    if (projectId) query.project_id = projectId;
    else delete query.project_id;
    if (environment) query.environment = environment;
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

  const isManager = Boolean(user?.devops_profile?.is_manager) || user?.role === 'admin';

  const refreshPendingCount = useCallback(() => {
    if (!isManager) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) {
          clearSessionAndRedirect();
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((data) => {
        if (data?.status === 'ok' && typeof data.pending_approval_count === 'number')
          setPendingCount(data.pending_approval_count);
      })
      .catch(() => {})
      .finally(() => setPendingCountKnown(true));
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
        if (r.status === 401) {
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
    const stored = window.localStorage.getItem('opstrellis-notify-read') || '';
    setSeenNotifyIds(stored.split(',').map((id) => id.trim()).filter(Boolean));
  }, []);

  useEffect(() => {
    setNotifyOpen(false);
    setProfileOpen(false);
    setSupportOpen(false);
    setSupportSeed('');
    setSupportMode('help');
    setSupportCostContext('');
  }, [pathname]);

  useEffect(() => {
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<{ question?: string; context?: string }>).detail || {};
      const question = detail.question || '';
      if (!question) return;
      setSupportMode('cost');
      setSupportCostContext(detail.context || '');
      setSupportSeed(question);
      setSupportTab('chat');
      setSupportOpen(true);
    };
    window.addEventListener('opstrellis-cost-ask', onAsk as EventListener);
    return () => window.removeEventListener('opstrellis-cost-ask', onAsk as EventListener);
  }, []);

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
  type SidebarSection = { title: string; items: NavItem[] };

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
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
    if (href === '/iam' || href === '/service-desk' || href === '/portal-access') return pathname === href;
    if (href === '/cost') {
      return pathname === '/cost' || pathname.startsWith('/cost/projects/') || pathname.startsWith('/cost/accounts/') || pathname.startsWith('/cost/cloud/');
    }
    if (href === '/k8s') return pathname === '/k8s' || pathname.startsWith('/k8s/');
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const itemIsActive = (item: NavItem) =>
    Boolean(item.children?.some((child) => leafIsActive(child.href))) || leafIsActive(item.href);

  const dailyNavItems: NavItem[] = [
    { href: '/dashboard', label: 'Overview', Icon: IconWorkload },
    { href: '/my-work', label: 'My work', Icon: IconBookOpen },
    {
      href: serviceDeskHref,
      label: 'Service desk',
      Icon: IconTickets,
      children: serviceDeskChildren,
    },
    { href: '/services', label: 'Service inventory', Icon: IconProjects },
  ];
  const operationsNavItems: NavItem[] = isManager
    ? [
        { href: '/on-call', label: 'On-call', Icon: IconBell, children: [
          { href: '/on-call', label: 'Roster' },
          { href: '/on-call/handovers', label: 'Handovers' },
        ] },
        { href: '/certificates', label: 'Certificates & domains', Icon: IconShield },
        { href: '/maintenance', label: 'Maintenance', Icon: IconAlertTriangle },
        { href: '/operations/webhooks', label: 'Webhooks', Icon: IconFileText },
        { href: '/runbooks', label: 'Guides', Icon: IconBookOpen },
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
        { href: '/on-call', label: 'On-call', Icon: IconBell, children: [
          { href: '/on-call', label: 'Roster' },
          { href: '/on-call/handovers', label: 'Handovers' },
        ] },
        { href: '/certificates', label: 'Certificates & domains', Icon: IconShield },
        { href: '/maintenance', label: 'Maintenance', Icon: IconAlertTriangle },
        { href: '/operations/webhooks', label: 'Webhooks', Icon: IconFileText },
        { href: '/reports-automation', label: 'Reports and automation', Icon: IconFileText },
      ];
  const iamNavItem: NavItem = {
    href: '/iam',
    label: 'IAM',
    Icon: IconShield,
    children: [
      { href: '/iam', label: 'Overview' },
      { href: '/iam/request', label: 'Request' },
      { href: '/iam/requests', label: 'My requests' },
      { href: '/iam/approvals', label: 'Approvals' },
      { href: '/iam/permissions', label: 'Permissions' },
      { href: '/iam/audit', label: 'Audit' },
      { href: '/iam/policy', label: 'Policy' },
    ],
  };
  const costNavItems: NavItem[] = [
    {
      href: '/cost',
      label: 'Cost management',
      Icon: IconFileText,
      children: [
        { href: '/cost', label: 'Analysis' },
        { href: '/cost/explorer', label: 'Explorer' },
        { href: '/cost/optimization', label: 'Optimization' },
        { href: '/cost/anomalies', label: 'Anomalies' },
        { href: '/cost/budgets', label: 'Budgets' },
        { href: '/cost/savings', label: 'Savings' },
        { href: '/cost/kubernetes', label: 'Kubernetes' },
        { href: '/cost/configuration', label: 'Configuration' },
      ],
    },
  ];
  const infrastructureNavItems: NavItem[] = [
    { href: '/projects', label: 'Projects', Icon: IconProjects },
    { href: '/environments', label: 'Environments', Icon: IconK8s },
    { href: '/cloud-accounts', label: 'Cloud accounts', Icon: IconFileText },
    { href: '/cloud-resources', label: 'Cloud inventory', Icon: IconFileText },
    iamNavItem,
    { href: '/k8s', label: 'Kubernetes', Icon: IconK8s },
    { href: '/promotions', label: 'Releases', Icon: IconFileText },
  ];
  const securityNavItems: NavItem[] = isManager
    ? [
        { href: '/credential-audit', label: 'Secrets', Icon: IconShield },
        { href: '/security/vulnerabilities', label: 'Vulnerabilities', Icon: IconShield },
        { href: '/security/cloud-scan', label: 'Cloud scan', Icon: IconShield },
        { href: '/security/findings', label: 'Findings', Icon: IconShield },
      ]
    : [
        { href: '/security/vulnerabilities', label: 'Vulnerabilities', Icon: IconShield },
        { href: '/security/cloud-scan', label: 'Cloud scan', Icon: IconShield },
        { href: '/security/findings', label: 'Findings', Icon: IconShield },
      ];
  const recordsNavItems: NavItem[] = isManager || Boolean(user?.grants?.records)
    ? [
        { href: '/previews', label: 'Previews', Icon: IconFileText },
        { href: '/scorecards', label: 'Scorecards', Icon: IconFileText },
        { href: '/evidence', label: 'Evidence', Icon: IconFileText },
        { href: '/templates', label: 'Request templates', Icon: IconTemplates },
      ]
    : [];
  const grants = portalGrants(user);
  const visibleNav = (items: NavItem[]): NavItem[] => items.flatMap((item) => {
    if (!pathAllowed(item.href, grants) && !pageAllowed(item.href, grants)) return [];
    if (!pathAllowed(item.href, grants)) return [];
    const children = item.children?.filter((child) => pathAllowed(child.href, grants));
    return [{ ...item, children }];
  });
  const sidebarSections: SidebarSection[] = [];
  if (grants.requests) {
    sidebarSections.push({
      title: 'Requests',
      items: visibleNav([
        { href: '/my-requests', label: 'My requests', Icon: IconTickets },
        { href: '/requests/new', label: 'New request', Icon: IconFileText },
        { href: '/my-projects', label: 'My projects', Icon: IconProjects },
        { href: '/my-teams', label: 'My teams', Icon: IconBookOpen },
      ]),
    });
  }
  if (grants.daily) sidebarSections.push({ title: 'Daily', items: visibleNav(dailyNavItems) });
  if (grants.operations) sidebarSections.push({ title: 'Operations', items: visibleNav(operationsNavItems) });
  else if (user?.maintenance_approver) {
    sidebarSections.push({
      title: 'Operations',
      items: [{ href: '/maintenance', label: 'Maintenance', Icon: IconAlertTriangle }],
    });
  }
  if (grants.cost) sidebarSections.push({ title: 'Cost', items: visibleNav(costNavItems) });
  if (grants.infrastructure) sidebarSections.push({ title: 'Infrastructure', items: visibleNav(infrastructureNavItems) });
  if (grants.security) sidebarSections.push({ title: 'Security', items: visibleNav(securityNavItems) });
  if (grants.records && recordsNavItems.length) sidebarSections.push({ title: 'Records', items: visibleNav(recordsNavItems) });
  if (grants.portalAccess) {
    sidebarSections.push({
      title: 'Portal Access',
      items: [
        { href: '/portal-access', label: 'Access', Icon: IconShield },
        { href: '/portal-access/users', label: 'People', Icon: IconUser },
        { href: '/portal-access/teams', label: 'Groups', Icon: IconProjects },
        { href: '/portal-access/sso', label: 'Sign-in', Icon: IconShield },
      ],
    });
  }
  const allNavItems: NavItem[] = sidebarSections.flatMap((section) => section.items);
  const k8sNavActive = pathname === '/k8s' || pathname.startsWith('/k8s/');

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const item of allNavItems) {
      if (item.children && itemIsActive(item)) next[item.href] = true;
    }
    const activeSection = sidebarSections.find((section) => section.items.some((item) => itemIsActive(item)));
    if (Object.keys(next).length === 0 && !activeSection) return;
    if (Object.keys(next).length) setOpenNavGroups((current) => ({ ...current, ...next }));
    if (activeSection) setOpenSections((current) => ({ ...current, [activeSection.title]: true }));
  }, [pathname]);

  useEffect(() => {
    if (!sessionReady || !user) return;
    const next = portalGrants(user);
    if (pathAllowed(pathname, next) || (user.maintenance_approver && (pathname === '/maintenance' || pathname.startsWith('/maintenance/')))) return;
    const dest = homeFor(next);
    if (pathname !== dest) {
      rememberAccessDenied(getPageTitle(pathname));
      void router.replace(dest);
    }
  }, [sessionReady, user, pathname, router]);

  const pageTitle = getPageTitle(pathname);
  const crumbProject = scopeProjects.find((item) => String(item.id) === scope.projectId);
  const breadcrumbs = buildBreadcrumbs(pathname, router.isReady ? router.asPath : pathname, PAGE_TITLES);
  const roleLabel = !sessionReady
    ? ''
    : grants.portalAccess
    ? 'Admin'
    : grants.manager
    ? 'DevOps manager'
    : grants.daily
    ? 'Operator'
    : 'Requester';
  const statusLabel = !sessionReady
    ? 'Checking session'
    : isManager
    ? !pendingCountKnown
      ? 'Checking approvals'
      : pendingCount > 0
      ? `${pendingCount} pending approvals`
      : 'No pending approvals'
    : 'Active session';
  const getSidebarBadge = (href: string): string | null => {
    if ((href === '/service-desk' || href === '/tickets') && isManager && pendingCountKnown && pendingCount > 0) {
      return pendingCount > 99 ? '99+' : String(pendingCount);
    }
    return null;
  };

  const isNavActive = (href: string) => {
    const item = allNavItems.find((entry) => entry.href === href);
    if (item) return itemIsActive(item);
    return href === '/k8s' ? k8sNavActive : leafIsActive(href);
  };

  const showNavTooltip = (event: SyntheticEvent<HTMLElement>) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip]');
    const text = target?.dataset.tooltip;
    if (!target || !text) {
      setNavTooltip(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setNavTooltip({ text, top: rect.top + rect.height / 2, left: rect.right + 10 });
  };

  const hideNavTooltip = () => setNavTooltip(null);

  const renderNavItem = (item: NavItem) => {
    const { href, label, Icon, children } = item;
    const groupActive = itemIsActive(item);
    const badge = getSidebarBadge(href);
    const hasChildren = Boolean(children?.length) && !sidebarCollapsed;
    const groupOpen = openNavGroups[href] === undefined ? groupActive : Boolean(openNavGroups[href]);

    return (
      <div key={href} className="devops-sidebar-new__expandable">
        <div className="devops-sidebar-new__group-row">
          <Link
            href={href}
            className={`devops-sidebar-new__link ${!hasChildren && leafIsActive(href) ? 'devops-sidebar-new__link--active' : groupActive ? 'devops-sidebar-new__link--current' : ''}`}
            onClick={() => {
              if (hasChildren) setOpenNavGroups((current) => ({ ...current, [href]: true }));
              setMobileMenuOpen(false);
            }}
            aria-current={!hasChildren && leafIsActive(href) ? 'page' : undefined}
            aria-label={sidebarCollapsed ? label : undefined}
            data-tooltip={sidebarCollapsed ? label : undefined}
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
              onClick={() => setOpenNavGroups((current) => ({ ...current, [href]: !groupOpen }))}
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
    { href: '/services', label: 'Service inventory', Icon: IconProjects },
    { href: '/k8s', label: 'Infra', Icon: IconK8s },
  ].map((tab) => ({ ...tab, active: isNavActive(tab.href), badge: getSidebarBadge(tab.href) }));

  return (
    <div className="devops-layout devops-layout-sidebar">
      <a className="ig-skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        className={`devops-sidebar-new ${sidebarCollapsed ? 'devops-sidebar-new--collapsed' : ''} ${mobileMenuOpen ? 'devops-sidebar-new--mobile-open' : ''}`}
        onMouseOver={sidebarCollapsed ? showNavTooltip : undefined}
        onFocus={sidebarCollapsed ? showNavTooltip : undefined}
        onMouseLeave={hideNavTooltip}
        onBlur={hideNavTooltip}
      >
        <div className="devops-sidebar-new__header">
          <button
            type="button"
            className="devops-sidebar-new__hamburger"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            data-tooltip={sidebarCollapsed ? 'Expand sidebar' : undefined}
          >
            <IconMenu />
          </button>
          {!sidebarCollapsed && (
            <Link href="/dashboard" className="devops-sidebar-new__brand">
              <img className="devops-sidebar-new__brand-mark" src="/brand/opstrellis-mark-dark.svg" alt="" aria-hidden width={28} height={28} />
              <span className="devops-sidebar-new__brand-word devops-sidebar-new__brand-word--primary">OpsTrellis</span>
            </Link>
          )}
        </div>
        <div className="devops-sidebar-new__body">
          <nav className="devops-sidebar-new__nav" aria-label="Primary">
            {sessionReady
              ? sidebarSections.filter((section) => section.items.length > 0).map((section) => {
                  const active = section.items.some((item) => itemIsActive(item));
                  const open = sidebarCollapsed || (openSections[section.title] === undefined ? active : openSections[section.title]);
                  return (
                    <div key={section.title}>
                      {!sidebarCollapsed ? (
                        <button
                          type="button"
                          className={`devops-sidebar-new__section${open ? ' is-open' : ''}`}
                          aria-expanded={open}
                          onClick={() => setOpenSections((current) => ({ ...current, [section.title]: !open }))}
                        >
                          <span>{section.title}</span>
                          <IconChevronDown />
                        </button>
                      ) : null}
                      {open ? section.items.map((item) => renderNavItem(item)) : null}
                    </div>
                  );
                })
              : null}
          </nav>
          <div className="devops-sidebar-new__footer">
            <Link
              href="/profile"
              className={`devops-sidebar-new__link ${leafIsActive('/profile') ? 'devops-sidebar-new__link--active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
              aria-current={leafIsActive('/profile') ? 'page' : undefined}
              aria-label={sidebarCollapsed ? 'Settings' : undefined}
              data-tooltip={sidebarCollapsed ? 'Settings' : undefined}
            >
              <IconUser className="devops-sidebar-new__icon" />
              {!sidebarCollapsed && <span className="devops-sidebar-new__label">Settings</span>}
            </Link>
            <button
              type="button"
              className="devops-sidebar-new__link"
              onClick={() => {
                setNotifyOpen(false);
                setProfileOpen(false);
                setSupportMode('help');
                setSupportCostContext('');
                setSupportTab('docs');
                setSupportOpen(true);
                setMobileMenuOpen(false);
              }}
              aria-label={sidebarCollapsed ? 'Help & guides' : undefined}
              data-tooltip={sidebarCollapsed ? 'Help & guides' : undefined}
            >
              <IconHelpCircle className="devops-sidebar-new__icon" />
              {!sidebarCollapsed && <span className="devops-sidebar-new__label">Help & guides</span>}
            </button>
            <button
              type="button"
              className="devops-sidebar-new__link"
              onClick={handleLogout}
              aria-label={sidebarCollapsed ? 'Log out' : undefined}
              data-tooltip={sidebarCollapsed ? 'Log out' : undefined}
            >
              <IconLogout className="devops-sidebar-new__icon" />
              {!sidebarCollapsed && <span className="devops-sidebar-new__label">Log out</span>}
            </button>
          </div>
        </div>
      </aside>

      {sidebarCollapsed && navTooltip ? (
        <div className="ot-nav-tooltip" role="tooltip" style={{ top: navTooltip.top, left: navTooltip.left }}>
          {navTooltip.text}
        </div>
      ) : null}

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
              aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileMenuOpen}
            >
              <IconMenu />
            </button>
            <div className="devops-navbar__title-wrap">
              <span className="devops-navbar__kicker">OpsTrellis</span>
              <h1 className="devops-navbar__title">{pageTitle}</h1>
            </div>
            <ScopeBar
              projects={scopeProjects}
              scope={scope}
              catalogEnvironments={catalogEnvironments}
              showFacts={isRecordDetailPath(pathname)}
              onChange={(partial) => {
                if (sessionStorage.getItem('opstrellis-form-dirty') === '1' && !window.confirm('This page has unsaved work. Changing the project or environment refreshes dependent fields. Continue?')) return;
                writeScopeQuery(updateScope(partial));
              }}
              onClear={() => {
                if (sessionStorage.getItem('opstrellis-form-dirty') === '1' && !window.confirm('This page has unsaved work. Clearing the project or environment refreshes dependent fields. Continue?')) return;
                writeScopeQuery(updateScope({ projectId: '', environment: '' }));
              }}
            />
            <span className={`devops-navbar__status-chip ${isManager && pendingCountKnown && pendingCount > 0 ? 'devops-navbar__status-chip--alert' : ''}`}>
              {statusLabel}
            </span>
          </div>
          <div className="devops-navbar__right">
            <SearchTrigger placeholder="Search tickets, services, infrastructure, people…" />
            <div className="devops-navbar__actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-pressed={compactRows}
                title={compactRows ? 'Comfortable rows' : 'Compact rows'}
                onClick={() => {
                  const next = !compactRows;
                  setCompactRows(next);
                  const value = next ? 'compact' : 'comfortable';
                  document.documentElement.dataset.density = value;
                  window.localStorage.setItem('opstrellis-density', value);
                }}
              >
                {compactRows ? 'Compact' : 'Comfortable'}
              </button>
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
                    ref={notifyButtonRef}
                    title={!pendingCountKnown ? 'Checking approvals' : pendingCount > 0 ? `${pendingCount} pending approvals` : 'Pending approvals'}
                    aria-label={!pendingCountKnown ? 'Notifications, checking approvals' : pendingCount > seenNotifyIds.length ? `Notifications, ${Math.max(pendingCount - seenNotifyIds.length, 0)} unread` : pendingCount > 0 ? `Notifications, ${pendingCount} waiting` : 'Notifications'}
                    aria-expanded={notifyOpen}
                    aria-haspopup="dialog"
                    aria-controls="devops-notify-panel"
                  >
                    <IconBell />
                    {pendingCountKnown && pendingCount > seenNotifyIds.length && <span className="devops-navbar__badge devops-navbar__badge--dot" aria-hidden />}
                  </button>

                  {notifyOpen && (
                    <div className="devops-navbar__notify-panel" id="devops-notify-panel" role="dialog" aria-label="Pending approvals">
                      <div className="devops-navbar__notify-header">
                        <h3 className="devops-navbar__notify-title">Action required</h3>
                        <button type="button" className="devops-navbar__notify-close" onClick={() => setNotifyOpen(false)} aria-label="Close">
                          Close
                        </button>
                      </div>
                      <div className="devops-navbar__notify-summary">
                        <strong>{!pendingCountKnown || pendingApprovalsLoading ? '…' : pendingCount > 99 ? '99+' : pendingCount}</strong>
                        <span>
                          {!pendingCountKnown || pendingApprovalsLoading
                            ? 'Checking approval tickets.'
                            : pendingCount > 0
                            ? 'Approval work is waiting across projects and release flows.'
                            : 'No approval tickets are waiting right now.'}
                        </span>
                      </div>
                      <div className="devops-navbar__notify-links">
                        <Link href="/tickets" className="devops-navbar__notify-link" onClick={() => setNotifyOpen(false)}>
                          Open tickets
                        </Link>
                        <Link href="/notification-settings" className="devops-navbar__notify-link" onClick={() => setNotifyOpen(false)}>
                          Notification settings
                        </Link>
                      </div>
                      <div className="devops-navbar__notify-list">
                        {pendingApprovalsLoading ? (
                          <p className="devops-navbar__notify-empty" role="status">Loading approvals…</p>
                        ) : pendingApprovals.length === 0 ? (
                          <p className="devops-navbar__notify-empty">No pending approval tickets.</p>
                        ) : (
                          pendingApprovals.slice(0, 8).map((request) => (
                            <Link
                              key={request.id}
                              href={`/tickets?id=${request.id}`}
                              className={`devops-navbar__notify-ticket ${seenNotifyIds.includes(String(request.id)) ? 'is-read' : 'is-unread'}`}
                              onClick={() => {
                                setSeenNotifyIds((current) => {
                                  if (current.includes(String(request.id))) return current;
                                  const next = [...current, String(request.id)];
                                  window.localStorage.setItem('opstrellis-notify-read', next.join(','));
                                  return next;
                                });
                                setNotifyOpen(false);
                              }}
                            >
                              <strong>Ticket #{request.id} · {request.service || 'Service unknown'}</strong>
                              {request.project_name ? (
                                <span>
                                  {request.project_name}
                                  {request.project_code ? ` (${request.project_code})` : ''}
                                </span>
                              ) : null}
                              <span>{request.team || 'Team'} / {request.cloud || 'Cloud'} / {request.service || 'Service'}</span>
                              <small>Waiting for approval · {formatTime(request.created_at)} · Open the ticket to approve or reject it.</small>
                            </Link>
                          ))
                        )}
                      </div>
                      <p className="devops-navbar__notify-empty">Updates such as status changes stay on the record timeline. This list is only work waiting on you.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="devops-navbar__profile-wrap" ref={profileRef}>
              <button
                type="button"
                ref={profileButtonRef}
                className="devops-navbar__profile-btn"
                onClick={() => {
                  setProfileOpen((open) => !open);
                  setNotifyOpen(false);
                  setSupportOpen(false);
                }}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                aria-controls="devops-profile-menu"
                aria-busy={!sessionReady || undefined}
                aria-label={sessionReady ? `Account menu for ${user?.username || 'your account'}` : 'Account menu, checking session'}
              >
                <span className="devops-navbar__avatar" aria-hidden="true">{sessionReady ? profileInitials : ''}</span>
                <span className="devops-navbar__profile-copy">
                  <span className="devops-navbar__profile-label">
                    {sessionReady ? user?.username || 'Signed in' : <span className="ot-skeleton ot-skeleton--text" />}
                  </span>
                  {roleLabel ? <span className="devops-navbar__role">{roleLabel}</span> : null}
                </span>
                <svg className="devops-navbar__profile-caret" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {profileOpen ? (
                <div className="devops-navbar__profile-menu" id="devops-profile-menu" role="menu" aria-label="Account" ref={profileMenuRef}>
                  <div className="devops-navbar__profile-head" role="presentation">
                    <strong>{sessionReady ? user?.username || 'Signed in' : 'Checking session…'}</strong>
                    <span>{roleLabel || 'Role loading'}</span>
                  </div>
                  <Link href="/profile" role="menuitem" className="devops-navbar__profile-item" onClick={() => setProfileOpen(false)}>
                    Profile settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    className="devops-navbar__profile-item"
                    onClick={() => {
                      setProfileOpen(false);
                      setSupportMode('help');
                      setSupportCostContext('');
                      setSupportOpen(true);
                    }}
                  >
                    Help and support
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="devops-navbar__profile-item devops-navbar__profile-item--danger"
                    onClick={() => {
                      setProfileOpen(false);
                      handleLogout();
                    }}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        {(accessNotice || submission) ? (
          <div className="ops-banner-stack">
            {accessNotice ? (
              <div className="alert sd-alert" role="status">
                <span>{accessNotice} is not available for your role. You were returned here. Ask an administrator if you need that page.</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAccessNotice('')}>Dismiss</button>
              </div>
            ) : null}
            {submission ? (
              <div className="alert alert-success sd-alert" role="status">
                <span>{submission.kind} {submission.id} is {submission.status}. {submission.next}</span>
                {submission.href ? <Link href={submission.href}>Open {submission.kind} {submission.id}</Link> : null}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSubmission(null)}>Dismiss</button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="ops-crumb">
          <nav aria-label="Breadcrumb">
            <ol className="ops-crumb__list">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`}>
                  {crumb.href ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <span className="ops-crumb__context">
            Workspace: {crumbProject ? `${typeof crumbProject.name === 'string' ? crumbProject.name : 'Project'} · ${typeof crumbProject.team === 'string' && crumbProject.team ? crumbProject.team : 'Team unknown'} · ${String(typeof crumbProject.cloud === 'string' && crumbProject.cloud ? crumbProject.cloud : 'cloud unknown').toUpperCase()}` : 'All projects'}
            {scope.environment ? ` · ${scope.environment}` : ''}
          </span>
        </div>
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
          {sessionReady ? <PortalErrorBoundary>{children}</PortalErrorBoundary> : null}
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
          { id: 'home', label: 'Home', href: '/dashboard', hint: 'Daily overview' },
          { id: 'requests', label: 'Requests', href: '/tickets', hint: 'Service desk tickets' },
          { id: 'approval-queue', label: 'Approval queue', href: '/approval-center', hint: 'Waiting for a decision' },
          { id: 'promotion-history', label: 'Promotion history', href: '/gate-approvals', hint: 'Past promotion decisions' },
          { id: 'promotion-rules', label: 'Promotion rules', href: '/gate-policies', hint: 'What a promotion must pass' },
          { id: 'approval-timing', label: 'Approval timing', href: '/approval-sla', hint: 'How long approvals take' },
          { id: 'changes', label: 'Changes', href: '/changes', hint: 'Change requests' },
          { id: 'deployments', label: 'Deployments', href: '/promotions', hint: 'Promotion runs' },
          { id: 'k8s', label: 'Kubernetes', href: '/k8s', hint: 'Clusters and workloads' },
          { id: 'gitops', label: 'GitOps', href: '/gitops-projects', hint: 'Git-backed projects' },
          { id: 'gitops-control', label: 'GitOps control', href: '/gitops-control', hint: 'Sync and drift' },
          { id: 'projects', label: 'Projects', href: '/projects', hint: 'Project catalog' },
          { id: 'create-change', label: 'Create change request', href: '/changes/new', hint: 'Open a change' },
          { id: 'change-calendar', label: 'Change calendar', href: '/change-calendar', hint: 'Scheduled changes' },
          { id: 'release-notes', label: 'Release notes', href: '/release-notes', hint: 'What shipped' },
          { id: 'cost', label: 'Cost', href: '/cost', hint: 'Operating bill and request estimates' },
          { id: 'services', label: 'Service inventory', href: '/services', hint: 'Production services, observability, and findings' },
          { id: 'add-service', label: 'Add service', href: '/services/new', hint: 'Register a service' },
          { id: 'operator-activity', label: 'Operator activity', href: '/activity', hint: 'Recent operator actions' },
          { id: 'incidents', label: 'Incidents', href: '/incidents', hint: 'Open incidents' },
          { id: 'incident-notes', label: 'Incident notes', href: '/incident-workspace', hint: 'Incident workspace' },
          { id: 'problems', label: 'Problems', href: '/problems', hint: 'Problem records' },
          { id: 'create-problem', label: 'Create problem', href: '/problems/new', hint: 'Open a problem' },
          { id: 'knowledge', label: 'Knowledge', href: '/knowledge', hint: 'Articles' },
          { id: 'deploy-intel', label: 'Deploy intelligence', href: '/deploy-intelligence', hint: 'Deploy signals' },
        ]}
      />
      <SupportHub
        open={supportOpen}
        initialTab={supportTab}
        onClose={() => setSupportOpen(false)}
        portalName="OpsTrellis"
        currentPath={pathname}
        currentTitle={pageTitle}
        articles={supportArticles}
        quickPrompts={supportQuickPromptsForPath(pathname)}
        seedQuestion={supportSeed}
        onSeedConsumed={() => setSupportSeed('')}
        analysisMode={supportMode === 'cost'}
        analysisContext={supportCostContext}
        apiUrl={apiUrl}
        token={typeof window === 'undefined' ? null : localStorage.getItem(DEVOPS_TOKEN_KEY)}
        remapIncidentCitationLinks
        externalDocsHref={process.env.NEXT_PUBLIC_DOCS_URL || ''}
        escalationActions={[
          ...(supportEmailReady
            ? [{
                label: 'Email platform support',
                externalHref: `mailto:${supportEmail}?subject=${encodeURIComponent(`OpsTrellis support: ${pageTitle}`)}`,
              }]
            : []),
          { label: 'Open incidents', href: '/incidents' },
        ]}
      />
    </div>
  );
}
