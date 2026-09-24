import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';

const KIND_OPTIONS = [
  { id: 'change', label: 'Change request CI' },
  { id: 'grafana', label: 'Grafana' },
  { id: 'alertmanager', label: 'Alertmanager' },
  { id: 'generic_log', label: 'Generic logging' },
  { id: 'alert', label: 'Any alert source' },
];

export default function NewInboundSourcePage() {
  const router = useRouter();
  const [kind, setKind] = useState('grafana');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    if (!localStorage.getItem('admin_token')) {
      router.replace('/login');
    }
  }, [router]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!name.trim() || !secret.trim()) {
      setError('Name and secret are required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/inbound-sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          kind,
          name: name.trim(),
          secret: secret.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        await router.push('/webhooks');
        return;
      }
      setError(typeof data.error === 'string' ? data.error : 'Failed to create source');
    } catch {
      setError('Failed to create source');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Head>
        <title>Add inbound source - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Integrations</span>
              <h1 className="portal-page__title">Add inbound source</h1>
              <p className="portal-page__subtitle">
                Store a secret Grafana, Alertmanager, a logger, or CI can send as X-CI-Secret or HMAC.
              </p>
            </div>
            <Link href="/webhooks" className="btn btn-secondary">
              Back
            </Link>
          </div>
          {error ? <div className="alert alert-error">{error}</div> : null}
          <form className="portal-surface" onSubmit={handleCreate}>
            <label className="label">
              Kind
              <select className="input" value={kind} onChange={(event) => setKind(event.target.value)}>
                {KIND_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Name
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Prod Grafana" />
            </label>
            <label className="label">
              Shared secret
              <input className="input" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Do not commit this value" />
            </label>
            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Saving...' : 'Save source'}
              </button>
            </div>
          </form>
        </div>
      </AdminLayout>
    </>
  );
}
