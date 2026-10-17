import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import CloudHubNav from '../../components/CloudHubNav';
import CloudStatePanel, { CloudEmptyCatalogAction } from '../../components/CloudStatePanel';
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
  project_id?: number;
  project_name?: string;
  project_code?: string;
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
  const [providerFilter, setProviderFilter] = useState<CloudProviderId | ''>('');

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
      const haystack = [row.display_name, row.account_id, row.team_slug, row.project_name, row.project_code, row.provider].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, statusFilter, providerFilter]);

  const summary = useMemo(() => {
    const connected = rows.filter((r) => r.status === 'connected').length;
    const errored = rows.filter((r) => r.status === 'error').length;
    const disabled = rows.filter((r) => r.status === 'disabled').length;
    const byCloud = {
      aws: rows.filter((r) => normalizeCloudProvider(r.provider) === 'aws').length,
      azure: rows.filter((r) => normalizeCloudProvider(r.provider) === 'azure').length,
      gcp: rows.filter((r) => normalizeCloudProvider(r.provider) === 'gcp').length,
    };
    return { total: rows.length, connected, errored, disabled, byCloud };
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
        id: 'project',
        header: 'Project',
        cell: (row) => row.project_code || row.project_name || '—',
      },
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
  const showEmptyCatalog = !loading && !error && rows.length === 0;
  const showEmptyFilter = !loading && !error && rows.length > 0 && visible.length === 0;

  return (
    <DevOpsLayout>
      <Head>
        <title>Cloud accounts - OpsTrellis</title>
      </Head>
      <div className="portal-page cloud-workspace-page">
        <PageHeader
          eyebrow="Cloud workspace"
          title="Cloud accounts"
          subtitle="Onboard AWS, Azure, or GCP for your teams. Trust stays on the API — switch to Inventory when accounts are connected."
          actions={
            <Link href="/cloud-accounts/new" className="btn btn-primary">
              Onboard account
            </Link>
          }
        />

        <CloudHubNav
          active="accounts"
          provider={providerFilter}
          showAllProvider
          onProviderChange={setProviderFilter}
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
              <span className="k8s-summary-card__label">AWS / Azure / GCP</span>
              <strong className="k8s-summary-card__value">
                {loading ? '—' : `${summary.byCloud.aws} / ${summary.byCloud.azure} / ${summary.byCloud.gcp}`}
              </strong>
            </div>
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">Needs attention</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : summary.errored}</strong>
            </div>
          </section>
        ) : null}

        <section className="portal-surface portal-surface--table">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Team accounts</h2>
              <p className="portal-surface__subtitle">
                Rows are limited to DevOps teams you belong to. Open a row to test trust or rotate credentials.
              </p>
            </div>
          </div>

          {error ? (
            <CloudStatePanel
              kind="error"
              title="Could not load cloud accounts"
              message={error}
              onRetry={() => setReloadToken((v) => v + 1)}
            />
          ) : (
            <>
              <section className="devops-incident-filter-surface cloud-accounts-filter-surface">
                <div className="devops-incident-filter-row">
                  <input
                    className="input"
                    type="search"
                    placeholder="Search name, account ID, or team"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search cloud accounts"
                  />
                  <label className="devops-incident-filter-chip">
                    <span className="devops-incident-filter-chip__label">Status</span>
                    <select
                      className="devops-incident-filter-chip__control"
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
                  </label>
                  <div className="devops-incident-filter-row__actions">
                    {hasLocalFilters ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setQuery('');
                          setStatusFilter('');
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
              </section>

              <DataTable
                columns={columns}
                rows={visible}
                rowKey={(r) => r.id}
                label="Cloud accounts"
                loading={loading}
                onRowOpen={(row) => void router.push(`/cloud-accounts/${row.id}`)}
                empty={
                  showEmptyCatalog ? (
                    <CloudStatePanel
                      kind="empty"
                      title="No cloud accounts yet"
                      message="Connect AWS, Azure, or GCP. Inventory stays empty until an account is connected."
                      action={
                        <>
                          <CloudEmptyCatalogAction />
                          <Link href="/cloud-resources" className="btn btn-secondary btn-sm">
                            Browse inventory
                          </Link>
                        </>
                      }
                    />
                  ) : showEmptyFilter ? (
                    <CloudStatePanel
                      kind="info"
                      title="No accounts match these filters"
                      message="Try another cloud pill above or clear search and status filters."
                      action={
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setQuery('');
                            setStatusFilter('');
                            setProviderFilter('');
                          }}
                        >
                          Reset filters
                        </button>
                      }
                    />
                  ) : (
                    <CloudStatePanel kind="info" title="No accounts to show" message="Adjust filters to see more rows." />
                  )
                }
              />
            </>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
