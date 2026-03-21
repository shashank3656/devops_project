import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const WEEK_IN_MS = 7 * DAY_IN_MS;

interface Ticket {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  pr_url: string;
  application_id: string;
  created_at: string;
  updated_at: string;
}

interface DashboardStats {
  pending_approval: number;
  in_progress: number;
}

interface ProjectDashboardItem {
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
}

interface ProjectAnalyticsDistributionItem {
  key: string;
  label: string;
  count: number;
}

interface ProjectAnalyticsProjectItem {
  id: number;
  name: string;
  code: string;
  status: string;
  stage: string;
  requests: number;
  pending: number;
  completed: number;
  services: number;
  teams: number;
}

interface ProjectAnalytics {
  summary: {
    project_count: number;
    ready_count: number;
    needs_setup_count: number;
    archived_count: number;
    total_request_count: number;
    pending_request_count: number;
    completed_request_count: number;
    active_user_count: number;
    mapped_team_count: number;
  };
  environment_request_distribution: ProjectAnalyticsDistributionItem[];
  cloud_request_distribution: ProjectAnalyticsDistributionItem[];
  service_request_distribution: ProjectAnalyticsDistributionItem[];
  risk_distribution: ProjectAnalyticsDistributionItem[];
  lead_time: {
    average_hours: number;
    completed_requests: number;
  };
  top_projects_by_requests: ProjectAnalyticsProjectItem[];
  approval_bottlenecks: ProjectAnalyticsProjectItem[];
  top_risk_projects: ProjectAnalyticsProjectItem[];
}

function normalizeProjectAnalytics(value: Partial<ProjectAnalytics> | null | undefined): ProjectAnalytics | null {
  if (!value || !value.summary) {
    return null;
  }
  return {
    summary: value.summary,
    environment_request_distribution: Array.isArray(value.environment_request_distribution) ? value.environment_request_distribution : [],
    cloud_request_distribution: Array.isArray(value.cloud_request_distribution) ? value.cloud_request_distribution : [],
    service_request_distribution: Array.isArray(value.service_request_distribution) ? value.service_request_distribution : [],
    risk_distribution: Array.isArray(value.risk_distribution) ? value.risk_distribution : [],
    lead_time: value.lead_time || {
      average_hours: 0,
      completed_requests: 0,
    },
    top_projects_by_requests: Array.isArray(value.top_projects_by_requests) ? value.top_projects_by_requests : [],
    approval_bottlenecks: Array.isArray(value.approval_bottlenecks) ? value.approval_bottlenecks : [],
    top_risk_projects: Array.isArray(value.top_risk_projects) ? value.top_risk_projects : [],
  };
}

interface DevOpsTeam {
  id: number;
  name: string;
  slug: string;
  team_type: string;
}

interface TeamSummary {
  team: string;
  in_progress: number;
  completed: number;
  rejected: number;
  pending_approval: number;
  other: number;
  total: number;
}

const STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Pending approval',
  pending_user_manager_approval: 'Pending user manager',
  pending_devops_approval: 'Pending DevOps',
  in_progress: 'In progress',
  completed: 'Completed',
  rejected: 'Rejected',
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  approval_queue: 'Requests waiting on human sign-off before engineering work starts.',
  pending_devops_approval: 'Requests ready for platform triage and intake.',
  in_progress: 'Changes actively moving through implementation and validation.',
  completed: 'Delivered requests with the latest successful outcome.',
};

function formatStatus(status: string): string {
  return STATUS_LABELS[status] || status.replace(/_/g, ' ');
}

function normalizePriority(priority: string): 'critical' | 'high' | 'medium' | 'low' {
  const value = priority.toLowerCase();
  if (value.includes('critical') || value.includes('p0')) return 'critical';
  if (value.includes('high') || value.includes('urgent') || value.includes('p1')) return 'high';
  if (value.includes('medium') || value.includes('normal') || value.includes('p2')) return 'medium';
  return 'low';
}

function formatPriority(priority: string): string {
  const normalized = normalizePriority(priority);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isPendingStatus(status: string): boolean {
  return status === 'pending_approval' || status === 'pending_user_manager_approval' || status === 'pending_devops_approval';
}

function isClosedStatus(status: string): boolean {
  return status === 'completed' || status === 'rejected';
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'ticket-status ticket-status--success';
    case 'rejected':
      return 'ticket-status ticket-status--danger';
    case 'in_progress':
      return 'ticket-status ticket-status--info';
    case 'pending_approval':
    case 'pending_user_manager_approval':
    case 'pending_devops_approval':
      return 'ticket-status ticket-status--warning';
    default:
      return 'ticket-status ticket-status--default';
  }
}

function getPriorityClass(priority: string): string {
  return `devops-ticket-priority devops-ticket-priority--${normalizePriority(priority)}`;
}

function getCloudClass(cloud: string): string {
  const normalized = cloud.toLowerCase();
  if (normalized === 'aws' || normalized === 'gcp' || normalized === 'azure') {
    return `devops-ticket-cloud devops-ticket-cloud--${normalized}`;
  }
  return 'devops-ticket-cloud';
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatCompactCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export default function DevOpsDashboard() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [teams, setTeams] = useState<DevOpsTeam[]>([]);
  const [projects, setProjects] = useState<ProjectDashboardItem[]>([]);
  const [projectAnalytics, setProjectAnalytics] = useState<ProjectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    Promise.all([
      fetch(`${apiUrl}/api/devops/tickets`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/devops/my-teams`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/devops/project-analytics`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(([ticketsRes, teamsRes, projectsRes, analyticsRes]) => {
        if (
          ticketsRes.status === 401 ||
          ticketsRes.status === 403 ||
          teamsRes.status === 401 ||
          teamsRes.status === 403 ||
          projectsRes.status === 401 ||
          projectsRes.status === 403 ||
          analyticsRes.status === 401 ||
          analyticsRes.status === 403
        ) {
          router.replace('/login');
          return Promise.resolve([{}, {}, {}, {}] as [{ tickets?: Ticket[]; error?: string }, { teams?: DevOpsTeam[] }, { projects?: ProjectDashboardItem[] }, { analytics?: ProjectAnalytics }]);
        }
        return Promise.all([
          ticketsRes.json().catch(() => ({})),
          teamsRes.json().catch(() => ({})),
          projectsRes.ok ? projectsRes.json().catch(() => ({})) : Promise.resolve({}),
          analyticsRes.ok ? analyticsRes.json().catch(() => ({})) : Promise.resolve({}),
        ]);
      })
      .then(([ticketsData, teamsData, projectsData, analyticsData]) => {
        if (ticketsData?.tickets) setTickets(ticketsData.tickets);
        else if (ticketsData?.error) setError(ticketsData.error);
        if (teamsData?.teams) setTeams(teamsData.teams);
        if (projectsData?.projects) setProjects(projectsData.projects);
        const nextAnalytics = normalizeProjectAnalytics(analyticsData?.analytics);
        if (nextAnalytics) setProjectAnalytics(nextAnalytics);
      })
      .catch(() => setError('Failed to load tickets'))
      .finally(() => setLoading(false));
  }, [router, apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/dashboard-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 200) return res.json().catch(() => ({}));
        return null;
      })
      .then((rawData) => {
        const data = asRecord(rawData);
        if (getString(data.status) === 'ok' && typeof data.pending_approval === 'number') {
          setStats({
            pending_approval: data.pending_approval,
            in_progress: typeof data.in_progress === 'number' ? data.in_progress : 0,
          });
        }
      })
      .catch(() => {});
  }, [apiUrl]);

  const sortedTickets = useMemo(() => {
    return [...tickets].sort((left, right) => {
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  }, [tickets]);

  const teamStatus = useMemo<TeamSummary[]>(() => {
    const byTeam: Record<string, TeamSummary> = {};
    tickets.forEach((ticket) => {
      const team = ticket.team || 'Other';
      if (!byTeam[team]) {
        byTeam[team] = {
          team,
          in_progress: 0,
          completed: 0,
          rejected: 0,
          pending_approval: 0,
          other: 0,
          total: 0,
        };
      }
      const entry = byTeam[team];
      entry.total += 1;
      if (ticket.status === 'in_progress') entry.in_progress += 1;
      else if (ticket.status === 'completed') entry.completed += 1;
      else if (ticket.status === 'rejected') entry.rejected += 1;
      else if (isPendingStatus(ticket.status)) entry.pending_approval += 1;
      else entry.other += 1;
    });
    return Object.values(byTeam).sort((left, right) => right.total - left.total);
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    if (!statusFilter) return sortedTickets;
    return sortedTickets.filter((ticket) => ticket.status === statusFilter);
  }, [sortedTickets, statusFilter]);

  const pendingApprovalCount = stats?.pending_approval ?? tickets.filter((ticket) => isPendingStatus(ticket.status)).length;
  const inProgressCount = stats?.in_progress ?? tickets.filter((ticket) => ticket.status === 'in_progress').length;
  const completedCount = tickets.filter((ticket) => ticket.status === 'completed').length;
  const rejectedCount = tickets.filter((ticket) => ticket.status === 'rejected').length;
  const openCount = tickets.filter((ticket) => !isClosedStatus(ticket.status)).length;
  const highRiskCount = tickets.filter((ticket) => {
    return !isClosedStatus(ticket.status) && ['critical', 'high'].includes(normalizePriority(ticket.priority));
  }).length;
  const updatedLast24Hours = tickets.filter((ticket) => {
    return Date.now() - new Date(ticket.updated_at).getTime() <= DAY_IN_MS;
  }).length;
  const resolvedLastWeek = tickets.filter((ticket) => {
    return ticket.status === 'completed' && Date.now() - new Date(ticket.updated_at).getTime() <= WEEK_IN_MS;
  }).length;
  const completionRate = tickets.length ? Math.round((completedCount / tickets.length) * 100) : 0;
  const activeTeamCount = teamStatus.filter((team) => team.total > 0).length;
  const safeCompletionRate = Math.max(0, Math.min(100, completionRate));

  const workflowLanes = useMemo(() => {
    const laneDefinitions = [
      {
        key: 'approval_queue',
        label: 'Approval queue',
        tone: 'amber',
        matches: (ticket: Ticket) => ticket.status === 'pending_approval' || ticket.status === 'pending_user_manager_approval',
      },
      {
        key: 'pending_devops_approval',
        label: 'DevOps intake',
        tone: 'sky',
        matches: (ticket: Ticket) => ticket.status === 'pending_devops_approval',
      },
      {
        key: 'in_progress',
        label: 'In progress',
        tone: 'teal',
        matches: (ticket: Ticket) => ticket.status === 'in_progress',
      },
      {
        key: 'completed',
        label: 'Completed',
        tone: 'green',
        matches: (ticket: Ticket) => ticket.status === 'completed',
      },
    ] as const;

    return laneDefinitions.map((lane) => {
      const laneTickets = sortedTickets.filter(lane.matches);
      return {
        ...lane,
        count: laneTickets.length,
        tickets: laneTickets.slice(0, 3),
        description: STATUS_DESCRIPTIONS[lane.key],
      };
    });
  }, [sortedTickets]);

  const urgentTickets = useMemo(() => {
    return sortedTickets
      .filter((ticket) => !isClosedStatus(ticket.status) && ['critical', 'high'].includes(normalizePriority(ticket.priority)))
      .slice(0, 4);
  }, [sortedTickets]);

  const recentActivity = useMemo(() => sortedTickets.slice(0, 6), [sortedTickets]);
  const projectSummary = useMemo(() => ({
    total: projects.length,
    ready: projects.filter((project) => project.ready_for_requests).length,
    setup: projects.filter((project) => !project.ready_for_requests && project.status === 'active').length,
  }), [projects]);
  const topProjects = useMemo(() => {
    return [...projects]
      .sort((left, right) => (right.pending_request_count || 0) - (left.pending_request_count || 0) || (right.request_count || 0) - (left.request_count || 0))
      .slice(0, 4);
  }, [projects]);
  const serviceDemand = (projectAnalytics?.service_request_distribution || []).slice(0, 5);
  const cloudDemand = (projectAnalytics?.cloud_request_distribution || []).slice(0, 4);
  const projectBottlenecks = (projectAnalytics?.approval_bottlenecks || []).slice(0, 5);
  const riskMix = projectAnalytics?.risk_distribution || [];

  const teamPulse = useMemo(() => {
    const zeroState = (): TeamSummary => ({
      team: '',
      in_progress: 0,
      completed: 0,
      rejected: 0,
      pending_approval: 0,
      other: 0,
      total: 0,
    });

    const merged = teams.map((team) => {
      const summary = teamStatus.find((entry) => entry.team === team.name) || zeroState();
      return {
        ...summary,
        team: team.name,
      };
    });

    const extras = teamStatus.filter((entry) => !teams.some((team) => team.name === entry.team));
    return [...merged, ...extras].sort((left, right) => right.total - left.total);
  }, [teams, teamStatus]);

  const quickActions = [
    {
      href: '/tickets',
      label: 'Open tickets',
      description: 'Move straight into assigned requests, comments, and approval context.',
    },
    {
      href: '/templates',
      label: 'Template library',
      description: 'Browse reusable delivery flows and approved infrastructure starting points.',
    },
    pendingApprovalCount > 0
      ? {
          href: '/tickets',
          label: 'Review backlog',
          description: `${formatCompactCount(pendingApprovalCount)} approvals need attention.`,
        }
      : {
          href: '/workload',
          label: 'Check workload',
          description: 'Balance active delivery, team ownership, and queue pressure.',
        },
    {
      href: '/team',
      label: 'Team directory',
      description: 'Review operators, assignments, and current team coverage.',
    },
  ];

  const heroGaugeStyle: CSSProperties = {
    background: `conic-gradient(var(--color-primary) 0 ${safeCompletionRate}%, rgba(148, 163, 184, 0.18) ${safeCompletionRate}% 100%)`,
  };

  return (
    <>
      <Head>
        <title>Dashboard - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="devops-portal">
          <section className="devops-portal__hero">
            <div className="devops-portal__hero-copy">
              <span className="devops-portal__eyebrow">Dashboard</span>
              <h1 className="devops-portal__headline">DevOps Dashboard</h1>
              <p className="devops-portal__subhead">
                Track approvals, active changes, and release pressure from a single control surface built for platform teams.
              </p>
              <div className="devops-portal__chips">
                <span className="devops-portal__chip">{loading ? 'Syncing ticket feed' : 'Live queue online'}</span>
                <span className="devops-portal__chip">{formatCompactCount(openCount)} open threads</span>
                <span className="devops-portal__chip">{formatCompactCount(Math.max(activeTeamCount, teams.length))} teams in view</span>
              </div>
              <div className="portal-page__actions" style={{ marginTop: 18 }}>
                <Link href="/project-operations" className="btn btn-secondary">
                  Project operations
                </Link>
                <Link href="/change-calendar" className="btn btn-secondary">
                  Change calendar
                </Link>
                <Link href="/service-heatmap" className="btn btn-secondary">
                  Service heatmap
                </Link>
                <Link href="/approval-sla" className="btn btn-secondary">
                  Approval SLA
                </Link>
                <Link href="/approval-center" className="btn btn-primary">
                  Approval center
                </Link>
              </div>
            </div>

            <div className="devops-hero-pulse">
              <div className="devops-hero-pulse__gauge" style={heroGaugeStyle}>
                <div className="devops-hero-pulse__gauge-center">
                  <strong>{safeCompletionRate}%</strong>
                  <span>resolved</span>
                </div>
              </div>
              <div className="devops-hero-pulse__body">
                <span className="devops-hero-pulse__label">System pulse</span>
                <p className="devops-hero-pulse__copy">
                  Delivery completion across {formatCompactCount(tickets.length)} tracked requests.
                </p>
                <div className="devops-hero-pulse__metrics">
                  <div>
                    <span>Backlog</span>
                    <strong>{formatCompactCount(pendingApprovalCount)}</strong>
                  </div>
                  <div>
                    <span>In flight</span>
                    <strong>{formatCompactCount(inProgressCount)}</strong>
                  </div>
                  <div>
                    <span>Resolved 7d</span>
                    <strong>{formatCompactCount(resolvedLastWeek)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {error && <div className="alert alert-error">{error}</div>}

          <section className="devops-kpi-grid">
            <article className="devops-kpi-card devops-kpi-card--primary">
              <span className="devops-kpi-card__label">Open queue</span>
              <strong className="devops-kpi-card__value">{formatCompactCount(openCount)}</strong>
              <p className="devops-kpi-card__detail">Requests that still need action before closure.</p>
            </article>
            <article className="devops-kpi-card devops-kpi-card--amber">
              <span className="devops-kpi-card__label">Awaiting approval</span>
              <strong className="devops-kpi-card__value">{formatCompactCount(pendingApprovalCount)}</strong>
              <p className="devops-kpi-card__detail">Human approval stages holding the delivery queue.</p>
            </article>
            <article className="devops-kpi-card devops-kpi-card--teal">
              <span className="devops-kpi-card__label">Updated in 24h</span>
              <strong className="devops-kpi-card__value">{formatCompactCount(updatedLast24Hours)}</strong>
              <p className="devops-kpi-card__detail">Recently touched tickets across your assigned teams.</p>
            </article>
            <article className="devops-kpi-card devops-kpi-card--rose">
              <span className="devops-kpi-card__label">High-risk items</span>
              <strong className="devops-kpi-card__value">{formatCompactCount(highRiskCount)}</strong>
              <p className="devops-kpi-card__detail">Open critical and high-priority changes requiring focus.</p>
            </article>
          </section>

          {projects.length > 0 && (
            <section className="devops-panel" style={{ marginBottom: 24 }}>
              <div className="devops-panel__header">
                <div>
                  <span className="devops-panel__eyebrow">Project Catalog</span>
                  <h2 className="devops-panel__title">Project onboarding pulse</h2>
                </div>
                <Link href="/projects" className="btn btn-secondary btn-sm">
                  Open projects
                </Link>
              </div>
              <div className="devops-kpi-grid" style={{ marginBottom: 20 }}>
                <article className="devops-kpi-card devops-kpi-card--primary">
                  <span className="devops-kpi-card__label">Projects</span>
                  <strong className="devops-kpi-card__value">{formatCompactCount(projectSummary.total)}</strong>
                  <p className="devops-kpi-card__detail">Catalogs managed by DevOps.</p>
                </article>
                <article className="devops-kpi-card devops-kpi-card--teal">
                  <span className="devops-kpi-card__label">Ready</span>
                  <strong className="devops-kpi-card__value">{formatCompactCount(projectSummary.ready)}</strong>
                  <p className="devops-kpi-card__detail">Projects available to requesters now.</p>
                </article>
                <article className="devops-kpi-card devops-kpi-card--amber">
                  <span className="devops-kpi-card__label">Needs setup</span>
                  <strong className="devops-kpi-card__value">{formatCompactCount(projectSummary.setup)}</strong>
                  <p className="devops-kpi-card__detail">Projects still missing final onboarding coverage.</p>
                </article>
                <article className="devops-kpi-card devops-kpi-card--rose">
                  <span className="devops-kpi-card__label">Pending by project</span>
                  <strong className="devops-kpi-card__value">{formatCompactCount(topProjects.reduce((sum, project) => sum + (project.pending_request_count || 0), 0))}</strong>
                  <p className="devops-kpi-card__detail">Pending requests across the busiest projects.</p>
                </article>
              </div>

              <div className="devops-team-grid">
                {topProjects.map((project) => (
                  <div key={project.id} className="devops-team-card">
                    <div className="devops-team-card__top">
                      <div>
                        <strong className="devops-team-card__name">{project.name}</strong>
                        <p className="devops-team-card__copy">{project.code} · {project.onboarding_stage || 'configured'}</p>
                      </div>
                      <span className={`devops-team-card__tone devops-team-card__tone--${project.ready_for_requests ? 'stable' : 'active'}`}>
                        {project.ready_for_requests ? 'Ready' : 'Setup'}
                      </span>
                    </div>
                    <div className="devops-team-card__stats">
                      <span>Requests {project.request_count || 0}</span>
                      <span>Pending {project.pending_request_count || 0}</span>
                      <span>Services {project.service_count || 0}</span>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">
                        View project
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {projectAnalytics && (
            <section className="devops-panel" style={{ marginBottom: 24 }}>
              <div className="devops-panel__header">
                <div>
                  <span className="devops-panel__eyebrow">Operations</span>
                  <h2 className="devops-panel__title">Project operations dashboard</h2>
                </div>
                <Link href="/projects" className="btn btn-secondary btn-sm">
                  Manage projects
                </Link>
              </div>

              <div className="devops-kpi-grid" style={{ marginBottom: 20 }}>
                <article className="devops-kpi-card devops-kpi-card--primary">
                  <span className="devops-kpi-card__label">Mapped users</span>
                  <strong className="devops-kpi-card__value">{formatCompactCount(projectAnalytics.summary.active_user_count)}</strong>
                  <p className="devops-kpi-card__detail">Users currently covered by project access mappings.</p>
                </article>
                <article className="devops-kpi-card devops-kpi-card--teal">
                  <span className="devops-kpi-card__label">Mapped teams</span>
                  <strong className="devops-kpi-card__value">{formatCompactCount(projectAnalytics.summary.mapped_team_count)}</strong>
                  <p className="devops-kpi-card__detail">Teams currently attached to project catalogs.</p>
                </article>
                <article className="devops-kpi-card devops-kpi-card--amber">
                  <span className="devops-kpi-card__label">Lead time</span>
                  <strong className="devops-kpi-card__value">{projectAnalytics.lead_time.average_hours ? `${projectAnalytics.lead_time.average_hours.toFixed(1)}h` : 'n/a'}</strong>
                  <p className="devops-kpi-card__detail">Average completion time across {formatCompactCount(projectAnalytics.lead_time.completed_requests)} completed project requests.</p>
                </article>
                <article className="devops-kpi-card devops-kpi-card--rose">
                  <span className="devops-kpi-card__label">Service demand</span>
                  <strong className="devops-kpi-card__value">{formatCompactCount(serviceDemand[0]?.count || 0)}</strong>
                  <p className="devops-kpi-card__detail">{serviceDemand[0]?.label || 'No service demand yet'}</p>
                </article>
              </div>

              <div className="devops-team-grid">
                <div className="devops-team-card">
                  <div className="devops-team-card__top">
                    <div>
                      <strong className="devops-team-card__name">Approval bottlenecks</strong>
                      <p className="devops-team-card__copy">Projects with the most pending work right now.</p>
                    </div>
                  </div>
                  <div className="devops-team-card__stats" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    {projectBottlenecks.length === 0 ? (
                      <span>No bottlenecks yet.</span>
                    ) : (
                      projectBottlenecks.map((project) => (
                        <span key={`bottleneck-${project.id}`}>{project.name}: {project.pending} pending / {project.requests} total</span>
                      ))
                    )}
                  </div>
                </div>
                <div className="devops-team-card">
                  <div className="devops-team-card__top">
                    <div>
                      <strong className="devops-team-card__name">Cloud demand</strong>
                      <p className="devops-team-card__copy">Where project traffic is concentrated.</p>
                    </div>
                  </div>
                  <div className="devops-team-card__stats" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    {cloudDemand.length === 0 ? (
                      <span>No request traffic yet.</span>
                    ) : (
                      cloudDemand.map((item) => (
                        <span key={`cloud-demand-${item.key}`}>{item.label}: {item.count}</span>
                      ))
                    )}
                  </div>
                </div>
                <div className="devops-team-card">
                  <div className="devops-team-card__top">
                    <div>
                      <strong className="devops-team-card__name">Risk mix</strong>
                      <p className="devops-team-card__copy">Project risk posture across the catalog.</p>
                    </div>
                  </div>
                  <div className="devops-team-card__stats" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    {riskMix.length === 0 ? (
                      <span>No risk signals yet.</span>
                    ) : (
                      riskMix.map((item) => (
                        <span key={`risk-mix-${item.key}`}>{item.label}: {item.count}</span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="devops-portal__grid devops-portal__grid--asymmetric">
            <article className="devops-panel">
              <div className="devops-panel__header">
                <div>
                  <span className="devops-panel__eyebrow">Workflow board</span>
                  <h2 className="devops-panel__title">Where the queue is moving</h2>
                </div>
              </div>
              <div className="devops-workflow-grid">
                {workflowLanes.map((lane) => (
                  <div key={lane.key} className={`devops-workflow-card devops-workflow-card--${lane.tone}`}>
                    <div className="devops-workflow-card__top">
                      <div>
                        <span className="devops-workflow-card__label">{lane.label}</span>
                        <strong className="devops-workflow-card__count">{formatCompactCount(lane.count)}</strong>
                      </div>
                    </div>
                    <p className="devops-workflow-card__copy">{lane.description}</p>
                    {lane.tickets.length === 0 ? (
                      <p className="devops-workflow-card__empty">No tickets in this lane right now.</p>
                    ) : (
                      <div className="devops-workflow-card__list">
                        {lane.tickets.map((ticket) => (
                          <div key={ticket.id} className="devops-mini-ticket">
                            <div className="devops-mini-ticket__top">
                              <span className="devops-mini-ticket__id">#{ticket.id}</span>
                              <span className={getPriorityClass(ticket.priority)}>{formatPriority(ticket.priority)}</span>
                            </div>
                            <strong className="devops-mini-ticket__service">{ticket.service}</strong>
                            <div className="devops-mini-ticket__meta">
                              <span>{ticket.team || 'Unassigned'}</span>
                              <span>{formatShortDate(ticket.updated_at)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>

            <article className="devops-panel">
              <div className="devops-panel__header">
                <div>
                  <span className="devops-panel__eyebrow">Operator radar</span>
                  <h2 className="devops-panel__title">What needs attention next</h2>
                </div>
              </div>

              <div className="devops-insight-grid">
                <div className="devops-insight-card">
                  <span className="devops-insight-card__label">Resolved 7d</span>
                  <strong className="devops-insight-card__value">{formatCompactCount(resolvedLastWeek)}</strong>
                </div>
                <div className="devops-insight-card">
                  <span className="devops-insight-card__label">Rejected</span>
                  <strong className="devops-insight-card__value">{formatCompactCount(rejectedCount)}</strong>
                </div>
                <div className="devops-insight-card">
                  <span className="devops-insight-card__label">Assigned teams</span>
                  <strong className="devops-insight-card__value">{formatCompactCount(Math.max(activeTeamCount, teams.length))}</strong>
                </div>
                <div className="devops-insight-card">
                  <span className="devops-insight-card__label">In progress</span>
                  <strong className="devops-insight-card__value">{formatCompactCount(inProgressCount)}</strong>
                </div>
              </div>

              <div className="devops-focus-card">
                <div className="devops-focus-card__header">
                  <h3 className="devops-focus-card__title">Priority focus</h3>
                  <span className="devops-focus-card__meta">{formatCompactCount(highRiskCount)} active</span>
                </div>
                {urgentTickets.length === 0 ? (
                  <p className="devops-focus-card__empty">No critical or high-priority tickets are open.</p>
                ) : (
                  <div className="devops-focus-list">
                    {urgentTickets.map((ticket) => (
                      <div key={ticket.id} className="devops-focus-item">
                        <div>
                          <strong>#{ticket.id}</strong>
                          <p>{ticket.service}</p>
                        </div>
                        <div className="devops-focus-item__meta">
                          <span className={getStatusBadgeClass(ticket.status)}>{formatStatus(ticket.status)}</span>
                          <span className={getPriorityClass(ticket.priority)}>{formatPriority(ticket.priority)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="devops-action-grid">
                {quickActions.map((action) => (
                  <Link key={action.href} href={action.href} className="devops-action-card">
                    <span className="devops-action-card__label">{action.label}</span>
                    <p className="devops-action-card__copy">{action.description}</p>
                  </Link>
                ))}
              </div>
            </article>
          </section>

          <section className="devops-portal__grid">
            <article className="devops-panel">
              <div className="devops-panel__header">
                <div>
                  <span className="devops-panel__eyebrow">Team pulse</span>
                  <h2 className="devops-panel__title">Capacity across assigned teams</h2>
                </div>
              </div>
              {teamPulse.length === 0 ? (
                <div className="empty-state">
                  <p>You are not in any DevOps teams yet. Team health appears here once teams are assigned.</p>
                </div>
              ) : (
                <>
                  <div className="devops-team-grid">
                    {teamPulse.slice(0, 6).map((team) => {
                      const total = team.total || 1;
                      const pendingWidth = `${(team.pending_approval / total) * 100}%`;
                      const progressWidth = `${(team.in_progress / total) * 100}%`;
                      const completedWidth = `${(team.completed / total) * 100}%`;
                      const tone = team.pending_approval + team.in_progress > team.completed ? 'active' : 'stable';
                      return (
                        <div key={team.team} className="devops-team-card">
                          <div className="devops-team-card__top">
                            <div>
                              <strong className="devops-team-card__name">{team.team}</strong>
                              <p className="devops-team-card__copy">
                                {formatCompactCount(team.total)} tickets across approval, delivery, and closeout.
                              </p>
                            </div>
                            <span className={`devops-team-card__tone devops-team-card__tone--${tone}`}>
                              {team.pending_approval + team.in_progress > team.completed ? 'Hot' : 'Stable'}
                            </span>
                          </div>
                          <div className="devops-team-card__bar">
                            <span className="devops-team-card__segment devops-team-card__segment--amber" style={{ width: pendingWidth }} />
                            <span className="devops-team-card__segment devops-team-card__segment--teal" style={{ width: progressWidth }} />
                            <span className="devops-team-card__segment devops-team-card__segment--green" style={{ width: completedWidth }} />
                          </div>
                          <div className="devops-team-card__stats">
                            <span>Pending {team.pending_approval}</span>
                            <span>Active {team.in_progress}</span>
                            <span>Done {team.completed}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {teams.length > 0 && (
                    <div className="devops-team-pill-row">
                      {teams.map((team) => (
                        <Link key={team.id} href="/team" className="devops-team-pill">
                          {team.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </article>

            <article className="devops-panel">
              <div className="devops-panel__header">
                <div>
                  <span className="devops-panel__eyebrow">Activity feed</span>
                  <h2 className="devops-panel__title">Latest ticket movement</h2>
                </div>
              </div>
              {recentActivity.length === 0 ? (
                <div className="empty-state">
                  <p>No ticket activity yet. New work will appear here as requests move through the queue.</p>
                </div>
              ) : (
                <div className="devops-activity-feed">
                  {recentActivity.map((ticket) => (
                    <div key={ticket.id} className="devops-activity-item">
                      <div className="devops-activity-item__left">
                        <strong className="devops-activity-item__title">#{ticket.id} {ticket.service}</strong>
                        <p className="devops-activity-item__copy">
                          {ticket.team || 'Unassigned'} | {ticket.cloud} | {ticket.env}
                        </p>
                      </div>
                      <div className="devops-activity-item__right">
                        <span className={getStatusBadgeClass(ticket.status)}>{formatStatus(ticket.status)}</span>
                        <span className="devops-activity-item__time">{formatShortDate(ticket.updated_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="devops-panel">
            <div className="devops-panel__header devops-panel__header--table">
              <div>
                <span className="devops-panel__eyebrow">Ticket explorer</span>
                <h2 className="devops-panel__title">Recent requests</h2>
              </div>
              <div className="devops-table-controls">
                <label className="devops-filter-label" htmlFor="dashboard-status-filter">
                  Status
                </label>
                <select
                  id="dashboard-status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="input devops-table-controls__select"
                >
                  <option value="">All</option>
                  <option value="pending_approval">Pending approval</option>
                  <option value="pending_user_manager_approval">Pending user manager</option>
                  <option value="pending_devops_approval">Pending DevOps</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>

            {loading ? (
              <p className="loading-text">Loading dashboard...</p>
            ) : tickets.length === 0 ? (
              <div className="empty-state">
                <p>No tickets assigned to you yet. Tickets appear here after an admin approves a request and a PR is created.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Service</th>
                      <th>Team</th>
                      <th>Cloud</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>PR</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTickets.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>
                          No tickets match the filter.
                        </td>
                      </tr>
                    ) : (
                      filteredTickets.slice(0, 12).map((ticket) => (
                        <tr key={ticket.id}>
                          <td>
                            <code>#{ticket.id}</code>
                          </td>
                          <td>
                            <div className="devops-ticket-cell">
                              <strong>{ticket.service}</strong>
                              {ticket.application_id && <span>{ticket.application_id}</span>}
                            </div>
                          </td>
                          <td>{ticket.team || 'Unassigned'}</td>
                          <td>
                            <span className={getCloudClass(ticket.cloud)}>{ticket.cloud}</span>
                          </td>
                          <td>
                            <span className={getPriorityClass(ticket.priority)}>{formatPriority(ticket.priority)}</span>
                          </td>
                          <td>
                            <span className={getStatusBadgeClass(ticket.status)}>{formatStatus(ticket.status)}</span>
                          </td>
                          <td>
                            {ticket.pr_url ? (
                              <a href={ticket.pr_url} target="_blank" rel="noopener noreferrer" className="devops-ticket-pr-link">
                                Open PR
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="devops-ticket-updated">{formatShortDate(ticket.updated_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </DevOpsLayout>
    </>
  );
}
