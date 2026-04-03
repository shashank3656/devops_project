import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';

interface User {
  id: number;
  username: string;
  email: string;
  verified?: boolean;
  role?: string;
  totp_enabled?: boolean;
  created_at: string;
}

interface Team {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

interface APIKeyRecord {
  id: number;
  user_id: number;
  name: string;
  scopes: string;
  last_used_at: string | null;
  created_at: string;
}

export default function Profile() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userFetched, setUserFetched] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [resending, setResending] = useState(false);
  const [apiKeys, setApiKeys] = useState<APIKeyRecord[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState('request:create,history:read');
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [totpToggling, setTotpToggling] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<{
    email_approved: boolean;
    email_rejected: boolean;
    email_pr_created: boolean;
    email_assigned: boolean;
    email_sla_breach: boolean;
  } | null>(null);
  const [notifPrefsSaving, setNotifPrefsSaving] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [managerUsername, setManagerUsername] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('token');
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    // Do not call /api/me if token is missing or literally "undefined" (e.g. from signup flow)
    if (!token || token === 'undefined' || !isAuthenticated) {
      router.replace('/login');
      return;
    }
    fetchMe();
  }, [router]);

  useEffect(() => {
    if (!user) return;
    setTotpEnabled(user.totp_enabled ?? false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setApiKeysLoading(true);
    fetch(`${apiUrl}/api/me/api-keys`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.api_keys) setApiKeys(data.api_keys); })
      .catch(() => {})
      .finally(() => setApiKeysLoading(false));
  }, [user, apiUrl]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    fetch(`${apiUrl}/api/me/notification-preferences`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.preferences) setNotifPrefs(data.preferences); })
      .catch(() => {});
  }, [user, apiUrl]);

  const fetchMe = async () => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    setLoading(true);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const res = await fetch(`${apiUrl}/api/me`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
        setTotpEnabled(data.user?.totp_enabled ?? false);
        setTeams(Array.isArray(data.teams) ? data.teams : []);
        setManagerUsername(data.manager_username || null);
      } else if (res.status === 404) {
        setUser(null);
        toast('User not found.', 'error');
      } else {
        toast('Session expired. Please log in again.', 'error');
        router.push('/login');
      }
    } catch (_) {
      toast('Failed to load profile', 'error');
    } finally {
      setLoading(false);
      setUserFetched(true);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast('New password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('New passwords do not match', 'error');
      return;
    }
    setChanging(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/api/change-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'ok') {
        toast('Password updated successfully', 'success');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast(data.error || 'Failed to change password', 'error');
      }
    } catch (_) {
      toast('Failed to change password', 'error');
    } finally {
      setChanging(false);
    }
  };

  const handleCreateAPIKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      toast('Name is required', 'error');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setCreatingKey(true);
    setCreatedKeyValue(null);
    try {
      const res = await fetch(`${apiUrl}/api/me/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newKeyName.trim(), scopes: newKeyScopes.trim() || 'request:create,history:read' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.key) {
        setCreatedKeyValue(data.key);
        setNewKeyName('');
        setApiKeys((prev) => (data.api_key ? [data.api_key, ...prev] : prev));
        toast('API key created. Copy it now; it will not be shown again.', 'success');
      } else {
        toast(data.error || 'Failed to create API key', 'error');
      }
    } catch (_) {
      toast('Failed to create API key', 'error');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeAPIKey = async (id: number) => {
    if (!confirm('Revoke this API key? It will stop working immediately.')) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setRevokingId(id);
    try {
      const res = await fetch(`${apiUrl}/api/me/api-keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setApiKeys((prev) => prev.filter((k) => k.id !== id));
        setCreatedKeyValue((v) => (v ? v : null));
        toast('API key revoked', 'success');
      } else {
        toast(data.error || 'Failed to revoke', 'error');
      }
    } catch (_) {
      toast('Failed to revoke API key', 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const copyKey = async (key: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(key);
        toast('Copied to clipboard', 'success');
        return;
      }
    } catch (_) {}
    const fallback = () => {
      const input = document.createElement('input');
      input.value = key;
      input.setAttribute('readonly', '');
      input.style.position = 'absolute';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      input.setSelectionRange(0, key.length);
      try {
        document.execCommand('copy');
        toast('Copied to clipboard', 'success');
      } catch (_) {
        toast('Copy failed. Select and copy the key manually.', 'error');
      }
      document.body.removeChild(input);
    };
    fallback();
  };

  const handleToggle2FA = async (enable: boolean) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    if (enable && !confirm('Enable 2FA? You will receive an email OTP on each login.')) return;
    if (!enable && !confirm('Disable 2FA? You will no longer need an OTP to log in.')) return;
    setTotpToggling(true);
    try {
      const res = await fetch(`${apiUrl}/api/me/2fa`, {
        method: enable ? 'POST' : 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTotpEnabled(enable);
        setUser((u) => (u ? { ...u, totp_enabled: enable } : null));
        toast(enable ? '2FA enabled' : '2FA disabled', 'success');
      } else {
        toast(data.error || 'Failed to update 2FA', 'error');
      }
    } catch (_) {
      toast('Failed to update 2FA', 'error');
    } finally {
      setTotpToggling(false);
    }
  };

  const handleSaveNotifPrefs = async () => {
    if (!notifPrefs) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setNotifPrefsSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/me/notification-preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(notifPrefs),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast('Notification preferences saved', 'success');
      } else {
        toast(data.error || 'Failed to save', 'error');
      }
    } catch (_) {
      toast('Failed to save preferences', 'error');
    } finally {
      setNotifPrefsSaving(false);
    }
  };

  const handleResendVerification = async () => {
    setResending(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/api/resend-verification`, { method: 'POST', headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'ok') {
        toast(data.message || 'Verification link sent. Check your email.', 'success');
      } else {
        toast(data.error || 'Failed to resend', 'error');
      }
    } catch (_) {
      toast('Failed to resend verification', 'error');
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return (
      <>
        <Head>
          <title>Profile - Infrastructure Portal</title>
        </Head>
        <div className="portal-page">
          <div className="portal-surface">
            <div className="empty-state">Loading profile...</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Profile - Infrastructure Portal</title>
      </Head>
      <div className="portal-page portal-page--narrow">
        {!loading && userFetched && !user ? (
          <div className="portal-surface">
            <div className="empty-state">
              <p>User not found. You may need to sign in again.</p>
              <div className="portal-form-actions profile-page__empty-actions">
                <button type="button" onClick={() => router.push('/login')} className="btn btn-primary">
                  Go to login
                </button>
              </div>
            </div>
          </div>
        ) : user ? (
          <>
            <section className="portal-surface">
              <div className="portal-profile-hero">
                <div className="portal-avatar">
                  {(user.username || user.email || 'U').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h1 className="portal-profile-hero__title">{user.username}</h1>
                  <p className="portal-profile-hero__meta">{user.email}</p>
                  <div className="portal-page__actions">
                    <span className={`portal-badge ${user.verified ? 'portal-badge--success' : 'portal-badge--warning'}`}>
                      {user.verified ? 'Verified' : 'Not verified'}
                    </span>
                    <span className="portal-badge portal-badge--neutral">{user.role || 'viewer'}</span>
                  </div>
                  {!user.verified && (
                    <div className="portal-form-actions profile-page__verify-actions">
                      <button type="button" onClick={handleResendVerification} disabled={resending} className="btn btn-secondary btn-sm">
                        {resending ? 'Sending...' : 'Resend verification'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="portal-profile-grid">
              <article className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Teams</span>
                  <div className="portal-page__actions">
                    {teams.length === 0 ? (
                      <span className="portal-pill">No teams</span>
                    ) : (
                      teams.map((team) => <span key={team.id} className="portal-pill">{team.name}</span>)
                    )}
                  </div>
                </div>
              </article>
              <article className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Manager</span>
                  <span className="portal-kv__value">{managerUsername || '-'}</span>
                </div>
              </article>
              <article className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Member since</span>
                  <span className="portal-kv__value">{new Date(user.created_at).toLocaleDateString()}</span>
                </div>
              </article>
              <article className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Authentication</span>
                  <span className="portal-kv__value">{totpEnabled ?? user.totp_enabled ? '2FA enabled' : '2FA disabled'}</span>
                </div>
              </article>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Credentials</span>
                  <h2 className="portal-surface__title">Change password</h2>
                </div>
              </div>
              <form onSubmit={handleChangePassword}>
                <div className="portal-field-grid portal-field-grid--two">
                  <div>
                    <label className="label">Current password</label>
                    <input type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                  </div>
                  <div>
                    <label className="label">New password</label>
                    <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
                  </div>
                  <div>
                    <label className="label">Confirm new password</label>
                    <input type="password" className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} />
                  </div>
                </div>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={changing}>
                    {changing ? 'Updating...' : 'Update password'}
                  </button>
                </div>
              </form>
            </section>

            {notifPrefs && (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Signal routing</span>
                    <h2 className="portal-surface__title">Notification preferences</h2>
                    <p className="portal-surface__subtitle">Choose which request events should reach your inbox.</p>
                  </div>
                </div>
                <div className="portal-stack">
                  {[
                    { key: 'email_approved' as const, label: 'Request approved' },
                    { key: 'email_rejected' as const, label: 'Request rejected' },
                    { key: 'email_pr_created' as const, label: 'PR created' },
                    { key: 'email_assigned' as const, label: 'Ticket assigned to me' },
                    { key: 'email_sla_breach' as const, label: 'SLA breach or overdue' },
                  ].map(({ key, label }) => (
                    <label key={key} className="portal-list__item profile-page__pref-row">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={notifPrefs[key]}
                        onChange={(e) => setNotifPrefs((prev) => (prev ? { ...prev, [key]: e.target.checked } : null))}
                      />
                    </label>
                  ))}
                </div>
                <div className="portal-form-actions">
                  <button type="button" className="btn btn-primary" disabled={notifPrefsSaving} onClick={handleSaveNotifPrefs}>
                    {notifPrefsSaving ? 'Saving...' : 'Save preferences'}
                  </button>
                </div>
              </section>
            )}

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Access control</span>
                  <h2 className="portal-surface__title">Two-factor authentication</h2>
                  <p className="portal-surface__subtitle">Email-based OTP is used during login when this control is enabled.</p>
                </div>
                <span className={`portal-badge ${(totpEnabled ?? user.totp_enabled) ? 'portal-badge--success' : 'portal-badge--neutral'}`}>
                  {(totpEnabled ?? user.totp_enabled) ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="portal-form-actions">
                <button
                  type="button"
                  onClick={() => handleToggle2FA(!(totpEnabled ?? user.totp_enabled))}
                  disabled={totpToggling}
                  className="btn btn-secondary"
                >
                  {totpToggling ? 'Updating...' : (totpEnabled ?? user.totp_enabled) ? 'Disable 2FA' : 'Enable 2FA'}
                </button>
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">API keys</span>
                  <h2 className="portal-surface__title">Programmatic access</h2>
                  <p className="portal-surface__subtitle">
                    Create keys for request creation and history reads without browser login. Use them in the <code>Authorization: Bearer ip_xxx</code> header.
                  </p>
                </div>
              </div>

              {createdKeyValue && (
                <div className="portal-selection-bar">
                  <span className="portal-selection-bar__count">New key created. Copy it now because it will not be shown again.</span>
                  <input
                    type="text"
                    className="input profile-page__key-value"
                    readOnly
                    value={createdKeyValue}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    aria-label="New API key"
                  />
                  <button type="button" className="btn btn-secondary" onClick={() => copyKey(createdKeyValue)}>
                    Copy
                  </button>
                </div>
              )}

              <form onSubmit={handleCreateAPIKey}>
                <div className="portal-field-grid portal-field-grid--two">
                  <div>
                    <label className="label">Key name</label>
                    <input type="text" className="input" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="CI job" />
                  </div>
                  <div>
                    <label className="label">Scopes</label>
                    <input type="text" className="input" value={newKeyScopes} onChange={(e) => setNewKeyScopes(e.target.value)} placeholder="request:create,history:read" />
                  </div>
                </div>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={creatingKey || !newKeyName.trim()}>
                    {creatingKey ? 'Creating...' : 'Create API key'}
                  </button>
                </div>
              </form>

              {apiKeysLoading ? (
                <div className="empty-state profile-page__api-state">Loading keys...</div>
              ) : apiKeys.length === 0 ? (
                <div className="empty-state profile-page__api-state">No API keys yet.</div>
              ) : (
                <div className="table-wrap profile-page__table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Scopes</th>
                        <th>Last used</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeys.map((key) => (
                        <tr key={key.id}>
                          <td>{key.name}</td>
                          <td>{key.scopes || '-'}</td>
                          <td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : '-'}</td>
                          <td>
                            <button type="button" className="btn btn-danger btn-sm" disabled={revokingId === key.id} onClick={() => handleRevokeAPIKey(key.id)}>
                              {revokingId === key.id ? 'Revoking...' : 'Revoke'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
