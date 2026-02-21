import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

export default function AdminForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSent(true);
      } else {
        setError(data.error || 'Request failed');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Forgot Password - Admin</title>
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
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <h2 className="login-page__card-title">Forgot password</h2>
            <p className="login-page__card-subtitle">
              Enter your admin email and we&apos;ll send you a reset link.
            </p>
            {error && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
                {error}
              </div>
            )}
            {sent ? (
              <p style={{ color: 'var(--color-success)', marginBottom: 16 }}>
                Check your email for a reset link. It may take a few minutes to arrive.
              </p>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="label" htmlFor="email">Email</label>
                  <input
                    id="email"
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    autoComplete="email"
                    placeholder="admin@example.com"
                  />
                </div>
                <button type="submit" className="btn btn-primary login-page__submit" disabled={loading}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}
            <p style={{ marginTop: 16 }}>
              <Link href="/login" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                ← Back to login
              </Link>
            </p>
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
              Reset link opens on the user portal. After resetting, sign in here with your new password.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
