import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import {
  WEBHOOK_CHANGE_SAMPLE,
  WEBHOOK_INCIDENT_SAMPLE,
  webhookOrigin,
  webhookUseLabel,
  webhookUsePath,
} from '../../../lib/inboundWebhooks';
import { PageHeader } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';
const USER_KEY = 'devops_user';

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

export default function WebhooksPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const origin = webhookOrigin(apiUrl);
  const changeUrl = `${origin}/api/webhooks/change`;
  const incidentUrl = `${origin}/api/webhooks/alerts`;
  const [copied, setCopied] = useState('');
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
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
        throw new Error(typeof sourceBody.error === 'string' ? sourceBody.error : 'Could not load webhooks');
      }
      setSources(Array.isArray(sourceBody.sources) ? sourceBody.sources : []);
      if (projectRes.ok) {
        const projectBody = await projectRes.json().catch(() => ({}));
        setProjects(Array.isArray(projectBody.projects) ? projectBody.projects : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load webhooks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [apiUrl]);

  useEffect(() => {
    if (router.query.created === '1') setNotice('Webhook saved. Send the secret in the X-CI-Secret header. It will not be shown again.');
  }, [router.query.created]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
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
      setError(typeof body.error === 'string' ? body.error : 'Could not update the webhook');
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
      setError('Could not remove the webhook');
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
      <div className="portal-page">
        <PageHeader
          eyebrow="Operations"
          title="Webhooks"
          subtitle="Each pipeline or monitor gets its own secret. Send that value in the X-CI-Secret header. The saved value is never shown again."
          actions={<Link href="/operations/webhooks/new" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>Create webhook</Link>}
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface portal-surface--table">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Saved</span>
              <h2 className="portal-surface__title">Saved webhooks</h2>
              <p className="portal-surface__subtitle">A change secret opens a change. An incident, Grafana, Alertmanager, or log secret opens an incident.</p>
            </div>
          </div>
          {loading ? <div className="empty-state">Loading webhooks...</div> : sources.length === 0 ? (
            <div className="empty-state">
              <p>No webhooks yet.</p>
              <Link href="/operations/webhooks/new" className="btn btn-primary">Create webhook</Link>
            </div>
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
                      <td>{webhookUseLabel(source.kind)}</td>
                      <td><code style={{ whiteSpace: 'nowrap' }}>{origin}{webhookUsePath(source.kind)}</code></td>
                      <td><code>X-CI-Secret</code></td>
                      <td>{projectName(source.project_id)}</td>
                      <td>{source.enabled && source.has_secret ? 'Ready' : 'Off'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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

        <div className="request-split">
          <section className="portal-surface request-panel">
            <h2 className="portal-surface__title">Change request</h2>
            <p className="portal-surface__subtitle">POST after a merge. <code>repo</code> and <code>sha</code> are required.</p>
            <p className="changes-page__webhook-url"><code>{changeUrl}</code></p>
            <button type="button" className="btn btn-secondary" onClick={() => void copy('change', changeUrl)}>{copied === 'change' ? 'Copied' : 'Copy change URL'}</button>
            <pre className="code-block">{WEBHOOK_CHANGE_SAMPLE}</pre>
          </section>
          <section className="portal-surface request-panel">
            <h2 className="portal-surface__title">Incident</h2>
            <p className="portal-surface__subtitle">POST when a monitor fires. A title opens the incident. Send <code>status: resolved</code> when it clears.</p>
            <p className="changes-page__webhook-url"><code>{incidentUrl}</code></p>
            <button type="button" className="btn btn-secondary" onClick={() => void copy('incident', incidentUrl)}>{copied === 'incident' ? 'Copied' : 'Copy incident URL'}</button>
            <pre className="code-block">{WEBHOOK_INCIDENT_SAMPLE}</pre>
          </section>
        </div>
      </div>
    </DevOpsLayout>
  );
}
