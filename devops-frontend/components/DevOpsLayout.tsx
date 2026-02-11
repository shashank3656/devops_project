import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';
import { IconLogout, IconSun, IconMoon } from './Icons';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const DEVOPS_THEME_KEY = 'infra-portal-theme';

interface DevopsUser {
  id: number;
  username: string;
  email?: string;
  user_type?: string;
  devops_profile?: { is_manager: boolean; level: string; position?: string; onboard_date?: string };
}

function getProfileInitials(): string {
  if (typeof window === 'undefined') return 'D';
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    if (!raw) return 'D';
    const user = JSON.parse(raw) as { username?: string; email?: string };
    const name = user?.username || user?.email || '';
    if (!name) return 'D';
    const parts = name.trim().split(/[\s@.]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    return name.slice(0, 2).toUpperCase();
  } catch {
    return 'D';
  }
}

export default function DevOpsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const pathname = router.pathname;
  const [user, setUser] = useState<DevopsUser | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitials, setProfileInitials] = useState('D');
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProfileInitials(getProfileInitials());
  }, []);

  useEffect(() => {
    try {
      const u = localStorage.getItem(DEVOPS_USER_KEY);
      if (u) setUser(JSON.parse(u));
      const t = localStorage.getItem(DEVOPS_THEME_KEY);
      const resolved = t === 'dark' ? 'dark' : 'light';
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
        if (data?.status === 'ok') {
          const pr = typeof data.pending_approval_count === 'number' ? data.pending_approval_count : 0;
          const q = typeof data.query_pending_count === 'number' ? data.query_pending_count : 0;
          setPendingCount(pr + q);
        }
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

  const baseNavItems: { href: string; label: string }[] = [
    { href: '/dashboard', label: 'My tickets' },
  ];
  if (isManager) {
    baseNavItems.push({ href: '/workload', label: 'Workload' });
    baseNavItems.push({ href: '/tickets', label: 'All tickets' });
    baseNavItems.push({ href: '/db-query-pending', label: 'Query approvals' });
  }
  baseNavItems.push({ href: '/db-query-audit', label: 'Query audit' });
  baseNavItems.push({ href: '/templates', label: 'Templates' });
  if (isManager) baseNavItems.push({ href: '/team', label: 'Team' });

  return (
    <div className="portal-layout">
      <header className="portal-topbar">
        <div className="portal-topbar-left">
          <Link href="/dashboard" className="portal-topbar-brand">
            <img src="/logo.svg" alt="" width={40} height={40} className="portal-topbar-logo" />
            <span className="portal-topbar-brand-text">{DEVOPS_SITE_NAME}</span>
          </Link>
          <nav className="portal-topbar-nav">
            {baseNavItems.map(({ href, label }) => {
              const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
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
            {isManager && pendingCount > 0 && (
              <span className="portal-topbar-approval-badge" title={`${pendingCount} pending approval`}>
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
            {user && <span className="portal-topbar-username">{user.username}</span>}
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
                  <span className="portal-profile-dropdown-label">{user?.username || 'DevOps'}</span>
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
