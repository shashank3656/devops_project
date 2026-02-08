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
        <h1 className="page-title">Profile</h1>
        {loading ? (
          <p className="loading-text">Loading…</p>
        ) : user ? (
          <div className="card">
            <div className="card-title">Account</div>
            <dl style={{ display: 'grid', gap: 'var(--space-3)', margin: 0 }}>
              <div>
                <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 2 }}>Username</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{user.username}</dd>
              </div>
              {user.email && (
                <div>
                  <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 2 }}>Email</dt>
                  <dd style={{ margin: 0 }}>{user.email}</dd>
                </div>
              )}
              <div>
                <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 2 }}>Role</dt>
                <dd style={{ margin: 0 }}>{user.devops_profile?.is_manager ? 'DevOps Manager' : 'DevOps Member'}</dd>
              </div>
              {user.devops_profile?.position && (
                <div>
                  <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 2 }}>Position</dt>
                  <dd style={{ margin: 0 }}>{user.devops_profile.position}</dd>
                </div>
              )}
              {user.devops_profile?.level && (
                <div>
                  <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 2 }}>Level</dt>
                  <dd style={{ margin: 0 }}>{user.devops_profile.level}</dd>
                </div>
              )}
              {user.devops_profile?.onboard_date && (
                <div>
                  <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 2 }}>Onboard date</dt>
                  <dd style={{ margin: 0 }}>{new Date(user.devops_profile.onboard_date).toLocaleDateString()}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <p className="loading-text">Could not load profile.</p>
        )}
      </div>
    </DevOpsLayout>
  );
}
