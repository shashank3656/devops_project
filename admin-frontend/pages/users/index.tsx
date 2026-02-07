import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

interface DevopsProfile {
  is_manager: boolean;
  position: string;
  onboard_date: string | null;
  level: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  role?: string;
  verified?: boolean;
  user_type?: 'portal_user' | 'devops_user';
  devops_profile?: DevopsProfile;
}

export default function UsersList() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const handleDelete = async () => {
    if (!userToDelete) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUserToDelete(null);
        await fetchUsers();
      } else {
        setError(data.error || 'Failed to delete user');
      }
    } catch (_) {
      setError('Failed to delete user');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Users - InfraGate Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <div className="page-header">
            <h1 className="page-title">Users</h1>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href="/users/new" className="btn btn-primary">
                Create portal user
              </Link>
              <Link href="/users/new-devops" className="btn btn-secondary">
                Create DevOps user
              </Link>
            </div>
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
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <Link href="/users/new" className="btn btn-primary">Create portal user</Link>
                    <Link href="/users/new-devops" className="btn btn-secondary">Create DevOps user</Link>
                  </div>
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Type</th>
                      <th>Role</th>
                      <th>Verified</th>
                      <th className="th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="td-username">{u.username}</td>
                        <td className="td-email">{u.email}</td>
                        <td>
                          <span style={{ textTransform: 'capitalize' }}>
                            {u.user_type === 'devops_user' ? 'DevOps user' : 'Portal user'}
                          </span>
                          {u.user_type === 'devops_user' && u.devops_profile?.is_manager && (
                            <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--color-primary)' }}>(Manager)</span>
                          )}
                          {u.user_type === 'devops_user' && u.devops_profile?.level && (
                            <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>· {u.devops_profile.level}</span>
                          )}
                        </td>
                        <td>
                          <span className={`role-badge role-badge--${u.role || 'viewer'}`}>
                            {u.role || 'viewer'}
                          </span>
                        </td>
                        <td>{u.verified ? 'Yes' : 'No'}</td>
                        <td className="td-actions">
                          <Link href={`/users/${u.id}/edit`} className="btn btn-secondary btn-sm">
                            Edit
                          </Link>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => setUserToDelete(u)}
                            aria-label={`Delete ${u.username}`}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {userToDelete && (
          <div className="modal-overlay" onClick={() => !deleting && setUserToDelete(null)} role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3 id="delete-modal-title" className="modal-title">Delete user?</h3>
              <p className="modal-body">
                This will remove <strong>{userToDelete.username}</strong> and their team memberships. This cannot be undone.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => !deleting && setUserToDelete(null)} disabled={deleting}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </AdminLayout>
    </>
  );
}
