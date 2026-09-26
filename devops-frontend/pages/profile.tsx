import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';
import { asRecord, getString } from '../lib/payload';
import {
  PortalProfileSettings,
  buildPortalApiUrl,
  portalFetch,
  type PortalProfileAccount,
} from '@infragate/ui';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface DevopsTeam {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

interface DevopsProfile {
  is_manager: boolean;
  level?: string;
  position?: string;
  onboard_date?: string;
}

export default function DevOpsProfilePage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [user, setUser] = useState<PortalProfileAccount | null>(null);
  const [devopsProfile, setDevopsProfile] = useState<DevopsProfile | null>(null);
  const [teams, setTeams] = useState<DevopsTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState<string | null>(null);

  const notify = useCallback((message: string, kind: 'success' | 'error') => {
    setNotice(message);
    if (kind === 'error') {
      setTimeout(() => setNotice(''), 8000);
    } else {
      setTimeout(() => setNotice(''), 5000);
    }
  }, []);

  useEffect(() => {
    const sessionToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!sessionToken) {
      router.replace('/login');
      return;
    }
    setToken(sessionToken);
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, '/api/me'), { token: sessionToken })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace('/login');
          return null;
        }
        return response.json().catch(() => ({}));
      })
      .then((rawData) => {
        const data = asRecord(rawData);
        const nextUser = data.user;
        if (nextUser && typeof nextUser === 'object') {
          const u = nextUser as PortalProfileAccount;
          setUser(u);
        }
        const dp = data.devops_profile;
        if (dp && typeof dp === 'object') {
          setDevopsProfile(dp as DevopsProfile);
        }
        setTeams(Array.isArray(data.teams) ? (data.teams as DevopsTeam[]) : []);
      })
      .catch(() => notify('Failed to load profile', 'error'))
      .finally(() => setLoading(false));
  }, [apiUrl, notify, router]);

  const initials = (user?.username || 'U').slice(0, 2).toUpperCase();

  return (
    <DevOpsLayout>
      <Head>
        <title>Profile - {DEVOPS_SITE_NAME}</title>
      </Head>
      <div className="portal-page portal-page--narrow">
        {notice ? (
          <div className={`alert ${notice.includes('Failed') ? 'alert-error' : 'alert-success'}`} role="status">
            {notice}
          </div>
        ) : null}
        {loading ? (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>Loading profile...</p>
            </div>
          </section>
        ) : user && token ? (
          <>
            <header className="portal-page__header">
              <div className="portal-page__header-main">
                <span className="portal-page__eyebrow">Profile</span>
                <h1 className="portal-page__title">Profile settings</h1>
                <p className="portal-page__subtitle">Account security and notifications, plus your DevOps role and team assignments.</p>
              </div>
            </header>

            <section className="portal-surface">
              <div className="portal-profile-hero">
                <div className="portal-avatar">{initials}</div>
                <div>
                  <h2 className="portal-profile-hero__title">{user.username}</h2>
                  {user.email && <p className="portal-profile-hero__meta">{user.email}</p>}
                  <div className="portal-pill-row">
                    <span className={`portal-badge ${user.verified ? 'portal-badge--success' : 'portal-badge--warning'}`}>
                      {user.verified ? 'Verified' : 'Not verified'}
                    </span>
                    <span className="portal-badge portal-badge--neutral">
                      {devopsProfile?.is_manager ? 'DevOps Manager' : 'DevOps Member'}
                    </span>
                    {devopsProfile?.level ? <span className="portal-pill">{devopsProfile.level}</span> : null}
                    {devopsProfile?.position ? <span className="portal-pill">{devopsProfile.position}</span> : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="portal-grid">
              <article className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Teams</span>
                    <h2 className="portal-surface__title">Assigned squads</h2>
                  </div>
                </div>
                {teams.length === 0 ? (
                  <p className="portal-surface__subtitle">No team assignments yet.</p>
                ) : (
                  <div className="portal-pill-row">
                    {teams.map((team) => (
                      <span key={team.id} className="portal-pill">
                        {team.name}
                      </span>
                    ))}
                  </div>
                )}
              </article>

              <article className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Profile data</span>
                    <h2 className="portal-surface__title">Role details</h2>
                  </div>
                </div>
                <div className="portal-profile-grid">
                  <div className="portal-kv">
                    <span className="portal-kv__label">Role</span>
                    <span className="portal-kv__value">{devopsProfile?.is_manager ? 'Manager' : 'Member'}</span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">Level</span>
                    <span className="portal-kv__value">{devopsProfile?.level || '—'}</span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">Onboard date</span>
                    <span className="portal-kv__value">
                      {devopsProfile?.onboard_date ? new Date(devopsProfile.onboard_date).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">2FA</span>
                    <span className="portal-kv__value">{user.totp_enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                </div>
              </article>
            </section>

            <PortalProfileSettings
              apiUrl={apiUrl}
              token={token}
              user={user}
              onUserPatch={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
              onNotify={notify}
            />
          </>
        ) : (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>{getString(notice, 'Could not load profile.')}</p>
            </div>
          </section>
        )}
      </div>
    </DevOpsLayout>
  );
}
