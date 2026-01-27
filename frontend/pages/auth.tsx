import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

type AuthMode = 'login' | 'signup';

export default function Auth() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const body = mode === 'login' 
        ? { username, password }
        : { username, email, password };

      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server returned ${response.status}`);
      }

      const data = await response.json();
      
      // Store auth data
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('isAuthenticated', 'true');
      
      // Redirect to home
      router.push('/home');
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>{mode === 'login' ? 'Login' : 'Sign Up'} - Infrastructure Portal</title>
      </Head>
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '20px'
      }}>
        <div className="card" style={{ maxWidth: '400px', width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h1 style={{ 
              fontSize: '32px', 
              fontWeight: 'bold',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom: '8px'
            }}>
              Infrastructure Portal
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
            </p>
          </div>

          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            marginBottom: '24px',
            borderBottom: '1px solid var(--border-color)'
          }}>
            <button
              onClick={() => {
                setMode('login');
                setError('');
              }}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                background: mode === 'login' ? 'var(--primary-color)' : 'transparent',
                color: mode === 'login' ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                borderRadius: '4px 4px 0 0',
                fontWeight: mode === 'login' ? '600' : '400'
              }}
            >
              Login
            </button>
            <button
              onClick={() => {
                setMode('signup');
                setError('');
              }}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                background: mode === 'signup' ? 'var(--primary-color)' : 'transparent',
                color: mode === 'signup' ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                borderRadius: '4px 4px 0 0',
                fontWeight: mode === 'signup' ? '600' : '400'
              }}
            >
              Sign Up
            </button>
          </div>

          {error && (
            <div className="error" style={{ marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {mode === 'signup' && (
              <div style={{ marginBottom: '16px' }}>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            )}

            <div style={{ marginBottom: '24px' }}>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                disabled={loading}
              />
              {mode === 'signup' && (
                <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                  Password must be at least 6 characters
                </small>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%' }}
            >
              {loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Sign Up'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
