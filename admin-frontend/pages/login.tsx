import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { asRecord, getString } from '../lib/payload';

const API_OVERRIDE_KEY = 'admin_api_url_override';
const LOGIN_ATTEMPT_TIMEOUT_MS = 6000;

export default function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending2fa, setPending2fa] = useState<{ token: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [effectiveApiUrl, setEffectiveApiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const existingToken = (localStorage.getItem('admin_token') || '').trim();
    if (!existingToken || existingToken === 'undefined' || existingToken === 'null' || !/^\d+:\d+$/.test(existingToken)) {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
    }
    const override = (localStorage.getItem(API_OVERRIDE_KEY) || '').trim();
    if (override) {
      setEffectiveApiUrl(override);
    }
  }, []);

  const getFallbackApiUrl = () => {
    if (typeof window === 'undefined') return '';
    const host = window.location.hostname;
    if (!host) return '';
    return `${window.location.protocol}//${host}:8080`;
  };

  const rememberWorkingApiUrl = (url: string) => {
    const normalized = url.trim().replace(/\/+$/, '');
    if (!normalized) return;
    localStorage.setItem(API_OVERRIDE_KEY, normalized);
    setEffectiveApiUrl(normalized);
  };

  const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs = LOGIN_ATTEMPT_TIMEOUT_MS) => {
    if (typeof AbortController === 'undefined') return fetch(url, init);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };

  const finishAdminLogin = (token: string, user?: { role?: string }) => {
    if (user?.role !== 'admin') {
      setError('Admin access only. Your account does not have admin role.');
      return;
    }
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_user', JSON.stringify(user || {}));
    router.push('/teams');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const primaryApi = effectiveApiUrl || apiUrl;
      const fallbackApi = getFallbackApiUrl();
      const candidates = [primaryApi];
      if (fallbackApi && fallbackApi !== primaryApi) {
        candidates.push(fallbackApi);
      }

      let res: Response | null = null;
      let lastErr: unknown = null;
      let chosenApi = primaryApi;
      const attemptedApis: string[] = [];
      for (const candidate of candidates) {
        try {
          attemptedApis.push(candidate);
          const attempt = await fetchWithTimeout(`${candidate}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, portal: 'admin' }),
          });
          res = attempt;
          chosenApi = candidate;
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!res) {
        const attempted = attemptedApis.length > 0 ? attemptedApis.join(', ') : primaryApi;
        if (lastErr instanceof Error) {
          throw new Error(`Cannot connect to backend. Tried: ${attempted}. Last error: ${lastErr.message}`);
        }
        throw new Error(`Cannot connect to backend. Tried: ${attempted}.`);
      }
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        setError(getString(data.error, 'Login failed'));
        return;
      }
      if (chosenApi !== primaryApi) {
        rememberWorkingApiUrl(chosenApi);
      }
      if (data.requires_otp && typeof data.pending_2fa_token === 'string') {
        setPending2fa({ token: data.pending_2fa_token });
        setError('');
        setPassword('');
        return;
      }
      if (typeof data.token !== 'string' || !data.token) {
        setError('Login failed');
        return;
      }
      const user = asRecord(data.user);
      finishAdminLogin(data.token, {
        role: getString(user.role),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message || `Cannot connect to backend at ${effectiveApiUrl}. Ensure it is running and reachable from browser.`
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
      const res = await fetch(`${effectiveApiUrl}/api/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_2fa_token: pending2fa.token, otp: otp.trim() }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        setError(getString(data.error, 'Invalid OTP'));
        return;
      }
      if (typeof data.token !== 'string' || !data.token) {
        setError('Verification failed');
        return;
      }
      const user = asRecord(data.user);
      finishAdminLogin(data.token, {
        role: getString(user.role),
      });
    } catch (_) {
      setError('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Portal Sign-in - SetuOps Governance</title>
      </Head>
      <div className="login-page login-page--portal">
        <div className="login-page__shell">
          <header className="login-page__masthead">
            <Link href="/login" className="login-page__wordmark">
              <img src="/logo.svg" alt="" width={44} height={44} className="login-page__wordmark-logo" />
              <div className="login-page__wordmark-copy">
                <span className="login-page__brand-name">SetuOps</span>
                <span className="login-page__brand-context">Governance Portal</span>
              </div>
            </Link>
            <span className="login-page__portal-pill">Admin review</span>
          </header>

          <main className="login-page__stage">
            <div className="login-page__card">
            <p className="login-page__eyebrow">Portal Sign-in</p>
            <h1 className="login-page__card-title">Portal Sign-in</h1>
            <p className="login-page__card-subtitle">
              Enter your credentials to access the SetuOps governance workspace.
            </p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            {pending2fa ? (
              <form onSubmit={handleVerify2FA}>
                <p className="login-page__form-copy">
                  Enter the 6-digit code sent to your email
                </p>
                <div className="form-group">
                  <label className="login-page__field-label" htmlFor="admin-otp">Verification code</label>
                  <input
                    id="admin-otp"
                    className="input login-page__input"
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
                <button type="submit" className="btn btn-primary login-page__submit login-page__submit--primary" disabled={loading || otp.length !== 6}>
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary login-page__submit login-page__submit--secondary"
                  onClick={() => { setPending2fa(null); setOtp(''); setError(''); }}
                  disabled={loading}
                >
                  Back to login
                </button>
              </form>
            ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="login-page__field-label" htmlFor="admin-username">Admin username</label>
                <input
                  id="admin-username"
                  className="input login-page__input"
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
                <div className="login-page__field-label-row">
                  <label className="login-page__field-label" htmlFor="admin-password">Access key</label>
                  <Link href="/forgot-password" className="login-page__field-link">Forgot password?</Link>
                </div>
                <input
                  id="admin-password"
                  className="input login-page__input"
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
                className="btn btn-primary login-page__submit login-page__submit--primary"
                disabled={loading}
              >
                {loading ? 'Initiating…' : 'Initiate Session'}
              </button>
            </form>
            )}
            <p className="login-page__trust-copy">
              Review policies, approvals, and governance controls from one secure control surface.
            </p>
            <p className="login-page__hint">
              Use your assigned platform administrator credentials.
            </p>
            </div>
          </main>
          <footer className="login-page__footer">
            <span>© {new Date().getFullYear()} SetuOps governance suite.</span>
            <div className="login-page__footer-links">
              <span>Privacy</span>
              <span>Security</span>
              <span>Status</span>
              <span>Support</span>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
