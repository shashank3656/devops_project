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

const EVENT_OPTIONS = ['approved', 'pr_created', 'rejected', 'assigned'];

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Webhooks</span>
              <h1 className="portal-page__title">Webhook Management</h1>
              <p className="portal-page__subtitle">
                Outbound webhooks fire when request status changes. Payloads include the event, request id, and request fields, with optional HMAC signing.
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

          <div className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Current routes</span>
                <h2 className="portal-surface__title">Webhooks</h2>
                <p className="portal-surface__subtitle">
                  Create now opens on a dedicated page so this screen stays focused on browsing and lifecycle actions.
                </p>
              </div>
            </div>
            {loading ? (
              <div className="empty-state">Loading...</div>
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
        </div>
      </AdminLayout>
    </>
  );
}
