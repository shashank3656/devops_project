import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';

const EVENT_OPTIONS = ['approved', 'pr_created', 'rejected', 'assigned', 'change.created', 'change.updated', 'incident.opened', 'incident.updated', 'incident.owner_paged', 'watch.failed', 'watch.ended'];

export default function NewWebhookPage() {
  const router = useRouter();
  const [newUrl, setNewUrl] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set(EVENT_OPTIONS));
  const [eventsDropdownOpen, setEventsDropdownOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const eventsDropdownRef = React.useRef<HTMLDivElement>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (eventsDropdownRef.current && !eventsDropdownRef.current.contains(event.target as Node)) {
        setEventsDropdownOpen(false);
      }
    };
    if (eventsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [eventsDropdownOpen, router]);

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
          events: selectedEvents.size > 0 ? Array.from(selectedEvents).join(',') : EVENT_OPTIONS.join(','),
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
        <title>New webhook - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/webhooks" className="back-link">
            ← Back to Webhooks
          </Link>
          <div className="card" style={{ maxWidth: 720 }}>
            <h2 className="card-title">Add webhook</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
              Create a webhook route on a dedicated page, then return to the list to enable, disable, or remove it.
            </p>
            {error ? (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            ) : null}
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
                <label className="label" htmlFor="webhook-secret">Secret (optional)</label>
                <input
                  id="webhook-secret"
                  type="password"
                  className="input"
                  placeholder="Leave blank to skip HMAC signing"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                />
              </div>
              <div className="form-group" ref={eventsDropdownRef}>
                <label className="label" htmlFor="webhook-events-trigger">Events</label>
                <div className="webhook-events-dropdown">
                  <button
                    id="webhook-events-trigger"
                    type="button"
                    className="webhook-events-dropdown__trigger input"
                    onClick={() => setEventsDropdownOpen((current) => !current)}
                    aria-haspopup="listbox"
                    aria-expanded={eventsDropdownOpen}
                  >
                    {selectedEvents.size === 0 ? 'Select events' : Array.from(selectedEvents).sort().join(', ')}
                  </button>
                  {eventsDropdownOpen ? (
                    <div className="webhook-events-dropdown__panel" role="listbox">
                      {EVENT_OPTIONS.map((eventName) => (
                        <label key={eventName} className="webhook-events-dropdown__option">
                          <input
                            type="checkbox"
                            checked={selectedEvents.has(eventName)}
                            onChange={() => toggleEvent(eventName)}
                          />
                          <span>{eventName}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Adding...' : 'Add webhook'}
              </button>
            </form>
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
