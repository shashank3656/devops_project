import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

interface User {
  id: number;
  username: string;
  email: string;
  role?: string;
  verified?: boolean;
}

export default function UsersList() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchUsers();
  }, [router]);

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/users`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.users) setUsers(data.users);
      else setError(data.error || 'Failed to load users');
    } catch (_) {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Users - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <div className="page-header">
            <h1 className="page-title">Users</h1>
            <Link href="/users/new" className="btn btn-primary">
              Add user
            </Link>
          </div>

          <div className="card">
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            {loading ? (
              <p className="loading-text">Loading users…</p>
            ) : users.length === 0 ? (
              <div className="empty-state">
                <p>No users yet.</p>
                <p style={{ marginTop: 8 }}>
                  <Link href="/users/new" className="btn btn-primary" style={{ marginTop: 8 }}>
                    Add your first user
                  </Link>
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 500 }}>{u.username}</td>
                        <td style={{ color: 'var(--color-text-muted)' }}>{u.email}</td>
                        <td>
                          <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>
                            {u.role || 'viewer'}
                          </span>
                        </td>
                        <td>{u.verified ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
