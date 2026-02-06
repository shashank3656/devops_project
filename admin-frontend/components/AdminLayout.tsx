import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useState } from 'react';
import { ADMIN_SITE_NAME } from '../lib/site';
import { IconDashboard, IconRequests, IconTeams, IconUsers, IconLogout, IconChevronLeft, IconChevronRight } from './Icons';

const SIDEBAR_STORAGE_KEY = 'admin_sidebar_collapsed';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = router.pathname;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch (_) {}
  }, []);

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch (_) {}
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };

  const navLink = (href: string, label: string, icon: ReactNode) => {
    const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
    return (
      <Link href={href} className={isActive ? 'active' : ''} title={collapsed ? label : undefined}>
        <span className="admin-sidebar-icon" aria-hidden>{icon}</span>
        <span className="admin-sidebar-label">{label}</span>
      </Link>
    );
  };

  return (
    <div className="admin-layout">
      <aside className={`admin-sidebar ${collapsed ? 'admin-sidebar-collapsed' : ''}`}>
        <div className="admin-sidebar-header">
          <Link href="/dashboard" className="admin-sidebar-brand">
            <img src="/logo.svg" alt="" width={36} height={36} />
            <span className="admin-sidebar-brand-text">{ADMIN_SITE_NAME}</span>
          </Link>
          <button
            type="button"
            className="admin-sidebar-toggle"
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>
        <nav className="admin-sidebar-nav">
          {navLink('/dashboard', 'Dashboard', <IconDashboard />)}
          {navLink('/requests', 'PR Requests', <IconRequests />)}
          {navLink('/teams', 'Teams', <IconTeams />)}
          {navLink('/users', 'Users', <IconUsers />)}
        </nav>
        <div className="admin-sidebar-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleLogout}
            style={{ width: '100%', justifyContent: collapsed ? 'center' : 'flex-start' }}
            title={collapsed ? 'Logout' : undefined}
          >
            <span className="admin-sidebar-icon" aria-hidden><IconLogout /></span>
            <span className="admin-sidebar-label">Logout</span>
          </button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
