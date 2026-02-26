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
      <Head><title>Profile — {ADMIN_SITE_NAME}</title></Head>
      <div className="container" style={{ maxWidth: 720 }}>
        {loading ? (
          <p className="loading-text">Loading…</p>
        ) : user ? (
          <>
            <div className="card" style={{ marginBottom: 24, padding: 24, borderLeft: '4px solid var(--color-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 }}>
                  {(user.username || user.email || 'A').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>{user.username}</h1>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 8 }}>{user.email}</p>
                  <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: 'var(--color-primary-tint, #eef2ff)', color: 'var(--color-primary)' }}>
                    {user.role || 'admin'}
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
              <div className="card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Manager</h3>
                <p style={{ color: 'var(--color-text)', fontSize: 14 }}>{managerUsername || '—'}</p>
              </div>
              <div className="card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Member since</h3>
                <p style={{ color: 'var(--color-text)', fontSize: 14 }}>{new Date(user.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </>
        ) : (
          <p className="loading-text">Could not load profile.</p>
        )}
      </div>
    </AdminLayout>
  );
}
