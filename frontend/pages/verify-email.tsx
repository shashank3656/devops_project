import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

export default function VerifyEmail() {
  const router = useRouter();
  const { token } = router.query;
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    if (!token || typeof token !== 'string') {
      setStatus('error');
      setMessage('Invalid verification link.');
      return;
    }
    fetch(`${apiUrl}/api/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.status === 'ok') {
          setStatus('success');
          setMessage(data.message || 'Email verified successfully.');
        } else {
          setStatus('error');
          setMessage(data.error || 'Verification failed or link expired.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Could not reach server.');
      });
  }, [token, apiUrl]);

  return (
    <>
      <Head>
        <title>Verify Email - Infrastructure Portal</title>
      </Head>
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-title">Email Verification</h1>
            <p className="auth-subtitle">
              {status === 'loading' && 'Verifying your email...'}
              {status === 'success' && 'Done'}
              {status === 'error' && 'Verification failed'}
            </p>
          </div>
          {status === 'loading' && (
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <span className="loading" style={{ width: 32, height: 32, borderWidth: 3, display: 'inline-block' }} />
            </div>
          )}
          {status === 'success' && (
            <div className="success" style={{ marginBottom: '24px' }}>
              {message}
            </div>
          )}
          {status === 'error' && (
            <div className="error" style={{ marginBottom: '24px' }}>
              {message}
            </div>
          )}
          <div className="auth-divider">
            <p className="auth-footer">
              <Link href="/login">Sign in</Link>
              {' · '}
              <Link href="/home">Home</Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
