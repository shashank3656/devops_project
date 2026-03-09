import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

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
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('infra-portal-theme', 'dark');
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      if (chosenApi !== primaryApi) {
        rememberWorkingApiUrl(chosenApi);
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
                <Link href="/forgot-password" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>Forgot password?</Link>
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
