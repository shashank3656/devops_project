import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };

  return (
    <div className="admin-layout">
      <nav className="admin-nav">
        <Link href="/teams" className="admin-nav-brand">
          Admin
        </Link>
        <div className="admin-nav-links">
          <Link href="/teams">Teams</Link>
          <Link href="/users">Users</Link>
          <button type="button" className="btn btn-ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </nav>
      <main className="admin-main">{children}</main>
    </div>
  );
}
