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
        toast('API key created. Copy it now; it won’t be shown again.', 'success');
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
        <div style={{ minHeight: '100vh', padding: '40px 20px', textAlign: 'center' }}>
          <div className="container">
            <p style={{ color: 'var(--text-secondary)' }}>Loading profile...</p>
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
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          {!loading && userFetched && !user ? (
            <div className="card profile-card" style={{ textAlign: 'center', padding: 48 }}>
              <p style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>User not found</p>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>You may need to sign in again.</p>
              <button type="button" onClick={() => router.push('/login')} className="btn btn-primary">Go to login</button>
            </div>
          ) : user ? (
            <>
              {/* Profile header */}
              <div className="card profile-card profile-header" style={{ marginBottom: 24, padding: 24 }}> 
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                  <div className="profile-avatar" style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--primary-gradient)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 }}>
                    {(user.username || user.email || 'U').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{user.username}</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 8 }}>{user.email}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: user.verified ? 'var(--success-bg)' : 'var(--warning-bg)', color: user.verified ? 'var(--success-color)' : 'var(--warning-color)' }}>
                        {user.verified ? 'Verified' : 'Not verified'}
                      </span>
                      <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--info-bg)', color: 'var(--info-color)' }}>
                        {user.role || 'viewer'}
                      </span>
                    </div>
                    {!user.verified && (
                      <button type="button" onClick={handleResendVerification} disabled={resending} className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
                        {resending ? 'Sending...' : 'Resend verification'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Teams & Manager row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
                <div className="card profile-card" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Teams</h3>
                  {teams.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>—</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {teams.map((t) => (
                        <span key={t.id} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 13, background: 'var(--primary-tint)', color: 'var(--primary-color)', fontWeight: 500 }}>{t.name}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="card profile-card" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Manager</h3>
                  <p style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500 }}>{managerUsername || '—'}</p>
                </div>
                <div className="card profile-card" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Member since</h3>
                  <p style={{ color: 'var(--text-primary)', fontSize: 14 }}>{new Date(user.created_at).toLocaleDateString()}</p>
                </div>
              </div>

          {user && (
          <div className="card profile-card" style={{ marginBottom: 24, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
              Change password
            </h2>
            <form onSubmit={handleChangePassword}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                Current password
              </label>
              <input
                type="password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="Current password"
                style={{ marginBottom: '16px' }}
              />
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                New password
              </label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                placeholder="At least 6 characters"
                style={{ marginBottom: '16px' }}
              />
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                Confirm new password
              </label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Confirm new password"
                style={{ marginBottom: '20px' }}
              />
              <button type="submit" className="btn btn-primary" disabled={changing}>
                {changing ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </div>
          )}

          {user && notifPrefs && (
          <div className="card profile-card" style={{ marginBottom: 24, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Notification preferences</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Choose which emails you receive for request updates.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              {[
                { key: 'email_approved' as const, label: 'Request approved' },
                { key: 'email_rejected' as const, label: 'Request rejected' },
                { key: 'email_pr_created' as const, label: 'PR created' },
                { key: 'email_assigned' as const, label: 'Ticket assigned to me' },
                { key: 'email_sla_breach' as const, label: 'SLA breach / overdue' },
              ].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={notifPrefs[key]}
                    onChange={(e) => setNotifPrefs((p) => p ? { ...p, [key]: e.target.checked } : null)}
                  />
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{label}</span>
                </label>
              ))}
            </div>
            <button type="button" className="btn btn-primary" disabled={notifPrefsSaving} onClick={handleSaveNotifPrefs}>
              {notifPrefsSaving ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
          )}

          {user && (
          <div className="card profile-card" style={{ marginBottom: 24, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Two-factor authentication (2FA)</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              When enabled, you will receive a 6-digit code by email on each login.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                background: (totpEnabled ?? user.totp_enabled) ? 'var(--success-bg)' : 'var(--info-bg)',
                color: (totpEnabled ?? user.totp_enabled) ? 'var(--success-color)' : 'var(--info-color)',
              }}>
                {(totpEnabled ?? user.totp_enabled) ? '✓ 2FA enabled' : '2FA disabled'}
              </span>
              <button
                type="button"
                onClick={() => handleToggle2FA(!(totpEnabled ?? user.totp_enabled))}
                disabled={totpToggling}
                className="btn btn-secondary"
                style={{ padding: '8px 16px', fontSize: '14px' }}
              >
                {totpToggling ? 'Updating...' : (totpEnabled ?? user.totp_enabled) ? 'Disable 2FA' : 'Enable 2FA'}
              </button>
            </div>
          </div>
          )}

          {user && (
          <div className="card profile-card" style={{ marginBottom: 24, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>API keys</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Create keys to call &quot;create request&quot; or &quot;get history&quot; without browser login. Use the key in the <code style={{ fontSize: '13px' }}>Authorization: Bearer ip_xxx</code> header. Scopes: <code>request:create</code>, <code>history:read</code>.
            </p>
            {createdKeyValue && (
              <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--success-bg)', borderRadius: '8px' }}>
                <strong style={{ fontSize: '13px' }}>New key (copy now — not shown again):</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    readOnly
                    value={createdKeyValue}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    style={{ flex: '1', minWidth: 200, fontSize: '12px', fontFamily: 'monospace', padding: '8px 10px' }}
                    aria-label="New API key"
                  />
                  <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={() => copyKey(createdKeyValue)}>Copy</button>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', marginBottom: 0 }}>If Copy fails, select the key above and copy manually (Ctrl+C / Cmd+C).</p>
              </div>
            )}
            <form onSubmit={handleCreateAPIKey} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: '20px' }}>
              <input
                type="text"
                className="input"
                placeholder="Key name (e.g. CI job)"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                style={{ minWidth: '180px' }}
              />
              <input
                type="text"
                className="input"
                placeholder="request:create,history:read"
                value={newKeyScopes}
                onChange={(e) => setNewKeyScopes(e.target.value)}
                style={{ minWidth: '220px' }}
              />
              <button type="submit" className="btn btn-primary" disabled={creatingKey || !newKeyName.trim()}>
                {creatingKey ? 'Creating…' : 'Create API key'}
              </button>
            </form>
            {apiKeysLoading ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading keys…</p>
            ) : apiKeys.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No API keys yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                      <th style={{ padding: '8px 12px 8px 0' }}>Name</th>
                      <th style={{ padding: '8px 12px 8px 0' }}>Scopes</th>
                      <th style={{ padding: '8px 12px 8px 0' }}>Last used</th>
                      <th style={{ padding: '8px 0' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map((k) => (
                      <tr key={k.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-primary)' }}>{k.name}</td>
                        <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>{k.scopes || '—'}</td>
                        <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-secondary)' }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '—'}</td>
                        <td style={{ padding: '8px 0' }}>
                          <button type="button" className="btn btn-danger" style={{ padding: '6px 12px', fontSize: '13px' }} disabled={revokingId === k.id} onClick={() => handleRevokeAPIKey(k.id)}>
                            {revokingId === k.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
