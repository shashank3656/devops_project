import Head from 'next/head';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';
const USER_KEY = 'devops_user';

const USES = [
  { id: 'change', label: 'Change request', path: '/api/webhooks/change' },
  { id: 'alert', label: 'Incident', path: '/api/webhooks/alerts' },
  { id: 'grafana', label: 'Grafana', path: '/api/webhooks/alerts' },
  { id: 'alertmanager', label: 'Alertmanager', path: '/api/webhooks/alerts' },
  { id: 'generic_log', label: 'Logs', path: '/api/webhooks/alerts' },
] as const;

type SourceKind = (typeof USES)[number]['id'];

interface SourceRow {
  id: number;
  kind: string;
  name: string;
  has_secret: boolean;
  enabled: boolean;
  project_id?: number;
}

interface ProjectOption {
  id: number;
  name: string;
  code?: string;
}

function originOf(apiUrl: string) {
  return apiUrl.replace(/\/$/, '').replace(/\/api\/webhooks\/(?:change|alerts)$/, '');
}

function useLabel(kind: string) {
  return USES.find((item) => item.id === kind)?.label || kind;
}

function usePath(kind: string) {
  return USES.find((item) => item.id === kind)?.path || '/api/webhooks/alerts';
}

const CHANGE_SAMPLE = `{
  "repo": "org/checkout",
  "sha": "abc123def456",
  "service": "checkout",
  "title": "Deploy main",
  "summary": "Ship the checkout fix",
  "author": "ci",
  "status": "implemented",
  "change_type": "standard",
  "environment": "prod"
}`;

const INCIDENT_SAMPLE = `{
  "title": "Checkout error rate",
  "message": "Error rate stayed above 5% for 5 minutes",
  "service": "checkout",
  "environment": "prod",
  "severity": "high",
  "status": "firing",
  "project_code": "checkout"
}`;

export default function WebhooksPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const origin = originOf(apiUrl);
  const changeUrl = `${origin}/api/webhooks/change`;
  const incidentUrl = `${origin}/api/webhooks/alerts`;
  const [copied, setCopied] = useState('');
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SourceKind>('change');
  const [secret, setSecret] = useState('');
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function authHeaders() {
    return { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ''}`, 'Content-Type': 'application/json' };
  }

  function leave() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    void router.replace('/login');
  }

  async function load() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      leave();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [sourceRes, projectRes] = await Promise.all([
        fetch(`${apiUrl}/api/devops/inbound-sources`, { headers: authHeaders() }),
        fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (sourceRes.status === 401) {
        leave();
        return;
      }
      const sourceBody = await sourceRes.json().catch(() => ({}));
      if (!sourceRes.ok) {
        throw new Error(typeof sourceBody.error === 'string' ? sourceBody.error : 'Could not load CI secrets');
      }
      setSources(Array.isArray(sourceBody.sources) ? sourceBody.sources : []);
      if (projectRes.ok) {
        const projectBody = await projectRes.json().catch(() => ({}));
        setProjects(Array.isArray(projectBody.projects) ? projectBody.projects : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load CI secrets');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [apiUrl]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  }

  async function createSecret(event: FormEvent) {
    event.preventDefault();
    if (!secret.trim()) {
      setError('Enter an X-CI-Secret. It is sent once and is not shown again.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/inbound-sources`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: name.trim(),
          kind,
          secret,
          project_id: projectId ? Number(projectId) : null,
        }),
      });
      if (response.status === 401) {
        leave();
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save the CI secret');
      }
      setName('');
      setSecret('');
      setProjectId('');
      setNotice(`${useLabel(kind)} secret saved. Send it in the X-CI-Secret header. It will not be shown again.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the CI secret');
    } finally {
      setSaving(false);
    }
  }

  async function setEnabled(source: SourceRow, enabled: boolean) {
    setError('');
    const response = await fetch(`${apiUrl}/api/devops/inbound-sources/${source.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({
        name: source.name,
        kind: source.kind,
        enabled,
        project_id: source.project_id || null,
      }),
    });
    if (response.status === 401) {
      leave();
      return;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(typeof body.error === 'string' ? body.error : 'Could not update the secret');
      return;
    }
    await load();
  }

  async function remove(source: SourceRow) {
    setError('');
    const response = await fetch(`${apiUrl}/api/devops/inbound-sources/${source.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (response.status === 401) {
      leave();
      return;
    }
    if (!response.ok) {
      setError('Could not remove the secret');
      return;
    }
    await load();
  }

  function projectName(id?: number) {
    if (!id) return 'Any project';
    const project = projects.find((item) => item.id === id);
    return project ? (project.code || project.name) : `Project ${id}`;
  }

  return (
    <DevOpsLayout>
      <Head><title>Webhooks - SetuOps</title></Head>
      <div className="alert-page">
        <header className="work-page__head">
          <div>
            <h1>Webhooks</h1>
            <p>Each pipeline or monitor gets its own secret. Send that value in the <code>X-CI-Secret</code> header. The saved value is never shown again.</p>
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <h2 className="portal-surface__title">New X-CI-Secret</h2>
              <p className="portal-surface__subtitle">Create one secret per use. A change secret opens a change. An incident, Grafana, Alertmanager, or log secret opens an incident.</p>
            </div>
          </div>
          <form className="alert-channels" onSubmit={(event) => void createSecret(event)}>
            <label className="label">Name
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout deploy" />
            </label>
            <label className="label">Use
              <select className="input" value={kind} onChange={(event) => setKind(event.target.value as SourceKind)}>
                {USES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="label">X-CI-Secret
              <input className="input" type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Paste a secret for this caller" />
            </label>
            <label className="label">Project
              <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">Any project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.code || project.name}</option>
                ))}
              </select>
            </label>
            <div className="alert-channel--wide">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create secret'}</button>
            </div>
          </form>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <h2 className="portal-surface__title">Saved secrets</h2>
          </div>
          {loading ? <div className="empty-state">Loading secrets...</div> : sources.length === 0 ? (
            <div className="empty-state">No CI secrets yet. Create one before a pipeline can open a change or an incident.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Use</th>
                    <th>Address</th>
                    <th>Header</th>
                    <th>Project</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.id}>
                      <td>{source.name}</td>
                      <td>{useLabel(source.kind)}</td>
                      <td><code>{origin}{usePath(source.kind)}</code></td>
                      <td><code>X-CI-Secret</code></td>
                      <td>{projectName(source.project_id)}</td>
                      <td>{source.enabled && source.has_secret ? 'Ready' : 'Off'}</td>
                      <td>
                        <div className="portal-page__actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void setEnabled(source, !source.enabled)}>
                            {source.enabled ? 'Turn off' : 'Turn on'}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void remove(source)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="access-hint">The pipeline secret <code>SETUOPS_API_URL</code> should be only <code>{origin}</code>. The samples already add the webhook path.</p>
        <div className="request-split">
          <section className="portal-surface request-panel">
            <h2 className="access-form__title">Change request</h2>
            <p className="access-hint">POST after a merge. <code>repo</code> and <code>sha</code> are required. The same pair updates the existing change.</p>
            <p className="changes-page__webhook-url"><code>{changeUrl}</code></p>
            <button type="button" className="btn btn-secondary" onClick={() => void copy('change', changeUrl)}>{copied === 'change' ? 'Copied' : 'Copy change URL'}</button>
            <pre className="code-block">{CHANGE_SAMPLE}</pre>
          </section>
          <section className="portal-surface request-panel">
            <h2 className="access-form__title">Incident</h2>
            <p className="access-hint">POST when a monitor fires. A title opens the incident. Send <code>status: resolved</code> when it clears.</p>
            <p className="changes-page__webhook-url"><code>{incidentUrl}</code></p>
            <button type="button" className="btn btn-secondary" onClick={() => void copy('incident', incidentUrl)}>{copied === 'incident' ? 'Copied' : 'Copy incident URL'}</button>
            <pre className="code-block">{INCIDENT_SAMPLE}</pre>
          </section>
        </div>
      </div>
    </DevOpsLayout>
  );
}
