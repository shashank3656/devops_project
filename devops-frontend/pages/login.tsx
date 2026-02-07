import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

export default function DevOpsLogin() {
  const router = useRouter();
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
    } catch {
      setError(`Cannot connect to backend at ${apiUrl}. Ensure it is running.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - InfraGate DevOps</title>
      </Head>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 420, width: '100%' }}>
          <h1 style={{ marginBottom: 8, fontSize: 24, fontWeight: 700 }}>InfraGate DevOps</h1>
          <p style={{ marginBottom: 24, fontSize: 14, color: 'var(--color-text-muted)' }}>
            Sign in with your DevOps account. Users are created from the Admin portal.
          </p>
          {error && (
            <div className="alert alert-error" role="alert">{error}</div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="label" htmlFor="username">Username</label>
              <input id="username" className="input" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ padding: '10px 24px' }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
