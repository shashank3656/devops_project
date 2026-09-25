import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';

const EVENT_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: 'approved', label: 'Request approved', hint: 'A ticket is ready for apply.' },
  { id: 'pr_created', label: 'Pull request opened', hint: 'SetuOps opened a PR for the request.' },
  { id: 'rejected', label: 'Request rejected', hint: 'An approver declined the ticket.' },
  { id: 'assigned', label: 'Request assigned', hint: 'Ownership changed.' },
  { id: 'change.created', label: 'Change created', hint: 'CI recorded a new deploy.' },
  { id: 'change.updated', label: 'Change updated', hint: 'A deploy moved status.' },
  { id: 'incident.opened', label: 'Incident opened', hint: 'An alert became an incident.' },
  { id: 'incident.updated', label: 'Incident updated', hint: 'Ack, note, or severity change.' },
  { id: 'incident.owner_paged', label: 'Owner paged', hint: 'On-call was notified.' },
  { id: 'watch.failed', label: 'Watch failed', hint: 'Health watch breached.' },
  { id: 'watch.ended', label: 'Watch ended', hint: 'The watch window closed.' },
];

export default function NewWebhookPage() {
  const router = useRouter();
  const [newUrl, setNewUrl] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set(EVENT_OPTIONS.map((item) => item.id)));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
    }
  }, [router]);

  const toggleEvent = (eventName: string) => {
    setSelectedEvents((current) => {
      const next = new Set(current);
      if (next.has(eventName)) next.delete(eventName);
      else next.add(eventName);
      return next;
    });
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!newUrl.trim()) {
      setError('URL is required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          url: newUrl.trim(),
          secret: newSecret.trim() || undefined,
          events: selectedEvents.size > 0 ? Array.from(selectedEvents).join(',') : EVENT_OPTIONS.map((item) => item.id).join(','),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        await router.push('/webhooks');
        return;
      }
      setError(typeof data.error === 'string' ? data.error : 'Failed to create webhook');
    } catch {
      setError('Failed to create webhook');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Head>
        <title>Add destination - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page portal-page--narrow">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Integrations</span>
              <h1 className="portal-page__title">Add destination</h1>
              <p className="portal-page__subtitle">
                SetuOps will POST JSON to this URL. Slack incoming webhooks and generic HTTPS receivers both work.
              </p>
            </div>
            <Link href="/webhooks" className="btn btn-secondary">
              Back
            </Link>
          </div>
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}
          <form className="portal-surface" onSubmit={handleCreate}>
            <label className="label" htmlFor="webhook-url">
              Destination URL
              <input
                id="webhook-url"
                type="url"
                className="input"
                placeholder="https://hooks.slack.com/services/…"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                required
              />
            </label>
            <label className="label" htmlFor="webhook-secret">
              Signing secret
              <span className="label-optional">Optional</span>
              <input
                id="webhook-secret"
                type="password"
                className="input"
                placeholder="Leave blank to skip HMAC"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
              />
            </label>
            <fieldset className="admin-event-fieldset">
              <legend>Events to send</legend>
              <p className="portal-surface__subtitle">Uncheck anything this destination should ignore.</p>
              <div className="admin-event-grid">
                {EVENT_OPTIONS.map((option) => (
                  <label key={option.id} className="admin-event-option">
                    <input
                      type="checkbox"
                      checked={selectedEvents.has(option.id)}
                      onChange={() => toggleEvent(option.id)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <em>{option.hint}</em>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Saving…' : 'Save destination'}
              </button>
            </div>
          </form>
        </div>
      </AdminLayout>
    </>
  );
}
