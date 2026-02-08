import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

export default function DevOpsVerifyRequired() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    const u = localStorage.getItem(DEVOPS_USER_KEY);
    if (u) {
      try {
        const parsed = JSON.parse(u);
        if (parsed?.email) setEmail(parsed.email);
      } catch (_) {}
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
    }
  }, [router]);

  const handleResend = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') return;
    setResending(true);
    try {
      const res = await fetch(`${apiUrl}/api/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'ok') {
        alert(data.message || 'Verification email sent. Check your inbox.');
      } else {
        alert(data.error || 'Failed to resend');
      }
    } catch (_) {
      alert('Failed to send verification email');
    } finally {
      setResending(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.push('/login');
  };

  return (
    <>
      <Head>
        <title>Verify your email - InfraGate DevOps</title>
      </Head>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 440, width: '100%' }}>
          <h1 style={{ marginBottom: 8, fontSize: 24, fontWeight: 700 }}>Verify your email</h1>
          <p style={{ marginBottom: 24, fontSize: 14, color: 'var(--color-text-muted)' }}>
            Your account is not verified yet. Check your email for a verification link, or request a new one.
          </p>
          {email && (
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 16 }}>
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
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              Already verified? <a href="/dashboard" onClick={(e) => { e.preventDefault(); router.push('/dashboard'); }}>Go to dashboard</a> to refresh.
            </p>
            <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 8, paddingTop: 16 }}>
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
