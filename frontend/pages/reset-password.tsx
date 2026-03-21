import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useToast } from '../context/ToastContext';
import { asRecord, getString } from '../lib/payload';

export default function ResetPassword() {
  const router = useRouter();
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const t = router.query.token;
    if (typeof t === 'string') setToken(t);
  }, [router.query.token]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('user-portal-theme', 'dark');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !password || password !== confirm) {
      if (password !== confirm) toast('Passwords do not match', 'error');
      return;
    }
    if (password.length < 6) {
      toast('Password must be at least 6 characters', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password, confirm_password: confirm }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setSuccess(true);
        toast('Password updated. You can now sign in.', 'success');
        setTimeout(() => router.push('/login'), 2000);
      } else {
        toast(getString(data.error, 'Reset failed'), 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Reset failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!token && router.isReady) {
    return (
      <>
        <Head>
          <title>Reset Password - InfraGate</title>
        </Head>
        <div className="login-page">
          <div className="login-page__right" style={{ margin: 'auto' }}>
            <div className="login-page__card">
              <h2 className="login-page__card-title">Invalid link</h2>
              <p className="login-page__card-subtitle">
                This reset link is invalid or has expired. Request a new one from the login page.
              </p>
              <Link href="/forgot-password" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-block', textDecoration: 'none' }}>
                Request new link
              </Link>
              <p style={{ marginTop: 16 }}>
                <Link href="/login" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
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
        <title>Reset Password - InfraGate</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">InfraGate</h1>
            <p className="login-page__tagline">
              Cloud-agnostic infrastructure management. Self-service requests for your team.
            </p>
          </div>
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <h2 className="login-page__card-title">Set new password</h2>
            <p className="login-page__card-subtitle">
              Enter your new password below.
            </p>
            {success ? (
              <p style={{ color: 'var(--success-color)' }}>Password updated. Redirecting to login…</p>
            ) : (
              <form onSubmit={handleSubmit}>
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
                  <label className="label" htmlFor="confirm">Confirm password</label>
                  <input
                    id="confirm"
                    className="input"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                    disabled={loading}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>
                <button type="submit" className="btn btn-primary login-page__submit" disabled={loading || password !== confirm}>
                  {loading ? 'Updating…' : 'Reset password'}
                </button>
              </form>
            )}
            <p style={{ marginTop: 16 }}>
              <Link href="/login" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                ← Back to login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
