import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useToast } from '../context/ToastContext';

const THEME_KEY = 'infra-portal-theme';

export function getStoredTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined') {
    localStorage.setItem(THEME_KEY, 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  return 'dark';
}

export function setStoredTheme(_theme: 'light' | 'dark') {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THEME_KEY, 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
}

export default function NavBar() {
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    getStoredTheme();
  }, []);

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
      <Link
        href={href}
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
        <Link
          href="/home"
          style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none' }}
        >
          Infrastructure Portal
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
        <button type="button" onClick={handleLogout} className="btn btn-secondary" style={{ padding: '8px 16px' }}>
          Logout
        </button>
      </div>
    </nav>
  );
}
