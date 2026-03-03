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

interface OnboardingMilestone {
  key: string;
  title: string;
  detail: string;
  state: 'completed' | 'current' | 'upcoming' | 'attention';
  timestamp?: string;
}

interface OnboardingRequestSummary {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  pr_url: string;
  created_at: string;
  updated_at: string;
}

interface OnboardingProgress {
  user_id: number;
  username: string;
  email: string;
  user_type: string;
  role: string;
  verified: boolean;
  created_at: string;
  manager_username?: string;
  teams: Team[];
  requests_by_status: Record<string, number>;
  requests_total: number;
  submitted_requests: number;
  latest_request?: OnboardingRequestSummary | null;
  milestones: OnboardingMilestone[];
  next_action: string;
  completion_percent: number;
}

interface Team {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
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
  const [onboardingProgress, setOnboardingProgress] = useState<OnboardingProgress | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(true);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    try {
      if (!localStorage.getItem(ONBOARDING_KEY)) setShowOnboarding(true);
    } catch (_) {}
    fetchOnboardingProgress();
    fetchStats();
    fetchLogs();
  }, [router]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const totalRequests = stats?.total_requests ?? 0;

  const fetchOnboardingProgress = async () => {
    setOnboardingLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/api/me/onboarding-progress`, { headers });
      if (!res.ok) {
        setOnboardingProgress(null);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setOnboardingProgress(data.progress || null);
    } catch (_) {
      setOnboardingProgress(null);
    } finally {
      setOnboardingLoading(false);
    }
  };

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
                Start with the guided request form, use templates when you want a faster approved path, and follow every review step from Request History after submission.
              </p>
              <div className="onboarding-inline-list">
                <div className="onboarding-inline-list__item">
                  <strong>1. Pick a starting path</strong>
                  <span>Guided form, template, or custom JSON.</span>
                </div>
                <div className="onboarding-inline-list__item">
                  <strong>2. Submit with context</strong>
                  <span>Cloud, environment, team, and ownership details.</span>
                </div>
                <div className="onboarding-inline-list__item">
                  <strong>3. Track approvals</strong>
                  <span>Manager review, DevOps review, PR, and delivery status.</span>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-primary" onClick={dismissOnboarding}>
                  Start in workspace
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="portal-surface launchpad-hero">
          <div className="launchpad-hero__content">
            <div>
              <span className="portal-page__eyebrow">Start Here</span>
              <h1 className="launchpad-hero__title">Launch infrastructure requests with less guesswork</h1>
              <p className="launchpad-hero__subtitle">
                Choose a starting path, fill in the right delivery details once, and follow the request from approval through provisioning without leaving the portal.
              </p>
              <div className="launchpad-action-grid" style={{ marginTop: 22 }}>
                <Link href="/create-infrastructure/new" className="launchpad-action-card">
                  <strong>Start guided request</strong>
                  <p>Best for first-time users who want cloud and environment prompts step by step.</p>
                </Link>
                <Link href="/templates" className="launchpad-action-card">
                  <strong>Use an approved template</strong>
                  <p>Fastest route when your request fits an existing platform pattern.</p>
                </Link>
                <Link href="/custom-json" className="launchpad-action-card">
                  <strong>Submit custom JSON</strong>
                  <p>Bring an existing payload when you already know the exact request contract.</p>
                </Link>
                <Link href="/history" className="launchpad-action-card">
                  <strong>Reuse a previous request</strong>
                  <p>Open Request History to clone or resubmit an earlier request instead of starting from scratch.</p>
                </Link>
                <Link href="/history" className="launchpad-action-card">
                  <strong>Track current requests</strong>
                  <p>Review approvals, PR links, comments, and provisioning progress in one place.</p>
                </Link>
              </div>
            </div>

            <aside className="launchpad-hero__pulse">
              <span className="portal-page__eyebrow">First-Run Checklist</span>
              <strong>{statsLoading ? '...' : totalRequests}</strong>
              <p>Requests already tracked in your workspace.</p>
              <div className="launchpad-tips" style={{ marginTop: 18 }}>
                <div className="launchpad-tip">
                  <strong>Choose the right path</strong>
                  <p>Guided form for new work, template for standard work, JSON for advanced work.</p>
                </div>
                <div className="launchpad-tip">
                  <strong>Add review-ready details</strong>
                  <p>Team, environment, service, due date, and cloud context reduce approval delays.</p>
                </div>
                <div className="launchpad-tip">
                  <strong>Watch the request journey</strong>
                  <p>Use Request History after submit to follow comments, approvals, and PR activity.</p>
                </div>
                <div className="launchpad-tip">
                  <strong>Reuse before rebuilding</strong>
                  <p>History already supports clone and resubmit, which is faster for repeat requests.</p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="portal-surface onboarding-progress-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Onboarding Progress Tracker</span>
              <h2 className="portal-surface__title">See exactly where your onboarding stands</h2>
              <p className="portal-surface__subtitle">
                Follow account setup, team assignment, submission, review, and delivery without guessing which step is next.
              </p>
            </div>
            {onboardingProgress && (
              <div className="onboarding-progress-summary">
                <strong>{onboardingProgress.completion_percent}%</strong>
                <span>completion</span>
              </div>
            )}
          </div>
          {onboardingLoading ? (
            <div className="empty-state">Loading onboarding progress…</div>
          ) : onboardingProgress ? (
            <>
              <div className="onboarding-progress-grid">
                <article className="onboarding-progress-card">
                  <span className="onboarding-progress-card__label">Current step</span>
                  <strong>{onboardingProgress.next_action}</strong>
                  <p>
                    {onboardingProgress.verified
                      ? 'Account access is active.'
                      : 'Verification is still pending and may block request work.'}
                  </p>
                </article>
                <article className="onboarding-progress-card">
                  <span className="onboarding-progress-card__label">Teams assigned</span>
                  <strong>{onboardingProgress.teams.length}</strong>
                  <p>
                    {onboardingProgress.teams.length > 0
                      ? onboardingProgress.teams.map((team) => team.name).slice(0, 3).join(', ')
                      : 'No team assignment yet'}
                  </p>
                </article>
                <article className="onboarding-progress-card">
                  <span className="onboarding-progress-card__label">Requests submitted</span>
                  <strong>{onboardingProgress.submitted_requests}</strong>
                  <p>
                    {onboardingProgress.latest_request
                      ? `Latest: ${onboardingProgress.latest_request.cloud} ${onboardingProgress.latest_request.service} (${onboardingProgress.latest_request.status.replace(/_/g, ' ')})`
                      : 'No submitted requests yet'}
                  </p>
                </article>
              </div>

              <div className="onboarding-timeline-tracker">
                {onboardingProgress.milestones.map((milestone) => (
                  <article
                    key={milestone.key}
                    className={`onboarding-timeline-tracker__step onboarding-timeline-tracker__step--${milestone.state}`}
                  >
                    <div className="onboarding-timeline-tracker__marker" />
                    <div>
                      <div className="onboarding-timeline-tracker__topline">
                        <strong>{milestone.title}</strong>
                        <span className={`onboarding-state-badge onboarding-state-badge--${milestone.state}`}>
                          {milestone.state}
                        </span>
                      </div>
                      <p>{milestone.detail}</p>
                      {milestone.timestamp && (
                        <span className="onboarding-timeline-tracker__time">
                          {formatDateTime(milestone.timestamp)}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">Onboarding progress is not available right now.</div>
          )}
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
          <article className="portal-surface onboarding-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Onboarding Flow</span>
                <h2 className="portal-surface__title">What to do first</h2>
                <p className="portal-surface__subtitle">Follow this order when you are new to the portal or submitting a new request type.</p>
              </div>
            </div>
            <div className="onboarding-step-grid">
              <div className="onboarding-step">
                <span className="onboarding-step__index">01</span>
                <strong>Pick a request path</strong>
                <p>Use the guided form for a new build, a template for standard patterns, or custom JSON for advanced payloads.</p>
              </div>
              <div className="onboarding-step">
                <span className="onboarding-step__index">02</span>
                <strong>Prepare review context</strong>
                <p>Include team, environment, cloud, service name, timeline, and any dependencies before submission.</p>
              </div>
              <div className="onboarding-step">
                <span className="onboarding-step__index">03</span>
                <strong>Track after submit</strong>
                <p>Use Request History to follow manager review, DevOps action, PR progress, and final delivery updates.</p>
              </div>
            </div>
          </article>

          <article className="portal-surface onboarding-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Request Journey</span>
                <h2 className="portal-surface__title">What happens after you submit</h2>
                <p className="portal-surface__subtitle">The portal is designed so requesters always know the next review stage.</p>
              </div>
            </div>
            <div className="onboarding-timeline">
              <div className="onboarding-timeline__item">
                <strong>Draft and submit</strong>
                <p>Your request is validated and queued with the context needed for review.</p>
              </div>
              <div className="onboarding-timeline__item">
                <strong>Approval review</strong>
                <p>Manager and platform reviewers can approve, reject, or comment with follow-up changes.</p>
              </div>
              <div className="onboarding-timeline__item">
                <strong>PR and automation</strong>
                <p>The system opens the change path and records GitHub activity for the request timeline.</p>
              </div>
              <div className="onboarding-timeline__item">
                <strong>Provision and confirm</strong>
                <p>Status, activity, and final comments remain visible in History so the request stays traceable.</p>
              </div>
            </div>
          </article>
        </section>

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
