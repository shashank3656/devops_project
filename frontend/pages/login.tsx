import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const router = useRouter();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (t === 'undefined' || t === 'null') {
      localStorage.removeItem('token');
      localStorage.removeItem('isAuthenticated');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = data.error || `Server returned ${response.status}`;
        setError(msg);
        toast(msg, 'error');
        return;
      }
      if (!data.token) {
        setError(data.error || 'Login failed');
        toast(data.error || 'Login failed', 'error');
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user || {}));
      localStorage.setItem('isAuthenticated', 'true');
      toast('Welcome back!', 'success');
      router.push('/home');
    } catch (err: any) {
      const msg = err.message || 'An error occurred';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - Infrastructure Portal</title>
      </Head>
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-title">Infrastructure Portal</h1>
            <p className="auth-subtitle">Sign in to your account</p>
          </div>

          {error && <div className="error">{error}</div>}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
                placeholder="Enter your username"
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="loading" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="auth-divider">
            <p className="auth-footer">
              Don&apos;t have an account? <Link href="/signup">Sign up here</Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
