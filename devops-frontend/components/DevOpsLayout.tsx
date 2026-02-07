import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';

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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/dashboard" style={{ fontWeight: 700, fontSize: 18, color: 'var(--color-text)', textDecoration: 'none' }}>
            {DEVOPS_SITE_NAME}
          </Link>
          <nav style={{ display: 'flex', gap: 8 }}>
            <Link href="/dashboard" className={router.pathname === '/dashboard' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} style={{ textDecoration: 'none' }}>
              My tickets
            </Link>
            {isManager && (
              <Link href="/workload" className={router.pathname === '/workload' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} style={{ textDecoration: 'none', position: 'relative' }}>
                Workload
                {pendingCount > 0 && (
                  <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, background: 'var(--color-error, #dc3545)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </Link>
            )}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{user.username}</span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>Logout</button>
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
