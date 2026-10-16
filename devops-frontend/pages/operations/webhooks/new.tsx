import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { WEBHOOK_USES, type WebhookUse } from '../../../lib/inboundWebhooks';
import { PageHeader } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';
const USER_KEY = 'devops_user';

interface ProjectOption {
  id: number;
  name: string;
  code?: string;
}

export default function NewWebhookPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WebhookUse>('change');
  const [secret, setSecret] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      localStorage.removeItem(USER_KEY);
      void router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          void router.replace('/login');
          return;
        }
        const body = await res.json().catch(() => ({}));
        if (res.ok) setProjects(Array.isArray(body.projects) ? body.projects : []);
      })
      .catch(() => setProjects([]));
  }, [apiUrl, router]);

  async function createSecret(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    if (!secret.trim()) {
      setError('Enter an X-CI-Secret. It is sent once and is not shown again.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/inbound-sources`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          secret,
          project_id: projectId ? Number(projectId) : null,
        }),
      });
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        void router.replace('/login');
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save the webhook');
      }
      await router.push('/operations/webhooks?created=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the webhook');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DevOpsLayout>
      <Head><title>Create webhook - SetuOps</title></Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Operations"
          title="Create webhook"
          subtitle="One secret per caller. A change secret opens a change. An incident, Grafana, Alertmanager, or log secret opens an incident."
          actions={<Link href="/operations/webhooks" className="btn btn-secondary">Back to webhooks</Link>}
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form className="portal-surface portal-form-grid" onSubmit={(event) => void createSecret(event)}>
          <label className="label">
            Name
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout deploy" required />
          </label>
          <label className="label">
            Use
            <select className="input" value={kind} onChange={(event) => setKind(event.target.value as WebhookUse)}>
              {WEBHOOK_USES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="label">
            X-CI-Secret
            <input className="input" type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Paste a secret for this caller" required />
          </label>
          <label className="label">
            Project
            <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Any project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.code || project.name}</option>
              ))}
            </select>
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create webhook'}</button>
            <Link href="/operations/webhooks" className="btn btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </DevOpsLayout>
  );
}
