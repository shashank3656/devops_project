import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useApiUrl } from '../context/ApiUrlContext';

export default function DevOpsForgotPassword() {
  const apiUrl = useApiUrl();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, portal: 'devops' }),
      });
      if (res.status === 429) {
        setError('Too many reset requests. Wait a minute, then try again.');
        return;
      }
      if (!res.ok) {
        setError('OpsTrellis could not send the reset link right now. Try again in a moment.');
        return;
      }
      setSentTo(value);
    } catch {
      setError('We could not reach OpsTrellis. Check your connection, then try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Forgot Password - OpsTrellis</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <p className="login-page__mark" aria-label="OpsTrellis">
              <img src="/brand/opstrellis-mark-dark.svg" alt="" aria-hidden width={44} height={44} />
              <span className="login-page__mark-word">OpsTrellis</span>
            </p>
            <h1 className="login-page__title">Get back to work.</h1>
            <p className="login-page__tagline">
              Reset your OpsTrellis password and return to tickets, workload, and approvals.
            </p>
          </div>
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <h2 className="login-page__card-title">Forgot password</h2>
            {sentTo ? (
              <div className="login-page__confirm" role="status">
                <p className="login-page__confirm-title">Check your inbox</p>
                <p>
                  If an OpsTrellis account matches <strong>{sentTo}</strong>, a reset link is on its way. It can take a few
                  minutes. The link works once and expires after one hour.
                </p>
                <p className="login-page__hint">Nothing arrived? Check spam, or send it again.</p>
                <button
                  type="button"
                  className="btn btn-secondary login-page__submit"
                  onClick={() => setSentTo('')}
                >
                  Send again
                </button>
              </div>
            ) : (
              <>
                <p className="login-page__card-subtitle">
                  Enter the email or username on your account. We&apos;ll send a reset link to the email on file.
                </p>
                {error && (
                  <div className="alert alert-error" role="alert">
                    {error}
                  </div>
                )}
                <form onSubmit={handleSubmit} aria-busy={loading}>
                  <div className="form-group">
                    <label className="label" htmlFor="email">Email or username</label>
                    <input
                      id="email"
                      name="email"
                      className="input"
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      readOnly={loading}
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="you@company.com"
                    />
                  </div>
                  <button type="submit" className="btn btn-primary login-page__submit" disabled={loading}>
                    {loading ? (
                      <>
                        <span className="login-page__spinner" aria-hidden />
                        Sending…
                      </>
                    ) : 'Send reset link'}
                  </button>
                </form>
              </>
            )}
            <p className="login-page__hint login-page__back">
              <Link href="/login" className="login-page__link">← Back to sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
