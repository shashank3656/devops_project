import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import CloudTrustSetupGuide from '../../components/CloudTrustSetupGuide';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { environmentCatalogHref, inventoryListHref } from '../../lib/cloudCatalogLinks';
import { cloudInventoryAccountHref } from '../../lib/cloudInventoryRoutes';
import { normalizeCloudProvider, providerFormCopy, providerLabel } from '../../lib/cloudProviders';
import { EmptyState, PageHeader, portalFetch, useConfirm } from '@infragate/ui';
import { confirmGuardedDay2Action, notifyDay2ActionComplete } from '../../lib/guardedDay2Action';

interface OperatorEvent {
  id: number;
  actor_username?: string;
  action: string;
  result: string;
  summary?: string;
  created_at: string;
}

interface CloudAccount {
  id: number;
  provider: string;
  account_id: string;
  display_name: string;
  team_slug: string;
  project_name?: string;
  project_code?: string;
  environments: string[];
  auth_mode: string;
  role_arn_set?: boolean;
  external_id_set?: boolean;
  secret_ref_set?: boolean;
  credentials_encrypted?: boolean;
  status: string;
  last_error?: string;
  last_test_at?: string;
  onboarded_by_username?: string;
}

export default function CloudAccountDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const confirm = useConfirm();
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const [item, setItem] = useState<CloudAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState('');
  const [isManager, setIsManager] = useState(false);
  const [authMode, setAuthMode] = useState('assume_role');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [operatorActivity, setOperatorActivity] = useState<OperatorEvent[]>([]);
  const [catalogEnvs, setCatalogEnvs] = useState<
    { project_id: number; project_name: string; name: string; frozen?: boolean }[]
  >([]);

  const copy = useMemo(
    () => providerFormCopy(item ? normalizeCloudProvider(item.provider) : 'aws'),
    [item],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem('devops_user');
      const parsed = raw ? (JSON.parse(raw) as { devops_profile?: { is_manager?: boolean } }) : null;
      setIsManager(Boolean(parsed?.devops_profile?.is_manager));
    } catch {
      setIsManager(false);
    }
  }, []);

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
        const account = data.account || null;
        setOperatorActivity(Array.isArray(data.operator_activity) ? data.operator_activity : []);
        setItem(account);
        if (account) {
          setAuthMode(account.auth_mode || 'assume_role');
          setRoleArn('');
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiUrl, id]);

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    const accountDbId = Number.parseInt(String(id), 10);
    if (!token || !Number.isFinite(accountDbId) || accountDbId <= 0) {
      setCatalogEnvs([]);
      return;
    }
    portalFetch(`${apiUrl}/api/devops/environment-catalog`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const envs = Array.isArray(data.environments) ? data.environments : [];
        setCatalogEnvs(
          envs.filter((row: { cloud_account_id?: number }) => row.cloud_account_id === accountDbId),
        );
      })
      .catch(() => setCatalogEnvs([]));
  }, [apiUrl, id, item?.id]);

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

  const saveTrust = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('devops_token');
    if (!token || !id) return;
    setActing('trust');
    setError('');
    setNotice('');
    const body: Record<string, unknown> = {
      auth_mode: authMode,
      retest: true,
    };
    if (authMode === 'assume_role') {
      if (roleArn.trim()) body.role_arn = roleArn.trim();
      if (externalId.trim()) body.external_id = externalId.trim();
    } else if (secretRef.trim()) {
      body.secret_ref = secretRef.trim();
    }
    try {
      const res = await portalFetch(`${apiUrl}/api/devops/cloud/accounts/${id}`, {
        token,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to update trust');
      if (data.account) {
        setItem(data.account);
        setRoleArn('');
        setExternalId('');
        setSecretRef('');
      }
      setNotice('Trust configuration updated and connection re-tested on the server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update trust');
    } finally {
      setActing('');
    }
  };

  const setDisabled = async (disabled: boolean) => {
    const token = localStorage.getItem('devops_token');
    if (!token || !id) return;
    setError('');
    setNotice('');
    if (disabled) {
      const gate = await confirmGuardedDay2Action({
        apiUrl,
        token,
        confirm,
        action: 'disable_cloud_account',
        params: { cloud_account_id: String(id) },
        title: 'Disable cloud account',
        message: 'Disable this cloud account? Inventory sync and day-2 actions will stop using it until you re-enable.',
        confirmLabel: 'Disable account',
        destructive: true,
      });
      if (gate.blocked) {
        setError(gate.blocked);
        return;
      }
      if (!gate.confirmed) return;
    }
    setActing(disabled ? 'disable' : 'enable');
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
      notifyDay2ActionComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setActing('');
    }
  };

  const inventoryHref = item
    ? cloudInventoryAccountHref(item.provider, item.account_id)
    : '/cloud-resources';

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.display_name || 'Cloud account'} - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud account"
          title={item?.display_name || 'Cloud account'}
          subtitle={
            item
              ? `${providerLabel(item.provider)} · ${item.account_id} · ${item.project_code || item.project_name || 'no project'} · team ${item.team_slug}`
              : 'Loading…'
          }
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
          <>
            <CloudTrustSetupGuide provider={item.provider} />
            <section className="portal-surface">
              <div className="portal-form-grid">
                <label className="label">
                  Cloud provider
                  <input className="input" readOnly value={providerLabel(item.provider)} />
                </label>
                <label className="label">
                  {copy.accountIdLabel}
                  <input className="input" readOnly value={item.account_id} />
                </label>
                <label className="label">
                  Status
                  <input className="input" readOnly value={item.status} />
                </label>
                <label className="label">
                  Auth mode
                  <input className="input" readOnly value={item.auth_mode} />
                </label>
                <label className="label">
                  {copy.roleLabel}
                  <input className="input" readOnly value={item.role_arn_set ? 'Stored encrypted' : '—'} />
                </label>
                <label className="label">
                  {copy.externalIdLabel}
                  <input className="input" readOnly value={item.external_id_set ? 'Stored encrypted' : '—'} />
                </label>
                <label className="label">
                  Server secret
                  <input className="input" readOnly value={item.secret_ref_set ? 'Stored encrypted' : '—'} />
                </label>
                <label className="label">
                  Project
                  <input className="input" readOnly value={item.project_code || item.project_name || '—'} />
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
                  <input
                    className="input"
                    readOnly
                    value={item.last_test_at ? new Date(item.last_test_at).toLocaleString() : 'Never'}
                  />
                </label>
              </div>
              {item.last_error ? <p className="portal-surface__subtitle">Last error: {item.last_error}</p> : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                {isManager ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!!acting || item.status === 'disabled'}
                      onClick={() => void testConnection()}
                    >
                      {acting === 'test' ? 'Testing…' : 'Test connection'}
                    </button>
                    {item.status === 'disabled' ? (
                      <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => void setDisabled(false)}>
                        {acting === 'enable' ? 'Enabling…' : 'Re-enable account'}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-danger" disabled={!!acting} onClick={() => void setDisabled(true)}>
                        {acting === 'disable' ? 'Disabling…' : 'Disable account'}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="portal-surface__subtitle" style={{ margin: 0 }}>
                    Connection test and disable are available to DevOps managers on this account&apos;s team.
                  </p>
                )}
                <Link href={inventoryHref} className="btn btn-secondary">
                  View {providerLabel(item.provider)} inventory
                </Link>
                <Link
                  href={inventoryListHref({ cloud: item.provider, accountId: item.account_id })}
                  className="btn btn-secondary"
                >
                  All inventory for this account
                </Link>
                <Link href="/environments" className="btn btn-secondary">
                  Environment catalog
                </Link>
              </div>
            </section>

            <section className="portal-surface" style={{ marginTop: 16 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Catalog</span>
                  <h2 className="portal-surface__title">Linked environment catalog rows</h2>
                  <p className="portal-surface__subtitle">
                    Projects that bind this onboarded account to an environment in the catalog.
                  </p>
                </div>
              </div>
              {catalogEnvs.length === 0 ? (
                <p className="portal-surface__subtitle">
                  No catalog rows reference this account yet. Managers can link one from{' '}
                  <Link href="/environments" className="ig-link">
                    Environment catalog
                  </Link>
                  .
                </p>
              ) : (
                <ul className="ig-simple-list">
                  {catalogEnvs.map((row) => (
                    <li key={`${row.project_id}-${row.name}`}>
                      <Link href={environmentCatalogHref(row.project_id, row.name)} className="ig-cell-link">
                        {row.project_name} · {row.name}
                      </Link>
                      {row.frozen ? ' · frozen' : ''}
                      {' · '}
                      <Link
                        href={inventoryListHref({
                          cloud: item.provider,
                          accountId: item.account_id,
                          projectId: String(row.project_id),
                          environment: row.name,
                        })}
                        className="ig-cell-link"
                      >
                        Inventory
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="portal-surface" style={{ marginTop: 16 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Audit</span>
                  <h2 className="portal-surface__title">Recent operator activity</h2>
                  <p className="portal-surface__subtitle">Last 10 audited actions on this account (server-written).</p>
                </div>
                <Link href="/activity" className="btn btn-secondary btn-sm">
                  All activity
                </Link>
              </div>
              {operatorActivity.length === 0 ? (
                <p className="portal-surface__subtitle">No operator events yet for this account.</p>
              ) : (
                <ul className="ig-simple-list">
                  {operatorActivity.map((event) => (
                    <li key={event.id}>
                      <strong>{event.action}</strong> ({event.result}) — {event.actor_username || 'Operator'} ·{' '}
                      {new Date(event.created_at).toLocaleString()}
                      {event.summary ? ` — ${event.summary}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {isManager ? (
              <section className="portal-surface" style={{ marginTop: 16 }}>
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Managers</span>
                    <h2 className="portal-surface__title">Rotate trust configuration</h2>
                    <p className="portal-surface__subtitle">
                      Update role, external ID, or server secret reference without re-onboarding. The API re-tests automatically.
                    </p>
                  </div>
                </div>
                <form className="portal-form-grid" onSubmit={(e) => void saveTrust(e)}>
                  <label className="label">
                    Auth mode
                    <select className="input" value={authMode} onChange={(e) => setAuthMode(e.target.value)}>
                      <option value="assume_role">{copy.assumeAuthLabel}</option>
                      <option value="static_ref">{copy.staticAuthLabel}</option>
                    </select>
                  </label>
                  {authMode === 'assume_role' ? (
                    <>
                      <label className="label">
                        {copy.roleLabel}
                        <input className="input" type="password" value={roleArn} onChange={(e) => setRoleArn(e.target.value)} required={!item.role_arn_set} placeholder={item.role_arn_set ? 'Stored encrypted. Enter a new value only to replace it.' : ''} autoComplete="off" />
                      </label>
                      <label className="label">
                        {copy.externalIdLabel}
                        <input
                          className="input"
                          type="password"
                          value={externalId}
                          onChange={(e) => setExternalId(e.target.value)}
                          placeholder={item.external_id_set ? 'Stored encrypted. Enter a new value only to replace it.' : copy.externalIdPlaceholder}
                          autoComplete="off"
                        />
                      </label>
                    </>
                  ) : (
                    <label className="label">
                      Secret reference
                      <input className="input" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} required={!item.secret_ref_set} autoComplete="off" placeholder={item.secret_ref_set ? 'Stored encrypted. Enter a new value only to replace it.' : 'ENV_VAR_NAME_ON_API_HOST'} />
                    </label>
                  )}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <button type="submit" className="btn btn-primary" disabled={!!acting || item.status === 'disabled'}>
                      {acting === 'trust' ? 'Saving…' : 'Save trust & re-test'}
                    </button>
                  </div>
                </form>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
