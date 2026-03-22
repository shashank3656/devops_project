import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
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
        <title>Portal Sign-in - {SITE_NAME}</title>
      </Head>
      <div className="login-page login-page--portal">
        <div className="login-page__shell">
          <header className="login-page__masthead">
            <Link href="/login" className="login-page__wordmark">
              <img src="/logo.svg" alt="" width={44} height={44} className="login-page__wordmark-logo" />
              <div className="login-page__wordmark-copy">
                <span className="login-page__brand-name">{SITE_NAME}</span>
                <span className="login-page__brand-context">User Portal</span>
              </div>
            </Link>
            <span className="login-page__portal-pill">User access</span>
          </header>

          <main className="login-page__stage">
            <div className="login-page__card">
              <p className="login-page__eyebrow">Portal Sign-in</p>
              <h1 className="login-page__card-title">Portal Sign-in</h1>
              <p className="login-page__card-subtitle">
                Enter your credentials to access the SetuOps ecosystem.
              </p>
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
                <p className="login-page__form-copy">
                  Enter the 6-digit code sent to your email
                </p>
                <div className="form-group">
                  <label className="login-page__field-label" htmlFor="otp">Verification code</label>
                  <input
                    id="otp"
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
                  className="btn btn-secondary login-page__submit login-page__submit--secondary"
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
                  <button type="button" className="btn btn-secondary login-page__submit login-page__submit--secondary" onClick={handleSSOLogin} disabled={loading}>
                    Continue with {providerLabel(sso.provider)}
                  </button>
                  <p className="login-page__form-copy" style={{ marginTop: 12, marginBottom: 12 }}>
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
                    <label className="login-page__field-label" htmlFor="username">Portal username</label>
                    <input
                      id="username"
                      className="input login-page__input"
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
                    <div className="login-page__field-label-row">
                      <label className="login-page__field-label" htmlFor="password">Access key</label>
                      <Link href="/forgot-password" className="login-page__field-link">Forgot password?</Link>
                    </div>
                    <input
                      id="password"
                      className="input login-page__input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                      autoComplete="current-password"
                      placeholder="••••••••"
                    />
                  </div>
                  <button type="submit" className="btn btn-primary login-page__submit login-page__submit--primary" disabled={loading}>
                    {loading ? (
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <span className="loading" style={{ width: 18, height: 18, borderWidth: 2 }} />
                        Signing in…
                      </span>
                    ) : (
                      'Initiate Session'
                    )}
                  </button>
                </>
              )}
            </form>
            )}
            {!pending2fa && sso.enabled && sso.mode !== 'required' && (
              <>
                <div className="login-page__divider"><span>Or continue with identity provider</span></div>
                <div className="login-page__provider-grid">
                  <button type="button" className="login-page__provider-card" onClick={handleSSOLogin} disabled={loading}>
                    <span className="login-page__provider-label">{providerLabel(sso.provider)}</span>
                    <span className="login-page__provider-copy">Enterprise SSO</span>
                  </button>
                </div>
              </>
            )}
            <p className="login-page__trust-copy">
              Trusted by platform teams, reviewers, and operators across shared infrastructure environments.
            </p>
            <p className="login-page__hint">
              Contact your administrator for access. Sign-up is disabled.
            </p>
            </div>
          </main>
          <footer className="login-page__footer">
            <span>© {new Date().getFullYear()} SetuOps multi-portal suite.</span>
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
