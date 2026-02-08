import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { maskDisplayValue } from '../lib/maskSensitive';

interface Stats {
  total_requests: number;
  by_cloud: Record<string, number>;
  by_status: Record<string, number>;
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

const ONBOARDING_KEY = 'infra-portal-onboarding-done';
const LOG_LIMIT = 15;

export default function Home() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
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
    try {
      if (!localStorage.getItem(ONBOARDING_KEY)) setShowOnboarding(true);
    } catch (_) {}
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

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch (_) {}
  };

  return (
    <>
      <Head>
        <title>Home - InfraGate</title>
        <meta name="description" content="Infrastructure request portal" />
      </Head>
      <div>
        {showOnboarding && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: 20,
            }}
            onClick={dismissOnboarding}
          >
            <div className="card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginBottom: 12 }}>Welcome</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                Create requests from <strong>New Request</strong>. Track them in <strong>History</strong>.
              </p>
              <button type="button" className="btn btn-primary" onClick={dismissOnboarding}>
                Get started
              </button>
            </div>
          </div>
        )}

        {/* Summary: one row, clear metrics */}
        {!statsLoading && stats && (
          <div className="home-stats-row">
            <div className="home-stat-card home-stat-card--primary">
              <div className="home-stat-value">{stats.total_requests}</div>
              <div className="home-stat-label">Total requests</div>
            </div>
            {Object.entries(stats.by_cloud || {}).slice(0, 3).map(([cloud, count]) => (
              <div key={cloud} className="home-stat-card">
                <div className="home-stat-value">{count}</div>
                <div className="home-stat-label">{cloud}</div>
              </div>
            ))}
          </div>
        )}

        {/* Activity: single card with Cloud + GitHub */}
        <div className="card">
          <h2 className="section-title">Activity</h2>
          {logsLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : cloudKeys.length === 0 && githubLogs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No activity yet. Create a request to see logs here.</p>
          ) : (
            <div className="home-activity">
              {cloudKeys.length > 0 && (
                <div className="home-activity-section">
                  <h3 className="home-activity-heading">Cloud</h3>
                  <ul className="home-activity-list">
                    {cloudKeys.map((cloud) => {
                      const entries = (cloudLogs[cloud] || []).slice(0, LOG_LIMIT);
                      const style = CLOUD_COLORS[cloud] || { bg: 'var(--primary-color)', color: '#fff' };
                      return entries.map((entry) => (
                        <li key={entry.id} className="home-activity-item">
                          <span className="home-activity-badge" style={{ background: style.bg, color: style.color }}>{cloud}</span>
                          <span>{entry.message}</span>
                          <span className="home-activity-meta">{entry.created_at}</span>
                        </li>
                      ));
                    })}
                  </ul>
                </div>
              )}
              {githubLogs.length > 0 && (
                <div className="home-activity-section">
                  <h3 className="home-activity-heading">GitHub</h3>
                  <ul className="home-activity-list">
                    {githubLogs.slice(0, LOG_LIMIT).map((entry) => (
                      <li key={entry.id} className="home-activity-item">
                        <span className="home-activity-meta">{entry.created_at}</span>
                        <span>{entry.message}</span>
                        {entry.details && <span className="home-activity-detail">{maskDisplayValue(entry.details)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(cloudKeys.length > 0 || githubLogs.length > 0) && (
                <p style={{ marginTop: 16, marginBottom: 0 }}>
                  <Link href="/history" className="btn btn-secondary btn-sm">View History</Link>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
