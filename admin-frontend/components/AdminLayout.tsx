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
  IconHelpCircle,
  IconFileText,
  IconChevronDown,
  IconAlertCircle,
} from './Icons';
import SupportHub from './SupportHub';
import { clearAdminSession, readAdminToken } from '../lib/session';
import { supportArticles, supportQuickPrompts } from '../lib/supportContent';
import {
  CommandPalette,
  MobileTabBar,
  ScopeBar,
  ThemeToggle,
  normalizeScopeProjects,
  queryToScope,
  readWorkspaceScope,
  scopeToQuery,
  useWorkspaceScope,
  type ScopeProject,
} from '@infragate/ui';

const SIDEBAR_COLLAPSED_KEY = 'infra-admin-sidebar-collapsed';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@setuops.example';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Home',
  '/approval-center': 'Approvals',
  '/project-governance': 'Project Setup',
  '/requests': 'Requests',
  '/changes': 'Changes',
  '/incidents': 'Incidents',
  '/sla': 'Service Levels',
  '/teams': 'Teams',
  '/users': 'Users',
  '/projects': 'Projects',
  '/team-ownership': 'Team Access',
  '/activity': 'Recent Activity',
  '/templates': 'Catalog',
  '/access-review': 'Access Review',
  '/webhooks': 'Integrations',
  '/maintenance': 'Maintenance',
  '/deploy-intelligence': 'Deploy Intel',
  '/profile': 'Profile',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/dashboard' && pathname.startsWith(path)) return title;
  }
  return 'Home';
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

const PRIMARY_NAV: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  children?: { href: string; label: string }[];
}[] = [
  { href: '/dashboard', label: 'Home', Icon: IconDashboard },
  { href: '/approval-center', label: 'Approvals', Icon: IconShield },
  { href: '/requests', label: 'Requests', Icon: IconRequests },
  {
    href: '/users',
    label: 'People',
    Icon: IconUsers,
    children: [
      { href: '/users', label: 'Users' },
      { href: '/teams', label: 'Teams' },
      { href: '/sso', label: 'SSO' },
    ],
  },
  {
    href: '/projects',
    label: 'Projects',
    Icon: IconProjects,
    children: [
      { href: '/projects', label: 'Catalog' },
      { href: '/project-governance', label: 'Setup' },
      { href: '/team-ownership', label: 'Access' },
    ],
  },
  { href: '/templates', label: 'Catalog', Icon: IconTemplates },
];

const MORE_NAV: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { href: '/changes', label: 'Changes', Icon: IconFileText },
  { href: '/incidents', label: 'Incidents', Icon: IconAlertCircle },
  { href: '/sla', label: 'Service levels', Icon: IconTrendingUp },
  { href: '/access-review', label: 'Access review', Icon: IconShield },
  { href: '/activity', label: 'Activity', Icon: IconActivity },
  { href: '/webhooks', label: 'Integrations', Icon: IconWebhook },
  { href: '/maintenance', label: 'Maintenance', Icon: IconLayers },
  { href: '/deploy-intelligence', label: 'Deploy intel', Icon: IconActivity },
  { href: '/scorecards', label: 'Scorecards', Icon: IconTrendingUp },
  { href: '/evidence', label: 'Evidence', Icon: IconFileText },
];

const MOBILE_TABS = ['/dashboard', '/approval-center', '/requests', '/projects']
  .map((href) => PRIMARY_NAV.find((item) => item.href === href))
  .filter((item): item is (typeof PRIMARY_NAV)[number] => Boolean(item));

function getAdminIdentity(): { initials: string; label: string } {
  if (typeof window === 'undefined') return { initials: 'A', label: 'Admin' };
  try {
    const raw = localStorage.getItem('admin_user');
    if (!raw) return { initials: 'A', label: 'Admin' };
    const user = JSON.parse(raw) as { username?: string; email?: string };
    const label = user?.username || user?.email || 'Admin';
    const parts = label.trim().split(/[\s@.]/).filter(Boolean);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2)
      : label.slice(0, 2).toUpperCase() || 'A';
    return { initials, label };
  } catch {
    return { initials: 'A', label: 'Admin' };
  }
}

function getAdminToken(): string | null {
  return readAdminToken();
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
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTab, setSupportTab] = useState<'chat' | 'docs'>('chat');
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [scopeProjects, setScopeProjects] = useState<ScopeProject[]>([]);
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>({});
  const { scope, updateScope } = useWorkspaceScope();
  const scopeHydrated = useRef(false);
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
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setSidebarCollapsed(c === 'true');
    } catch (_) {}
  }, []);

  const token = getAdminToken();
  const moreNavActive = MORE_NAV.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`));

  useEffect(() => {
    if (moreNavActive) setMoreNavOpen(true);
  }, [moreNavActive]);

  useEffect(() => {
    if (!token) return;
    fetch(`${apiUrl}/api/admin/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setScopeProjects(normalizeScopeProjects(data?.projects)))
      .catch(() => setScopeProjects([]));
  }, [token]);

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
    const currentToken = getAdminToken();
    if (currentToken) return;
    clearAdminSession();
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
        setPendingTickets(Array.isArray(data?.requests) ? data.requests : []);
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
    setSupportOpen(false);
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

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };

  const pageTitle = getPageTitle(pathname);
  const statusLabel = newRequestsCount > 0 ? `${newRequestsCount} pending requests` : 'No pending requests';
  const getSidebarBadge = (href: string): string | null => {
    if (href === '/requests' && newRequestsCount > 0) {
      return newRequestsCount > 99 ? '99+' : String(newRequestsCount);
    }
    return null;
  };

  return (
    <div className="admin-layout admin-layout-sidebar admin-shell">
      <a className="ig-skip-link" href="#main-content">
        Skip to content
      </a>
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
              <span className="admin-sidebar-shell__brand-word admin-sidebar-shell__brand-word--primary">SetuOps</span>
              <span className="admin-sidebar-shell__brand-word">Admin</span>
            </Link>
          )}
        </div>
        <div className="admin-sidebar-shell__body">
          <nav className="admin-sidebar-shell__nav" aria-label="Primary">
            {!sidebarCollapsed && <span className="admin-sidebar-shell__nav-title">Modules</span>}
            {PRIMARY_NAV.map(({ href, label, Icon, children }) => {
              const childActive = Boolean(children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`)));
              const isActive = childActive || pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
              const badge = getSidebarBadge(href);
              const groupOpen = Boolean(openNavGroups[href]) || childActive;
              return (
                <div key={href}>
                  <div className="devops-sidebar-new__group-row">
                    <Link
                      href={href}
                      className={`admin-sidebar-shell__link ${isActive ? 'admin-sidebar-shell__link--active' : ''}`}
                      onClick={() => {
                        if (children) setOpenNavGroups((current) => ({ ...current, [href]: true }));
                        setMobileMenuOpen(false);
                      }}
                      aria-current={pathname === href ? 'page' : undefined}
                      aria-label={sidebarCollapsed ? label : undefined}
                      title={sidebarCollapsed ? label : undefined}
                    >
                      <Icon className="admin-sidebar-shell__icon" />
                      {!sidebarCollapsed && <span className="admin-sidebar-shell__label">{label}</span>}
                      {!sidebarCollapsed && badge && <span className="admin-sidebar-shell__badge">{badge}</span>}
                    </Link>
                    {children && !sidebarCollapsed ? (
                      <button
                        type="button"
                        className={`devops-sidebar-new__chevron ${groupOpen ? 'devops-sidebar-new__chevron--open' : ''}`}
                        aria-expanded={groupOpen}
                        onClick={() => setOpenNavGroups((current) => ({ ...current, [href]: !current[href] }))}
                      >
                        <IconChevronDown />
                      </button>
                    ) : null}
                  </div>
                  {children && !sidebarCollapsed && groupOpen ? (
                    <div className="admin-sidebar-shell__sub">
                      {children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`admin-sidebar-shell__sublink ${pathname === child.href || pathname.startsWith(`${child.href}/`) ? 'is-active' : ''}`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!sidebarCollapsed && (
              <div className="admin-sidebar-shell__section">
                <button
                  type="button"
                  className="admin-sidebar-shell__link"
                  onClick={() => setMoreNavOpen((open) => !open)}
                  aria-expanded={moreNavOpen}
                >
                  <span className="admin-sidebar-shell__label">More</span>
                </button>
                {moreNavOpen && MORE_NAV.map(({ href, label, Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`admin-sidebar-shell__link ${pathname === href || pathname.startsWith(href) ? 'admin-sidebar-shell__link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={pathname === href || pathname.startsWith(href) ? 'page' : undefined}
                  >
                    <Icon className="admin-sidebar-shell__icon" />
                    <span className="admin-sidebar-shell__label">{label}</span>
                  </Link>
                ))}
              </div>
            )}
          </nav>

          <div className="admin-sidebar-shell__footer">
            <button
              type="button"
              className="admin-sidebar-shell__link"
              onClick={() => {
                setNotifyOpen(false);
                setProfileOpen(false);
                setSupportTab('chat');
                setSupportOpen(true);
                setMobileMenuOpen(false);
              }}
              title="Support"
            >
              <IconHelpCircle className="admin-sidebar-shell__icon" />
              {!sidebarCollapsed && <span className="admin-sidebar-shell__label">Support</span>}
            </button>
            <button
              type="button"
              className="admin-sidebar-shell__link"
              onClick={() => {
                setNotifyOpen(false);
                setProfileOpen(false);
                setSupportTab('docs');
                setSupportOpen(true);
                setMobileMenuOpen(false);
              }}
              title="Documentation"
            >
              <IconFileText className="admin-sidebar-shell__icon" />
              {!sidebarCollapsed && <span className="admin-sidebar-shell__label">Documentation</span>}
            </button>
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
              <span className="admin-topbar__kicker">SetuOps</span>
              <h1 className="admin-topbar__title">{pageTitle}</h1>
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
              <button
                type="button"
                className="admin-topbar__assist-btn"
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
              <span className="admin-topbar__workspace">{profileLabel}</span>
              <span className="admin-topbar__role">Admin</span>
              <ThemeToggle />
            </div>

            <div className="admin-topbar__notify-wrap" ref={notifyRef}>
              <button
                type="button"
                className="admin-topbar__icon-btn"
                onClick={() => {
                  setNotifyOpen((o) => !o);
                  setProfileOpen(false);
                  setSupportOpen(false);
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
                onClick={() => {
                  setProfileOpen((o) => !o);
                  setNotifyOpen(false);
                  setSupportOpen(false);
                }}
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

        <main id="main-content" tabIndex={-1} className="admin-main-shell__content ig-page">
          {children}
        </main>
      </div>
      <MobileTabBar
        tabs={MOBILE_TABS.map((item) => ({
          ...item,
          active:
            pathname === item.href
            || Boolean(item.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`)))
            || (item.href !== '/dashboard' && pathname.startsWith(item.href)),
          badge: getSidebarBadge(item.href),
        }))}
        onMore={() => setMobileMenuOpen((open) => !open)}
        moreOpen={mobileMenuOpen}
        MoreIcon={IconMenu}
      />
      <CommandPalette
        apiUrl={apiUrl}
        token={token}
        commands={[
          { id: 'home', label: 'Home', href: '/dashboard' },
          { id: 'approvals', label: 'Approvals', href: '/approval-center' },
          { id: 'requests', label: 'Requests', href: '/requests' },
          { id: 'people', label: 'People', href: '/users' },
          { id: 'projects', label: 'Projects', href: '/projects' },
          { id: 'catalog', label: 'Catalog', href: '/templates' },
          { id: 'changes', label: 'Change requests', href: '/changes' },
          { id: 'incidents', label: 'Incidents', href: '/incidents' },
          { id: 'webhooks', label: 'Integrations', href: '/webhooks' },
        ]}
      />
      <SupportHub
        open={supportOpen}
        initialTab={supportTab}
        onClose={() => setSupportOpen(false)}
        portalName="Admin Portal"
        currentPath={pathname}
        currentTitle={pageTitle}
        articles={supportArticles}
        quickPrompts={supportQuickPrompts}
        apiUrl={apiUrl}
        token={token}
        externalDocsHref={process.env.NEXT_PUBLIC_DOCS_URL || ''}
        escalationActions={[
          {
            label: 'Email platform support',
            externalHref: `mailto:${supportEmail}?subject=${encodeURIComponent(`SetuOps support: ${pageTitle}`)}`,
          },
          { label: 'Open approval center', href: '/approval-center' },
          { label: 'Open change requests', href: '/changes' },
          { label: 'Open incidents', href: '/incidents' },
          { label: 'Open activity', href: '/activity' },
        ]}
      />
    </div>
  );
}
