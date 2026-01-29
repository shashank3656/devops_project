import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
interface Stats {
  total_requests: number;
  by_cloud: Record<string, number>;
  by_status: Record<string, number>;
  by_env: Record<string, number>;
}

export default function Home() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchStats();
  }, [router]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/api/stats`, { headers });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats || null);
      }
    } catch (_) {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Infrastructure Portal - Home</title>
        <meta name="description" content="Create infrastructure resources" />
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          {/* Dashboard stats */}
          {!statsLoading && stats && (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: '20px', 
              marginBottom: '32px' 
            }}>
              <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--primary-color)' }}>
                  {stats.total_requests}
                </div>
                <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Total Requests</div>
              </div>
              {Object.entries(stats.by_cloud).slice(0, 3).map(([cloud, count]) => (
                <div key={cloud} className="card" style={{ padding: '24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--text-primary)' }}>{count}</div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>{cloud}</div>
                </div>
              ))}
              {Object.entries(stats.by_status).slice(0, 2).map(([status, count]) => (
                <div key={status} className="card" style={{ padding: '24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--text-primary)' }}>{count}</div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '4px', textTransform: 'capitalize' }}>{status}</div>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
            <h2 style={{ fontSize: '36px', marginBottom: '20px', color: 'var(--text-primary)', fontWeight: '700' }}>
              Welcome to Infrastructure Portal
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '48px', fontSize: '18px', lineHeight: '1.6', maxWidth: '600px', margin: '0 auto 48px' }}>
              Manage your cloud infrastructure across AWS, GCP, and Azure with ease.
              Create new infrastructure requests or view your request history.
            </p>
            <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => router.push('/create-infrastructure')}
                className="btn btn-primary"
                style={{ padding: '16px 40px', fontSize: '18px', fontWeight: '600', minWidth: '220px' }}
              >
                ➕ New Request
              </button>
              <button
                onClick={() => router.push('/history')}
                className="btn btn-secondary"
                style={{ padding: '16px 40px', fontSize: '18px', fontWeight: '600', minWidth: '220px' }}
              >
                📜 View History
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
