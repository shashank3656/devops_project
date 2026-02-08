import { useEffect, useState } from 'react';
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

const EVENT_OPTIONS = ['approved', 'pr_created', 'rejected', 'assigned'];

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newEvents, setNewEvents] = useState('approved,pr_created,rejected,assigned');
  const [creating, setCreating] = useState(false);
  const [toggleLoading, setToggleLoading] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) {
      setError('URL is required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          url: newUrl.trim(),
          secret: newSecret.trim() || undefined,
          events: newEvents.trim() || 'approved,pr_created,rejected,assigned',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNewUrl('');
        setNewSecret('');
        setNewEvents('approved,pr_created,rejected,assigned');
        fetchWebhooks();
      } else {
        setError(data.error || 'Failed to create webhook');
      }
    } catch (_) {
      setError('Failed to create webhook');
    } finally {
      setCreating(false);
    }
  };

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

  return (
    <>
      <Head>
        <title>Webhooks - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <h1 className="page-title" style={{ marginBottom: 8 }}>Webhooks</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Outbound webhooks are called when request state changes (e.g. approved, PR created, rejected, assigned). Payload is JSON with <code>event</code>, <code>request_id</code>, and request fields. Optional secret for <code>X-Webhook-Signature: sha256=...</code>.
          </p>

          {error && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <span>{error}</span>
              <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={() => { setError(''); fetchWebhooks(); }}>
                Retry
              </button>
            </div>
          )}

          <div className="card" style={{ maxWidth: 640, marginBottom: 24 }}>
            <h2 className="card-title">Add webhook</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="label" htmlFor="webhook-url">URL *</label>
                <input
                  id="webhook-url"
                  type="url"
                  className="input"
                  placeholder="https://your-server.com/webhook"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="webhook-secret">Secret (optional, for signature)</label>
                <input
                  id="webhook-secret"
                  type="password"
                  className="input"
                  placeholder="Leave blank to skip HMAC signature"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="webhook-events">Events (comma-separated)</label>
                <input
                  id="webhook-events"
                  type="text"
                  className="input"
                  placeholder="approved,pr_created,rejected,assigned"
                  value={newEvents}
                  onChange={(e) => setNewEvents(e.target.value)}
                />
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  approved, pr_created, rejected, assigned
                </p>
              </div>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Adding…' : 'Add webhook'}
              </button>
            </form>
          </div>

          <div className="card">
            <h2 className="card-title">Webhooks</h2>
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : !error && webhooks.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No webhooks configured.</p>
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
                        <td style={{ wordBreak: 'break-all', color: 'var(--color-text-primary)' }}>{w.url}</td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{w.events || '—'}</td>
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
                            {toggleLoading === w.id ? '…' : w.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ padding: '6px 12px', fontSize: 13 }}
                            disabled={deleteLoading === w.id}
                            onClick={() => handleDelete(w.id)}
                          >
                            {deleteLoading === w.id ? '…' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
