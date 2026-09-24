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

export default function GatePolicyEditorPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const projectId = Number(Array.isArray(router.query.id) ? router.query.id[0] : router.query.id);
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const clearSessionAndRedirect = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.replace('/login');
  };

  const fetchProject = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !projectId) return;

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
      const match = nextProjects.find((item) => item.id === projectId);
      if (!match) {
        throw new Error('Project not found');
      }
      setProject({
        ...match,
        approval_rules: match.approval_rules?.length
          ? match.approval_rules.map((rule) => ({ ...rule }))
          : defaultRulesForEnvironments(match.environments || []),
      });
    } catch (err) {
      setProject(null);
      setError(err instanceof Error ? err.message : 'Failed to load approval rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    void fetchProject();
  }, [apiUrl, projectId, router.isReady]);

  const updateRule = (environment: string, field: 'require_manager_approval' | 'require_devops_approval', value: boolean) => {
    setProject((current) => {
      if (!current) return current;
      const nextRules = current.approval_rules?.length
        ? current.approval_rules.map((rule) => (rule.environment === environment ? { ...rule, [field]: value } : rule))
        : defaultRulesForEnvironments(current.environments).map((rule) =>
            rule.environment === environment ? { ...rule, [field]: value } : rule,
          );
      return { ...current, approval_rules: nextRules };
    });
  };

  const saveProjectPolicies = async () => {
    if (!project) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }

    setSaving(true);
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
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to save approval rules'));
      }
      setNotice(`Saved approval rules for ${project.name}.`);
      await router.push('/gate-policies');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save approval rules');
    } finally {
      setSaving(false);
    }
  };

  const environments = useMemo(() => project?.environments || [], [project]);

  return (
    <DevOpsLayout>
      <Head>
        <title>{project ? `Rules · ${project.name}` : 'Edit approval rules'} - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <Link href="/gate-policies" className="di-back">
              ← Back to rules
            </Link>
            <span className="portal-page__eyebrow">Approvals</span>
            <h1 className="portal-page__title">{project ? project.name : 'Edit approval rules'}</h1>
            <p className="portal-page__subtitle">
              {project
                ? `${project.owner_team ? `Owner team: ${project.owner_team}. ` : ''}Set manager and DevOps requirements for each environment.`
                : 'Load a project to edit its gate rules.'}
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/gate-policies" className="btn btn-secondary">
              Cancel
            </Link>
            <button type="button" className="btn btn-primary" disabled={!project || saving} onClick={() => void saveProjectPolicies()}>
              {saving ? 'Saving...' : 'Save rules'}
            </button>
          </div>
        </div>

        <ApprovalsSectionNav />

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        {loading ? (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>Loading project rules...</p>
            </div>
          </section>
        ) : !project ? (
          <div className="portal-table-state portal-table-state--empty">
            <h3 className="portal-table-state__title">Project not found</h3>
            <p className="portal-table-state__copy">Return to the rules list and pick another project.</p>
            <div className="portal-table-state__actions">
              <Link href="/gate-policies" className="btn btn-primary">
                Back to rules
              </Link>
            </div>
          </div>
        ) : (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">{project.code || `Project ${project.id}`}</span>
                <h2 className="portal-surface__title">Environment gates</h2>
                <p className="portal-surface__subtitle">
                  These toggles are the baseline. Incidents, overrides, and change windows still apply during promotion.
                </p>
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
                  {environments.map((environment) => {
                    const rule =
                      project.approval_rules.find((entry) => entry.environment === environment) || {
                        environment,
                        require_manager_approval: environment !== 'dev',
                        require_devops_approval: true,
                      };
                    return (
                      <tr key={environment}>
                        <td>
                          <strong>{environment.toUpperCase()}</strong>
                        </td>
                        <td>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={rule.require_manager_approval}
                              onChange={(event) => updateRule(environment, 'require_manager_approval', event.target.checked)}
                            />
                            Require manager review
                          </label>
                        </td>
                        <td>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={rule.require_devops_approval}
                              onChange={(event) => updateRule(environment, 'require_devops_approval', event.target.checked)}
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
        )}
      </div>
    </DevOpsLayout>
  );
}
