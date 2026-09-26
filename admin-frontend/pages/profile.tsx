import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AdminLayout from '../components/AdminLayout';
import { ADMIN_SITE_NAME } from '../lib/site';
import {
  PortalProfileSettings,
  buildPortalApiUrl,
  portalFetch,
  type PortalProfileAccount,
} from '@infragate/ui';

const ADMIN_TOKEN_KEY = 'admin_token';

interface Team {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

export default function AdminProfilePage() {
  const router = useRouter();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const [user, setUser] = useState<PortalProfileAccount | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [managerUsername, setManagerUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState<string | null>(null);

  const notify = useCallback((message: string, kind: 'success' | 'error') => {
    setNotice(message);
    setTimeout(() => setNotice(''), kind === 'error' ? 8000 : 5000);
  }, []);

  useEffect(() => {
    const sessionToken = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!sessionToken) {
      router.replace('/login');
      return;
    }
    setToken(sessionToken);
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, '/api/me'), { token: sessionToken })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          router.replace('/login');
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.user) {
          setUser(data.user as PortalProfileAccount);
          setTeams(Array.isArray(data.teams) ? data.teams : []);
          setManagerUsername(data.manager_username || null);
        }
      })
      .catch(() => notify('Failed to load profile', 'error'))
      .finally(() => setLoading(false));
  }, [apiUrl, notify, router]);

  return (
    <AdminLayout>
      <Head>
        <title>Profile - {ADMIN_SITE_NAME}</title>
      </Head>
      <div className="portal-page portal-page--narrow">
        {notice ? (
          <div className={`alert ${notice.includes('Failed') ? 'alert-error' : 'alert-success'}`} role="status">
            {notice}
          </div>
        ) : null}
        {loading ? (
          <div className="portal-surface">
            <div className="empty-state">Loading...</div>
          </div>
        ) : user && token ? (
          <>
            <div className="portal-surface">
              <div className="portal-profile-hero">
                <div className="portal-avatar">{(user.username || user.email || 'A').slice(0, 2).toUpperCase()}</div>
                <div>
                  <h1 className="portal-profile-hero__title">{user.username}</h1>
                  <p className="portal-profile-hero__meta">{user.email}</p>
                  <div className="portal-page__actions">
                    <span className={`portal-badge ${user.verified ? 'portal-badge--success' : 'portal-badge--warning'}`}>
                      {user.verified ? 'Verified' : 'Not verified'}
                    </span>
                    <span className="portal-badge portal-badge--neutral">{user.role || 'admin'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="portal-profile-grid">
              <div className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Teams</span>
                  {teams.length === 0 ? (
                    <span className="portal-kv__value">—</span>
                  ) : (
                    <div className="portal-pill-row">
                      {teams.map((t) => (
                        <span key={t.id} className="portal-pill">
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Manager</span>
                  <span className="portal-kv__value">{managerUsername || '—'}</span>
                </div>
              </div>
              <div className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Member since</span>
                  <span className="portal-kv__value">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                  </span>
                </div>
              </div>
              <div className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">2FA</span>
                  <span className="portal-kv__value">{user.totp_enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            </div>

            <PortalProfileSettings
              apiUrl={apiUrl}
              token={token}
              user={user}
              onUserPatch={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
              onNotify={notify}
            />
          </>
        ) : (
          <div className="portal-surface">
            <div className="empty-state">Could not load profile.</div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
