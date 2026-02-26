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
      .then((r) => {
        if (r.status === 401) {
          router.replace('/login');
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const teams = user?.teams || [];

  return (
    <DevOpsLayout>
      <Head><title>Profile — {DEVOPS_SITE_NAME}</title></Head>
      <div className="container" style={{ maxWidth: 720 }}>
        {loading ? (
          <p className="loading-text">Loading…</p>
        ) : user ? (
          <>
            <div className="card" style={{ marginBottom: 24, padding: 24, borderLeft: '4px solid var(--color-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 }}>
                  {(user.username || 'U').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>{user.username}</h1>
                  {user.email && <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 8 }}>{user.email}</p>}
                  <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--color-primary-tint, #eef2ff)', color: 'var(--color-primary)' }}>
                    {user.devops_profile?.is_manager ? 'DevOps Manager' : 'DevOps Member'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
              <div className="card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Teams</h3>
                {teams.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>—</p> : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {teams.map((t) => (
                      <span key={t.id} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 13, background: 'var(--color-primary-tint, #eef2ff)', color: 'var(--color-primary)', fontWeight: 500 }}>{t.name}</span>
                    ))}
                  </div>
                )}
              </div>
              {user.devops_profile?.position && (
                <div className="card" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Position</h3>
                  <p style={{ color: 'var(--color-text)', fontSize: 14 }}>{user.devops_profile.position}</p>
                </div>
              )}
              {user.devops_profile?.level && (
                <div className="card" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Level</h3>
                  <p style={{ color: 'var(--color-text)', fontSize: 14 }}>{user.devops_profile.level}</p>
                </div>
              )}
              {user.devops_profile?.onboard_date && (
                <div className="card" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Onboard date</h3>
                  <p style={{ color: 'var(--color-text)', fontSize: 14 }}>{new Date(user.devops_profile.onboard_date).toLocaleDateString()}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="loading-text">Could not load profile.</p>
        )}
      </div>
    </DevOpsLayout>
  );
}
