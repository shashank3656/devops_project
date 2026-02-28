import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending2fa, setPending2fa] = useState<{ token: string } | null>(null);
  const [otp, setOtp] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('infra-portal-theme', 'dark');
  }, []);

  const finishAdminLogin = (data: { token: string; user?: { role?: string } }) => {
    if (data.user?.role !== 'admin') {
      setError('Admin access only. Your account does not have admin role.');
      return;
    }
    localStorage.setItem('admin_token', data.token);
    localStorage.setItem('admin_user', JSON.stringify(data.user || {}));
    router.push('/teams');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      if (data.requires_otp && data.pending_2fa_token) {
        setPending2fa({ token: data.pending_2fa_token });
        setError('');
        setPassword('');
        return;
      }
      if (!data.token) {
        setError('Login failed');
        return;
      }
      finishAdminLogin(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message === 'Failed to fetch'
          ? `Cannot connect to backend at ${apiUrl}. Ensure it is running.`
          : message || 'Login failed'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending2fa || !otp.trim()) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_2fa_token: pending2fa.token, otp: otp.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Invalid OTP');
        return;
      }
      if (!data.token) {
        setError('Verification failed');
        return;
      }
      finishAdminLogin(data);
    } catch (_) {
      setError('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Admin Login - Admin</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">Admin</h1>
            <p className="login-page__tagline">
              Cloud-agnostic infrastructure management. Secure, self-service, and audit-ready.
            </p>
          </div>
          <div className="login-page__decor">
            <div className="login-page__blob login-page__blob--1" />
            <div className="login-page__blob login-page__blob--2" />
            <div className="login-page__blob login-page__blob--3" />
          </div>
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <h2 className="login-page__card-title">Welcome back</h2>
            <p className="login-page__card-subtitle">
              Sign in with your admin account
            </p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            {pending2fa ? (
              <form onSubmit={handleVerify2FA}>
                <p className="login-page__card-subtitle" style={{ marginBottom: '1rem' }}>
                  Enter the 6-digit code sent to your email
                </p>
                <div className="form-group">
                  <label className="label" htmlFor="admin-otp">Verification code</label>
                  <input
                    id="admin-otp"
                    className="input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    required
                    disabled={loading}
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="000000"
                  />
                </div>
                <button type="submit" className="btn btn-primary login-page__submit" disabled={loading || otp.length !== 6}>
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: '12px', width: '100%' }}
                  onClick={() => { setPending2fa(null); setOtp(''); setError(''); }}
                  disabled={loading}
                >
                  Back to login
                </button>
              </form>
            ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="admin-username">
                  Username
                </label>
                <input
                  id="admin-username"
                  className="input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                  placeholder="admin"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="admin-password">
                  Password
                </label>
                <input
                  id="admin-password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary login-page__submit"
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            )}
            {!pending2fa && (
              <p style={{ marginTop: 12, fontSize: 13 }}>
                <a href="/forgot-password" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>Forgot password?</a>
              </p>
            )}
            <p className="login-page__hint">
              Default: admin / admin123 — change after first login
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
