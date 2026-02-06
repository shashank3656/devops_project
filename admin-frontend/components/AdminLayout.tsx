import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = router.pathname;

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };

  const navLink = (href: string, label: string, icon: string) => {
    const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
    return (
      <Link href={href} className={isActive ? 'active' : ''}>
        <span className="admin-sidebar-icon" aria-hidden>{icon}</span>
        {label}
      </Link>
    );
  };

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <Link href="/dashboard" className="admin-sidebar-brand">
          <img src="/logo.svg" alt="" width={36} height={36} />
          <span>Admin</span>
        </Link>
        <nav className="admin-sidebar-nav">
          {navLink('/dashboard', 'Dashboard', '▣')}
          {navLink('/requests', 'PR Requests', '▤')}
          {navLink('/teams', 'Teams', '⬡')}
          {navLink('/users', 'Users', '▢')}
        </nav>
        <div className="admin-sidebar-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleLogout}
            style={{ width: '100%', justifyContent: 'flex-start' }}
          >
            Logout
          </button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
