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
const REVEAL_MS = 5 * 60 * 1000;

interface ProjectOption {
  id: number;
  name: string;
  code?: string;
}

function generateCISecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function formatRemain(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
  const [saved, setSaved] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealUntil, setRevealUntil] = useState(0);
  const [remainMs, setRemainMs] = useState(REVEAL_MS);

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

  useEffect(() => {
    if (!revealUntil) return undefined;
    const tick = () => {
      const left = revealUntil - Date.now();
      if (left <= 0) {
        setSecret('');
        setRevealUntil(0);
        setRemainMs(0);
        setHidden(true);
        return;
      }
      setRemainMs(left);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [revealUntil]);

  function startReveal(value: string) {
    setSecret(value);
    setHidden(false);
    setRevealUntil(Date.now() + REVEAL_MS);
    setRemainMs(REVEAL_MS);
  }

  function generate() {
    startReveal(generateCISecret());
    setCopied(false);
    setError('');
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function createSecret(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    if (hidden && !secret.trim()) {
      setError('Generate a new X-CI-Secret. The previous value can no longer be shown.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const generated = !secret.trim();
      const response = await fetch(`${apiUrl}/api/devops/inbound-sources`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          secret: secret.trim(),
          generate: generated,
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
      const revealed = typeof body.secret === 'string' ? body.secret.trim() : secret.trim();
      if (revealed) startReveal(revealed);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the webhook');
    } finally {
      setSaving(false);
    }
  }

  const showingSecret = Boolean(secret) && !hidden;

  return (
    <DevOpsLayout>
      <Head><title>Create webhook - OpsTrellis</title></Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Operations"
          title="Create webhook"
          subtitle="Generate an X-CI-Secret, copy it, then send that value in the X-CI-Secret header. After five minutes it cannot be shown again."
          actions={<Link href="/operations/webhooks" className="btn btn-secondary">Back to webhooks</Link>}
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        {saved ? <div className="alert alert-success">Webhook saved. Copy the secret now if you have not already.</div> : null}
        {showingSecret ? (
          <div className="portal-surface webhook-secret-reveal">
            <p className="portal-surface__subtitle">X-CI-Secret</p>
            <code className="webhook-secret-reveal__value">{secret}</code>
            <div className="webhook-secret-reveal__actions">
              <button type="button" className="btn btn-primary" onClick={() => void copySecret()}>
                {copied ? 'Copied' : 'Copy secret'}
              </button>
              <span className="webhook-secret-reveal__timer">Visible for {formatRemain(remainMs)}</span>
            </div>
            <p className="chg-detail__hint">Send that value in the X-CI-Secret header. Lists and later visits will not show it.</p>
          </div>
        ) : null}
        {hidden ? (
          <div className="alert">This value can no longer be shown. Send the copied secret in the X-CI-Secret header.</div>
        ) : null}
        {saved ? (
          <div style={{ marginTop: 16 }}>
            <Link href="/operations/webhooks" className="btn btn-primary">Back to webhooks</Link>
          </div>
        ) : (
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
            <div className="label" style={{ gridColumn: '1 / -1' }}>
              X-CI-Secret
              {showingSecret ? (
                <input className="input" type="text" readOnly value={secret} />
              ) : (
                <input className="input" type="password" autoComplete="new-password" value="" readOnly placeholder="Generate a secret, then copy it" />
              )}
              <div className="webhook-secret-reveal__actions" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={generate} disabled={saving}>
                  Generate
                </button>
                {showingSecret ? (
                  <span className="chg-detail__hint">Copy it before {formatRemain(remainMs)} runs out.</span>
                ) : (
                  <span className="chg-detail__hint">Generate a value, copy it, then create the webhook.</span>
                )}
              </div>
            </div>
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
              <button type="submit" className="btn btn-primary" disabled={saving || (!secret.trim() && hidden)}>
                {saving ? 'Saving...' : 'Create webhook'}
              </button>
              <Link href="/operations/webhooks" className="btn btn-secondary">Cancel</Link>
            </div>
          </form>
        )}
      </div>
    </DevOpsLayout>
  );
}
