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
  const [signupSuccess, setSignupSuccess] = useState<{ email: string; otpForTesting?: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);

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

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || `Server returned ${response.status}`);
        return;
      }

      if (mode === 'signup') {
        setSignupSuccess({ email: data.email, otpForTesting: data.otp_for_testing });
        return;
      }

      if (!data.token) {
        setError(data.error || 'Login failed');
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user || {}));
      localStorage.setItem('isAuthenticated', 'true');
      router.push('/home');
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupSuccess?.email || !otp.trim()) {
      setError('Enter the 6-digit OTP');
      return;
    }
    setError('');
    setVerifyLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: signupSuccess.email, otp: otp.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Verification failed');
        return;
      }
      setSignupSuccess(null);
      setOtp('');
      setMode('login');
      setError('');
      // Redirect to login so user signs in with new account
      router.push('/login');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifyLoading(false);
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
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
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
            gap: '0', 
            marginBottom: '24px',
            background: 'var(--bg-gray-100)',
            borderRadius: '8px',
            padding: '4px'
          }}>
            <button
              onClick={() => {
                setMode('login');
                setError('');
                setSignupSuccess(null);
                setUsername('');
                setEmail('');
                setPassword('');
              }}
              style={{
                flex: 1,
                padding: '12px 20px',
                border: 'none',
                background: mode === 'login' ? 'var(--primary-gradient)' : 'transparent',
                color: mode === 'login' ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                borderRadius: '6px',
                fontWeight: mode === 'login' ? '600' : '500',
                transition: 'all 0.2s ease',
                fontSize: '15px'
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setMode('signup');
                setError('');
                setSignupSuccess(null);
                setUsername('');
                setEmail('');
                setPassword('');
              }}
              style={{
                flex: 1,
                padding: '12px 20px',
                border: 'none',
                background: mode === 'signup' ? 'var(--primary-gradient)' : 'transparent',
                color: mode === 'signup' ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                borderRadius: '6px',
                fontWeight: mode === 'signup' ? '600' : '500',
                transition: 'all 0.2s ease',
                fontSize: '15px'
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

          {signupSuccess ? (
            <div style={{ marginTop: '8px' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
                Account created. Enter the 6-digit OTP sent to <strong>{signupSuccess.email}</strong> to verify.
              </p>
              {signupSuccess.otpForTesting && (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  (Testing: OTP is <strong>{signupSuccess.otpForTesting}</strong>)
                </p>
              )}
              <form onSubmit={handleVerifyOtp}>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={verifyLoading}
                  style={{ marginBottom: '16px', width: '100%', padding: '12px', fontSize: '18px', letterSpacing: '4px', textAlign: 'center' }}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={verifyLoading || otp.length !== 6}
                  style={{ width: '100%', padding: '14px' }}
                >
                  {verifyLoading ? 'Verifying...' : 'Verify & sign in'}
                </button>
              </form>
              <button
                type="button"
                onClick={() => { setSignupSuccess(null); setOtp(''); setError(''); }}
                style={{ marginTop: '12px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}
              >
                Back to sign up
              </button>
            </div>
          ) : (
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
                  {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                </span>
              ) : (
                mode === 'login' ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>
          )}
        </div>
      </div>
    </>
  );
}
