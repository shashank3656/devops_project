import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { maskDisplayValue } from '../lib/maskSensitive';

interface Stats {
  total_requests: number;
  by_cloud: Record<string, number>;
  by_status: Record<string, number>;
  by_env: Record<string, number>;
}

interface CloudLogEntry {
  id: number;
  message: string;
  team: string;
  env: string;
  service: string;
  pr_url: string;
  created_at: string;
}

interface GitHubLogEntry {
  id: number;
  event_type: string;
  message: string;
  details: string;
  created_at: string;
}

const CLOUD_COLORS: Record<string, { bg: string; color: string }> = {
  AWS: { bg: 'var(--aws-color)', color: '#fff' },
  GCP: { bg: 'var(--gcp-color)', color: '#fff' },
  Azure: { bg: 'var(--azure-color)', color: '#fff' },
};

export default function Home() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [cloudLogs, setCloudLogs] = useState<Record<string, CloudLogEntry[]>>({});
  const [githubLogs, setGithubLogs] = useState<GitHubLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchStats();
    fetchLogs();
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

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;
      const [cloudRes, githubRes] = await Promise.all([
        fetch(`${apiUrl}/api/logs/cloud`, { headers }),
        fetch(`${apiUrl}/api/logs/github`, { headers }),
      ]);
      if (cloudRes.ok) {
        const data = await cloudRes.json();
        setCloudLogs(data.clouds || {});
      }
      if (githubRes.ok) {
        const data = await githubRes.json();
        setGithubLogs(data.logs || []);
      }
    } catch (_) {
      setCloudLogs({});
      setGithubLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const cloudOrder = ['AWS', 'GCP', 'Azure'];
  const cloudKeys = Object.keys(cloudLogs).sort((a, b) => {
    const ai = cloudOrder.indexOf(a);
    const bi = cloudOrder.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  return (
    <>
      <Head>
        <title>InfraGate - Home</title>
        <meta name="description" content="Create infrastructure resources" />
      </Head>
      <div>
        {/* Dashboard stats */}
        {!statsLoading && stats && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '20px',
            marginBottom: '32px',
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

        {/* Cloud activity logs (by cloud name) */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Cloud activity logs
          </h2>
          {logsLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading logs...</p>
          ) : cloudKeys.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No cloud activity yet. Create a request to see logs here.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {cloudKeys.map((cloud) => {
                const entries = cloudLogs[cloud] || [];
                const style = CLOUD_COLORS[cloud] || { bg: 'var(--primary-color)', color: '#fff' };
                return (
                  <div key={cloud}>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        marginBottom: '8px',
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-md)',
                        background: style.bg,
                        color: style.color,
                        display: 'inline-block',
                      }}
                    >
                      {cloud}
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {entries.slice(0, 20).map((entry) => (
                        <li
                          key={entry.id}
                          style={{
                            padding: '10px 12px',
                            borderBottom: '1px solid var(--border-color)',
                            fontSize: '14px',
                            color: 'var(--text-primary)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px',
                          }}
                        >
                          <span>{entry.message}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{entry.created_at}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* GitHub log */}
        <div className="card">
          <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            GitHub log
          </h2>
          {logsLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading GitHub log...</p>
          ) : githubLogs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No GitHub activity yet. Creating a PR will add entries here.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '400px', overflowY: 'auto' }}>
              {githubLogs.map((entry) => (
                <li
                  key={entry.id}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border-color)',
                    fontSize: '14px',
                    color: 'var(--text-primary)',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', marginRight: '12px', fontSize: '13px' }}>{entry.created_at}</span>
                  <span style={{ fontWeight: 500 }}>{entry.message}</span>
                  {entry.details && (
                    <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>{maskDisplayValue(entry.details)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
