import Link from 'next/link';
import { useRouter } from 'next/router';
import { SITE_NAME } from '../lib/site';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { getStoredTheme, setStoredTheme } from './NavBar';
import {
  IconLogout,
  IconBell,
  IconSun,
  IconMoon,
} from './Icons';

const THEME_KEY = 'user-portal-theme';
const HISTORY_LAST_SEEN_KEY = 'user_history_last_seen';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export function getApiUrl(): string {
  return apiUrl;
}

function getProfileInitials(): string {
  if (typeof window === 'undefined') return 'U';
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return 'U';
    const user = JSON.parse(raw) as { username?: string; email?: string; name?: string };
    const name = user?.name || user?.username || user?.email || '';
    if (!name) return 'U';
    const parts = name.trim().split(/[\s@.]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    return name.slice(0, 2).toUpperCase();
  } catch {
    return 'U';
  }
}

const BASE_NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/home', label: 'Home' },
  { href: '/create-infrastructure', label: 'New Request' },
  { href: '/templates', label: 'Templates' },
  { href: '/history', label: 'History' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const pathname = router.pathname;
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [teamCheck, setTeamCheck] = useState<'loading' | 'ok' | 'forbidden'>('loading');
  const [updatedRequestsCount, setUpdatedRequestsCount] = useState(0);
  const [pendingManagerApprovalCount, setPendingManagerApprovalCount] = useState(0);
  const [hasManagedTeams, setHasManagedTeams] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitials, setProfileInitials] = useState('U');
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProfileInitials(getProfileInitials());
  }, []);

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

  useEffect(() => {
    if (router.pathname === '/history') {
      try {
        localStorage.setItem(HISTORY_LAST_SEEN_KEY, new Date().toISOString());
        setUpdatedRequestsCount(0);
      } catch (_) {}
    }
  }, [router.pathname]);

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    if (profileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [profileOpen]);

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

  const navItems = [...BASE_NAV_ITEMS];
  if (hasManagedTeams) navItems.push({ href: '/my-teams', label: 'My teams' });

  if (teamCheck === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg, #e2e8f0)' }}>
        <p style={{ color: 'var(--color-text-muted, #64748b)' }}>Checking access...</p>
      </div>
    );
  }
  if (teamCheck === 'forbidden') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg, #e2e8f0)', padding: 24 }}>
        <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, color: 'var(--color-danger)', marginBottom: 16 }}>403 Forbidden</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
            You are not assigned to any team. Contact your administrator to be added to a team.
          </p>
          <button type="button" className="btn btn-primary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-layout">
      <header className="portal-topbar">
        <div className="portal-topbar-left">
          <Link href="/home" className="portal-topbar-brand">
            <img src="/logo.svg" alt="" width={40} height={40} className="portal-topbar-logo" />
            <span className="portal-topbar-brand-text">{SITE_NAME}</span>
          </Link>
          <nav className="portal-topbar-nav">
            {navItems.map(({ href, label }) => {
              const isActive = pathname === href || (href !== '/home' && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={`portal-topbar-nav-link ${isActive ? 'active' : ''}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="portal-topbar-right">
          <div className="portal-topbar-actions">
            <Link
              href="/history"
              className="portal-topbar-icon-btn"
              title={updatedRequestsCount > 0 ? `${updatedRequestsCount} request update(s)` : 'Notifications'}
            >
              <IconBell />
              {updatedRequestsCount > 0 && (
                <span className="portal-topbar-badge" aria-label={`${updatedRequestsCount} updates`}>
                  {updatedRequestsCount > 99 ? '99+' : updatedRequestsCount}
                </span>
              )}
            </Link>
            {pendingManagerApprovalCount > 0 && (
              <span className="portal-topbar-approval-badge" title={`${pendingManagerApprovalCount} need your approval`}>
                {pendingManagerApprovalCount > 99 ? '99+' : pendingManagerApprovalCount}
              </span>
            )}
            <button
              type="button"
              className="portal-topbar-icon-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
          </div>
          <div className="portal-topbar-profile-wrap" ref={profileRef}>
            <button
              type="button"
              className="portal-topbar-profile-btn"
              onClick={() => setProfileOpen((o) => !o)}
              aria-expanded={profileOpen}
              aria-haspopup="true"
              title="Profile"
            >
              <span className="portal-topbar-avatar" aria-hidden>
                {profileInitials}
              </span>
            </button>
            {profileOpen && (
              <div className="portal-profile-dropdown">
                <div className="portal-profile-dropdown-header">
                  <span className="portal-profile-dropdown-avatar">{profileInitials}</span>
                  <span className="portal-profile-dropdown-label">Profile</span>
                </div>
                <Link
                  href="/profile"
                  className="portal-profile-dropdown-item"
                  onClick={() => setProfileOpen(false)}
                >
                  Profile
                </Link>
                <button
                  type="button"
                  className="portal-profile-dropdown-item"
                  onClick={handleLogout}
                >
                  <IconLogout />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="portal-main">{children}</main>
    </div>
  );
}
