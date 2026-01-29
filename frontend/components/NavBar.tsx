import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';

const THEME_KEY = 'infra-portal-theme';

export function getStoredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export function setStoredTheme(theme: 'light' | 'dark') {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

export default function NavBar() {
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

  const navLink = (href: string, label: string) => {
    const isActive = router.pathname === href;
    return (
      <Link href={href}>
        <a
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            color: isActive ? 'var(--primary-color)' : 'var(--text-primary)',
            fontWeight: isActive ? 600 : 500,
            textDecoration: 'none',
            background: isActive ? 'var(--info-bg)' : 'transparent',
          }}
        >
          {label}
        </a>
      </Link>
    );
  };

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
        padding: '16px 0',
        marginBottom: '24px',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Link href="/home">
          <a style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none' }}>
            Infrastructure Portal
          </a>
        </Link>
        <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>|</span>
        <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
          {navLink('/home', 'Home')}
          {navLink('/create-infrastructure', 'New Request')}
          {navLink('/history', 'History')}
          {navLink('/profile', 'Profile')}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          type="button"
          onClick={toggleTheme}
          className="btn btn-secondary"
          style={{ padding: '8px 14px', fontSize: '14px' }}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        >
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
        <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '8px 16px' }}>
          Logout
        </button>
      </div>
    </nav>
  );
}
