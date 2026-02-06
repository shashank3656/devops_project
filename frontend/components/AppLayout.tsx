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
  IconChevronLeft,
  IconChevronRight,
} from './Icons';

const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_STORAGE_KEY = 'user_sidebar_collapsed';
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [teamCheck, setTeamCheck] = useState<'loading' | 'ok' | 'forbidden'>('loading');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    setTheme(next);
  };

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
          background: isActive ? 'var(--info-bg)' : 'transparent',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
        {!sidebarCollapsed && <span>{label}</span>}
      </Link>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg-gray-50)',
      }}
    >
      {/* Left sidebar */}
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
          {navItem('/history', 'History', <IconHistory />)}
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
          <button
            onClick={handleLogout}
            className="btn btn-secondary app-sidebar-footer-btn"
            title={sidebarCollapsed ? 'Logout' : undefined}
          >
            <span className="app-sidebar-icon-wrap"><IconLogout /></span>
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
      {/* Main content */}
      <main
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px 32px',
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
