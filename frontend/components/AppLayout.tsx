import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { getStoredTheme, setStoredTheme } from './NavBar';

const SIDEBAR_WIDTH = 240;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [teamCheck, setTeamCheck] = useState<'loading' | 'ok' | 'forbidden'>('loading');

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    document.documentElement.setAttribute('data-theme', stored);
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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
          color: isActive ? 'var(--primary-color)' : 'var(--text-primary)',
          fontWeight: isActive ? 600 : 500,
          textDecoration: 'none',
          background: isActive ? 'var(--info-bg)' : 'transparent',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {icon && <span style={{ fontSize: '18px' }}>{icon}</span>}
        {label}
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
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          background: 'var(--bg-white)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ padding: '0 16px 24px', borderBottom: '1px solid var(--border-color)', marginBottom: '16px' }}>
          <Link
            href="/home"
            style={{
              fontSize: '18px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <img src="/logo.svg" alt="" width={32} height={32} style={{ display: 'block', flexShrink: 0 }} />
            Infrastructure Portal
          </Link>
        </div>
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 12px' }}>
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
            style={{ width: '100%', marginBottom: '8px', padding: '10px 14px', fontSize: '14px', justifyContent: 'center' }}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button
            onClick={handleLogout}
            className="btn btn-secondary"
            style={{ width: '100%', padding: '10px 14px', fontSize: '14px' }}
          >
            Logout
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
