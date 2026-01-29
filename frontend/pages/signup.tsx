import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useToast } from '../context/ToastContext';

export default function Signup() {
  const router = useRouter();
  const { toast } = useToast();
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
      const response = await fetch(`${apiUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
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
      toast('Account created. Welcome!', 'success');
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
        <title>Sign Up - Infrastructure Portal</title>
      </Head>
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 50%, #cbd5e0 100%)',
        backgroundAttachment: 'fixed',
        padding: '20px'
      }}>
        <div className="card" style={{ 
          maxWidth: '450px', 
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h1 style={{ 
              fontSize: '32px', 
              fontWeight: 'bold',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom: '8px'
            }}>
              Infrastructure Portal
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Create a new account
            </p>
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
                placeholder="Choose a username"
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder="Enter your email"
              />
            </div>

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
                placeholder="Create a password (min 6 characters)"
              />
              <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                Password must be at least 6 characters
              </small>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ 
                width: '100%',
                padding: '14px',
                fontSize: '16px',
                fontWeight: '600',
                background: 'var(--primary-gradient)',
                boxShadow: '0 4px 6px -1px rgba(102, 126, 234, 0.3)',
                transition: 'all 0.2s ease'
              }}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span style={{ 
                    width: '16px', 
                    height: '16px', 
                    border: '2px solid rgba(255,255,255,0.3)', 
                    borderTop: '2px solid white',
                    borderRadius: '50%',
                    animation: 'spin 0.6s linear infinite',
                    display: 'inline-block'
                  }}></span>
                  Creating account...
                </span>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div style={{ 
            marginTop: '24px', 
            textAlign: 'center',
            paddingTop: '20px',
            borderTop: '1px solid var(--border-color)'
          }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              Already have an account?{' '}
              <Link href="/login" style={{ 
                color: 'var(--primary-color)', 
                textDecoration: 'none',
                fontWeight: '600'
              }}>
                Sign in here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
