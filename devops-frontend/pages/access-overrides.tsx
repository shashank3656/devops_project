import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

interface UserOption {
  id: number;
  username: string;
}

interface OverrideItem {
  id: number;
  project_id: number;
  project_name: string;
  project_code: string;
  user_id: number;
  username: string;
  environments: string[];
  permission: string;
  reason: string;
  expires_at: string;
}

function normalizeProjects(value: unknown): ProjectOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((project) => {
    const item = project && typeof project === 'object' ? (project as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      name: typeof item.name === 'string' ? item.name : 'Unknown',
      code: typeof item.code === 'string' ? item.code : 'n/a',
    };
  });
}

function normalizeUsers(value: unknown): UserOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((user) => {
    const item = user && typeof user === 'object' ? (user as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      username: typeof item.username === 'string' ? item.username : 'unknown',
    };
  });
}

function normalizeOverrides(value: unknown): OverrideItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((override) => {
    const item = override && typeof override === 'object' ? (override as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      project_id: typeof item.project_id === 'number' ? item.project_id : 0,
      project_name: typeof item.project_name === 'string' ? item.project_name : 'Unknown',
      project_code: typeof item.project_code === 'string' ? item.project_code : 'n/a',
      user_id: typeof item.user_id === 'number' ? item.user_id : 0,
      username: typeof item.username === 'string' ? item.username : 'unknown',
      environments: Array.isArray(item.environments)
        ? item.environments.filter((entry: unknown): entry is string => typeof entry === 'string')
        : [],
      permission: typeof item.permission === 'string' ? item.permission : 'read',
      reason: typeof item.reason === 'string' ? item.reason : '',
      expires_at: typeof item.expires_at === 'string' ? item.expires_at : '',
    };
  });
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export default function DevOpsAccessOverridesPage() {
  const apiUrl = useApiUrl();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [overrides, setOverrides] = useState<OverrideItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/access-overrides`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to load access overrides'));
      }
      setProjects(normalizeProjects(data.projects));
      setUsers(normalizeUsers(data.users));
      setOverrides(normalizeOverrides(data.overrides));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load access overrides');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiUrl]);

  const revokeOverride = async (id: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!window.confirm('Revoke this override?')) return;
    try {
      const response = await fetch(`${apiUrl}/api/devops/access-overrides/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to revoke override');
      }
      setNotice('Override revoked.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke override');
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Access Overrides - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations Control</span>
            <h1 className="portal-page__title">Project Access Overrides</h1>
            <p className="portal-page__subtitle">
              Grant temporary project/environment access for emergency windows without changing the long-term project-to-team mapping.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/access-overrides/new" className="btn btn-primary">
              Create override
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface access-overrides__surface-gap">
          <div className="access-overrides__summary-actions">
            <span className="portal-pill">Active overrides {overrides.length}</span>
            <span className="portal-pill">Projects {projects.length}</span>
            <span className="portal-pill">Visible users {users.length}</span>
          </div>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Active Window</span>
              <h2 className="portal-surface__title">Current overrides</h2>
              <p className="portal-surface__subtitle">
                Create overrides on a dedicated page so this view stays focused on active windows and revoke actions.
              </p>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading overrides...</div>
          ) : overrides.length === 0 ? (
            <div className="empty-state">No active overrides.</div>
          ) : (
            <div className="access-overrides__table-wrap">
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>User</th>
                    <th>Env</th>
                    <th>Permission</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((override) => (
                    <tr key={override.id}>
                      <td>
                        <div className="access-overrides__stack">
                          <strong>{override.project_name}</strong>
                          <span className="access-overrides__meta">{override.project_code}</span>
                        </div>
                      </td>
                      <td>
                        <div className="access-overrides__stack">
                          <strong>{override.username}</strong>
                          <span className="access-overrides__meta">User #{override.user_id}</span>
                        </div>
                      </td>
                      <td>
                        <div className="access-overrides__env-row">
                          {override.environments.map((environment) => (
                            <span key={`${override.id}-${environment}`} className="project-detail__tone-chip project-detail__tone-chip--sm">
                              {environment}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className="project-detail__tone-chip project-detail__tone-chip--sm">
                          {override.permission}
                        </span>
                      </td>
                      <td className="access-overrides__expiry">
                        {new Date(override.expires_at).toLocaleString()}
                      </td>
                      <td>
                        <div className="access-overrides__action-row">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void revokeOverride(override.id)}>
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
