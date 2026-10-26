import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { AuthPipeline, pending2FAFromLoginResponse, resendLogin2FACode, type Pending2FA } from '@infragate/ui';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord } from '../lib/payload';
import { homeFor, pathAllowed, portalGrants } from '../lib/portalAccess';
import { consumeReturn, readChangeDraft } from '../lib/returnPath';
import { clearAuthNotice, peekAuthNotice } from '../lib/sessionExpiry';
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
  const [sessionExpired, setSessionExpired] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessCopied, setAccessCopied] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftSaved(readChangeDraft() || sessionStorage.getItem('opstrellis-auth-draft') === '1' || Boolean(sessionStorage.getItem('opstrellis-request-draft') || sessionStorage.getItem('opstrellis-incident-draft')));
    if (peekAuthNotice() !== 'expired') return;
    setSessionExpired(true);
    const clearNotice = window.setTimeout(() => {
      clearAuthNotice();
    }, 0);
    return () => window.clearTimeout(clearNotice);
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
    const account = meData.user;
    const grants = portalGrants(account);
    const canEnter = grants.requests || grants.daily || grants.operations || grants.cost || grants.infrastructure || grants.security || grants.records || grants.portalAccess;
    if (!canEnter) {
      setError('Sign-in was not accepted.');
      return;
    }
    localStorage.setItem(DEVOPS_TOKEN_KEY, sessionToken);
    if (typeof meData.token === 'string' && isSignedSessionToken(meData.token)) {
      localStorage.setItem(DEVOPS_TOKEN_KEY, meData.token.trim());
    }
    localStorage.setItem(DEVOPS_USER_KEY, JSON.stringify(account || {}));
    const next = consumeReturn();
    router.push(pathAllowed(next, grants) ? next : homeFor(grants));
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
    if (loading || !pending2fa || !otp.trim()) return;
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

  const submitLogin = async () => {
    if (loading) return;
    setError('');
    setCanRetry(false);
    setLoading(true);
    try {
      const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, portal: 'devops' }),
      });
      const loginData = await loginRes.json().catch(() => ({}));
      if (!loginRes.ok) {
        if (loginRes.status === 401) {
          setPassword('');
          setError('That username and password did not match. Check them and try again.');
          passwordRef.current?.focus();
        } else if (loginRes.status === 429) {
          setError('Too many sign-in attempts. Wait a minute, then try again.');
        } else if (loginRes.status === 403) {
          setError('Your account cannot sign in here. Ask your administrator to check your access.');
        } else {
          setError('OpsTrellis could not complete sign-in right now.');
          setCanRetry(true);
        }
        return;
      }
      const pending = pending2FAFromLoginResponse(loginData);
      if (pending) {
        setPending2fa(pending);
        setPassword('');
        return;
      }
      if (typeof loginData.token !== 'string' || !isSignedSessionToken(loginData.token)) {
        setError('OpsTrellis could not complete sign-in right now.');
        setCanRetry(true);
        return;
      }
      await finishDevOpsSession(loginData.token);
    } catch {
      setError('We could not reach OpsTrellis. Check your connection, then try again.');
      setCanRetry(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitLogin();
  };

  const accessRequestText = [
    'Hello, I need access to OpsTrellis.',
    `Username: ${username.trim() || '(my username)'}`,
    'Team:',
    'Project(s):',
    'Access needed (read / write):',
  ].join('\n');

  const copyAccessRequest = async () => {
    try {
      await navigator.clipboard.writeText(accessRequestText);
      setAccessCopied(true);
      window.setTimeout(() => setAccessCopied(false), 2500);
    } catch {
      setAccessCopied(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - OpsTrellis</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <p className="login-page__mark" aria-label="OpsTrellis">
              <img src="/brand/opstrellis-mark-dark.svg" alt="" aria-hidden width={44} height={44} />
              <span className="login-page__mark-word">OpsTrellis</span>
            </p>
            <h1 className="login-page__title">Check the work<br />before it moves.</h1>
            <p className="login-page__tagline">
              Requests, releases, and recovery stay in one place. Nothing moves until you confirm it.
            </p>
            <AuthPipeline />
          </div>
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <h2 className="login-page__card-title">Welcome back</h2>
            <p className="login-page__card-subtitle">Sign in to OpsTrellis.</p>
            {sessionExpired ? (
              <p className="alert" role="status">
                {draftSaved
                  ? 'Your session ended. Sign in to continue. Entries saved in this browser are still here. Passwords are not stored with them.'
                  : 'Your session expired. Sign in to return to the page you were using. Nothing you already saved was removed.'}
              </p>
            ) : null}
            {draftSaved && !sessionExpired ? (
              <p className="alert" role="status">A draft is saved in this browser. Sign in to continue it. Passwords are not stored with it.</p>
            ) : null}
            {error && (
              <div className="alert alert-error login-page__error" role="alert">
                <span>{error}</span>
                {canRetry && !pending2fa ? (
                  <button type="button" className="login-page__retry" onClick={() => void submitLogin()} disabled={loading}>
                    Try again
                  </button>
                ) : null}
              </div>
            )}
            {pending2fa ? (
              <form onSubmit={handleVerify2FA}>
                <p className="login-page__card-subtitle" style={{ marginBottom: '1rem' }}>
                  Two-factor authentication is on for this account. Enter the 6-digit code sent to <strong>{pending2fa.emailHint}</strong>. After it is accepted you return to the page you opened.
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
            <form onSubmit={handleSubmit} aria-busy={loading}>
              {sso.enabled && (
                <>
                  <button type="button" className="btn btn-secondary login-page__submit" onClick={handleSSOLogin} disabled={loading}>
                    Continue with {providerLabel(sso.provider)}
                  </button>
                  <p className="login-page__hint" style={{ marginTop: 12, marginBottom: 12 }}>
                    {sso.mode === 'required'
                      ? `${providerLabel(sso.provider)} is required for this portal. After sign-in you return to the page you opened.`
                      : `Or sign in with your username and password. ${providerLabel(sso.provider)} is optional.`}
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
                      name="username"
                      className="input"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoFocus
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      readOnly={loading}
                      placeholder="Enter your username"
                    />
                  </div>
                  <div className="form-group">
                    <div className="login-page__label-row">
                      <label className="label" htmlFor="password">Password</label>
                      <Link href="/forgot-password" className="login-page__link">
                        Forgot password?
                      </Link>
                    </div>
                    <div className="login-page__password">
                      <input
                        ref={passwordRef}
                        id="password"
                        name="password"
                        className="input"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        readOnly={loading}
                        placeholder="Enter your password"
                      />
                      <button
                        type="button"
                        className="login-page__reveal"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-pressed={showPassword}
                        aria-controls="password"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary login-page__submit" disabled={loading}>
                    {loading ? (
                      <>
                        <span className="login-page__spinner" aria-hidden />
                        Signing in…
                      </>
                    ) : 'Sign in'}
                  </button>
                </>
              )}
            </form>
            )}
            {!pending2fa ? (
              <div className="login-page__access">
                <button
                  type="button"
                  className="login-page__access-toggle"
                  aria-expanded={accessOpen}
                  aria-controls="login-access-help"
                  onClick={() => setAccessOpen((v) => !v)}
                >
                  Need access or help signing in?
                </button>
                {accessOpen ? (
                  <div id="login-access-help" className="login-page__access-panel">
                    <p>
                      Your OpsTrellis administrator adds people to groups and projects. Send them this request so they know
                      what to grant.
                    </p>
                    <pre className="login-page__access-text">{accessRequestText}</pre>
                    <button type="button" className="btn btn-secondary login-page__access-copy" onClick={() => void copyAccessRequest()}>
                      {accessCopied ? 'Copied' : 'Copy request'}
                    </button>
                    <p className="login-page__access-note" aria-live="polite">
                      Locked out or forgot your password? Use <Link href="/forgot-password" className="login-page__link">Forgot password</Link> first.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
