import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { EmptyState, PageHeader, portalFetch } from '@infragate/ui';

interface CloudAccount {
  id: number;
  provider: string;
  account_id: string;
  display_name: string;
  team_slug: string;
  environments: string[];
  auth_mode: string;
  role_arn?: string;
  external_id_set?: boolean;
  secret_ref_set?: boolean;
  status: string;
  last_error?: string;
  last_test_at?: string;
  onboarded_by_username?: string;
}

export default function CloudAccountDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const [item, setItem] = useState<CloudAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState('');

  const load = () => {
    const token = localStorage.getItem('devops_token');
    if (!token || !id) return;
    setLoading(true);
    portalFetch(`${apiUrl}/api/devops/cloud/accounts/${id}`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 || res.status === 404) {
          setError('Cloud account not found or not visible for your teams.');
          setItem(null);
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Failed to load account');
        setItem(data.account || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiUrl, id]);

  const testConnection = async () => {
    const token = localStorage.getItem('devops_token');
    if (!token || !id) return;
    setActing('test');
    setNotice('');
    setError('');
    try {
      const res = await portalFetch(`${apiUrl}/api/devops/cloud/accounts/${id}/test`, {
        token,
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (data.account) setItem(data.account);
      setNotice(data.message || (res.ok ? 'Connection verified.' : 'Connection test failed.'));
      if (!res.ok && data.message) setError(data.message);
    } catch {
      setError('Connection test failed.');
    } finally {
      setActing('');
    }
  };

  const setDisabled = async (disabled: boolean) => {
    const token = localStorage.getItem('devops_token');
    if (!token || !id) return;
    setActing(disabled ? 'disable' : 'enable');
    setError('');
    try {
      const res = await portalFetch(`${apiUrl}/api/devops/cloud/accounts/${id}`, {
        token,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: disabled ? 'disabled' : 'pending' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Update failed');
      setItem(data.account || item);
      setNotice(disabled ? 'Account disabled. Inventory will ignore this account.' : 'Account re-enabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setActing('');
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.display_name || 'Cloud account'} - DevOps</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud account"
          title={item?.display_name || 'Cloud account'}
          subtitle={item ? `${item.provider.toUpperCase()} · ${item.account_id} · team ${item.team_slug}` : 'Loading…'}
          actions={
            <Link href="/cloud-accounts" className="btn btn-secondary">
              Back to catalog
            </Link>
          }
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-info">{notice}</div> : null}
        {loading ? <EmptyState title="Loading account" body="Fetching account metadata…" /> : null}
        {item ? (
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">
                Status
                <input className="input" readOnly value={item.status} />
              </label>
              <label className="label">
                Auth mode
                <input className="input" readOnly value={item.auth_mode} />
              </label>
              <label className="label">
                Role ARN
                <input className="input" readOnly value={item.role_arn || '—'} />
              </label>
              <label className="label">
                External ID
                <input className="input" readOnly value={item.external_id_set ? 'Configured on server' : '—'} />
              </label>
              <label className="label">
                Environments
                <input className="input" readOnly value={item.environments?.join(', ') || '—'} />
              </label>
              <label className="label">
                Onboarded by
                <input className="input" readOnly value={item.onboarded_by_username || '—'} />
              </label>
              <label className="label">
                Last test
                <input className="input" readOnly value={item.last_test_at ? new Date(item.last_test_at).toLocaleString() : 'Never'} />
              </label>
            </div>
            {item.last_error ? <p className="portal-surface__subtitle">Last error: {item.last_error}</p> : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-primary" disabled={!!acting || item.status === 'disabled'} onClick={() => void testConnection()}>
                {acting === 'test' ? 'Testing…' : 'Test connection'}
              </button>
              {item.status === 'disabled' ? (
                <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => void setDisabled(false)}>
                  {acting === 'enable' ? 'Enabling…' : 'Re-enable account'}
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => void setDisabled(true)}>
                  {acting === 'disable' ? 'Disabling…' : 'Disable account'}
                </button>
              )}
              <Link href="/cloud-resources" className="btn btn-secondary">
                View inventory
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
