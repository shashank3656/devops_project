import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord } from '../lib/payload';

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
  return 'SSO';
}

export default function DevOpsLogin() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sso, setSso] = useState<PublicSSOState>({ enabled: false, mode: 'disabled', provider: 'none', login_url: '' });

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
        setError(loginData.error || 'Login failed');
        return;
      }
      if (!loginData.token) {
        setError('Login failed');
        return;
      }
      const meRes = await fetch(`${apiUrl}/api/devops/me`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });
      const meData = await meRes.json().catch(() => ({}));
      if (!meRes.ok || meData.error) {
        setError(meData.error || 'This portal is for DevOps users or admins only. Create a DevOps user from the Admin portal.');
        return;
      }
      // Allow devops_user or admin (role=admin) to access DevOps portal
      const userType = meData.user?.user_type;
      const isAdmin = meData.user?.role === 'admin';
      if (userType !== 'devops_user' && !isAdmin) {
        setError('This portal is for DevOps users or admins only.');
        return;
      }
      localStorage.setItem(DEVOPS_TOKEN_KEY, loginData.token);
      if (typeof meData.token === 'string' && meData.token.trim()) {
        localStorage.setItem(DEVOPS_TOKEN_KEY, meData.token.trim());
      }
      localStorage.setItem(DEVOPS_USER_KEY, JSON.stringify(meData.user || {}));
      router.push('/dashboard');
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
        <title>Portal Sign-in - SetuOps DevOps</title>
      </Head>
      <div className="login-page login-page--portal">
        <div className="login-page__shell">
          <header className="login-page__masthead">
            <Link href="/login" className="login-page__wordmark">
              <img src="/logo.svg" alt="" width={44} height={44} className="login-page__wordmark-logo" />
              <div className="login-page__wordmark-copy">
                <span className="login-page__brand-name">SetuOps</span>
                <span className="login-page__brand-context">DevOps Portal</span>
              </div>
            </Link>
            <span className="login-page__portal-pill">Command center</span>
          </header>

          <main className="login-page__stage">
            <div className="login-page__card">
            <p className="login-page__eyebrow">Portal Sign-in</p>
            <h1 className="login-page__card-title">Portal Sign-in</h1>
            <p className="login-page__card-subtitle">
              Enter your credentials to access the SetuOps operational control plane.
            </p>
            {error && (
              <div className="alert alert-error" role="alert">{error}</div>
            )}
            <form onSubmit={handleSubmit}>
              {sso.mode === 'required' ? (
                <div className="alert alert-info" role="status" style={{ marginBottom: 12 }}>
                  Use SSO to continue.
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="login-page__field-label" htmlFor="username">DevOps username</label>
                    <input
                      id="username"
                      className="input login-page__input"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoFocus
                      placeholder="devops"
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
                      placeholder="••••••••"
                    />
                  </div>
                  <button type="submit" className="btn btn-primary login-page__submit login-page__submit--primary" disabled={loading}>
                    {loading ? 'Initiating…' : 'Initiate Session'}
                  </button>
                </>
              )}
            </form>
            {sso.enabled && (
              <>
                <div className="login-page__divider"><span>Or continue with identity provider</span></div>
                <div className="login-page__provider-grid">
                  <button type="button" className="login-page__provider-card" onClick={handleSSOLogin} disabled={loading || !sso.login_url}>
                    <span className="login-page__provider-label">{providerLabel(sso.provider)}</span>
                    <span className="login-page__provider-copy">
                      {sso.mode === 'required' ? 'Required access path' : 'Enterprise SSO'}
                    </span>
                  </button>
                </div>
              </>
            )}
            <p className="login-page__trust-copy">
              Run releases, triage incidents, and govern platform changes from one connected workspace.
            </p>
            <p className="login-page__hint">
              Users are created from the Admin portal.
            </p>
            </div>
          </main>
          <footer className="login-page__footer">
            <span>© {new Date().getFullYear()} SetuOps operations suite.</span>
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
