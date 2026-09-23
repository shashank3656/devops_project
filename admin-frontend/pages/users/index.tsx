import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { DataTable, type DataTableColumn, type DataTableSort } from '@infragate/ui';
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
  auth_source?: 'local' | 'sso';
  sso_provider?: string;
  sso_active?: boolean;
  last_sso_sync_at?: string | null;
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
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DataTableSort>({ key: 'username', direction: 'asc' });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchUsers();
  }, [router]);

  const getAdminToken = () => localStorage.getItem('admin_token');

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    setSuccessMessage('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/users`, {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
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

  const userTypeLabel = (u: User) => (u.user_type === 'devops_user' ? 'DevOps user' : 'Portal user');

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? users.filter((u) =>
          [u.username, u.email, u.role || 'viewer', userTypeLabel(u)].some((value) => value.toLowerCase().includes(needle)),
        )
      : users;
    const valueFor = (u: User) => {
      if (sort.key === 'type') return userTypeLabel(u);
      if (sort.key === 'role') return u.role || 'viewer';
      if (sort.key === 'verified') return u.verified ? '1' : '0';
      if (sort.key === 'email') return u.email;
      return u.username;
    };
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => valueFor(a).localeCompare(valueFor(b)) * direction);
  }, [users, query, sort]);

  const handleSortChange = (key: string) => {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' },
    );
  };

  const userColumns: DataTableColumn<User>[] = [
    {
      id: 'username',
      header: 'User',
      sortable: true,
      cell: (u) => (
        <div className="ig-cell-stack">
          <span className="ig-cell-title">{u.username}</span>
          <span className="ig-cell-meta">{u.email}</span>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      sortable: true,
      cell: (u) => (
        <div className="ig-cell-stack">
          <span>{userTypeLabel(u)}</span>
          {u.user_type === 'devops_user' && (u.devops_profile?.is_manager || u.devops_profile?.level) ? (
            <span className="ig-cell-meta">
              {[u.devops_profile?.is_manager ? 'Manager' : '', u.devops_profile?.level || ''].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      sortable: true,
      cell: (u) => <span className={`role-badge role-badge--${u.role || 'viewer'}`}>{u.role || 'viewer'}</span>,
    },
    {
      id: 'verified',
      header: 'Verified',
      sortable: true,
      cell: (u) =>
        u.verified ? <span className="ig-cell-meta">Verified</span> : <span className="ig-priority ig-priority--high">Not verified</span>,
    },
    {
      id: 'actions',
      header: <span className="ig-sr-only">Actions</span>,
      align: 'right',
      cell: (u) => (
        <div className="ig-row-actions">
          <Link href={`/users/${u.id}/edit`} className="btn btn-secondary btn-sm">
            Edit
          </Link>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setUserToDelete(u)} aria-label={`Delete ${u.username}`}>
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Head>
        <title>Users - SetuOps Governance</title>
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

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="alert alert-info admin-users-index__success" role="status">
              {successMessage}
            </div>
          )}

          <div className="ig-table-toolbar">
            <input
              type="search"
              className="input ig-table-toolbar__search"
              placeholder="Search name, email, role or type"
              aria-label="Search users"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="ig-table-toolbar__count">
              {loading ? 'Loading…' : `${visibleUsers.length} of ${users.length} users`}
            </span>
          </div>

          <div className="card ig-table-card">
            <DataTable<User>
              label="Users"
              columns={userColumns}
              rows={visibleUsers}
              rowKey={(u) => u.id}
              loading={loading}
              skeletonRows={6}
              onRowOpen={(u) => router.push(`/users/${u.id}/edit`)}
              sort={sort}
              onSortChange={handleSortChange}
              empty={
                <div className="ig-table-empty">
                  <strong>{query ? 'No users match this search' : 'No users are onboarded yet'}</strong>
                  {query ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuery('')}>
                      Clear search
                    </button>
                  ) : (
                    <Link href="/users/new" className="btn btn-primary btn-sm">
                      Create portal user
                    </Link>
                  )}
                </div>
              }
            />
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
              if (event.key === 'Escape' && !deleting) {
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
