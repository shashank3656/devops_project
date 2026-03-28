import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';

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

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export default function NewAccessOverridePage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [environments, setEnvironments] = useState('dev');
  const [permission, setPermission] = useState('write');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
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
          throw new Error(getString(data.error, 'Failed to load access override options'));
        }
        setProjects(normalizeProjects(data.projects));
        setUsers(normalizeUsers(data.users));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load access override options');
      } finally {
        setLoading(false);
      }
    };
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
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to create override'));
      }
      await router.push('/access-overrides');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create override');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Create Access Override - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations Control</span>
            <h1 className="portal-page__title">Create access override</h1>
            <p className="portal-page__subtitle">
              Grant temporary emergency access on a dedicated page, then return to the override list to review active windows.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/access-overrides" className="btn btn-secondary">
              Back to overrides
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Temporary Grant</span>
              <h2 className="portal-surface__title">Override details</h2>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading override options...</div>
          ) : (
            <>
              <div className="portal-form-grid">
                <label className="label">
                  Project
                  <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                    <option value="">Select project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  User
                  <select className="input" value={userId} onChange={(event) => setUserId(event.target.value)}>
                    <option value="">Select user</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username}
                      </option>
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
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !projectId || !userId || !expiresAt}
                  onClick={() => void createOverride()}
                >
                  {saving ? 'Creating...' : 'Create override'}
                </button>
                <Link href="/access-overrides" className="btn btn-secondary">
                  Cancel
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
