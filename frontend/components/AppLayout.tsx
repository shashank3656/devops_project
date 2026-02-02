import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { getStoredTheme, setStoredTheme } from './NavBar';

const SIDEBAR_WIDTH = 240;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    document.documentElement.setAttribute('data-theme', stored);
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
              display: 'block',
            }}
          >
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
