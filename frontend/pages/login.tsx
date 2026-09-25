import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { AuthPipeline, ThemeToggle } from '@infragate/ui';
import { useToast } from '../context/ToastContext';
import { asRecord, getString } from '../lib/payload';
import { SITE_NAME } from '../lib/site';

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

export default function Login() {
  const router = useRouter();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending2fa, setPending2fa] = useState<{ token: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [sso, setSso] = useState<PublicSSOState>({ enabled: false, mode: 'disabled', provider: 'none', login_url: '' });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (t === 'undefined' || t === 'null') {
      localStorage.removeItem('token');
      localStorage.removeItem('isAuthenticated');
    }
  }, []);

  useEffect(() => {
    const token = typeof router.query.sso_token === 'string' ? router.query.sso_token : '';
    if (!token) return;
    localStorage.setItem('token', token);
    localStorage.setItem('isAuthenticated', 'true');
    toast('Signed in with SSO', 'success');
    router.replace('/home');
  }, [router, router.query.sso_token, toast]);

  useEffect(() => {
    fetch(`${apiUrl}/api/public/sso/options?portal=user`)
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
      const msg = 'SSO login is enabled but no SSO login URL is configured by admin.';
      setError(msg);
      toast(msg, 'error');
      return;
    }
    window.location.assign(sso.login_url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, portal: 'user' }),
      });

      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        const msg = getString(data.error, `Server returned ${response.status}`);
        setError(msg);
        toast(msg, 'error');
        return;
      }
      if (data.requires_otp && typeof data.pending_2fa_token === 'string') {
        setPending2fa({ token: data.pending_2fa_token });
        setError('');
        setPassword('');
        if (typeof data.otp_for_testing === 'string') {
          toast(`OTP for testing: ${data.otp_for_testing}`, 'success');
        } else {
          toast('Enter the 6-digit code sent to your email', 'success');
        }
        return;
      }
      if (typeof data.token !== 'string' || !data.token) {
        const message = getString(data.error, 'Login failed');
        setError(message);
        toast(message, 'error');
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user && typeof data.user === 'object' ? data.user : {}));
      localStorage.setItem('isAuthenticated', 'true');

      const teamsRes = await fetch(`${apiUrl}/api/me/teams`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      const teamsData = asRecord(await teamsRes.json().catch(() => ({})));
      const teams = Array.isArray(teamsData.teams) ? teamsData.teams : [];
      if (teams.length === 0) {
        localStorage.removeItem('token');
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('user');
        setError('403 Forbidden: You are not assigned to any team. Contact your administrator.');
        toast('Access forbidden. You are not in any team.', 'error');
        return;
      }
      toast('Welcome back!', 'success');
      router.push('/home');
    } catch (err: any) {
      const isNetworkError = err?.message === 'Failed to fetch' || err?.name === 'TypeError';
      const msg = isNetworkError
        ? `Cannot connect to the server. Ensure the backend is running at ${apiUrl} (check NEXT_PUBLIC_API_URL).`
        : (err?.message || 'An error occurred');
      setError(msg);
      toast(msg, 'error');
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
      const res = await fetch(`${apiUrl}/api/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_2fa_token: pending2fa.token, otp: otp.trim() }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        const message = getString(data.error, 'Invalid OTP');
        setError(message);
        toast(message, 'error');
        return;
      }
      if (typeof data.token !== 'string' || !data.token) {
        setError('Verification failed');
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user && typeof data.user === 'object' ? data.user : {}));
      localStorage.setItem('isAuthenticated', 'true');
      const teamsRes = await fetch(`${apiUrl}/api/me/teams`, { headers: { Authorization: `Bearer ${data.token}` } });
      const teamsData = asRecord(await teamsRes.json().catch(() => ({})));
      const teams = Array.isArray(teamsData.teams) ? teamsData.teams : [];
      if (teams.length === 0) {
        localStorage.removeItem('token');
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('user');
        setError('403 Forbidden: You are not assigned to any team.');
        toast('Access forbidden. You are not in any team.', 'error');
        return;
      }
      toast('Welcome back!', 'success');
      router.push('/home');
    } catch (err: any) {
      setError(err?.message || 'Verification failed');
      toast('Verification failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - {SITE_NAME}</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt={SITE_NAME} width={44} height={44} className="login-page__logo" />
            <h1 className="login-page__title">Ship infrastructure without the ticket queue.</h1>
            <p className="login-page__tagline">
              Pick a golden path, see the cost up front, and track your request from dev to prod.
            </p>
            <AuthPipeline />
          </div>
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <ThemeToggle />
            <span className="ig-portal-pill">User portal</span>
            <h2 className="login-page__card-title">Welcome back</h2>
            <p className="login-page__card-subtitle">Sign in to your account</p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
                {error.includes('Cannot connect') && (
                  <p style={{ marginTop: '8px', fontSize: '13px', opacity: 0.9 }}>
                    Backend URL: <code style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '4px' }}>{apiUrl}</code>
                  </p>
                )}
              </div>
            )}
            {pending2fa ? (
              <form onSubmit={handleVerify2FA}>
                <p className="login-page__card-subtitle" style={{ marginBottom: '1rem' }}>
                  Enter the 6-digit code sent to your email
                </p>
                <div className="form-group">
                  <label className="label" htmlFor="otp">Verification code</label>
                  <input
                    id="otp"
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
                  {loading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <span className="loading" style={{ width: 18, height: 18, borderWidth: 2 }} />
                      Verifying…
                    </span>
                  ) : (
                    'Verify'
                  )}
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
                      disabled={loading}
                      autoComplete="username"
                      autoFocus
                      placeholder="Enter your username"
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
                      disabled={loading}
                      autoComplete="current-password"
                      placeholder="••••••••"
                    />
                  </div>
                  <button type="submit" className="btn btn-primary login-page__submit" disabled={loading}>
                    {loading ? (
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <span className="loading" style={{ width: 18, height: 18, borderWidth: 2 }} />
                        Signing in…
                      </span>
                    ) : (
                      'Sign in'
                    )}
                  </button>
                </>
              )}
            </form>
            )}
            {!pending2fa && (
              <p style={{ marginTop: 12, fontSize: 13 }}>
                <Link href="/forgot-password" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>Forgot password?</Link>
              </p>
            )}
            <p className="login-page__hint">
              Contact your administrator for access. Sign-up is disabled.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
