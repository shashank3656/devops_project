import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useToast } from '../context/ToastContext';

export default function VerifyRequired() {
  const router = useRouter();
  const { toast } = useToast();
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const u = localStorage.getItem('user');
    if (u) {
      try {
        const parsed = JSON.parse(u);
        if (parsed?.email) setEmail(parsed.email);
      } catch (_) {}
    }
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
    }
  }, [router]);

  const handleResend = async () => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setResending(true);
    try {
      const res = await fetch(`${apiUrl}/api/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'ok') {
        toast(data.message || 'Verification email sent. Check your inbox.', 'success');
      } else {
        toast(data.error || 'Failed to resend', 'error');
      }
    } catch (_) {
      toast('Failed to send verification email', 'error');
    } finally {
      setResending(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('isAuthenticated');
    router.push('/login');
  };

  return (
    <>
      <Head>
        <title>Verify your email - Infrastructure Portal</title>
      </Head>
      <div className="auth-page">
        <div className="auth-card" style={{ maxWidth: 440 }}>
          <div className="auth-header">
            <h1 className="auth-title">Verify your email</h1>
            <p className="auth-subtitle">
              Your account is not verified yet. Check your email for a verification link, or request a new one.
            </p>
          </div>
          {email && (
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
              We sent a link to <strong>{email}</strong>
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleResend}
              disabled={resending}
              style={{ padding: '12px 20px' }}
            >
              {resending ? 'Sending…' : 'Resend verification email'}
            </button>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Already verified? <Link href="/home">Go to home</Link> to refresh your session.
            </p>
            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 8, paddingTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={handleLogout} style={{ padding: '10px 16px' }}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
