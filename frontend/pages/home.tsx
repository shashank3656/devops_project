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

interface ProjectPortfolioItem {
  id: number;
  name: string;
  code: string;
  status: string;
  onboarding_stage?: string;
  ready_for_requests?: boolean;
  service_count?: number;
  team_count?: number;
  request_count?: number;
  pending_request_count?: number;
  environments: string[];
  clouds: string[];
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
  const [projects, setProjects] = useState<ProjectPortfolioItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

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
    fetchProjects();
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

  const fetchProjects = async () => {
    setProjectsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/api/me/projects`, { headers });
      if (!res.ok) {
        setProjects([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (_) {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
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
        setGithubLogs(Array.isArray(data?.logs) ? data.logs : []);
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
                Use New Request for step-by-step help, choose a template for common work, and check My Requests after you submit.
              </p>
              <div className="onboarding-inline-list">
                <div className="onboarding-inline-list__item">
                  <strong>1. Choose how to start</strong>
                  <span>Guided form, template, or advanced JSON.</span>
                </div>
                <div className="onboarding-inline-list__item">
                  <strong>2. Fill in the basics</strong>
                  <span>Team, environment, service, and due date.</span>
                </div>
                <div className="onboarding-inline-list__item">
                  <strong>3. Follow updates</strong>
                  <span>Reviews, comments, PR activity, and final delivery.</span>
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
              <span className="portal-page__eyebrow">Start a Request</span>
              <h1 className="launchpad-hero__title">Start your next request</h1>
              <p className="launchpad-hero__subtitle">
                Choose the easiest path, send the request once, and follow it from review to delivery in one place.
              </p>
              <div className="launchpad-action-grid" style={{ marginTop: 22 }}>
                <Link href="/create-infrastructure/new" className="launchpad-action-card">
                  <strong>Start a new request</strong>
                  <p>Use the guided form when you want the safest starting point.</p>
                </Link>
                <Link href="/templates" className="launchpad-action-card">
                  <strong>Use a template</strong>
                  <p>Choose this when your work matches a standard setup.</p>
                </Link>
                <Link href="/history" className="launchpad-action-card">
                  <strong>Check request progress</strong>
                  <p>See reviews, comments, PR links, and delivery updates.</p>
                </Link>
                <Link href="/custom-json" className="launchpad-action-card">
                  <strong>Advanced JSON</strong>
                  <p>Use this only when you already have the full request payload prepared.</p>
                </Link>
              </div>
            </div>

            <aside className="launchpad-hero__pulse">
              <span className="portal-page__eyebrow">Today</span>
              <strong>{onboardingProgress?.next_action || 'Start with a new request'}</strong>
              <p>
                {onboardingProgress?.latest_request
                  ? `Latest request: ${onboardingProgress.latest_request.cloud} ${onboardingProgress.latest_request.service}`
                  : 'You can start with the guided form or a template.'}
              </p>
              <div className="launchpad-hero__metrics" style={{ marginTop: 18 }}>
                <div className="launchpad-hero__metric">
                  <span>Requests</span>
                  <strong>{statsLoading ? '...' : totalRequests}</strong>
                </div>
                <div className="launchpad-hero__metric">
                  <span>Teams</span>
                  <strong>{onboardingProgress?.teams.length ?? 0}</strong>
                </div>
                <div className="launchpad-hero__metric">
                  <span>Submitted</span>
                  <strong>{onboardingProgress?.submitted_requests ?? 0}</strong>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="portal-surface onboarding-progress-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Setup Progress</span>
              <h2 className="portal-surface__title">See what is ready and what is still waiting</h2>
              <p className="portal-surface__subtitle">
                Check account access, team assignment, and first-request progress without guessing what comes next.
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
                  <span className="onboarding-progress-card__label">What happens next</span>
                  <strong>{onboardingProgress.next_action}</strong>
                  <p>
                    {onboardingProgress.verified
                      ? 'Your account is ready to use.'
                      : 'Email verification is still pending, so some actions may stay blocked.'}
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
                      ? `Latest request: ${onboardingProgress.latest_request.cloud} ${onboardingProgress.latest_request.service} (${onboardingProgress.latest_request.status.replace(/_/g, ' ')})`
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

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Projects</span>
              <h2 className="portal-surface__title">Projects available to you</h2>
              <p className="portal-surface__subtitle">These projects decide which environments, clouds, and services you can use.</p>
            </div>
            <Link href="/my-projects" className="btn btn-secondary btn-sm">
              Open My Projects
            </Link>
          </div>
          {projectsLoading ? (
            <div className="empty-state">Loading assigned projects...</div>
          ) : projects.length === 0 ? (
            <div className="empty-state">No projects are assigned to your teams yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {projects.slice(0, 3).map((project) => (
                <article key={project.id} className="request-choice-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div>
                      <strong>{project.name}</strong>
                      <p style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 13 }}>{project.code}</p>
                    </div>
                    <span className="portal-pill">{project.onboarding_stage || 'configured'}</span>
                  </div>
                  <p style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
                    {project.ready_for_requests ? 'Ready for requests' : 'Setup still in progress'} · {project.service_count ?? 0} services · {project.pending_request_count ?? 0} pending
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {project.environments.slice(0, 3).map((environment) => (
                      <span key={`${project.id}-${environment}`} className="portal-pill">{environment}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                    <Link href={`/my-projects/${project.id}`} className="btn btn-secondary btn-sm">View details</Link>
                    <Link href={`/select-service?project_id=${project.id}`} className="btn btn-primary btn-sm">Request service</Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="portal-grid">
          <article className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Recent Activity</span>
                <h2 className="portal-surface__title">Latest request activity</h2>
                <p className="portal-surface__subtitle">Recent updates linked to your requests.</p>
              </div>
              <Link href="/history" className="btn btn-secondary btn-sm">
                Open My Requests
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
              <Link href="/history" className="btn btn-secondary btn-sm">
                View updates
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
