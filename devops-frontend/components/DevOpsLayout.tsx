import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';
import {
  IconLogout,
  IconSun,
  IconMoon,
  IconTickets,
  IconWorkload,
  IconTemplates,
  IconUsers,
  IconMenu,
  IconShield,
} from './Icons';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const DEVOPS_THEME_KEY = 'infra-portal-theme';
const SIDEBAR_COLLAPSED_KEY = 'devops-sidebar-collapsed';

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

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'My tickets',
  '/workload': 'Workload',
  '/tickets': 'All tickets',
  '/templates': 'Templates',
  '/team': 'Team',
  '/credential-audit': 'Credential Audit',
  '/profile': 'Profile',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/dashboard' && pathname.startsWith(path)) return title;
  }
  return 'My tickets';
}

export default function DevOpsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const pathname = router.pathname;
  const [user, setUser] = useState<DevopsUser | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
      const c = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      setSidebarCollapsed(c === 'true');
    } catch (_) {}
  }, []);

  const isManager = user?.devops_profile?.is_manager ?? false;

  const refreshPendingCount = useCallback(() => {
    if (!isManager) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.status === 'ok' && typeof data.pending_approval_count === 'number')
          setPendingCount(data.pending_approval_count);
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

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch (_) {}
  };

  useEffect(() => {
    let gPressedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        e.preventDefault();
        const msg = isManager
          ? 'Shortcuts: ? help, g then d = My tickets, g then t = All tickets, g then w = Workload'
          : 'Shortcuts: ? help, g then d = My tickets';
        alert(msg);
        return;
      }
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        gPressedAt = Date.now();
        return;
      }
      if (gPressedAt && Date.now() - gPressedAt < 800) {
        if (e.key === 'd') {
          e.preventDefault();
          router.push('/dashboard');
        } else if (e.key === 't' && isManager) {
          e.preventDefault();
          router.push('/tickets');
        } else if (e.key === 'w' && isManager) {
          e.preventDefault();
          router.push('/workload');
        }
        gPressedAt = 0;
      } else {
        gPressedAt = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, isManager]);

  const handleLogout = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.replace('/login');
  };

  const baseNavItems: { href: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { href: '/dashboard', label: 'My tickets', Icon: IconTickets },
  ];
  if (isManager) {
    baseNavItems.push({ href: '/workload', label: 'Workload', Icon: IconWorkload });
    baseNavItems.push({ href: '/tickets', label: 'All tickets', Icon: IconTickets });
  }
  baseNavItems.push({ href: '/templates', label: 'Templates', Icon: IconTemplates });
  baseNavItems.push({ href: '/credential-audit', label: 'Credential Audit', Icon: IconShield });
  if (isManager) baseNavItems.push({ href: '/team', label: 'Team', Icon: IconUsers });

  const pageTitle = getPageTitle(pathname);

  return (
    <div className="devops-layout devops-layout-sidebar">
      <aside
        className={`devops-sidebar-new ${sidebarCollapsed ? 'devops-sidebar-new--collapsed' : ''} ${mobileMenuOpen ? 'devops-sidebar-new--mobile-open' : ''}`}
      >
        <div className="devops-sidebar-new__header">
          <button
            type="button"
            className="devops-sidebar-new__hamburger"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <IconMenu />
          </button>
          <Link href="/dashboard" className="devops-sidebar-new__brand">
            <img src="/logo.svg" alt="" width={36} height={36} className="devops-sidebar-new__logo" />
            {!sidebarCollapsed && <span className="devops-sidebar-new__brand-text">{DEVOPS_SITE_NAME}</span>}
          </Link>
        </div>
        <nav className="devops-sidebar-new__nav">
          {baseNavItems.map(({ href, label, Icon }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`devops-sidebar-new__link ${isActive ? 'devops-sidebar-new__link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon className="devops-sidebar-new__icon" />
                {!sidebarCollapsed && <span className="devops-sidebar-new__label">{label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="devops-sidebar-new__footer">
          <button type="button" className="devops-sidebar-new__link" onClick={handleLogout}>
            <IconLogout className="devops-sidebar-new__icon" />
            {!sidebarCollapsed && <span className="devops-sidebar-new__label">Logout</span>}
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="devops-sidebar-new-overlay" onClick={() => setMobileMenuOpen(false)} aria-hidden />
      )}

      <div className="devops-main-wrapper-new">
        <header className="devops-navbar">
          <div className="devops-navbar__left">
            <button
              type="button"
              className="devops-navbar__menu-btn"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <IconMenu />
            </button>
            <h1 className="devops-navbar__title">{pageTitle}</h1>
          </div>
          <div className="devops-navbar__right">
            <div className="devops-navbar__actions">
              {isManager && pendingCount > 0 && (
                <span className="devops-navbar__approval-badge" title={`${pendingCount} pending approval`}>
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
              {user && <span className="devops-navbar__username">{user.username}</span>}
            </div>
            <button
              type="button"
              className="devops-navbar__theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
            <div className="devops-navbar__profile-wrap" ref={profileRef}>
              <button
                type="button"
                className="devops-navbar__profile-btn"
                onClick={() => setProfileOpen((o) => !o)}
                aria-expanded={profileOpen}
                aria-haspopup="true"
                title="Profile"
              >
                <span className="devops-navbar__avatar">{profileInitials}</span>
                <span className="devops-navbar__profile-label">{user?.username || 'DevOps'}</span>
              </button>
              {profileOpen && (
                <div className="devops-navbar__dropdown">
                  <div className="devops-navbar__dropdown-header">
                    <span className="devops-navbar__dropdown-avatar">{profileInitials}</span>
                    <span className="devops-navbar__dropdown-label">{user?.username || 'DevOps'}</span>
                  </div>
                  <Link href="/profile" className="devops-navbar__dropdown-item" onClick={() => setProfileOpen(false)}>
                    Profile
                  </Link>
                  <button type="button" className="devops-navbar__dropdown-item" onClick={handleLogout}>
                    <IconLogout />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="devops-main-new">{children}</main>
      </div>
    </div>
  );
}
