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
  auth_source?: 'local' | 'sso';
  sso_provider?: string;
  last_sso_sync_at?: string | null;
  devops_profile?: DevopsProfile;
}

interface SSOSettings {
  provider: string;
  enabled: boolean;
  sync_enabled: boolean;
  user_portal_sso_enabled: boolean;
  devops_portal_sso_enabled: boolean;
  sso_login_url: string;
  directory_users_json?: string;
  directory_users_json_size?: number;
  last_sync_at?: string | null;
}

const defaultSSOSettings: SSOSettings = {
  provider: 'none',
  enabled: false,
  sync_enabled: false,
  user_portal_sso_enabled: false,
  devops_portal_sso_enabled: false,
  sso_login_url: '',
  directory_users_json: '',
  directory_users_json_size: 0,
  last_sync_at: null,
};

export default function UsersList() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [ssoSettings, setSsoSettings] = useState<SSOSettings>(defaultSSOSettings);
  const [ssoLoading, setSsoLoading] = useState(true);
  const [ssoSaving, setSsoSaving] = useState(false);
  const [ssoSyncing, setSsoSyncing] = useState(false);
  const [ssoError, setSsoError] = useState('');
  const [ssoMessage, setSsoMessage] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchUsers();
    fetchSSOSettings();
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

  const fetchSSOSettings = async () => {
    setSsoLoading(true);
    setSsoError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/sso/settings`, {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.settings) {
        setSsoSettings({
          ...defaultSSOSettings,
          ...data.settings,
        });
      } else {
        setSsoError(data.error || 'Failed to load SSO settings');
      }
    } catch (_) {
      setSsoError('Failed to load SSO settings');
    } finally {
      setSsoLoading(false);
    }
  };

  const saveSSOSettings = async () => {
    setSsoSaving(true);
    setSsoError('');
    setSsoMessage('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/sso/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify({
          provider: ssoSettings.provider,
          sync_enabled: ssoSettings.sync_enabled,
          user_portal_sso_enabled: ssoSettings.user_portal_sso_enabled,
          devops_portal_sso_enabled: ssoSettings.devops_portal_sso_enabled,
          sso_login_url: ssoSettings.sso_login_url || '',
          directory_users_json: ssoSettings.directory_users_json || '',
        }),
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.settings) {
        setSsoSettings({ ...defaultSSOSettings, ...data.settings });
        setSsoMessage('SSO settings saved.');
      } else {
        setSsoError(data.error || 'Failed to save SSO settings');
      }
    } catch (_) {
      setSsoError('Failed to save SSO settings');
    } finally {
      setSsoSaving(false);
    }
  };

  const runSSOSync = async () => {
    setSsoSyncing(true);
    setSsoError('');
    setSsoMessage('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/sso/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.summary) {
        const summary = data.summary as { processed?: number; created?: number; updated?: number; skipped?: number };
        setSsoMessage(
          `SSO sync completed. Processed: ${summary.processed ?? 0}, Created: ${summary.created ?? 0}, Updated: ${summary.updated ?? 0}, Skipped: ${summary.skipped ?? 0}.`
        );
        fetchUsers();
        fetchSSOSettings();
      } else {
        setSsoError(data.error || 'SSO sync failed');
      }
    } catch (_) {
      setSsoError('SSO sync failed');
    } finally {
      setSsoSyncing(false);
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
            <div style={{ padding: 24, borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: 0, fontSize: 20 }}>SSO Settings & Directory Sync</h3>
              <p style={{ marginTop: 8, color: 'var(--color-text-muted)' }}>
                Configure Azure AD or SAML sync from Admin. When enabled, SSO login appears on User and DevOps login pages.
              </p>
              {ssoError && (
                <div className="alert alert-error" role="alert" style={{ marginTop: 12 }}>
                  {ssoError}
                </div>
              )}
              {ssoMessage && (
                <div className="alert alert-info" role="alert" style={{ marginTop: 12 }}>
                  {ssoMessage}
                </div>
              )}
              {ssoLoading ? (
                <p style={{ marginTop: 12 }}>Loading SSO settings...</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                  <div>
                    <label className="label" htmlFor="sso-provider">Provider</label>
                    <select
                      id="sso-provider"
                      className="input"
                      value={ssoSettings.provider}
                      onChange={(event) => setSsoSettings((prev) => ({ ...prev, provider: event.target.value }))}
                    >
                      <option value="none">Disabled</option>
                      <option value="azure_ad">Azure AD</option>
                      <option value="saml">SAML</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="sso-login-url">SSO Login URL</label>
                    <input
                      id="sso-login-url"
                      className="input"
                      type="text"
                      placeholder="https://login.microsoftonline.com/... or your IdP URL"
                      value={ssoSettings.sso_login_url || ''}
                      onChange={(event) => setSsoSettings((prev) => ({ ...prev, sso_login_url: event.target.value }))}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="label" htmlFor="sso-directory-json">Directory Users JSON (optional)</label>
                    <textarea
                      id="sso-directory-json"
                      className="input"
                      rows={6}
                      placeholder='[{"external_id":"123","username":"jane","email":"jane@example.com","user_type":"portal_user"}]'
                      value={ssoSettings.directory_users_json || ''}
                      onChange={(event) => setSsoSettings((prev) => ({ ...prev, directory_users_json: event.target.value }))}
                    />
                    <small style={{ color: 'var(--color-text-muted)' }}>
                      If empty, backend falls back to environment variables: <code>SSO_DIRECTORY_USERS_JSON</code>, <code>AZURE_DIRECTORY_USERS_JSON</code>, or <code>SAML_DIRECTORY_USERS_JSON</code>.
                    </small>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(ssoSettings.sync_enabled)}
                      onChange={(event) => setSsoSettings((prev) => ({ ...prev, sync_enabled: event.target.checked }))}
                    />
                    Enable SSO sync
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(ssoSettings.user_portal_sso_enabled)}
                      onChange={(event) => setSsoSettings((prev) => ({ ...prev, user_portal_sso_enabled: event.target.checked }))}
                    />
                    Enable SSO login on User portal
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(ssoSettings.devops_portal_sso_enabled)}
                      onChange={(event) => setSsoSettings((prev) => ({ ...prev, devops_portal_sso_enabled: event.target.checked }))}
                    />
                    Enable SSO login on DevOps portal
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                    Last sync: {ssoSettings.last_sync_at ? new Date(ssoSettings.last_sync_at).toLocaleString() : 'Never'}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                <button type="button" className="btn btn-primary" onClick={saveSSOSettings} disabled={ssoSaving || ssoLoading}>
                  {ssoSaving ? 'Saving…' : 'Save SSO settings'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={runSSOSync} disabled={ssoSyncing || ssoLoading}>
                  {ssoSyncing ? 'Syncing…' : 'Run SSO sync'}
                </button>
              </div>
            </div>

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
                      <th>Auth Source</th>
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
                        <td>
                          {u.auth_source === 'sso' ? (
                            <span>
                              SSO {u.sso_provider ? `(${u.sso_provider})` : ''}
                              {u.last_sso_sync_at ? (
                                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>
                                  {new Date(u.last_sso_sync_at).toLocaleString()}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            'Local'
                          )}
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
