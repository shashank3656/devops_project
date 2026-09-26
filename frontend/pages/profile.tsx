import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';
import {
  PortalProfileSettings,
  buildPortalApiUrl,
  portalFetch,
  type PortalProfileAccount,
} from '@infragate/ui';

interface Team {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

export default function Profile() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<PortalProfileAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [userFetched, setUserFetched] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [managerUsername, setManagerUsername] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const sessionToken = localStorage.getItem('token');
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!sessionToken || sessionToken === 'undefined' || !isAuthenticated) {
      router.replace('/login');
      return;
    }
    setToken(sessionToken);
    fetchMe(sessionToken);
  }, [router]);

  const fetchMe = async (sessionToken: string) => {
    setLoading(true);
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/me'), { token: sessionToken });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
        setTeams(Array.isArray(data.teams) ? data.teams : []);
        setManagerUsername(data.manager_username || null);
      } else if (res.status === 404) {
        setUser(null);
        toast('User not found.', 'error');
      } else {
        toast('Session expired. Please log in again.', 'error');
        router.push('/login');
      }
    } catch {
      toast('Failed to load profile', 'error');
    } finally {
      setLoading(false);
      setUserFetched(true);
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
        ) : user && token ? (
          <>
            <section className="portal-surface">
              <div className="portal-profile-hero">
                <div className="portal-avatar">{(user.username || user.email || 'U').slice(0, 2).toUpperCase()}</div>
                <div>
                  <h1 className="portal-profile-hero__title">{user.username}</h1>
                  <p className="portal-profile-hero__meta">{user.email}</p>
                  <div className="portal-page__actions">
                    <span className={`portal-badge ${user.verified ? 'portal-badge--success' : 'portal-badge--warning'}`}>
                      {user.verified ? 'Verified' : 'Not verified'}
                    </span>
                    <span className="portal-badge portal-badge--neutral">{user.role || 'viewer'}</span>
                  </div>
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
                      teams.map((team) => (
                        <span key={team.id} className="portal-pill">
                          {team.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </article>
              <article className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Manager</span>
                  <span className="portal-kv__value">{managerUsername || '—'}</span>
                </div>
              </article>
              <article className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Member since</span>
                  <span className="portal-kv__value">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                  </span>
                </div>
              </article>
              <article className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Authentication</span>
                  <span className="portal-kv__value">{user.totp_enabled ? '2FA enabled' : '2FA disabled'}</span>
                </div>
              </article>
            </section>

            <PortalProfileSettings
              apiUrl={apiUrl}
              token={token}
              user={user}
              onUserPatch={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
              onNotify={(message, kind) => toast(message, kind)}
            />
          </>
        ) : null}
      </div>
    </>
  );
}
