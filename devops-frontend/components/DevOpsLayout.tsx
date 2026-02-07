import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useState } from 'react';
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
  const [user, setUser] = useState<DevopsUser | null>(null);

  useEffect(() => {
    try {
      const u = localStorage.getItem(DEVOPS_USER_KEY);
      if (u) setUser(JSON.parse(u));
    } catch (_) {}
  }, []);

  const handleLogout = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.replace('/login');
  };

  const isManager = user?.devops_profile?.is_manager ?? false;

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
              <Link href="/workload" className={router.pathname === '/workload' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} style={{ textDecoration: 'none' }}>
                Workload
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
