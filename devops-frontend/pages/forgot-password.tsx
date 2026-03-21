import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

export default function DevOpsForgotPassword() {
  const apiUrl = useApiUrl();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('infra-portal-theme', 'dark');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          portal: 'devops',
        }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        setError(getString(data.error, 'Request failed'));
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Forgot Password - DevOps</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">DevOps</h1>
            <p className="login-page__tagline">
              Reset your DevOps portal password and get back to tickets, workload, and approvals.
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
            <h2 className="login-page__card-title">Forgot password</h2>
            <p className="login-page__card-subtitle">
              Enter your DevOps email and we&apos;ll send you a reset link for this portal.
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
                    placeholder="devops@example.com"
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
          </div>
        </div>
      </div>
    </>
  );
}
