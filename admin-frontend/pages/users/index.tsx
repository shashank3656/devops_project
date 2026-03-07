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
  const [successMessage, setSuccessMessage] = useState('');

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
    setSuccessMessage('');
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
      if (res.ok && (data.status === 'ok' || Array.isArray(data.users))) {
        setUsers(Array.isArray(data.users) ? data.users : []);
        setError('');
      } else {
        setError(data.error || 'Failed to load users');
      }
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
    setSuccessMessage('');
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
        setSuccessMessage('User deleted successfully.');
        setUsers((prev) => prev.filter((u) => u.id !== userToDelete.id));
        setTimeout(() => setSuccessMessage(''), 4000);
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
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Users</span>
              <h1 className="portal-page__title">User Management</h1>
              <p className="portal-page__subtitle">
                Create portal and DevOps users, export the directory, and clean up dormant access when needed.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/users/new" className="btn btn-primary">
                Create portal user
              </Link>
              <Link href="/users/new-devops" className="btn btn-secondary">
                Create DevOps user
              </Link>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const token = localStorage.getItem('admin_token');
                  fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/admin/users?format=csv`, {
                    headers: { Authorization: `Bearer ${token}` },
                  })
                    .then((res) => res.text())
                    .then((csv) => {
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                    .catch(() => setError('Export failed'));
                }}
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="portal-surface portal-surface--table">
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            {successMessage && (
              <div className="alert alert-info" role="alert" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #a7f3d0', margin: 24 }}>
                {successMessage}
              </div>
            )}
            {loading ? (
              <div className="empty-state" style={{ padding: 24 }}>Loading users...</div>
            ) : users.length === 0 ? (
              <div className="empty-state">
                <p>No users are onboarded yet.</p>
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
                            <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>/ {u.devops_profile.level}</span>
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
          <div
            className="modal-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget && !deleting) {
                setUserToDelete(null);
              }
            }}
            onKeyDown={(event) => {
              if ((event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') && !deleting) {
                setUserToDelete(null);
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
          >
            <div className="modal">
              <h3 id="delete-modal-title" className="modal-title">Delete user?</h3>
              <p className="modal-body">
                This will remove <strong>{userToDelete.username}</strong> and their team memberships. This cannot be undone.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => !deleting && setUserToDelete(null)} disabled={deleting}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </AdminLayout>
    </>
  );
}
