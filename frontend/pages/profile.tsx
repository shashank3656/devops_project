import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';

interface User {
  id: number;
  username: string;
  email: string;
  verified?: boolean;
  role?: string;
  created_at: string;
}

export default function Profile() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [resending, setResending] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchMe();
  }, [router]);

  const fetchMe = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/api/me`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
      } else {
        toast('Session expired. Please log in again.', 'error');
        router.push('/login');
      }
    } catch (_) {
      toast('Failed to load profile', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast('New password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('New passwords do not match', 'error');
      return;
    }
    setChanging(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/api/change-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'ok') {
        toast('Password updated successfully', 'success');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast(data.error || 'Failed to change password', 'error');
      }
    } catch (_) {
      toast('Failed to change password', 'error');
    } finally {
      setChanging(false);
    }
  };

  const handleResendVerification = async () => {
    setResending(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/api/resend-verification`, { method: 'POST', headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'ok') {
        toast(data.message || 'Verification link sent. Check your email.', 'success');
      } else {
        toast(data.error || 'Failed to resend', 'error');
      }
    } catch (_) {
      toast('Failed to resend verification', 'error');
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return (
      <>
        <Head>
          <title>Profile - Infrastructure Portal</title>
        </Head>
        <div style={{ minHeight: '100vh', padding: '40px 20px', textAlign: 'center' }}>
          <div className="container">
            <p style={{ color: 'var(--text-secondary)' }}>Loading profile...</p>
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
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '24px' }}>
            Profile
          </h1>

          <div className="card" style={{ maxWidth: '500px', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '16px', color: 'var(--text-primary)' }}>Account</h2>
            {user && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Username</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.username}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Email</span>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{user.email}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Status</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: user.verified ? 'var(--success-bg)' : 'var(--warning-bg)',
                      color: user.verified ? 'var(--success-color)' : 'var(--warning-color)',
                    }}>
                      {user.verified ? '✓ Verified' : 'Not verified'}
                    </span>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: 'var(--info-bg)',
                      color: 'var(--info-color)',
                    }}>
                      Role: {user.role || 'viewer'}
                    </span>
                  </div>
                </div>
                {!user.verified && (
                  <div>
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={resending}
                      className="btn btn-secondary"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                    >
                      {resending ? 'Sending...' : 'Resend verification email'}
                    </button>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                      Verify your email and get contributor access to create PRs.
                    </p>
                  </div>
                )}
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Member since</span>
                  <div style={{ color: 'var(--text-primary)' }}>
                    {new Date(user.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ maxWidth: '500px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '16px', color: 'var(--text-primary)' }}>
              Change password
            </h2>
            <form onSubmit={handleChangePassword}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                Current password
              </label>
              <input
                type="password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="Current password"
                style={{ marginBottom: '16px' }}
              />
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                New password
              </label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                placeholder="At least 6 characters"
                style={{ marginBottom: '16px' }}
              />
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                Confirm new password
              </label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Confirm new password"
                style={{ marginBottom: '20px' }}
              />
              <button type="submit" className="btn btn-primary" disabled={changing}>
                {changing ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
