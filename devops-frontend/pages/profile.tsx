import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface DevopsUser {
  id: number;
  username: string;
  email?: string;
  user_type?: string;
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

  return (
    <DevOpsLayout>
      <Head><title>Profile — {DEVOPS_SITE_NAME}</title></Head>
      <div className="container">
        <h1 className="page-title" style={{ marginBottom: 8 }}>Profile</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24 }}>Your DevOps account and role.</p>
        {loading ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <span className="loading" style={{ width: 32, height: 32, borderWidth: 3, display: 'inline-block' }} />
            <p style={{ marginTop: 16, color: 'var(--color-text-muted)' }}>Loading…</p>
          </div>
        ) : user ? (
          <div className="card">
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: 'var(--color-text)', paddingBottom: 12, borderBottom: '1px solid var(--color-border)' }}>Account</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
              <div>
                <dt style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Username</dt>
                <dd style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{user.username}</dd>
              </div>
              {user.email && (
                <div>
                  <dt style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Email</dt>
                  <dd style={{ margin: 0 }}>{user.email}</dd>
                </div>
              )}
              <div>
                <dt style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Role</dt>
                <dd style={{ margin: 0 }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    background: user.devops_profile?.is_manager ? 'var(--color-primary-light)' : 'var(--color-surface-elevated)',
                    color: user.devops_profile?.is_manager ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  }}>
                    {user.devops_profile?.is_manager ? 'DevOps Manager' : 'DevOps Member'}
                  </span>
                </dd>
              </div>
              {user.devops_profile?.position && (
                <div>
                  <dt style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Position</dt>
                  <dd style={{ margin: 0 }}>{user.devops_profile.position}</dd>
                </div>
              )}
              {user.devops_profile?.level && (
                <div>
                  <dt style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Level</dt>
                  <dd style={{ margin: 0 }}>{user.devops_profile.level}</dd>
                </div>
              )}
              {user.devops_profile?.onboard_date && (
                <div>
                  <dt style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Onboard date</dt>
                  <dd style={{ margin: 0 }}>{new Date(user.devops_profile.onboard_date).toLocaleDateString()}</dd>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>Could not load profile.</p>
          </div>
        )}
      </div>
    </DevOpsLayout>
  );
}
