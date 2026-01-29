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
  const [signupDone, setSignupDone] = useState<{ email: string; otpForTesting?: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);

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

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || `Server returned ${response.status}`);
        toast(data.error || 'Signup failed', 'error');
        return;
      }

      // Signup does not return a token; show OTP verification step
      setSignupDone({ email: data.email, otpForTesting: data.otp_for_testing });
      toast('Account created. Enter the OTP to verify.', 'success');
    } catch (err: any) {
      const msg = err.message || 'An error occurred';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupDone?.email || !otp.trim()) {
      setError('Enter the 6-digit OTP');
      toast('Enter the 6-digit OTP', 'error');
      return;
    }
    setError('');
    setVerifyLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: signupDone.email, otp: otp.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Verification failed');
        toast(data.error || 'Verification failed', 'error');
        return;
      }
      toast('Email verified. You can now log in.', 'success');
      router.push('/login');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      toast('Verification failed', 'error');
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Sign Up - Infrastructure Portal</title>
      </Head>
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-title">Infrastructure Portal</h1>
            <p className="auth-subtitle">Create a new account</p>
          </div>

          {error && <div className="error">{error}</div>}

          {signupDone ? (
            <div className="auth-form">
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
                Enter the 6-digit OTP sent to <strong>{signupDone.email}</strong>.
              </p>
              {signupDone.otpForTesting && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  (Testing: OTP is <strong>{signupDone.otpForTesting}</strong>)
                </p>
              )}
              <form onSubmit={handleVerifyOtp}>
                <div className="form-group">
                  <label htmlFor="otp">OTP</label>
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="input"
                    placeholder="000000"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    disabled={verifyLoading}
                    style={{ letterSpacing: 6, textAlign: 'center', fontSize: 18 }}
                  />
                </div>
                <button type="submit" className="auth-btn" disabled={verifyLoading || otp.length !== 6}>
                  {verifyLoading ? 'Verifying...' : 'Verify & sign in'}
                </button>
              </form>
              <button
                type="button"
                onClick={() => { setSignupDone(null); setOtp(''); setError(''); }}
                style={{ marginTop: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}
              >
                Back to sign up
              </button>
            </div>
          ) : (
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
                placeholder="Choose a username"
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder="Enter your email"
                autoComplete="email"
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
                minLength={6}
                disabled={loading}
                placeholder="Create a password (min 6 characters)"
                autoComplete="new-password"
              />
              <span className="auth-hint">Password must be at least 6 characters</span>
            </div>
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="loading" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Creating account...
                </span>
              ) : (
                'Create Account'
              )}
            </button>
          </form>
          )}

          <div className="auth-divider">
            <p className="auth-footer">
              Already have an account? <Link href="/login">Sign in here</Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
