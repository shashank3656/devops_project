import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

interface ProjectServiceOption {
  cloud: string;
  service: string;
}

interface ProjectApprovalRule {
  environment: string;
  require_manager_approval: boolean;
  require_devops_approval: boolean;
}

interface ProjectTeamAccess {
  team_id: number;
  team_name: string;
  team_slug: string;
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
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
  approval_rules?: ProjectApprovalRule[];
}

function stageTone(stage?: string): { background: string; color: string } {
  switch (stage) {
    case 'ready':
      return { background: 'var(--success-bg)', color: 'var(--success-color)' };
    case 'team_mapped':
    case 'configured':
      return { background: 'var(--warning-bg)', color: 'var(--warning-color)' };
    case 'inactive':
    case 'archived':
      return { background: 'var(--bg-gray-100)', color: 'var(--text-secondary)' };
    default:
      return { background: 'var(--info-bg)', color: 'var(--info-color)' };
  }
}

export default function ProjectDetailsPage() {
  const router = useRouter();
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    if (!router.isReady) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    const rawId = router.query.id;
    const projectId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!projectId) return;

    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/me/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } })
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
    <>
      <Head>
        <title>{project ? `${project.name} - Project Details` : 'Project Details - Infrastructure Portal'}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Catalog</span>
            <h1 className="portal-page__title">{project ? project.name : 'Project Details'}</h1>
            <p className="portal-page__subtitle">
              Review the exact environments, clouds, services, and team scopes available before raising an infrastructure request.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/my-projects" className="btn btn-secondary">Back to My Projects</Link>
            {project ? (
              <Link href={`/select-service?project_id=${project.id}`} className="btn btn-primary">Request service</Link>
            ) : null}
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
                  {project.ready_for_requests ? 'This project is ready for live requests.' : 'The project scope is still being finalized.'}
                </p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Environments</span>
                <span className="portal-stat-card__value">{project.environments.length}</span>
                <p className="portal-stat-card__copy">{project.environments.join(', ')}</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Cloud services</span>
                <span className="portal-stat-card__value">{project.service_count ?? project.services.length}</span>
                <p className="portal-stat-card__copy">{project.clouds.join(', ').toUpperCase()}</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Team scopes</span>
                <span className="portal-stat-card__value">{project.team_count ?? project.team_access.length}</span>
                <p className="portal-stat-card__copy">{project.owner_team || 'No owner team configured yet.'}</p>
              </article>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">{project.code}</span>
                  <h2 className="portal-surface__title">Overview</h2>
                  <p className="portal-surface__subtitle">{project.description || 'Project-driven request scope for your assigned teams.'}</p>
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

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Service Catalog</span>
                  <h2 className="portal-surface__title">Allowed Services</h2>
                  <p className="portal-surface__subtitle">Only these cloud-service combinations are requestable for this project.</p>
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
                  <h2 className="portal-surface__title">Who Can Request</h2>
                  <p className="portal-surface__subtitle">Only these mapped portal teams can request against this project, and only in their allowed environments.</p>
                </div>
              </div>
              {project.team_access.length === 0 ? (
                <div className="empty-state">No team access has been mapped to this project yet.</div>
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
                          <td>{access.team_name}</td>
                          <td>{access.team_slug}</td>
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
                  <h2 className="portal-surface__title">Environment Rules</h2>
                  <p className="portal-surface__subtitle">Approval requirements vary by environment so requesters know what happens before a PR is raised.</p>
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
                    {(project.approval_rules || []).map((rule) => (
                      <tr key={`${project.id}-${rule.environment}`}>
                        <td>{rule.environment}</td>
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
    </>
  );
}
