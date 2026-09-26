import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { providerChipTone, providerLabel, normalizeCloudProvider, type CloudProviderId } from '../../lib/cloudProviders';
import { DataTable, PageHeader, portalFetch, type DataTableColumn } from '@infragate/ui';

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
  status: string;
  last_error?: string;
  last_test_at?: string;
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  error: 'Error',
  disabled: 'Disabled',
  pending: 'Pending test',
};

const STATUS_CHIP: Record<string, string> = {
  connected: 'ok',
  error: 'danger',
  disabled: 'neutral',
  pending: 'medium',
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'connected', label: 'Connected' },
  { value: 'pending', label: 'Pending test' },
  { value: 'error', label: 'Error' },
  { value: 'disabled', label: 'Disabled' },
];

function accountStatusCell(row: CloudAccount) {
  const tone = STATUS_CHIP[row.status] || 'neutral';
  return <span className={`ig-chip ig-chip--${tone}`}>{STATUS_LABEL[row.status] || row.status}</span>;
}

export default function CloudAccountsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [rows, setRows] = useState<CloudAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    portalFetch(`${apiUrl}/api/devops/cloud/accounts`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Failed to load cloud accounts');
        setRows(Array.isArray(data.accounts) ? data.accounts : []);
      })
      .catch((err) => {
        setRows([]);
        setError(err instanceof Error ? err.message : 'Failed to load cloud accounts');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router, reloadToken]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (providerFilter && normalizeCloudProvider(row.provider) !== providerFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [row.display_name, row.account_id, row.team_slug, row.provider].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, statusFilter, providerFilter]);

  const summary = useMemo(() => {
    const connected = rows.filter((r) => r.status === 'connected').length;
    const errored = rows.filter((r) => r.status === 'error').length;
    const disabled = rows.filter((r) => r.status === 'disabled').length;
    return { total: rows.length, connected, errored, disabled };
  }, [rows]);

  const columns: DataTableColumn<CloudAccount>[] = useMemo(
    () => [
      {
        id: 'display_name',
        header: 'Account',
        cell: (row) => (
          <Link href={`/cloud-accounts/${row.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>
            {row.display_name}
          </Link>
        ),
      },
      {
        id: 'provider',
        header: 'Provider',
        cell: (row) => (
          <span className={`ig-chip ig-chip--${providerChipTone(row.provider)}`}>{providerLabel(row.provider)}</span>
        ),
      },
      { id: 'account_id', header: 'Account ID', cell: (row) => <span className="ig-mono">{row.account_id}</span> },
      { id: 'team_slug', header: 'Team', cell: (row) => row.team_slug },
      {
        id: 'environments',
        header: 'Environments',
        cell: (row) => (row.environments?.length ? row.environments.join(', ') : '—'),
      },
      { id: 'status', header: 'Status', cell: accountStatusCell },
    ],
    [],
  );

  const hasLocalFilters = Boolean(query.trim() || statusFilter || providerFilter);

  const PROVIDER_FILTER_OPTIONS: { value: '' | CloudProviderId; label: string }[] = [
    { value: '', label: 'All clouds' },
    { value: 'aws', label: 'AWS' },
    { value: 'azure', label: 'Azure' },
    { value: 'gcp', label: 'GCP' },
  ];
  const showEmptyCatalog = !loading && !error && rows.length === 0;
  const showEmptyFilter = !loading && !error && rows.length > 0 && visible.length === 0;

  return (
    <DevOpsLayout>
      <Head>
        <title>Cloud accounts - DevOps</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud"
          title="Cloud accounts"
          subtitle="Register AWS, Azure, or GCP accounts for your DevOps teams. Trust configuration and secrets stay on the API host only."
          actions={
            <Link href="/cloud-accounts/new" className="btn btn-primary">
              Onboard account
            </Link>
          }
        />

        {!error ? (
          <section className="k8s-summary-strip" aria-label="Cloud account summary">
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">Accounts</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : summary.total}</strong>
            </div>
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">Connected</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : summary.connected}</strong>
            </div>
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">Needs attention</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : summary.errored}</strong>
            </div>
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">Disabled</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : summary.disabled}</strong>
            </div>
          </section>
        ) : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Team accounts</h2>
              <p className="portal-surface__subtitle">
                Visible for DevOps teams you belong to. Open a row to test the connection or disable an account.
              </p>
            </div>
            {!error ? (
              <div className="ig-filter-bar devops-incident-filter-row">
                <input
                  className="input"
                  type="search"
                  placeholder="Search name, account ID, or team"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search cloud accounts"
                />
                <select
                  className="input"
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  aria-label="Filter by cloud provider"
                >
                  {PROVIDER_FILTER_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                >
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="devops-incident-filter-row__actions">
                  {hasLocalFilters ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setQuery('');
                        setStatusFilter('');
                        setProviderFilter('');
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                  <span className="ig-table-toolbar__count">
                    {loading ? 'Loading…' : `${visible.length} shown`}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="empty-state" role="alert">
              <strong>Could not load cloud accounts</strong>
              <p className="ig-muted">{error}</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => setReloadToken((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.id}
              label="Cloud accounts"
              loading={loading}
              onRowOpen={(row) => void router.push(`/cloud-accounts/${row.id}`)}
              empty={
                showEmptyCatalog ? (
                  <div className="empty-state">
                    <strong>No cloud accounts yet</strong>
                    <p className="ig-muted">
                      Onboard AWS, Azure, or GCP using the provider-specific trust fields, then run{' '}
                      <strong>Test connection</strong> on the detail page. Use <strong>Onboard account</strong> in the
                      page header to get started.
                    </p>
                  </div>
                ) : showEmptyFilter ? (
                  <div className="empty-state">
                    <strong>No accounts match these filters</strong>
                    <p className="ig-muted">Clear search or status filters to see the full list.</p>
                  </div>
                ) : (
                  <div className="empty-state">No cloud accounts to show.</div>
                )
              }
            />
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
