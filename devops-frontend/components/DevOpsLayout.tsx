import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';
import { IconTickets, IconWorkload, IconLogout, IconChevronLeft, IconChevronRight, IconSun, IconMoon, IconUser, IconUsers, IconTemplates } from './Icons';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const DEVOPS_SIDEBAR_COLLAPSED_KEY = 'devops_sidebar_collapsed';
const DEVOPS_THEME_KEY = 'infra-portal-theme';

interface DevopsUser {
  id: number;
  username: string;
  email?: string;
  user_type?: string;
  devops_profile?: { is_manager: boolean; level: string; position?: string; onboard_date?: string };
}

export default function DevOpsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [user, setUser] = useState<DevopsUser | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    try {
      const u = localStorage.getItem(DEVOPS_USER_KEY);
      if (u) setUser(JSON.parse(u));
      const c = localStorage.getItem(DEVOPS_SIDEBAR_COLLAPSED_KEY);
      if (c !== null) setCollapsed(c === 'true');
      const t = localStorage.getItem(DEVOPS_THEME_KEY);
      const resolved = t === 'light' ? 'light' : 'dark';
      setTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    } catch (_) {}
  }, []);

  const isManager = user?.devops_profile?.is_manager ?? false;

  const refreshPendingCount = useCallback(() => {
    if (!isManager) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.status === 'ok' && typeof data.pending_approval_count === 'number') setPendingCount(data.pending_approval_count);
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

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(DEVOPS_SIDEBAR_COLLAPSED_KEY, String(next));
    } catch (_) {}
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(DEVOPS_THEME_KEY, next);
      document.documentElement.setAttribute('data-theme', next);
    } catch (_) {}
  };

  const handleLogout = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.replace('/login');
  };

  const pathname = router.pathname;
  const navLink = (href: string, label: string, icon: ReactNode, badge?: number) => {
    const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
    return (
      <Link href={href} className={isActive ? 'devops-nav-active' : ''} title={collapsed ? label : undefined}>
        <span className="devops-sidebar-icon" aria-hidden>{icon}</span>
        <span className="devops-sidebar-label">{label}</span>
        {badge != null && badge > 0 && (
          <span className="devops-nav-badge" aria-label={`${badge} pending`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="devops-layout">
      <aside className={`devops-sidebar ${collapsed ? 'devops-sidebar-collapsed' : ''}`}>
        <div className="devops-sidebar-header">
          <Link href="/dashboard" className="devops-sidebar-brand">
            <img src="/logo.svg" alt="" width={36} height={36} />
            <span className="devops-sidebar-brand-text">{DEVOPS_SITE_NAME}</span>
          </Link>
          <button
            type="button"
            className="devops-sidebar-toggle"
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>
        <nav className="devops-sidebar-nav">
          {navLink('/dashboard', 'My tickets', <IconTickets />)}
          {isManager && navLink('/workload', 'Workload', <IconWorkload />, pendingCount)}
          {isManager && navLink('/tickets', 'All tickets', <IconTickets />)}
          {navLink('/templates', 'Templates', <IconTemplates />)}
          {isManager && navLink('/team', 'Team', <IconUsers />)}
          {navLink('/profile', 'Profile', <IconUser />)}
        </nav>
        <div className="devops-sidebar-footer">
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-secondary"
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            style={{
              width: '100%',
              justifyContent: collapsed ? 'center' : 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              color: 'var(--sidebar-text-muted)',
              background: 'transparent',
              border: '1px solid var(--sidebar-border)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </span>
            {!collapsed && <span className="devops-sidebar-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>}
          </button>
        </div>
      </aside>
      <div className="devops-main-wrap">
        <header className="devops-topbar">
          <div className="devops-topbar-spacer" />
          <div className="devops-topbar-actions">
            {user && <span className="devops-topbar-user">{user.username}</span>}
            <button type="button" className="btn btn-ghost devops-topbar-logout" onClick={handleLogout} title="Logout">
              <IconLogout />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <main className="devops-main">{children}</main>
      </div>
    </div>
  );
}
