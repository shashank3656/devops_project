import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../components/AdminLayout';
import CopyField from '../components/CopyField';
import { copyText } from '../lib/clipboard';

interface Webhook {
  id: number;
  url: string;
  events: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface InboundSource {
  id: number;
  kind: string;
  name: string;
  has_secret: boolean;
  enabled: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  approved: 'Request approved',
  pr_created: 'Pull request opened',
  rejected: 'Request rejected',
  assigned: 'Request assigned',
  'change.created': 'Change created',
  'change.updated': 'Change updated',
  'incident.opened': 'Incident opened',
  'incident.updated': 'Incident updated',
  'incident.owner_paged': 'Owner paged',
  'watch.failed': 'Watch failed',
  'watch.ended': 'Watch ended',
};

const SOURCE_KIND_LABELS: Record<string, string> = {
  change: 'Change CI',
  grafana: 'Grafana',
  alertmanager: 'Alertmanager',
  generic_log: 'Logger',
  alert: 'Alert source',
};

function eventLabel(event: string): string {
  return EVENT_LABELS[event] || event;
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [sources, setSources] = useState<InboundSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toggleLoading, setToggleLoading] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);
  const [sourceDeleteLoading, setSourceDeleteLoading] = useState<number | null>(null);
  const [copiedSample, setCopiedSample] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
  const origin = apiUrl.replace(/\/$/, '');

  const inboundEndpoints = useMemo(
    () => [
      {
        id: 'ci',
        title: 'Infra CI',
        purpose: 'Plan, policy, and apply results from GitHub or GitLab.',
        url: `${origin}/api/webhooks/ci`,
        auth: 'X-CI-Secret',
      },
      {
        id: 'change',
        title: 'Changes',
        purpose: 'Record a deploy after merge to main.',
        url: `${origin}/api/webhooks/change`,
        auth: 'X-CI-Secret or HMAC',
      },
      {
        id: 'alerts',
        title: 'Alerts',
        purpose: 'Open or update an incident from Grafana or Alertmanager.',
        url: `${origin}/api/webhooks/alerts`,
        auth: 'X-CI-Secret or HMAC',
      },
      {
        id: 'irm',
        title: 'IRM',
        purpose: 'Ack or resolve the same incident from PagerDuty or Grafana IRM.',
        url: `${origin}/api/webhooks/irm`,
        auth: 'X-CI-Secret',
      },
      {
        id: 'github',
        title: 'GitHub',
        purpose: 'PR events for deploy briefs and check runs.',
        url: `${origin}/api/webhooks/github`,
        auth: 'X-Hub-Signature-256',
      },
      {
        id: 'flags',
        title: 'Feature flags',
        purpose: 'Create a flag change from LaunchDarkly, Unleash, or Flagsmith.',
        url: `${origin}/api/webhooks/flags`,
        auth: 'X-CI-Secret',
      },
      {
        id: 'otlp',
        title: 'Metrics',
        purpose: 'Push OTLP samples into Health when a service has no metrics URL.',
        url: `${origin}/api/otlp/v1/metrics`,
        auth: 'X-CI-Secret',
      },
    ],
    [origin],
  );

  const sampleCurl = `curl -sf -X POST "${origin}/api/webhooks/ci" \\
  -H "Content-Type: application/json" \\
  -H "X-CI-Secret: $INFRAGATE_CI_SECRET" \\
  -d '{"request_id":123,"status":"plan_success","plan_output":"...","policy_reports":[],"infracost_report":{}}'`;

  const fetchWebhooks = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/webhooks`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
        setError('');
      } else {
        setError(data.error || 'Failed to load webhooks');
      }
      const sourceRes = await fetch(`${apiUrl}/api/admin/inbound-sources`, { headers: { Authorization: `Bearer ${token}` } });
      const sourceData = await sourceRes.json().catch(() => ({}));
      if (sourceRes.ok) {
        setSources(Array.isArray(sourceData.sources) ? sourceData.sources : []);
      }
    } catch (_) {
      setError('Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchWebhooks();
  }, [token, apiUrl]);

  const handleToggle = async (w: Webhook) => {
    setToggleLoading(w.id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/webhooks/${w.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled: !w.enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.webhook) {
        setWebhooks((prev) => prev.map((x) => (x.id === w.id ? { ...x, enabled: data.webhook.enabled } : x)));
      } else {
        setError(data.error || 'Failed to update');
      }
    } catch (_) {
      setError('Failed to update webhook');
    } finally {
      setToggleLoading(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this destination? SetuOps will stop posting events to it.')) return;
    setDeleteLoading(id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/webhooks/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setWebhooks((prev) => prev.filter((x) => x.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to delete');
      }
    } catch (_) {
      setError('Failed to delete webhook');
    } finally {
      setDeleteLoading(null);
    }
  };

  const handleDeleteSource = async (id: number) => {
    if (!confirm('Delete this secret? Pipelines still using it will get 401.')) return;
    setSourceDeleteLoading(id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/inbound-sources/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSources((prev) => prev.filter((item) => item.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to delete source');
      }
    } catch (_) {
      setError('Failed to delete inbound source');
    } finally {
      setSourceDeleteLoading(null);
    }
  };

  const copySample = async () => {
    const ok = await copyText(sampleCurl);
    if (!ok) return;
    setCopiedSample(true);
    window.setTimeout(() => setCopiedSample(false), 1600);
  };

  return (
    <>
      <Head>
        <title>Integrations - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Integrations</span>
              <h1 className="portal-page__title">Webhooks</h1>
              <p className="portal-page__subtitle">
                Paste a URL into CI or Grafana. Add a destination if Slack or another system should hear about approvals.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/webhooks/inbound/new" className="btn btn-secondary">
                Add secret
              </Link>
              <Link href="/webhooks/new" className="btn btn-primary">
                Add destination
              </Link>
            </div>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <span>{error}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setError(''); fetchWebhooks(); }}>
                Retry
              </button>
            </div>
          )}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Receive</span>
                <h2 className="portal-surface__title">Endpoints your tools post to</h2>
                <p className="portal-surface__subtitle">
                  Copy a URL into the tool. GitHub checks <code>infragate/plan-review</code> and <code>infragate/policy</code> wait on the Infra CI endpoint.
                </p>
              </div>
            </div>
            <ul className="admin-setup-list">
              {inboundEndpoints.map((endpoint) => (
                <li key={endpoint.id} className="admin-setup-row">
                  <div className="admin-setup-row__copy">
                    <h3>{endpoint.title}</h3>
                    <p>{endpoint.purpose}</p>
                    <span className="admin-setup-row__meta">Auth: {endpoint.auth}</span>
                  </div>
                  <CopyField value={endpoint.url} />
                </li>
              ))}
            </ul>
            <details className="admin-setup-sample">
              <summary>Sample Infra CI request</summary>
              <div className="admin-setup-sample__toolbar">
                <p>Use this from a pipeline after plan. Replace the secret with the value stored as a named secret or <code>CI_WEBHOOK_SECRET</code>.</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copySample()}>
                  {copiedSample ? 'Copied' : 'Copy curl'}
                </button>
              </div>
              <pre className="admin-maintenance-card__code-block">{sampleCurl}</pre>
            </details>
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Send</span>
                <h2 className="portal-surface__title">Destinations SetuOps calls</h2>
                <p className="portal-surface__subtitle">
                  Slack, Teams, or any HTTPS URL. Pick the events, optionally sign with a shared secret.
                </p>
              </div>
              <Link href="/webhooks/new" className="btn btn-secondary">
                Add destination
              </Link>
            </div>
            {loading ? (
              <div className="admin-queue-state">
                <div className="admin-queue-state__spinner" aria-hidden="true" />
                <p className="admin-queue-state__title">Loading destinations</p>
              </div>
            ) : !error && webhooks.length === 0 ? (
              <div className="admin-queue-state">
                <p className="admin-queue-state__title">No destinations yet</p>
                <p className="admin-queue-state__copy">
                  Add a Slack incoming webhook or your own URL to get a POST when a request is approved or an incident opens.
                </p>
                <div className="admin-queue-state__actions">
                  <Link href="/webhooks/new" className="btn btn-primary">
                    Add destination
                  </Link>
                </div>
              </div>
            ) : !error ? (
              <ul className="admin-webhook-list">
                {webhooks.map((w) => {
                  const events = (w.events || '').split(',').map((event) => event.trim()).filter(Boolean);
                  return (
                    <li key={w.id} className="admin-webhook-row">
                      <div className="admin-webhook-row__top">
                        <CopyField value={w.url} />
                        <span className={`admin-webhook-status${w.enabled ? ' is-on' : ''}`}>
                          {w.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <div className="admin-webhook-row__events">
                        {events.length === 0 ? (
                          <span className="admin-webhook-chip">No events</span>
                        ) : (
                          events.map((event) => (
                            <span key={event} className="admin-webhook-chip">
                              {eventLabel(event)}
                            </span>
                          ))
                        )}
                      </div>
                      <div className="admin-webhook-row__actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={toggleLoading === w.id}
                          onClick={() => handleToggle(w)}
                        >
                          {toggleLoading === w.id ? 'Saving…' : w.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={deleteLoading === w.id}
                          onClick={() => handleDelete(w.id)}
                        >
                          {deleteLoading === w.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Secrets</span>
                <h2 className="portal-surface__title">Named inbound secrets</h2>
                <p className="portal-surface__subtitle">
                  Give Grafana or CI its own secret so you can rotate one tool without changing the others. If none are set, pipelines can still use <code>CI_WEBHOOK_SECRET</code>, <code>CHANGE_WEBHOOK_SECRET</code>, or <code>ALERT_WEBHOOK_SECRET</code> on the API host.
                </p>
              </div>
              <Link href="/webhooks/inbound/new" className="btn btn-secondary">
                Add secret
              </Link>
            </div>
            {sources.length === 0 ? (
              <div className="admin-queue-state">
                <p className="admin-queue-state__title">Using the shared API secrets</p>
                <p className="admin-queue-state__copy">
                  Add a named secret when more than one tool posts in, or when you want to rotate Grafana without touching CI.
                </p>
                <div className="admin-queue-state__actions">
                  <Link href="/webhooks/inbound/new" className="btn btn-secondary">
                    Add secret
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="admin-webhook-list">
                {sources.map((source) => (
                  <li key={source.id} className="admin-webhook-row">
                    <div className="admin-webhook-row__top">
                      <div>
                        <strong>{source.name}</strong>
                        <p className="admin-setup-row__meta">
                          {SOURCE_KIND_LABELS[source.kind] || source.kind}
                          {' · '}
                          {source.has_secret ? 'Secret set' : 'Secret missing'}
                        </p>
                      </div>
                      <span className={`admin-webhook-status${source.enabled ? ' is-on' : ''}`}>
                        {source.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="admin-webhook-row__actions">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={sourceDeleteLoading === source.id}
                        onClick={() => handleDeleteSource(source.id)}
                      >
                        {sourceDeleteLoading === source.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </AdminLayout>
    </>
  );
}
