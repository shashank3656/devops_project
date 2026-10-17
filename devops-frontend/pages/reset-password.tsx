import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const MIN_PASSWORD = 6;

function BrandPanel() {
  return (
    <div className="login-page__left">
      <div className="login-page__brand">
        <p className="login-page__mark" aria-label="OpsTrellis">
          <img src="/brand/opstrellis-mark-dark.svg" alt="" aria-hidden width={44} height={44} />
          <span className="login-page__mark-word">OpsTrellis</span>
        </p>
        <h1 className="login-page__title">Set a new password.</h1>
        <p className="login-page__tagline">Choose a new password, then sign in to your operations workspace.</p>
      </div>
    </div>
  );
}

export default function DevOpsResetPassword() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [linkExpired, setLinkExpired] = useState(false);

  useEffect(() => {
    const queryToken = router.query.token;
    if (typeof queryToken === 'string') {
      setToken(queryToken);
    }
  }, [router.query.token]);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password, confirm_password: confirmPassword }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        const message = getString(data.error, '');
        if (/invalid or expired token|token required/i.test(message)) {
          setLinkExpired(true);
          return;
        }
        setError(res.status >= 500 ? 'OpsTrellis could not update your password right now. Try again in a moment.' : message || 'Your password was not updated.');
        return;
      }
      setSuccess(true);
      window.setTimeout(() => {
        router.push('/login');
      }, 2500);
    } catch {
      setError('We could not reach OpsTrellis. Check your connection, then try again.');
    } finally {
      setLoading(false);
    }
  };

  const invalidLink = (!token && router.isReady) || linkExpired;

  return (
    <>
      <Head>
        <title>Reset Password - OpsTrellis</title>
      </Head>
      <div className="login-page">
        <BrandPanel />
        <div className="login-page__right">
          <div className="login-page__card">
            {invalidLink ? (
              <>
                <h2 className="login-page__card-title">This link has expired</h2>
                <p className="login-page__card-subtitle">
                  Reset links work once and expire after one hour. Request a new one to continue.
                </p>
                <Link href="/forgot-password" className="btn btn-primary login-page__submit">
                  Request a new link
                </Link>
              </>
            ) : success ? (
              <div className="login-page__confirm" role="status">
                <p className="login-page__confirm-title">Password updated</p>
                <p>Taking you to sign in…</p>
                <Link href="/login" className="btn btn-primary login-page__submit">
                  Sign in now
                </Link>
              </div>
            ) : (
              <>
                <h2 className="login-page__card-title">Set new password</h2>
                <p className="login-page__card-subtitle">Use at least {MIN_PASSWORD} characters.</p>
                {error && (
                  <div className="alert alert-error" role="alert">
                    {error}
                  </div>
                )}
                <form onSubmit={handleSubmit} aria-busy={loading}>
                  <div className="form-group">
                    <label className="label" htmlFor="password">New password</label>
                    <div className="login-page__password">
                      <input
                        id="password"
                        name="new-password"
                        className="input"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={MIN_PASSWORD}
                        readOnly={loading}
                        autoComplete="new-password"
                        aria-invalid={tooShort}
                        aria-describedby="password-help"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="login-page__reveal"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-pressed={showPassword}
                        aria-controls="password confirm-password"
                        aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p id="password-help" className={`login-page__field-help${tooShort ? ' login-page__field-help--error' : ''}`}>
                      {tooShort ? `${MIN_PASSWORD - password.length} more character${MIN_PASSWORD - password.length === 1 ? '' : 's'} needed.` : `At least ${MIN_PASSWORD} characters.`}
                    </p>
                  </div>
                  <div className="form-group">
                    <label className="label" htmlFor="confirm-password">Confirm password</label>
                    <input
                      id="confirm-password"
                      name="confirm-password"
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={MIN_PASSWORD}
                      readOnly={loading}
                      autoComplete="new-password"
                      aria-invalid={mismatch}
                      aria-describedby="confirm-help"
                    />
                    {mismatch ? (
                      <p id="confirm-help" className="login-page__field-help login-page__field-help--error">
                        The passwords do not match yet.
                      </p>
                    ) : (
                      <p id="confirm-help" className="login-page__field-help">Type the same password again.</p>
                    )}
                  </div>
                  <button type="submit" className="btn btn-primary login-page__submit" disabled={loading}>
                    {loading ? (
                      <>
                        <span className="login-page__spinner" aria-hidden />
                        Updating…
                      </>
                    ) : 'Reset password'}
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
