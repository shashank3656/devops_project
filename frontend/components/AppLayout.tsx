import Link from 'next/link';
import { useRouter } from 'next/router';
import { SITE_NAME } from '../lib/site';
import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { getStoredTheme, setStoredTheme } from './NavBar';
import {
  IconHome,
  IconPlus,
  IconHistory,
  IconUser,
  IconMoon,
  IconSun,
  IconLogout,
  IconBell,
  IconChevronLeft,
  IconChevronRight,
  IconUsers,
  IconTemplates,
} from './Icons';

const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_STORAGE_KEY = 'user_sidebar_collapsed';
const HISTORY_LAST_SEEN_KEY = 'user_history_last_seen';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export function getApiUrl(): string {
  return apiUrl;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [teamCheck, setTeamCheck] = useState<'loading' | 'ok' | 'forbidden'>('loading');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [updatedRequestsCount, setUpdatedRequestsCount] = useState(0);
  const [pendingManagerApprovalCount, setPendingManagerApprovalCount] = useState(0);
  const [hasManagedTeams, setHasManagedTeams] = useState(false);

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) setSidebarCollapsed(stored === 'true');
    } catch (_) {}
  }, []);

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch (_) {}
  };

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
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        const teams = data?.teams || [];
        setHasManagedTeams(teams.length > 0);
      })
      .catch(() => {});
  }, [teamCheck]);

  // When user visits History, mark as seen so notification badge can clear
  useEffect(() => {
    if (router.pathname === '/history') {
      try {
        localStorage.setItem(HISTORY_LAST_SEEN_KEY, new Date().toISOString());
        setUpdatedRequestsCount(0);
      } catch (_) {}
    }
  }, [router.pathname]);

  // Poll for request status updates (user's requests updated since last History visit)
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
          .then((res) => res.ok ? res.json() : null)
          .then((data) => { if (data && typeof data.updated_count === 'number') setUpdatedRequestsCount(data.updated_count); })
          .catch(() => {});
      } catch (_) {}
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, NOTIFY_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  // Poll for "pending your approval" count (portal / group managers)
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || token === 'undefined') return;
    const fetchPendingApproval = () => {
      const t = localStorage.getItem('token');
      if (!t) return;
      fetch(`${apiUrl}/api/me/pending-manager-approval`, { headers: { Authorization: `Bearer ${t}` } })
        .then((res) => res.ok ? res.json() : null)
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

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    setTheme(next);
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

  if (teamCheck === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-gray-50)' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Checking access...</p>
      </div>
    );
  }
  if (teamCheck === 'forbidden') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-gray-50)', padding: 24 }}>
        <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, color: 'var(--error-color)', marginBottom: 16 }}>403 Forbidden</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
            You are not assigned to any team. Contact your administrator to be added to a team.
          </p>
          <button type="button" className="btn btn-primary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    );
  }

  const navItem = (href: string, label: string, icon: React.ReactNode) => {
    const isActive = router.pathname === href || (href !== '/home' && router.pathname.startsWith(href));
    return (
      <Link
        href={href}
        title={sidebarCollapsed ? label : undefined}
        className="app-sidebar-nav-item"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: sidebarCollapsed ? '12px' : '12px 16px',
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          borderRadius: 'var(--radius-md)',
          color: isActive ? 'var(--primary-color)' : 'var(--text-primary)',
          fontWeight: isActive ? 600 : 500,
          textDecoration: 'none',
          background: isActive ? 'var(--primary-tint)' : 'transparent',
          transition: 'background 0.15s, color 0.15s',
          position: 'relative',
        }}
      >
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
        {!sidebarCollapsed && <span>{label}</span>}
      </Link>
    );
  };

  return (
    <div className="app-layout">
      <aside className="app-sidebar" data-collapsed={sidebarCollapsed}>
        <div className="app-sidebar-header">
          <Link href="/home" className="app-sidebar-brand">
            <img src="/logo.svg" alt="" width={36} height={36} />
            {!sidebarCollapsed && <span className="app-sidebar-brand-text">{SITE_NAME}</span>}
          </Link>
          <button
            type="button"
            className="app-sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>
        <nav className="app-sidebar-nav">
          {navItem('/home', 'Home', <IconHome />)}
          {navItem('/create-infrastructure', 'New Request', <IconPlus />)}
          {navItem('/templates', 'Templates', <IconTemplates />)}
          <Link
            href="/history"
            title="History"
            className="app-sidebar-nav-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: sidebarCollapsed ? '12px' : '12px 16px',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              borderRadius: 'var(--radius-md)',
              color: router.pathname === '/history' ? 'var(--primary-color)' : 'var(--text-primary)',
              fontWeight: router.pathname === '/history' ? 600 : 500,
              textDecoration: 'none',
              background: router.pathname === '/history' ? 'var(--primary-tint)' : 'transparent',
              transition: 'background 0.15s, color 0.15s',
              position: 'relative',
            }}
          >
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconHistory /></span>
            {!sidebarCollapsed && (
              <>
                <span>History</span>
                {pendingManagerApprovalCount > 0 && (
                  <span className="app-topbar-badge" style={{ marginLeft: 'auto', minWidth: 20 }} aria-label={`${pendingManagerApprovalCount} need your approval`}>
                    {pendingManagerApprovalCount > 99 ? '99+' : pendingManagerApprovalCount}
                  </span>
                )}
              </>
            )}
          </Link>
          {hasManagedTeams && navItem('/my-teams', 'My teams', <IconUsers />)}
          {navItem('/profile', 'Profile', <IconUser />)}
        </nav>
        <div className="app-sidebar-footer">
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-secondary app-sidebar-footer-btn"
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          >
            <span className="app-sidebar-icon-wrap">{theme === 'dark' ? <IconSun /> : <IconMoon />}</span>
            {!sidebarCollapsed && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
          </button>
        </div>
      </aside>
      <div className="app-main-wrap">
        <header className="app-topbar">
          <div className="app-topbar-spacer" />
          <div className="app-topbar-actions">
            <Link
              href="/history"
              className="app-topbar-notify"
              title={updatedRequestsCount > 0 ? `${updatedRequestsCount} request update(s)` : 'Notifications'}
            >
              <IconBell />
              {updatedRequestsCount > 0 && (
                <span className="app-topbar-badge" aria-label={`${updatedRequestsCount} updates`}>
                  {updatedRequestsCount > 99 ? '99+' : updatedRequestsCount}
                </span>
              )}
            </Link>
            <button type="button" className="app-topbar-logout btn btn-secondary" onClick={handleLogout} title="Logout">
              <IconLogout />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <main className="app-main">
          {children}
        </main>
      </div>
    </div>
  );
}
