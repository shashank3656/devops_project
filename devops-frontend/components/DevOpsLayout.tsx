import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';
import { IconTickets, IconWorkload, IconLogout } from './Icons';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface DevopsUser {
  id: number;
  username: string;
  user_type?: string;
  devops_profile?: { is_manager: boolean; level: string };
}

export default function DevOpsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [user, setUser] = useState<DevopsUser | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    try {
      const u = localStorage.getItem(DEVOPS_USER_KEY);
      if (u) setUser(JSON.parse(u));
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
        if (data?.status === 'ok' && typeof data.pending_approval_count === 'number') setPendingCount(data.pending_approval_count);
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

  const handleLogout = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.replace('/login');
  };

  const pathname = router.pathname;
  const navLink = (href: string, label: string, icon: ReactNode, badge?: number) => {
    const isActive = pathname === href;
    return (
      <Link href={href} className={isActive ? 'devops-nav-active' : ''} title={label}>
        <span className="devops-sidebar-icon" aria-hidden>{icon}</span>
        <span className="devops-sidebar-label">{label}</span>
        {badge != null && badge > 0 && (
          <span className="devops-nav-badge" aria-label={`${badge} pending`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="devops-layout">
      <aside className="devops-sidebar">
        <div className="devops-sidebar-header">
          <Link href="/dashboard" className="devops-sidebar-brand">
            <img src="/logo.svg" alt="" width={36} height={36} />
            <span className="devops-sidebar-brand-text">{DEVOPS_SITE_NAME}</span>
          </Link>
        </div>
        <nav className="devops-sidebar-nav">
          {navLink('/dashboard', 'My tickets', <IconTickets />)}
          {isManager && navLink('/workload', 'Workload', <IconWorkload />, pendingCount)}
        </nav>
        <div className="devops-sidebar-footer">
          {user && <span className="devops-sidebar-user">{user.username}</span>}
          <button type="button" className="btn btn-secondary devops-sidebar-logout" onClick={handleLogout} title="Logout">
            <IconLogout />
            <span>Logout</span>
          </button>
        </div>
      </aside>
      <div className="devops-main-wrap">
        <header className="devops-topbar">
          <div className="devops-topbar-spacer" />
          <div className="devops-topbar-actions">
            {user && <span className="devops-topbar-user">{user.username}</span>}
            <button type="button" className="btn btn-ghost devops-topbar-logout" onClick={handleLogout} title="Logout">
              <IconLogout />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <main className="devops-main">{children}</main>
      </div>
    </div>
  );
}
