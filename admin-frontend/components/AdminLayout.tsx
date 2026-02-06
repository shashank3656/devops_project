import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useState } from 'react';
import { ADMIN_SITE_NAME } from '../lib/site';
import { IconDashboard, IconRequests, IconTeams, IconUsers, IconLogout, IconChevronLeft, IconChevronRight } from './Icons';

const SIDEBAR_STORAGE_KEY = 'admin_sidebar_collapsed';
const NOTIFY_POLL_MS = 30000;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = router.pathname;
  const [collapsed, setCollapsed] = useState(false);
  const [newRequestsCount, setNewRequestsCount] = useState(0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch (_) {}
  }, []);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
    if (!token) return;
    const fetchNotifications = () => {
      fetch(`${apiUrl}/api/admin/notifications`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => { if (data && typeof data.new_requests === 'number') setNewRequestsCount(data.new_requests); })
        .catch(() => {});
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, NOTIFY_POLL_MS);
    return () => clearInterval(interval);
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

  const navLink = (href: string, label: string, icon: ReactNode, badge?: number) => {
    const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
    return (
      <Link href={href} className={isActive ? 'active' : ''} title={collapsed ? label : undefined}>
        <span className="admin-sidebar-icon" aria-hidden>{icon}</span>
        <span className="admin-sidebar-label">{label}</span>
        {badge != null && badge > 0 && (
          <span className="admin-nav-badge" aria-label={`${badge} new requests`}>{badge > 99 ? '99+' : badge}</span>
        )}
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
          {navLink('/requests', 'PR Requests', <IconRequests />, newRequestsCount)}
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
