import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import ApprovalsSectionNav from '../../components/ApprovalsSectionNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectApprovalRule {
  environment: string;
  require_manager_approval: boolean;
  require_devops_approval: boolean;
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  description: string;
  status: 'active' | 'inactive' | 'archived';
  owner_team?: string;
  environments: string[];
  approval_rules: ProjectApprovalRule[];
}

function defaultRulesForEnvironments(environments: string[]): ProjectApprovalRule[] {
  return environments.map((environment) => ({
    environment,
    require_manager_approval: environment !== 'dev',
    require_devops_approval: true,
  }));
}

function ruleFor(project: ProjectOption, environment: string): ProjectApprovalRule {
  return (
    project.approval_rules.find((entry) => entry.environment === environment) || {
      environment,
      require_manager_approval: environment !== 'dev',
      require_devops_approval: true,
    }
  );
}

export default function GatePoliciesCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

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
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to load approval rules'));
      }
      const nextProjects = Array.isArray(payload.projects) ? (payload.projects as ProjectOption[]) : [];
      setProjects(
        nextProjects.map((project) => ({
          ...project,
          approval_rules: project.approval_rules?.length
            ? project.approval_rules.map((rule) => ({ ...rule }))
            : defaultRulesForEnvironments(project.environments || []),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approval rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProjects();
  }, [apiUrl]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) =>
      `${project.name} ${project.code} ${project.owner_team || ''}`.toLowerCase().includes(needle),
    );
  }, [projects, query]);

  const summary = useMemo(() => {
    const projectsWithProdManager = projects.filter((project) =>
      project.approval_rules.some((rule) => rule.environment === 'prod' && rule.require_manager_approval),
    ).length;
    const projectsWithProdDevops = projects.filter((project) =>
      project.approval_rules.some((rule) => rule.environment === 'prod' && rule.require_devops_approval),
    ).length;
    return {
      total: projects.length,
      projectsWithProdManager,
      projectsWithProdDevops,
    };
  }, [projects]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Promotion rules - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Approvals</span>
            <h1 className="portal-page__title">Promotion rules</h1>
            <p className="portal-page__subtitle">
              Browse project gate rules here. Open a project to edit manager and DevOps requirements.
            </p>
          </div>
          <div className="portal-page__actions">
            <button type="button" className="btn btn-secondary" onClick={() => void fetchProjects()} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <ApprovalsSectionNav />

        <section className="k8s-summary-strip">
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Projects</span>
            <strong className="k8s-summary-card__value">{summary.total}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Prod manager</span>
            <strong className="k8s-summary-card__value">{summary.projectsWithProdManager}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Prod DevOps</span>
            <strong className="k8s-summary-card__value">{summary.projectsWithProdDevops}</strong>
          </div>
        </section>

        <div className="k8s-filterbar">
          <label className="k8s-filterbar__field k8s-filterbar__field--search">
            <span className="k8s-filterbar__label">Find project</span>
            <input
              className="input k8s-filterbar__input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, code, or owner team"
            />
          </label>
          <div className="k8s-filterbar__actions">
            <span className="portal-pill">{visible.length} visible</span>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        {loading ? (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>Loading approval rules...</p>
            </div>
          </section>
        ) : visible.length === 0 ? (
          <div className="portal-table-state portal-table-state--empty">
            <h3 className="portal-table-state__title">No projects match</h3>
            <p className="portal-table-state__copy">Onboard a project first, then come back to set its approval rules.</p>
          </div>
        ) : (
          <section className="portal-surface portal-surface--table">
            <div className="table-scroll">
              <table className="templates-table k8s-data-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Environments</th>
                    <th>Prod manager</th>
                    <th>Prod DevOps</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((project) => {
                    const prod = ruleFor(project, 'prod');
                    return (
                      <tr key={project.id}>
                        <td>
                          <Link href={`/gate-policies/${project.id}`} className="k8s-link-cell">
                            <span className="k8s-link-cell__title">{project.name}</span>
                            <span className="k8s-link-cell__meta">
                              {project.code}
                              {project.owner_team ? ` · ${project.owner_team}` : ''}
                            </span>
                          </Link>
                        </td>
                        <td>{project.environments.join(', ') || '—'}</td>
                        <td>
                          <span className={`ig-chip ig-chip--${prod.require_manager_approval ? 'low' : 'medium'}`}>
                            {prod.require_manager_approval ? 'Required' : 'Off'}
                          </span>
                        </td>
                        <td>
                          <span className={`ig-chip ig-chip--${prod.require_devops_approval ? 'low' : 'medium'}`}>
                            {prod.require_devops_approval ? 'Required' : 'Off'}
                          </span>
                        </td>
                        <td>
                          <Link href={`/gate-policies/${project.id}`} className="btn btn-secondary btn-sm">
                            Edit rules
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </DevOpsLayout>
  );
}
