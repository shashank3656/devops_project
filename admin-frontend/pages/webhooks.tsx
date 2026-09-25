import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../components/AdminLayout';

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

const EVENT_OPTIONS = ['approved', 'pr_created', 'rejected', 'assigned', 'change.created', 'change.updated', 'incident.opened', 'incident.updated', 'incident.owner_paged', 'watch.failed', 'watch.ended'];

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [sources, setSources] = useState<InboundSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toggleLoading, setToggleLoading] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);
  const [sourceDeleteLoading, setSourceDeleteLoading] = useState<number | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
  const ciWebhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/ci`;
  const changeWebhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/change`;
  const alertWebhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/alerts`;
  const irmWebhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/irm`;
  const flagWebhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/flags`;
  const otlpWebhookUrl = `${apiUrl.replace(/\/$/, '')}/api/otlp/v1/metrics`;

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
    if (!confirm('Delete this webhook? It will stop receiving events.')) return;
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
    if (!confirm('Delete this inbound source? Pipelines using that secret will get 401.')) return;
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

  return (
    <>
      <Head>
        <title>Webhooks - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Webhooks</span>
              <h1 className="portal-page__title">Webhooks</h1>
              <p className="portal-page__subtitle">
                Outbound routes SetuOps calls, and the inbound endpoints your pipeline posts to.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/webhooks/new" className="btn btn-primary">
                Add webhook
              </Link>
            </div>
          </div>

          {error && (
            <div className="alert alert-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <span>{error}</span>
              <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={() => { setError(''); fetchWebhooks(); }}>
                Retry
              </button>
            </div>
          )}

          <div className="portal-surface" style={{ marginBottom: 24 }}>
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Outbound</span>
                <h2 className="portal-surface__title">Routes SetuOps calls</h2>
              </div>
            </div>
            {loading ? (
              <div className="empty-state">Loading...</div>
            ) : !error && webhooks.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No outbound webhooks yet.</p>
            ) : !error ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>Events</th>
                      <th>Status</th>
                      <th style={{ width: 140 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((w) => (
                      <tr key={w.id}>
                        <td style={{ wordBreak: 'break-all', color: 'var(--color-text)' }}>{w.url}</td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{w.events || '-'}</td>
                        <td>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: w.enabled ? 'var(--color-success-bg)' : 'var(--color-border)',
                            color: w.enabled ? 'var(--color-success)' : 'var(--color-text-muted)',
                          }}>
                            {w.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ marginRight: 8, padding: '6px 12px', fontSize: 13 }}
                            disabled={toggleLoading === w.id}
                            onClick={() => handleToggle(w)}
                          >
                            {toggleLoading === w.id ? '...' : w.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ padding: '6px 12px', fontSize: 13 }}
                            disabled={deleteLoading === w.id}
                            onClick={() => handleDelete(w.id)}
                          >
                            {deleteLoading === w.id ? '...' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <section className="admin-maintenance-card" style={{ marginBottom: 24 }}>
            <div className="admin-maintenance-card__header">
              <div>
                <span className="portal-page__eyebrow">Inbound</span>
                <h2 className="admin-maintenance-card__title">Endpoints your pipeline posts to</h2>
                <p className="admin-maintenance-card__copy">
                  Send <code>X-CI-Secret</code>. GitHub checks <code>infragate/plan-review</code> and <code>infragate/policy</code> wait on plan and policy status.
                </p>
              </div>
            </div>
            <div className="admin-maintenance-card__body">
              <dl className="admin-endpoint-list">
                <div><dt>Infra CI</dt><dd><code>{ciWebhookUrl}</code></dd></div>
                <div><dt>Changes</dt><dd><code>{changeWebhookUrl}</code></dd></div>
                <div><dt>Alerts</dt><dd><code>{alertWebhookUrl}</code></dd></div>
                <div><dt>IRM</dt><dd><code>{irmWebhookUrl}</code></dd></div>
                <div><dt>Flags</dt><dd><code>{flagWebhookUrl}</code></dd></div>
                <div><dt>OTLP</dt><dd><code>{otlpWebhookUrl}</code></dd></div>
              </dl>
              <details>
                <summary>Sample CI request</summary>
                <pre className="admin-maintenance-card__code-block" style={{ overflow: 'auto', fontSize: 12, padding: 16, borderRadius: 8, background: 'var(--color-surface-muted)' }}>
                  {`curl -sf -X POST "${ciWebhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-CI-Secret: $INFRAGATE_CI_SECRET" \\
  -d '{"request_id":123,"status":"plan_success","plan_output":"...","policy_reports":[],"infracost_report":{}}'`}
                </pre>
              </details>
            </div>
          </section>

          <div className="portal-surface" style={{ marginBottom: 24 }}>
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Inbound sources</span>
                <h2 className="portal-surface__title">Change and alert secrets</h2>
                <p className="portal-surface__subtitle">
                  Optional per-source secrets for Grafana, Alertmanager, loggers, and CI change posts. Env fallbacks are CHANGE_WEBHOOK_SECRET, ALERT_WEBHOOK_SECRET, and CI_WEBHOOK_SECRET.
                </p>
              </div>
              <Link href="/webhooks/inbound/new" className="btn btn-secondary">
                Add source
              </Link>
            </div>
            {sources.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No inbound sources yet. Pipelines can still use the environment secrets.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Kind</th>
                      <th>Secret</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((source) => (
                      <tr key={source.id}>
                        <td>{source.name}</td>
                        <td>{source.kind}</td>
                        <td>{source.has_secret ? 'Set' : 'Missing'}</td>
                        <td>{source.enabled ? 'Enabled' : 'Disabled'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ padding: '6px 12px', fontSize: 13 }}
                            disabled={sourceDeleteLoading === source.id}
                            onClick={() => handleDeleteSource(source.id)}
                          >
                            {sourceDeleteLoading === source.id ? '...' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </AdminLayout>
    </>
  );
}
