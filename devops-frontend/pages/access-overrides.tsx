import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

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
  return value.map((project) => ({
    id: typeof project?.id === 'number' ? project.id : 0,
    name: typeof project?.name === 'string' ? project.name : 'Unknown',
    code: typeof project?.code === 'string' ? project.code : 'n/a',
  }));
}

function normalizeUsers(value: unknown): UserOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((user) => ({
    id: typeof user?.id === 'number' ? user.id : 0,
    username: typeof user?.username === 'string' ? user.username : 'unknown',
  }));
}

function normalizeOverrides(value: unknown): OverrideItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((override) => ({
    id: typeof override?.id === 'number' ? override.id : 0,
    project_id: typeof override?.project_id === 'number' ? override.project_id : 0,
    project_name: typeof override?.project_name === 'string' ? override.project_name : 'Unknown',
    project_code: typeof override?.project_code === 'string' ? override.project_code : 'n/a',
    user_id: typeof override?.user_id === 'number' ? override.user_id : 0,
    username: typeof override?.username === 'string' ? override.username : 'unknown',
    environments: Array.isArray(override?.environments) ? override.environments.filter((item): item is string => typeof item === 'string') : [],
    permission: typeof override?.permission === 'string' ? override.permission : 'read',
    reason: typeof override?.reason === 'string' ? override.reason : '',
    expires_at: typeof override?.expires_at === 'string' ? override.expires_at : '',
  }));
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
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [environments, setEnvironments] = useState('dev');
  const [permission, setPermission] = useState('write');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load access overrides');
      }
      setProjects(normalizeProjects(data?.projects));
      setUsers(normalizeUsers(data?.users));
      setOverrides(normalizeOverrides(data?.overrides));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load access overrides');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiUrl]);

  const createOverride = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const expiryValue = expiresAt ? new Date(expiresAt).toISOString() : '';
      const response = await fetch(`${apiUrl}/api/devops/access-overrides`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: Number(projectId),
          user_id: Number(userId),
          environments: environments.split(',').map((item) => item.trim()).filter(Boolean),
          permission,
          reason,
          expires_at: expiryValue,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create override');
      }
      setNotice('Access override created.');
      setProjectId('');
      setUserId('');
      setEnvironments('dev');
      setPermission('write');
      setReason('');
      setExpiresAt('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create override');
    } finally {
      setSaving(false);
    }
  };

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
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Temporary Grant</span>
              <h2 className="portal-surface__title">Create override</h2>
            </div>
          </div>
          <div className="portal-form-grid">
            <label className="label">
              Project
              <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                ))}
              </select>
            </label>
            <label className="label">
              User
              <select className="input" value={userId} onChange={(event) => setUserId(event.target.value)}>
                <option value="">Select user</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.username}</option>
                ))}
              </select>
            </label>
            <label className="label">
              Environments
              <input className="input" value={environments} onChange={(event) => setEnvironments(event.target.value)} placeholder="dev,uat" />
            </label>
            <label className="label">
              Permission
              <select className="input" value={permission} onChange={(event) => setPermission(event.target.value)}>
                <option value="read">Read</option>
                <option value="write">Write</option>
              </select>
            </label>
            <label className="label">
              Expires at
              <input className="input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </label>
            <label className="label">
              Reason
              <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Emergency release support" />
            </label>
          </div>
          <div className="portal-form-actions">
            <button type="button" className="btn btn-primary" disabled={saving || !projectId || !userId || !expiresAt} onClick={() => void createOverride()}>
              {saving ? 'Creating...' : 'Create override'}
            </button>
          </div>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Active Window</span>
              <h2 className="portal-surface__title">Current overrides</h2>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading overrides...</div>
          ) : overrides.length === 0 ? (
            <div className="empty-state">No active overrides.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
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
                      <td>{override.project_name} ({override.project_code})</td>
                      <td>{override.username}</td>
                      <td>{override.environments.join(', ')}</td>
                      <td>{override.permission}</td>
                      <td>{new Date(override.expires_at).toLocaleString()}</td>
                      <td>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void revokeOverride(override.id)}>
                          Revoke
                        </button>
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
