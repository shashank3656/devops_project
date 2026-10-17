import { useEffect, useState } from 'react';
import { buildPortalApiUrl, portalFetch } from './apiRuntime';

export type PortalProfileAccount = {
  id: number;
  username: string;
  email: string;
  verified?: boolean;
  role?: string;
  totp_enabled?: boolean;
  created_at?: string;
};

type APIKeyRecord = {
  id: number;
  name: string;
  scopes: string;
  last_used_at: string | null;
  created_at: string;
};

type NotifPrefs = {
  email_approved: boolean;
  email_rejected: boolean;
  email_pr_created: boolean;
  email_assigned: boolean;
  email_sla_breach: boolean;
};

export type PortalProfileNotify = (message: string, kind: 'success' | 'error') => void;

function defaultNotify(message: string, kind: 'success' | 'error') {
  if (typeof window !== 'undefined') {
    window.alert(message);
  }
  void kind;
}

export default function PortalProfileSettings({
  apiUrl,
  token,
  user,
  onUserPatch,
  onNotify = defaultNotify,
  focus,
}: {
  apiUrl: string;
  token: string;
  user: PortalProfileAccount;
  onUserPatch?: (patch: Partial<PortalProfileAccount>) => void;
  onNotify?: PortalProfileNotify;
  focus?: 'password' | 'notifications' | 'api' | 'account';
}) {
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
  const [totpEnabled, setTotpEnabled] = useState(Boolean(user.totp_enabled));
  const [totpToggling, setTotpToggling] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs | null>(null);
  const [notifLoaded, setNotifLoaded] = useState(false);
  const [notifPrefsSaving, setNotifPrefsSaving] = useState(false);

  useEffect(() => {
    setTotpEnabled(Boolean(user.totp_enabled));
  }, [user.totp_enabled]);

  useEffect(() => {
    if (!token) return;
    setApiKeysLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, '/api/me/api-keys'), { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.api_keys)) setApiKeys(data.api_keys);
      })
      .catch(() => {})
      .finally(() => setApiKeysLoading(false));
  }, [apiUrl, token]);

  useEffect(() => {
    if (!token) return;
    portalFetch(buildPortalApiUrl(apiUrl, '/api/me/notification-preferences'), { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.preferences) setNotifPrefs(data.preferences as NotifPrefs);
      })
      .catch(() => {})
      .finally(() => setNotifLoaded(true));
  }, [apiUrl, token]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      onNotify('New password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      onNotify('New passwords do not match', 'error');
      return;
    }
    setChanging(true);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/change-password'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'ok') {
        onNotify('Password updated successfully', 'success');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        onNotify(typeof data.error === 'string' ? data.error : 'Failed to change password', 'error');
      }
    } catch {
      onNotify('Failed to change password', 'error');
    } finally {
      setChanging(false);
    }
  };

  const handleCreateAPIKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      onNotify('Name is required', 'error');
      return;
    }
    setCreatingKey(true);
    setCreatedKeyValue(null);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/me/api-keys'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          scopes: newKeyScopes.trim() || 'request:create,history:read',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.key) {
        setCreatedKeyValue(data.key);
        setNewKeyName('');
        if (data.api_key) setApiKeys((prev) => [data.api_key as APIKeyRecord, ...prev]);
        onNotify('API key created. Copy it now; it will not be shown again.', 'success');
      } else {
        onNotify(typeof data.error === 'string' ? data.error : 'Failed to create API key', 'error');
      }
    } catch {
      onNotify('Failed to create API key', 'error');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeAPIKey = async (id: number) => {
    if (!confirm('Revoke this API key? It will stop working immediately.')) return;
    setRevokingId(id);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, `/api/me/api-keys/${id}`), {
        method: 'DELETE',
        token,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setApiKeys((prev) => prev.filter((k) => k.id !== id));
        onNotify('API key revoked', 'success');
      } else {
        onNotify(typeof data.error === 'string' ? data.error : 'Failed to revoke', 'error');
      }
    } catch {
      onNotify('Failed to revoke API key', 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const copyKey = async (key: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(key);
        onNotify('Copied to clipboard', 'success');
        return;
      }
    } catch {
      /* fallback below */
    }
    const input = document.createElement('input');
    input.value = key;
    input.setAttribute('readonly', '');
    input.style.position = 'absolute';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
      onNotify('Copied to clipboard', 'success');
    } catch {
      onNotify('Copy failed. Select and copy the key manually.', 'error');
    }
    document.body.removeChild(input);
  };

  const handleToggle2FA = async (enable: boolean) => {
    if (enable && !confirm('Enable 2FA? You will receive an email OTP on each login.')) return;
    if (!enable && !confirm('Disable 2FA? You will no longer need an OTP to log in.')) return;
    setTotpToggling(true);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/me/2fa'), {
        method: enable ? 'POST' : 'DELETE',
        token,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTotpEnabled(enable);
        onUserPatch?.({ totp_enabled: enable });
        onNotify(enable ? '2FA enabled' : '2FA disabled', 'success');
      } else {
        onNotify(typeof data.error === 'string' ? data.error : 'Failed to update 2FA', 'error');
      }
    } catch {
      onNotify('Failed to update 2FA', 'error');
    } finally {
      setTotpToggling(false);
    }
  };

  const handleSaveNotifPrefs = async () => {
    if (!notifPrefs) return;
    setNotifPrefsSaving(true);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/me/notification-preferences'), {
        method: 'PATCH',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifPrefs),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onNotify('Notification preferences saved', 'success');
      } else {
        onNotify(typeof data.error === 'string' ? data.error : 'Failed to save', 'error');
      }
    } catch {
      onNotify('Failed to save preferences', 'error');
    } finally {
      setNotifPrefsSaving(false);
    }
  };

  const handleResendVerification = async () => {
    setResending(true);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/resend-verification'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'ok') {
        onNotify(typeof data.message === 'string' ? data.message : 'Verification link sent. Check your email.', 'success');
      } else {
        onNotify(typeof data.error === 'string' ? data.error : 'Failed to resend', 'error');
      }
    } catch {
      onNotify('Failed to resend verification', 'error');
    } finally {
      setResending(false);
    }
  };

  const show = (part: 'password' | 'notifications' | 'api' | 'twofa') => {
    if (focus === 'account') return part === 'twofa';
    if (!focus) return true;
    return focus === part;
  };

  return (
    <>
      {(!focus || focus === 'account') && !user.verified ? (
        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Email</span>
              <h2 className="portal-surface__title">Verify your account</h2>
              <p className="portal-surface__subtitle">Some actions require a verified email address.</p>
            </div>
            <span className="portal-badge portal-badge--warning">Not verified</span>
          </div>
          <div className="portal-form-actions profile-page__verify-actions">
            <button type="button" onClick={handleResendVerification} disabled={resending} className="btn btn-secondary">
              {resending ? 'Sending...' : 'Resend verification email'}
            </button>
          </div>
        </section>
      ) : null}

      {show('password') ? <section className="portal-surface" id="profile-password">
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
              <input
                type="password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="label">New password</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="portal-form-actions">
            <button type="submit" className="btn btn-primary" disabled={changing}>
              {changing ? 'Updating...' : 'Update password'}
            </button>
          </div>
        </form>
      </section> : null}

      {show('notifications') && !notifPrefs ? (
        <section className="portal-surface" id="profile-notifications">
          <div className="empty-state profile-page__api-state">
            {notifLoaded ? 'Notification preferences are not available yet.' : 'Loading notification preferences...'}
          </div>
        </section>
      ) : null}

      {show('notifications') && notifPrefs ? (
        <section className="portal-surface" id="profile-notifications">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Signal routing</span>
              <h2 className="portal-surface__title">Notification preferences</h2>
              <p className="portal-surface__subtitle">Choose which request events should reach your inbox.</p>
            </div>
          </div>
          <div className="portal-stack">
            {(
              [
                { key: 'email_approved' as const, label: 'Request approved' },
                { key: 'email_rejected' as const, label: 'Request rejected' },
                { key: 'email_pr_created' as const, label: 'PR created' },
                { key: 'email_assigned' as const, label: 'Ticket assigned to me' },
                { key: 'email_sla_breach' as const, label: 'SLA breach or overdue' },
              ] as const
            ).map(({ key, label }) => (
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
      ) : null}

      {show('twofa') ? <section className="portal-surface" id="profile-2fa">
        <div className="portal-surface__header">
          <div>
            <span className="portal-surface__eyebrow">Access control</span>
            <h2 className="portal-surface__title">Two-factor authentication</h2>
            <p className="portal-surface__subtitle">Email-based OTP is used during login when this control is enabled.</p>
          </div>
          <span className={`portal-badge ${totpEnabled ? 'portal-badge--success' : 'portal-badge--neutral'}`}>
            {totpEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div className="portal-form-actions">
          <button
            type="button"
            onClick={() => handleToggle2FA(!totpEnabled)}
            disabled={totpToggling}
            className="btn btn-secondary"
          >
            {totpToggling ? 'Updating...' : totpEnabled ? 'Disable 2FA' : 'Enable 2FA'}
          </button>
        </div>
      </section> : null}

      {show('api') ? <section className="portal-surface" id="profile-api-keys">
        <div className="portal-surface__header">
          <div>
            <span className="portal-surface__eyebrow">API keys</span>
            <h2 className="portal-surface__title">Programmatic access</h2>
            <p className="portal-surface__subtitle">
              Create keys for API access without browser login. Use them in the <code>Authorization: Bearer ip_xxx</code>{' '}
              header.
            </p>
          </div>
        </div>

        {createdKeyValue ? (
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
        ) : null}

        <form onSubmit={handleCreateAPIKey}>
          <div className="portal-field-grid portal-field-grid--two">
            <div>
              <label className="label">Key name</label>
              <input
                type="text"
                className="input"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="CI job"
              />
            </div>
            <div>
              <label className="label">Scopes</label>
              <input
                type="text"
                className="input"
                value={newKeyScopes}
                onChange={(e) => setNewKeyScopes(e.target.value)}
                placeholder="request:create,history:read"
              />
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
                  <th />
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td>{key.scopes || '—'}</td>
                    <td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={revokingId === key.id}
                        onClick={() => handleRevokeAPIKey(key.id)}
                      >
                        {revokingId === key.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section> : null}
    </>
  );
}
