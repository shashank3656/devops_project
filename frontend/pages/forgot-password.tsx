import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useToast } from '../context/ToastContext';
import { asRecord, getString } from '../lib/payload';

export default function ForgotPassword() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('user-portal-theme', 'dark');
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
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        setSent(true);
        toast('Check your email for a reset link.', 'success');
      } else {
        const errMsg = getString(data.error, 'Request failed');
        setError(errMsg);
        toast(errMsg, 'error');
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Request failed';
      setError(errMsg);
      toast(errMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Forgot Password - SetuOps</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">SetuOps</h1>
            <p className="login-page__tagline">
              Cloud-agnostic infrastructure management. Self-service requests for your team.
            </p>
          </div>
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <h2 className="login-page__card-title">Forgot password</h2>
            <p className="login-page__card-subtitle">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
            {sent ? (
              <p style={{ color: 'var(--success-color)', marginBottom: 16 }}>
                Check your email for a reset link. It may take a few minutes to arrive.
              </p>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && (
                  <p style={{ color: 'var(--error-color, #dc2626)', marginBottom: 16 }}>
                    {error}
                  </p>
                )}
                <div className="form-group">
                  <label className="label" htmlFor="email">Email</label>
                  <input
                    id="email"
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(''); }}
                    required
                    disabled={loading}
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </div>
                <button type="submit" className="btn btn-primary login-page__submit" disabled={loading}>
                  {loading ? 'Sending…' : 'Send reset link'}
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
