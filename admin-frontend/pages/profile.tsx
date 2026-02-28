import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AdminLayout from '../components/AdminLayout';
import { ADMIN_SITE_NAME } from '../lib/site';

const ADMIN_TOKEN_KEY = 'admin_token';

interface User {
  id: number;
  username: string;
  email: string;
  role?: string;
  verified?: boolean;
  created_at: string;
}

interface Team {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

export default function AdminProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [managerUsername, setManagerUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          router.replace('/login');
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.user) {
          setUser(data.user);
          setTeams(Array.isArray(data.teams) ? data.teams : []);
          setManagerUsername(data.manager_username || null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  return (
    <AdminLayout>
      <Head><title>Profile - {ADMIN_SITE_NAME}</title></Head>
      <div className="portal-page portal-page--narrow">
        {loading ? (
          <div className="portal-surface">
            <div className="empty-state">Loading...</div>
          </div>
        ) : user ? (
          <>
            <div className="portal-surface">
              <div className="portal-profile-hero">
                <div className="portal-avatar">
                  {(user.username || user.email || 'A').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h1 className="portal-profile-hero__title">{user.username}</h1>
                  <p className="portal-profile-hero__meta">{user.email}</p>
                  <span className="portal-badge portal-badge--neutral">
                    {user.role || 'admin'}
                  </span>
                </div>
              </div>
            </div>

            <div className="portal-profile-grid">
              <div className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Teams</span>
                {teams.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>-</p> : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {teams.map((t) => (
                      <span key={t.id} className="portal-pill">{t.name}</span>
                    ))}
                  </div>
                )}
                </div>
              </div>
              <div className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Manager</span>
                  <span className="portal-kv__value">{managerUsername || '-'}</span>
                </div>
              </div>
              <div className="portal-surface portal-surface--tight">
                <div className="portal-kv">
                  <span className="portal-kv__label">Member since</span>
                  <span className="portal-kv__value">{new Date(user.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
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
