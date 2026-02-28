import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface DevopsTeam {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

interface DevopsUser {
  id: number;
  username: string;
  email?: string;
  user_type?: string;
  teams?: DevopsTeam[];
  devops_profile?: {
    is_manager: boolean;
    level?: string;
    position?: string;
    onboard_date?: string;
  };
}

export default function DevOpsProfilePage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [user, setUser] = useState<DevopsUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (response.status === 401) {
          router.replace('/login');
          return null;
        }
        return response.json();
      })
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const teams = user?.teams || [];
  const initials = (user?.username || 'U').slice(0, 2).toUpperCase();

  return (
    <DevOpsLayout>
      <Head>
        <title>Profile - {DEVOPS_SITE_NAME}</title>
      </Head>
      <div className="portal-page portal-page--narrow">
        {loading ? (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>Loading profile...</p>
            </div>
          </section>
        ) : user ? (
          <>
            <header className="portal-page__header">
              <div className="portal-page__header-main">
                <span className="portal-page__eyebrow">Profile</span>
                <h1 className="portal-page__title">Profile Settings</h1>
                <p className="portal-page__subtitle">
                  Current profile data is unchanged; this redesign makes role, level, and team ownership easier to scan.
                </p>
              </div>
            </header>

            <section className="portal-surface">
              <div className="portal-profile-hero">
                <div className="portal-avatar">{initials}</div>
                <div>
                  <h2 className="portal-profile-hero__title">{user.username}</h2>
                  {user.email && <p className="portal-profile-hero__meta">{user.email}</p>}
                  <div className="portal-pill-row">
                    <span className="portal-badge portal-badge--neutral">
                      {user.devops_profile?.is_manager ? 'DevOps Manager' : 'DevOps Member'}
                    </span>
                    {user.devops_profile?.level && <span className="portal-pill">{user.devops_profile.level}</span>}
                    {user.devops_profile?.position && <span className="portal-pill">{user.devops_profile.position}</span>}
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
                  <div className="portal-empty" style={{ padding: 0, textAlign: 'left' }}>
                    <p>No team assignments yet.</p>
                  </div>
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
                    <span className="portal-kv__value">{user.devops_profile?.is_manager ? 'Manager' : 'Member'}</span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">Level</span>
                    <span className="portal-kv__value">{user.devops_profile?.level || '-'}</span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">Position</span>
                    <span className="portal-kv__value">{user.devops_profile?.position || '-'}</span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">Onboard date</span>
                    <span className="portal-kv__value">
                      {user.devops_profile?.onboard_date ? new Date(user.devops_profile.onboard_date).toLocaleDateString() : '-'}
                    </span>
                  </div>
                </div>
              </article>
            </section>
          </>
        ) : (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>Could not load profile.</p>
            </div>
          </section>
        )}
      </div>
    </DevOpsLayout>
  );
}
