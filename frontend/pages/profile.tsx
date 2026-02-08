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
  created_at: string;
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
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setApiKeysLoading(true);
    fetch(`${apiUrl}/api/me/api-keys`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.api_keys) setApiKeys(data.api_keys); })
      .catch(() => {})
      .finally(() => setApiKeysLoading(false));
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

  const copyKey = (key: string) => {
    try {
      navigator.clipboard.writeText(key);
      toast('Copied to clipboard', 'success');
    } catch (_) {
      toast('Could not copy', 'error');
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
        <div className="container">
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '24px' }}>
            Profile
          </h1>

          <div className="card" style={{ maxWidth: '500px', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '16px', color: 'var(--text-primary)' }}>Account</h2>
            {!loading && userFetched && !user ? (
              <div style={{ padding: '24px', textAlign: 'center' }}>
                <p style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  User not found
                </p>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  The user account could not be found. You may need to sign in again.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/login')}
                  className="btn btn-primary"
                  style={{ padding: '10px 20px' }}
                >
                  Go to login
                </button>
              </div>
            ) : user ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Username</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.username}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Email</span>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{user.email}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Status</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: user.verified ? 'var(--success-bg)' : 'var(--warning-bg)',
                      color: user.verified ? 'var(--success-color)' : 'var(--warning-color)',
                    }}>
                      {user.verified ? '✓ Verified' : 'Not verified'}
                    </span>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: 'var(--info-bg)',
                      color: 'var(--info-color)',
                    }}>
                      Role: {user.role || 'viewer'}
                    </span>
                  </div>
                </div>
                {!user.verified && (
                  <div>
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={resending}
                      className="btn btn-secondary"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                    >
                      {resending ? 'Sending...' : 'Resend verification email'}
                    </button>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                      Verify your email and get contributor access to create PRs.
                    </p>
                  </div>
                )}
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Member since</span>
                  <div style={{ color: 'var(--text-primary)' }}>
                    {new Date(user.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {user && (
          <div className="card" style={{ maxWidth: '500px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '16px', color: 'var(--text-primary)' }}>
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

          {user && (
          <div className="card" style={{ maxWidth: '640px', marginTop: '24px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--text-primary)' }}>API keys</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Create keys to call &quot;create request&quot; or &quot;get history&quot; without browser login. Use the key in the <code style={{ fontSize: '13px' }}>Authorization: Bearer ip_xxx</code> header. Scopes: <code>request:create</code>, <code>history:read</code>.
            </p>
            {createdKeyValue && (
              <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--success-bg)', borderRadius: '8px', wordBreak: 'break-all' }}>
                <strong style={{ fontSize: '13px' }}>New key (copy now):</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <code style={{ fontSize: '12px' }}>{createdKeyValue}</code>
                  <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={() => copyKey(createdKeyValue)}>Copy</button>
                </div>
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
        </div>
      </div>
    </>
  );
}
