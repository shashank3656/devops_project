import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { AuthPipeline, pending2FAFromLoginResponse, resendLogin2FACode, ThemeToggle, type Pending2FA } from '@infragate/ui';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord } from '../lib/payload';
import { consumeReturn, readChangeDraft } from '../lib/returnPath';
import { isSignedSessionToken } from '../lib/session';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface PublicSSOState {
  enabled: boolean;
  mode: string;
  provider: string;
  login_url: string;
}

function providerLabel(provider: string): string {
  if (provider === 'azure_ad') return 'Azure AD';
  if (provider === 'keycloak') return 'Keycloak';
  if (provider === 'saml') return 'SAML SSO';
  if (provider === 'oidc') return 'OIDC';
  return 'SSO';
}

export default function DevOpsLogin() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending2fa, setPending2fa] = useState<Pending2FA | null>(null);
  const [otp, setOtp] = useState('');
  const [resendingOtp, setResendingOtp] = useState(false);
  const [sso, setSso] = useState<PublicSSOState>({ enabled: false, mode: 'disabled', provider: 'none', login_url: '' });
  const [draftSaved, setDraftSaved] = useState(false);

  useEffect(() => {
    setDraftSaved(readChangeDraft());
  }, []);

  useEffect(() => {
    const token = typeof router.query.sso_token === 'string' ? router.query.sso_token : '';
    if (!token || !isSignedSessionToken(token)) return;
    localStorage.setItem(DEVOPS_TOKEN_KEY, token);
    router.replace(consumeReturn());
  }, [router, router.query.sso_token]);

  useEffect(() => {
    fetch(`${apiUrl}/api/public/sso/options?portal=devops`)
      .then((res) => (res.ok ? res.json() : null))
      .then((rawData) => {
        const data = asRecord(rawData);
        const payload = asRecord(data.sso);
        if (payload && typeof payload === 'object') {
          setSso({
            enabled: Boolean(payload.enabled),
            mode: typeof payload.mode === 'string' ? payload.mode : 'disabled',
            provider: typeof payload.provider === 'string' ? payload.provider : 'none',
            login_url: typeof payload.login_url === 'string' ? payload.login_url : '',
          });
        }
      })
      .catch(() => {
        // Keep local login flow operational if this optional call fails.
      });
  }, [apiUrl]);

  useEffect(() => {
    // Only force redirect when policy is explicitly required.
    if (sso.enabled && sso.mode === 'required' && sso.login_url) {
      window.location.assign(sso.login_url);
    }
  }, [sso.enabled, sso.mode, sso.login_url]);

  const handleSSOLogin = () => {
    if (!sso.enabled) return;
    if (!sso.login_url) {
      setError('SSO login is enabled but no SSO login URL is configured by admin.');
      return;
    }
    window.location.assign(sso.login_url);
  };

  const finishDevOpsSession = async (sessionToken: string) => {
    const meRes = await fetch(`${apiUrl}/api/devops/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const meData = await meRes.json().catch(() => ({}));
    if (!meRes.ok || meData.error) {
      setError('Sign-in was not accepted.');
      return;
    }
    const userType = meData.user?.user_type;
    const isAdmin = meData.user?.role === 'admin';
    if (userType !== 'devops_user' && !isAdmin) {
      setError('This portal is for DevOps users or admins only.');
      return;
    }
    localStorage.setItem(DEVOPS_TOKEN_KEY, sessionToken);
    if (typeof meData.token === 'string' && isSignedSessionToken(meData.token)) {
      localStorage.setItem(DEVOPS_TOKEN_KEY, meData.token.trim());
    }
    localStorage.setItem(DEVOPS_USER_KEY, JSON.stringify(meData.user || {}));
    router.push(consumeReturn());
  };

  const handleResendOtp = async () => {
    if (!pending2fa) return;
    setResendingOtp(true);
    setError('');
    try {
      const next = await resendLogin2FACode(apiUrl, pending2fa.token);
      setPending2fa(next);
      setOtp('');
    } catch (err: unknown) {
      setError('Could not resend the code.');
    } finally {
      setResendingOtp(false);
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
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        setError('The code was not accepted.');
        return;
      }
      if (typeof data.token !== 'string' || !isSignedSessionToken(data.token)) {
        setError('Verification failed');
        return;
      }
      await finishDevOpsSession(data.token);
    } catch {
      setError('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, portal: 'devops' }),
      });
      const loginData = await loginRes.json().catch(() => ({}));
      if (!loginRes.ok) {
        setError('Sign-in was not accepted.');
        return;
      }
      const pending = pending2FAFromLoginResponse(loginData);
      if (pending) {
        setPending2fa(pending);
        setPassword('');
        return;
      }
      if (typeof loginData.token !== 'string' || !isSignedSessionToken(loginData.token)) {
        setError('Login failed');
        return;
      }
      await finishDevOpsSession(loginData.token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const isNetwork = /failed to fetch|network error|load failed|err_connection/i.test(String(msg));
      setError(
        isNetwork
          ? `Cannot connect to backend at ${apiUrl}. Check: (1) Backend is running (docker-compose up -d or run backend on port 8080). (2) Port 8080 is open. (3) From this browser, open ${apiUrl.replace(/\/$/, '')}/health to test.`
          : `Cannot connect to backend at ${apiUrl}. Ensure it is running.`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - DevOps</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="SetuOps" width={44} height={44} className="login-page__logo" />
            <h1 className="login-page__title">Approve, deploy and recover with confidence.</h1>
            <p className="login-page__tagline">
              Every request, promotion and rollback in one calm control room.
            </p>
            <AuthPipeline />
          </div>
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <ThemeToggle />
            <span className="ig-portal-pill">DevOps console</span>
            <h2 className="login-page__card-title">Welcome back</h2>
            <p className="login-page__card-subtitle">Sign in with your DevOps account</p>
            {draftSaved ? (
              <p className="alert" role="status">A change draft is saved in this browser. Sign in to continue it.</p>
            ) : null}
            {error && (
              <div className="alert alert-error" role="alert">{error}</div>
            )}
            {pending2fa ? (
              <form onSubmit={handleVerify2FA}>
                <p className="login-page__card-subtitle" style={{ marginBottom: '1rem' }}>
                  Enter the 6-digit code sent to <strong>{pending2fa.emailHint}</strong>
                </p>
                <div className="form-group">
                  <label className="label" htmlFor="devops-otp">Verification code</label>
                  <input
                    id="devops-otp"
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
                  onClick={() => void handleResendOtp()}
                  disabled={loading || resendingOtp}
                >
                  {resendingOtp ? 'Sending…' : 'Resend code'}
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
              {sso.enabled && (
                <>
                  <button type="button" className="btn btn-secondary login-page__submit" onClick={handleSSOLogin} disabled={loading}>
                    Continue with {providerLabel(sso.provider)}
                  </button>
                  <p className="login-page__hint" style={{ marginTop: 12, marginBottom: 12 }}>
                    {sso.mode === 'required' ? 'username/password login is disabled by policy' : 'or sign in with username and password'}
                  </p>
                </>
              )}
              {sso.mode === 'required' ? (
                <div className="alert alert-info" role="status" style={{ marginBottom: 12 }}>
                  Use SSO to continue.
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="label" htmlFor="username">Username</label>
                    <input
                      id="username"
                      className="input"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoFocus
                      placeholder="devops"
                    />
                  </div>
                  <div className="form-group">
                    <label className="label" htmlFor="password">Password</label>
                    <input
                      id="password"
                      className="input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                    />
                  </div>
                  <button type="submit" className="btn btn-primary login-page__submit" disabled={loading}>
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>
                </>
              )}
            </form>
            )}
            {!pending2fa ? (
            <p className="login-page__hint" style={{ marginTop: 16 }}>
              <Link href="/forgot-password" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                Forgot password?
              </Link>
            </p>
            ) : null}
            {!pending2fa ? (
            <p className="login-page__hint">
              Users are created from the Admin portal.
            </p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
