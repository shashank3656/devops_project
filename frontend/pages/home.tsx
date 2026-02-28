import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { maskDisplayValue } from '../lib/maskSensitive';
import { SITE_NAME } from '../lib/site';

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

const CLOUD_COLORS: Record<string, string> = {
  AWS: 'portal-badge portal-badge--warning',
  GCP: 'portal-badge portal-badge--neutral',
  Azure: 'portal-badge portal-badge--success',
};

const ONBOARDING_KEY = 'infra-portal-onboarding-done';
const LOG_LIMIT = 15;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

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
      if (token && token !== 'undefined') headers.Authorization = `Bearer ${token}`;
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
      if (token && token !== 'undefined') headers.Authorization = `Bearer ${token}`;
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
        <title>Home - {SITE_NAME}</title>
        <meta name="description" content="Infrastructure request portal" />
      </Head>

      <div className="portal-page">
        {showOnboarding && (
          <div className="modal-overlay" onClick={dismissOnboarding}>
            <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">Welcome to {SITE_NAME}</h3>
              <p className="modal-body">
                Use Create Infrastructure to launch changes, Templates to reuse approved patterns, and Request History to review every request state.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-primary" onClick={dismissOnboarding}>
                  Enter workspace
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="portal-surface launchpad-hero">
          <div className="launchpad-hero__content">
            <div>
              <span className="portal-page__eyebrow">Dashboard</span>
              <h1 className="launchpad-hero__title">User Dashboard</h1>
              <p className="launchpad-hero__subtitle">
                Build new requests, reuse trusted templates, and track request movement across cloud and GitHub from one operating view.
              </p>
              <div className="launchpad-action-grid" style={{ marginTop: 22 }}>
                <Link href="/create-infrastructure/new" className="launchpad-action-card">
                  <strong>Open Create Infrastructure</strong>
                  <p>Start a fresh infrastructure request with guided cloud selection.</p>
                </Link>
                <Link href="/templates" className="launchpad-action-card">
                  <strong>Browse Templates</strong>
                  <p>Use validated starting points for repeatable platform work.</p>
                </Link>
                <Link href="/custom-json" className="launchpad-action-card">
                  <strong>Submit custom JSON</strong>
                  <p>Paste or adapt an existing request payload and move straight to review.</p>
                </Link>
                <Link href="/history" className="launchpad-action-card">
                  <strong>Open Request History</strong>
                  <p>Review statuses, PR links, change history, and operator comments.</p>
                </Link>
              </div>
            </div>

            <aside className="launchpad-hero__pulse">
              <span className="portal-page__eyebrow">Request Overview</span>
              <strong>{statsLoading ? '...' : stats?.total_requests ?? 0}</strong>
              <p>Total requests tracked across your workspace.</p>
              <div className="launchpad-tips" style={{ marginTop: 18 }}>
                <div className="launchpad-tip">
                  <strong>Templates first</strong>
                  <p>Use approved templates to reduce back-and-forth during review.</p>
                </div>
                <div className="launchpad-tip">
                  <strong>Track in timeline</strong>
                  <p>Review comments, diffs, and PR links before raising follow-up work.</p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {!statsLoading && stats && (
          <section className="portal-stat-grid">
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Total requests</span>
              <span className="portal-stat-card__value">{stats.total_requests}</span>
              <p className="portal-stat-card__copy">All requests in your accessible scope.</p>
            </article>
            {Object.entries(stats.by_cloud || {}).slice(0, 3).map(([cloud, count]) => (
              <article key={cloud} className="portal-stat-card">
                <span className="portal-stat-card__label">{cloud}</span>
                <span className="portal-stat-card__value">{count}</span>
                <p className="portal-stat-card__copy">Requests routed through {cloud}.</p>
              </article>
            ))}
          </section>
        )}

        <section className="portal-grid">
          <article className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Cloud activity</span>
                <h2 className="portal-surface__title">Recent platform events</h2>
                <p className="portal-surface__subtitle">Latest actions emitted by your infrastructure requests.</p>
              </div>
              <Link href="/history" className="btn btn-secondary btn-sm">
                Open timeline
              </Link>
            </div>

            {logsLoading ? (
              <div className="empty-state">Loading activity...</div>
            ) : cloudKeys.length === 0 ? (
              <div className="empty-state">No cloud activity yet. Create a request to populate this feed.</div>
            ) : (
              <div className="launchpad-activity-list">
                {cloudKeys.flatMap((cloud) =>
                  (cloudLogs[cloud] || []).slice(0, LOG_LIMIT).map((entry) => (
                    <div key={`${cloud}-${entry.id}`} className="launchpad-activity-item">
                      <div>
                        <span className={CLOUD_COLORS[cloud] || 'portal-badge portal-badge--neutral'}>{cloud}</span>
                        <strong style={{ display: 'block', marginTop: 10 }}>{entry.message}</strong>
                        <span>{entry.team} / {entry.env} / {entry.service}</span>
                      </div>
                      <small>{formatDateTime(entry.created_at)}</small>
                    </div>
                  )),
                )}
              </div>
            )}
          </article>

          <article className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">GitHub trace</span>
                <h2 className="portal-surface__title">Automation feedback</h2>
                <p className="portal-surface__subtitle">Recent GitHub-side events for submitted requests.</p>
              </div>
              <Link href="/notifications" className="btn btn-secondary btn-sm">
                View alerts
              </Link>
            </div>

            {logsLoading ? (
              <div className="empty-state">Loading GitHub events...</div>
            ) : githubLogs.length === 0 ? (
              <div className="empty-state">No GitHub activity recorded yet.</div>
            ) : (
              <div className="launchpad-activity-list">
                {githubLogs.slice(0, LOG_LIMIT).map((entry) => (
                  <div key={entry.id} className="launchpad-activity-item">
                    <div>
                      <span className="portal-badge portal-badge--neutral">{entry.event_type || 'github'}</span>
                      <strong style={{ display: 'block', marginTop: 10 }}>{entry.message}</strong>
                      {entry.details && <span>{maskDisplayValue(entry.details)}</span>}
                    </div>
                    <small>{formatDateTime(entry.created_at)}</small>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      </div>
    </>
  );
}
