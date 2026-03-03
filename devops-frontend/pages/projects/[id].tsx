import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProjectServiceOption {
  cloud: string;
  service: string;
}

interface ProjectApprovalRule {
  environment: string;
  require_manager_approval: boolean;
  require_devops_approval: boolean;
}

interface CostRiskSignal {
  severity: 'low' | 'medium' | 'high';
  category: string;
  title: string;
  detail: string;
}

interface ProjectCostRiskSummary {
  overall_risk: 'low' | 'medium' | 'high';
  estimated_band: string;
  estimated_monthly: string;
  estimate_basis: string;
  summary: string;
  request_count: number;
  pending_review_count: number;
  high_risk_count: number;
  medium_risk_count: number;
  signals: CostRiskSignal[];
}

interface ProjectTeamAccess {
  team_id: number;
  team_name?: string;
  team_slug?: string;
  environments: string[];
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  description: string;
  status: string;
  onboarding_stage?: string;
  ready_for_requests?: boolean;
  service_count?: number;
  team_count?: number;
  owner_team?: string;
  cost_risk_summary?: ProjectCostRiskSummary | null;
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
  approval_rules: ProjectApprovalRule[];
}

function stageTone(stage?: string): { background: string; color: string } {
  switch (stage) {
    case 'ready':
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
    case 'configured':
    case 'team_mapped':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    case 'inactive':
    case 'archived':
      return { background: 'rgba(148, 163, 184, 0.14)', color: 'var(--color-text-muted)' };
    default:
      return { background: 'rgba(34, 211, 238, 0.14)', color: 'var(--color-primary)' };
  }
}

function getPreviewRiskClass(level?: string): string {
  switch (level) {
    case 'high':
      return 'portal-preview-risk portal-preview-risk--high';
    case 'medium':
      return 'portal-preview-risk portal-preview-risk--medium';
    default:
      return 'portal-preview-risk portal-preview-risk--low';
  }
}

function getPreviewSignalClass(severity?: string): string {
  switch (severity) {
    case 'high':
      return 'portal-preview-signal portal-preview-signal--high';
    case 'medium':
      return 'portal-preview-signal portal-preview-signal--medium';
    default:
      return 'portal-preview-signal portal-preview-signal--low';
  }
}

export default function DevOpsProjectDetailPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    const rawId = router.query.id;
    const projectId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!projectId) return;

    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/devops/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load project');
        }
        setProject(data.project || null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router, router.isReady, router.query.id]);

  const servicesByCloud = useMemo(() => {
    if (!project) return [];
    return project.clouds.map((cloud) => ({
      cloud,
      services: project.services.filter((service) => service.cloud === cloud).map((service) => service.service),
    }));
  }, [project]);

  const stageStyle = stageTone(project?.onboarding_stage);

  return (
    <DevOpsLayout>
      <Head>
        <title>{project ? `${project.name} - Projects` : 'Project Details - DevOps Portal'}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Onboarding</span>
            <h1 className="portal-page__title">{project ? project.name : 'Project Details'}</h1>
            <p className="portal-page__subtitle">
              Review the project contract DevOps is enforcing for user requests: scope, services, access, and approval path.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/projects" className="btn btn-secondary">Back to Projects</Link>
          </div>
        </div>

        {loading ? (
          <div className="portal-surface"><div className="empty-state">Loading project...</div></div>
        ) : error ? (
          <div className="portal-surface"><div className="empty-state">{error}</div></div>
        ) : !project ? (
          <div className="portal-surface"><div className="empty-state">Project not found.</div></div>
        ) : (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Lifecycle</span>
                <span className="portal-stat-card__value">{project.onboarding_stage || 'configured'}</span>
                <p className="portal-stat-card__copy">
                  {project.ready_for_requests ? 'Users can request from this project now.' : 'More mapping is needed before the catalog is usable.'}
                </p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Service coverage</span>
                <span className="portal-stat-card__value">{project.service_count ?? project.services.length}</span>
                <p className="portal-stat-card__copy">{project.clouds.join(', ') || 'No clouds configured'}</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Team mappings</span>
                <span className="portal-stat-card__value">{project.team_count ?? project.team_access.length}</span>
                <p className="portal-stat-card__copy">{project.owner_team || 'Owner team not set yet'}</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Environments</span>
                <span className="portal-stat-card__value">{project.environments.length}</span>
                <p className="portal-stat-card__copy">{project.environments.join(', ')}</p>
              </article>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">{project.code}</span>
                  <h2 className="portal-surface__title">Project Contract</h2>
                  <p className="portal-surface__subtitle">{project.description || 'This project is managed by the DevOps catalog.'}</p>
                </div>
                <span style={{ ...stageStyle, padding: '8px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                  {project.onboarding_stage || 'configured'}
                </span>
              </div>

              <div className="portal-detail-grid">
                <article className="portal-detail-card">
                  <span className="portal-surface__eyebrow">Status</span>
                  <div className="portal-detail-card__value">{project.status}</div>
                </article>
                <article className="portal-detail-card">
                  <span className="portal-surface__eyebrow">Owner team</span>
                  <div className="portal-detail-card__value">{project.owner_team || 'Not set'}</div>
                </article>
                <article className="portal-detail-card">
                  <span className="portal-surface__eyebrow">Request readiness</span>
                  <div className="portal-detail-card__value">{project.ready_for_requests ? 'Ready' : 'Pending'}</div>
                </article>
                <article className="portal-detail-card">
                  <span className="portal-surface__eyebrow">Project code</span>
                  <div className="portal-detail-card__value">{project.code}</div>
                </article>
              </div>
            </section>

            {project.cost_risk_summary ? (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Cost and Risk</span>
                    <h2 className="portal-surface__title">Project Summary</h2>
                    <p className="portal-surface__subtitle">This rolls up request-level heuristics into one project view so DevOps can see workload pressure and exposure patterns quickly.</p>
                  </div>
                  <span className={getPreviewRiskClass(project.cost_risk_summary.overall_risk)}>
                    {project.cost_risk_summary.overall_risk} risk
                  </span>
                </div>
                <div className="portal-preview-grid" style={{ marginTop: 0 }}>
                  <article className="portal-detail-card">
                    <span className="portal-preview-eyebrow">Estimated monthly</span>
                    <strong className="portal-preview-value">{project.cost_risk_summary.estimated_monthly}</strong>
                    <p className="portal-preview-copy">
                      {project.cost_risk_summary.estimated_band} footprint. {project.cost_risk_summary.estimate_basis}
                    </p>
                  </article>
                  <article className="portal-detail-card">
                    <span className="portal-preview-eyebrow">Signals tracked</span>
                    <strong className="portal-preview-value">{project.cost_risk_summary.signals.length}</strong>
                    <p className="portal-preview-copy">{project.cost_risk_summary.summary}</p>
                  </article>
                  <article className="portal-detail-card">
                    <span className="portal-preview-eyebrow">Pending review</span>
                    <strong className="portal-preview-value">{project.cost_risk_summary.pending_review_count}</strong>
                    <p className="portal-preview-copy">High risk: {project.cost_risk_summary.high_risk_count} · Medium risk: {project.cost_risk_summary.medium_risk_count}</p>
                  </article>
                </div>
                <div className="portal-preview-signals" style={{ marginTop: 16 }}>
                  {project.cost_risk_summary.signals.map((signal) => (
                    <article key={`${signal.category}-${signal.title}`} className={getPreviewSignalClass(signal.severity)}>
                      <div className="portal-preview-signal__top">
                        <strong className="portal-preview-signal__title">{signal.title}</strong>
                        <span>{signal.severity}</span>
                      </div>
                      <p className="portal-preview-signal__detail">{signal.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Service Catalog</span>
                  <h2 className="portal-surface__title">Cloud-Service Matrix</h2>
                  <p className="portal-surface__subtitle">Users only see these services after they select this project in the request flow.</p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                {servicesByCloud.map((entry) => (
                  <article key={`${project.id}-${entry.cloud}`} className="request-choice-card">
                    <strong>{entry.cloud.toUpperCase()}</strong>
                    <p style={{ marginTop: 8 }}>{entry.services.join(', ') || 'No services configured'}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Team Access</span>
                  <h2 className="portal-surface__title">Portal Team Mappings</h2>
                  <p className="portal-surface__subtitle">Each mapped team gets environment-level scope inside the user portal.</p>
                </div>
              </div>
              {project.team_access.length === 0 ? (
                <div className="empty-state">No portal teams are mapped yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>Slug</th>
                        <th>Allowed environments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.team_access.map((access) => (
                        <tr key={`${project.id}-${access.team_id}`}>
                          <td>{access.team_name || 'Unknown team'}</td>
                          <td>{access.team_slug || '—'}</td>
                          <td>{access.environments.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Approval Path</span>
                  <h2 className="portal-surface__title">Environment Approval Rules</h2>
                  <p className="portal-surface__subtitle">These rules control whether a request waits on manager approval, DevOps approval, or both.</p>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Environment</th>
                      <th>Manager approval</th>
                      <th>DevOps approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.approval_rules.map((rule) => (
                      <tr key={`${project.id}-${rule.environment}`}>
                        <td>{rule.environment.toUpperCase()}</td>
                        <td>{rule.require_manager_approval ? 'Required' : 'Not required'}</td>
                        <td>{rule.require_devops_approval ? 'Required' : 'Bypass to approval queue'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </DevOpsLayout>
  );
}
