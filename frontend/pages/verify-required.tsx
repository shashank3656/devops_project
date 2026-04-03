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
        <title>Verify Your Email - SetuOps</title>
      </Head>
      <div className="auth-page">
        <div className="auth-card auth-card--compact">
          <div className="auth-header">
            <h1 className="auth-title">Verify your email</h1>
            <p className="auth-subtitle">
              Your account is not verified yet. Check your email for a verification link, or request a new one.
            </p>
          </div>
          {email && (
            <p className="auth-note">
              We sent a link to <strong>{email}</strong>
            </p>
          )}
          <div className="auth-stack">
            <button
              type="button"
              className="btn btn-primary auth-action-btn"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? 'Sending…' : 'Resend verification email'}
            </button>
            <p className="auth-helper-copy">
              Already verified? <Link href="/home">Go to home</Link> to refresh your session.
            </p>
            <div className="auth-divider auth-divider--tight auth-divider--left">
              <button type="button" className="btn btn-secondary auth-action-btn auth-action-btn--secondary" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
