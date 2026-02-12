import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

export default function DevOpsLogin() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
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
        setError(meData.error || 'This portal is for DevOps users only. Create a DevOps user from the Admin portal.');
        return;
      }
      if (meData.user?.user_type !== 'devops_user') {
        setError('This portal is for DevOps users only.');
        return;
      }
      localStorage.setItem(DEVOPS_TOKEN_KEY, loginData.token);
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
        <title>Login - DevOps</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">DevOps</h1>
            <p className="login-page__tagline">
              Approve and manage infrastructure requests. Users are created from the Admin portal.
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
            <p className="login-page__card-subtitle">Sign in with your DevOps account</p>
            {error && (
              <div className="alert alert-error" role="alert">{error}</div>
            )}
            <form onSubmit={handleSubmit}>
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
            </form>
            <p className="login-page__hint">
              Users are created from the Admin portal.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
