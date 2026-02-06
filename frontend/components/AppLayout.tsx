import Link from 'next/link';
import { useRouter } from 'next/router';
import { SITE_NAME } from '../lib/site';
import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { getStoredTheme, setStoredTheme } from './NavBar';

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

  const navItem = (href: string, label: string, icon?: string) => {
    const isActive = router.pathname === href || (href !== '/home' && router.pathname.startsWith(href));
    return (
      <Link
        href={href}
        title={sidebarCollapsed ? label : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
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
        {icon && <span style={{ fontSize: '18px', flexShrink: 0 }}>{icon}</span>}
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
      <aside
        style={{
          width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
          minWidth: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
          background: 'var(--bg-white)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0',
          boxShadow: 'var(--shadow-sm)',
          transition: 'width 0.2s ease, min-width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: sidebarCollapsed ? '0 12px 20px' : '0 16px 24px',
          borderBottom: '1px solid var(--border-color)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'space-between',
          gap: 8,
        }}>
          <Link
            href="/home"
            style={{
              fontSize: sidebarCollapsed ? 0 : 18,
              fontWeight: 700,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flex: sidebarCollapsed ? 0 : 1,
              minWidth: 0,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            }}
          >
            <img src="/logo.svg" alt="" width={32} height={32} style={{ display: 'block', flexShrink: 0 }} />
            {!sidebarCollapsed && <span>{SITE_NAME}</span>}
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'var(--bg-gray-100)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--text-secondary)',
            }}
          >
            {sidebarCollapsed ? '»' : '«'}
          </button>
        </div>
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px' }}>
          {navItem('/home', 'Home', '🏠')}
          {navItem('/create-infrastructure', 'New Request', '➕')}
          {navItem('/history', 'History', '📜')}
          {navItem('/profile', 'Profile', '👤')}
        </nav>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-secondary"
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            style={{
              width: '100%',
              marginBottom: 8,
              padding: '10px 14px',
              fontSize: 14,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
            {!sidebarCollapsed && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
          </button>
          <button
            onClick={handleLogout}
            className="btn btn-secondary"
            title={sidebarCollapsed ? 'Logout' : undefined}
            style={{
              width: '100%',
              padding: '10px 14px',
              fontSize: 14,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span>↪</span>
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
