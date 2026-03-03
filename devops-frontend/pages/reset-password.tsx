import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useApiUrl } from '../context/ApiUrlContext';

export default function DevOpsResetPassword() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('infra-portal-theme', 'dark');
  }, []);

  useEffect(() => {
    const queryToken = router.query.token;
    if (typeof queryToken === 'string') {
      setToken(queryToken);
    }
  }, [router.query.token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Reset token is missing.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          new_password: password,
          confirm_password: confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Reset failed');
        return;
      }
      setSuccess(true);
      window.setTimeout(() => {
        router.push('/login');
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  if (!token && router.isReady) {
    return (
      <>
        <Head>
          <title>Reset Password - DevOps</title>
        </Head>
        <div className="login-page">
          <div className="login-page__right" style={{ margin: 'auto' }}>
            <div className="login-page__card">
              <h2 className="login-page__card-title">Invalid link</h2>
              <p className="login-page__card-subtitle">
                This reset link is invalid or has expired. Request a new one from the DevOps login page.
              </p>
              <Link href="/forgot-password" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-block', textDecoration: 'none' }}>
                Request new link
              </Link>
              <p style={{ marginTop: 16 }}>
                <Link href="/login" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                  ← Back to login
                </Link>
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Reset Password - DevOps</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">DevOps</h1>
            <p className="login-page__tagline">
              Set a new password for the DevOps portal and return to your operations workspace.
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
            <h2 className="login-page__card-title">Set new password</h2>
            <p className="login-page__card-subtitle">
              Enter your new DevOps portal password below.
            </p>
            {success ? (
              <p style={{ color: 'var(--color-success)' }}>
                Password updated. Redirecting to login…
              </p>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
                    {error}
                  </div>
                )}
                <div className="form-group">
                  <label className="label" htmlFor="password">New password</label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={loading}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    className="input"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={loading}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary login-page__submit"
                  disabled={loading || password !== confirmPassword}
                >
                  {loading ? 'Updating…' : 'Reset password'}
                </button>
              </form>
            )}
            <p style={{ marginTop: 16 }}>
              <Link href="/login" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                ← Back to login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
