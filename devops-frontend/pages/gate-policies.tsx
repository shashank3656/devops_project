import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

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
  team_name?: string;
  team_slug?: string;
  environments: string[];
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  description: string;
  status: 'active' | 'inactive' | 'archived';
  owner_team_id?: number | null;
  owner_team?: string;
  environments: string[];
  clouds: string[];
  services: ProjectServiceOption[];
  team_access: ProjectTeamAccess[];
  approval_rules: ProjectApprovalRule[];
}

function defaultRulesForEnvironments(environments: string[]): ProjectApprovalRule[] {
  return environments.map((environment) => ({
    environment,
    require_manager_approval: environment !== 'dev',
    require_devops_approval: true,
  }));
}

export default function GatePoliciesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingProjectId, setSavingProjectId] = useState<number | null>(null);

  const clearSessionAndRedirect = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.replace('/login');
  };

  const fetchProjects = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load gate policies');
      }
      const nextProjects = Array.isArray(payload?.projects) ? payload.projects : [];
      setProjects(nextProjects.map((project: ProjectOption) => ({
        ...project,
        approval_rules: project.approval_rules?.length
          ? project.approval_rules.map((rule) => ({ ...rule }))
          : defaultRulesForEnvironments(project.environments || []),
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gate policies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProjects();
  }, [apiUrl]);

  const updateRule = (projectId: number, environment: string, field: 'require_manager_approval' | 'require_devops_approval', value: boolean) => {
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== projectId) return project;
        const nextRules = project.approval_rules?.length
          ? project.approval_rules.map((rule) =>
              rule.environment === environment ? { ...rule, [field]: value } : rule,
            )
          : defaultRulesForEnvironments(project.environments).map((rule) =>
              rule.environment === environment ? { ...rule, [field]: value } : rule,
            );
        return { ...project, approval_rules: nextRules };
      }),
    );
  };

  const saveProjectPolicies = async (project: ProjectOption) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }

    setSavingProjectId(project.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: project.name,
          code: project.code,
          description: project.description,
          status: project.status,
          owner_team_id: project.owner_team_id ?? null,
          environments: project.environments,
          clouds: project.clouds,
          services: project.services,
          team_access: project.team_access,
          approval_rules: project.approval_rules,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save gate policy');
      }
      setNotice(`Saved gate policy for ${project.name}.`);
      void fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save gate policy');
    } finally {
      setSavingProjectId(null);
    }
  };

  const summary = useMemo(() => {
    const projectsWithProdManager = projects.filter((project) =>
      project.approval_rules.some((rule) => rule.environment === 'prod' && rule.require_manager_approval),
    ).length;
    const projectsWithProdDevops = projects.filter((project) =>
      project.approval_rules.some((rule) => rule.environment === 'prod' && rule.require_devops_approval),
    ).length;
    const relaxedDevProjects = projects.filter((project) =>
      project.approval_rules.some((rule) => rule.environment === 'dev' && !rule.require_manager_approval),
    ).length;
    return {
      total: projects.length,
      projectsWithProdManager,
      projectsWithProdDevops,
      relaxedDevProjects,
    };
  }, [projects]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Gate Policies - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Deployment Gate Policy Engine</span>
            <h1 className="portal-page__title">Gate Policies</h1>
            <p className="portal-page__subtitle">
              Manage environment approval rules per project. Incident guards, rollback readiness, and change-window signals continue to be evaluated dynamically during promotion review.
            </p>
          </div>
          <div className="portal-page__actions">
            <button type="button" className="btn btn-secondary" onClick={() => void fetchProjects()} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <section className="portal-stat-grid" style={{ marginBottom: 24 }}>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Projects</span>
            <strong className="portal-stat-card__value">{summary.total}</strong>
            <p className="portal-stat-card__copy">Projects currently visible to the DevOps policy console.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Prod manager approval</span>
            <strong className="portal-stat-card__value">{summary.projectsWithProdManager}</strong>
            <p className="portal-stat-card__copy">Projects enforcing explicit manager review before production promotion.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Prod DevOps approval</span>
            <strong className="portal-stat-card__value">{summary.projectsWithProdDevops}</strong>
            <p className="portal-stat-card__copy">Projects requiring DevOps approval on production promotions.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Relaxed dev policy</span>
            <strong className="portal-stat-card__value">{summary.relaxedDevProjects}</strong>
            <p className="portal-stat-card__copy">Projects where development environments can move without manager review.</p>
          </article>
        </section>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface" style={{ marginBottom: 24 }}>
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Policy guide</span>
              <h2 className="portal-surface__title">How the engine uses these settings</h2>
              <p className="portal-surface__subtitle">
                These toggles define the baseline approval requirements for each environment. Runtime checks like incidents, temporary access overrides, rollback readiness, and source promotion state are layered on top during promotion decisions.
              </p>
            </div>
          </div>
        </section>

        {loading ? (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>Loading gate policies...</p>
            </div>
          </section>
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            {projects.map((project) => (
              <section key={project.id} className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">{project.code || `Project ${project.id}`}</span>
                    <h2 className="portal-surface__title">{project.name}</h2>
                    <p className="portal-surface__subtitle">
                      {project.owner_team ? `Owner team: ${project.owner_team}. ` : ''}
                      Environments: {project.environments.join(', ') || 'None'}
                    </p>
                  </div>
                  <div className="portal-page__actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={savingProjectId === project.id}
                      onClick={() => void saveProjectPolicies(project)}
                    >
                      {savingProjectId === project.id ? 'Saving...' : 'Save policy'}
                    </button>
                  </div>
                </div>

                <div className="table-wrap">
                  <table className="credential-audit-table">
                    <thead>
                      <tr>
                        <th>Environment</th>
                        <th>Manager approval</th>
                        <th>DevOps approval</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.environments.map((environment) => {
                        const rule =
                          project.approval_rules.find((entry) => entry.environment === environment) || {
                            environment,
                            require_manager_approval: environment !== 'dev',
                            require_devops_approval: true,
                          };
                        return (
                          <tr key={`${project.id}-${environment}`}>
                            <td>
                              <strong>{environment.toUpperCase()}</strong>
                            </td>
                            <td>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={rule.require_manager_approval}
                                  onChange={(event) => updateRule(project.id, environment, 'require_manager_approval', event.target.checked)}
                                />
                                Require manager review
                              </label>
                            </td>
                            <td>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={rule.require_devops_approval}
                                  onChange={(event) => updateRule(project.id, environment, 'require_devops_approval', event.target.checked)}
                                />
                                Require DevOps approval
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </DevOpsLayout>
  );
}
