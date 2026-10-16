import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { environmentCatalogHref, inventoryListHref, mergeInventoryScope } from '../../lib/cloudCatalogLinks';
import { cloudInventoryAccountHref } from '../../lib/cloudInventoryRoutes';
import {
  inventoryAccountPlaceholder,
  normalizeCloudProvider,
  providerChipTone,
  providerInventoryTitle,
  providerLabel,
  type CloudProviderId,
} from '../../lib/cloudProviders';
import CloudHubNav from '../../components/CloudHubNav';
import CloudStatePanel, { CloudEmptyCatalogAction } from '../../components/CloudStatePanel';
import {
  DataTable,
  PageFilters,
  PageHeader,
  portalFetch,
  type DataTableColumn,
  type PageFilterChip,
} from '@infragate/ui';

interface CloudResource {
  id: number;
  team_slug: string;
  cloud: string;
  account_id: string;
  account_name: string;
  environment: string;
  region: string;
  service_type: string;
  resource_id: string;
  display_name: string;
  status: string;
  updated_at?: string;
}

const PAGE_SIZE = 25;

export default function CloudResourcesPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [rows, setRows] = useState<CloudResource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [account, setAccount] = useState('');
  const [env, setEnv] = useState('');
  const [region, setRegion] = useState('');
  const [cloud, setCloud] = useState<CloudProviderId>('aws');
  const [accountContext, setAccountContext] = useState<{
    message?: string;
    account_status?: string;
    onboarded_account_id?: number;
  } | null>(null);

  const projectId = Array.isArray(router.query.project_id) ? router.query.project_id[0] : router.query.project_id;
  const scopeEnv = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment;

  useEffect(() => {
    const fromQuery = router.query.cloud;
    const raw = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
    if (raw) setCloud(normalizeCloudProvider(raw));
  }, [router.query.cloud]);

  useEffect(() => {
    const raw = router.query.account_id;
    const fromQuery = Array.isArray(raw) ? raw[0] : raw;
    if (fromQuery?.trim()) setAccount(fromQuery.trim());
  }, [router.query.account_id]);

  useEffect(() => {
    if (scopeEnv && !env) setEnv(scopeEnv);
  }, [scopeEnv, env]);

  useEffect(() => {
    setPage(1);
  }, [team, account, env, region, q, projectId, cloud]);

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    const params = new URLSearchParams({ cloud, limit: String(PAGE_SIZE), page: String(page) });
    if (team.trim()) params.set('team', team.trim());
    if (account.trim()) params.set('account_id', account.trim());
    if (env.trim()) params.set('environment', env.trim());
    if (region.trim()) params.set('region', region.trim());
    if (q.trim()) params.set('q', q.trim());
    if (projectId) params.set('project_id', projectId);
    setLoading(true);
    setError('');
    setForbidden(false);
    portalFetch(`${apiUrl}/api/devops/cloud/resources?${params}`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (res.status === 403) {
          setForbidden(true);
          setRows([]);
          setTotal(0);
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Failed to load cloud resources');
        setRows(Array.isArray(data.resources) ? data.resources : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setAccountContext(
          data.account_context && typeof data.account_context === 'object' ? data.account_context : null,
        );
      })
      .catch((err) => {
        setRows([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : 'Failed to load cloud resources');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router, team, account, env, region, q, projectId, page, reloadToken, cloud]);

  const columns: DataTableColumn<CloudResource>[] = useMemo(
    () => [
      {
        id: 'display_name',
        header: 'Name',
        cell: (row) => (
          <Link href={`/cloud-resources/${row.id}`} style={{ fontWeight: 500 }} onClick={(e) => e.stopPropagation()}>
            {row.display_name || row.resource_id}
          </Link>
        ),
      },
      {
        id: 'cloud',
        header: 'Cloud',
        cell: (row) => (
          <span className={`ig-chip ig-chip--${providerChipTone(row.cloud)}`}>{providerLabel(row.cloud)}</span>
        ),
      },
      { id: 'service_type', header: 'Service', cell: (row) => row.service_type },
      { id: 'team_slug', header: 'Team', cell: (row) => row.team_slug },
      {
        id: 'account_id',
        header: 'Account',
        cell: (row) => (
          <Link
            href={cloudInventoryAccountHref(row.cloud, row.account_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ fontWeight: 500 }}
          >
            {row.account_name?.trim() ? `${row.account_name} (${row.account_id})` : row.account_id}
          </Link>
        ),
      },
      {
        id: 'environment',
        header: 'Env',
        cell: (row) =>
          row.environment ? (
            <Link
              href={`/environments?env=${encodeURIComponent(row.environment)}`}
              onClick={(e) => e.stopPropagation()}
              className="ig-cell-link"
            >
              {row.environment}
            </Link>
          ) : (
            '—'
          ),
      },
      { id: 'region', header: 'Region', cell: (row) => row.region },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => <span className="ig-chip ig-chip--ok">{row.status}</span>,
      },
    ],
    [],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterChips: PageFilterChip[] = useMemo(
    () =>
      [
        { key: 'cloud', label: 'Cloud', value: providerLabel(cloud) },
        projectId ? { key: 'project', label: 'Project scope', value: `#${projectId}` } : null,
        env.trim() || scopeEnv ? { key: 'environment', label: 'Environment', value: env.trim() || scopeEnv || '' } : null,
        team.trim() ? { key: 'team', label: 'Team', value: team.trim() } : null,
        account.trim() ? { key: 'account', label: 'Account', value: account.trim() } : null,
        region.trim() ? { key: 'region', label: 'Region', value: region.trim() } : null,
        q.trim() ? { key: 'q', label: 'Search', value: q.trim() } : null,
      ].filter((chip): chip is PageFilterChip => Boolean(chip)),
    [cloud, projectId, env, scopeEnv, team, account, region, q],
  );

  const hasLocalFilters = Boolean(team.trim() || account.trim() || env.trim() || region.trim() || q.trim());

  const onCloudChange = (next: string) => {
    const value = normalizeCloudProvider(next);
    setCloud(value);
    void router.replace({ pathname: router.pathname, query: { ...router.query, cloud: value } }, undefined, {
      shallow: true,
    });
  };

  const removeChip = (key: string) => {
    switch (key) {
      case 'cloud':
        break;
      case 'environment':
        setEnv('');
        break;
      case 'team':
        setTeam('');
        break;
      case 'account':
        setAccount('');
        break;
      case 'region':
        setRegion('');
        break;
      case 'q':
        setQ('');
        break;
      default:
        break;
    }
  };

  const clearLocalFilters = () => {
    setTeam('');
    setAccount('');
    setEnv('');
    setRegion('');
    setQ('');
  };

  const activeRegions = useMemo(() => new Set(rows.map((row) => row.region).filter(Boolean)).size, [rows]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Cloud inventory - DevOps</title>
      </Head>
      <div className="portal-page cloud-workspace-page">
        <PageHeader
          eyebrow="Cloud workspace"
          title="Resource inventory"
          subtitle="Read-only resources for your DevOps teams. Pick a cloud, then filter — only connected onboarded accounts apply."
          actions={
            projectId ? (
              <>
                <Link href={environmentCatalogHref(Number(projectId))} className="btn btn-secondary">
                  Environment catalog
                </Link>
                <Link
                  href={mergeInventoryScope(inventoryListHref({ cloud, projectId: String(projectId) }), {
                    projectId: String(projectId),
                    environment: env.trim() || scopeEnv || undefined,
                  })}
                  className="btn btn-secondary"
                >
                  Project inventory
                </Link>
              </>
            ) : (
              <Link href="/environments" className="btn btn-secondary">
                Environment catalog
              </Link>
            )
          }
        />

        {accountContext?.message ? (
          <div
            className={`alert ${accountContext.account_status === 'disabled' ? 'alert-error' : 'alert-info'}`}
            role="status"
            style={{ marginBottom: 16 }}
          >
            {accountContext.message}
            {accountContext.onboarded_account_id ? (
              <>
                {' '}
                <Link href={`/cloud-accounts/${accountContext.onboarded_account_id}`} className="ig-link">
                  Open cloud account
                </Link>
              </>
            ) : null}
          </div>
        ) : null}

        {!forbidden ? (
          <CloudHubNav active="inventory" provider={cloud} onProviderChange={onCloudChange} />
        ) : null}

        {forbidden ? (
          <div className="alert alert-error" role="alert">
            You do not have permission to view cloud inventory. Ask a DevOps manager if you need access.
          </div>
        ) : null}

        {!forbidden && !error ? (
          <section className="k8s-summary-strip" aria-label="Inventory summary">
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">Total resources</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : total}</strong>
            </div>
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">On this page</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : rows.length}</strong>
            </div>
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">Regions (page)</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : activeRegions}</strong>
            </div>
            <div className="k8s-summary-card">
              <span className="k8s-summary-card__label">Page</span>
              <strong className="k8s-summary-card__value">{loading ? '—' : `${page} / ${totalPages}`}</strong>
            </div>
          </section>
        ) : null}

        {!forbidden ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Inventory</span>
                <h2 className="portal-surface__title">{providerInventoryTitle(cloud)}</h2>
                <p className="portal-surface__subtitle">
                  Filter by team, account, environment, or region. Inventory lists resources for{' '}
                  <strong>{providerLabel(cloud)}</strong> when matching onboarded accounts are connected.
                </p>
              </div>
            </div>

            {error ? (
              <CloudStatePanel
                kind="error"
                title="Could not load inventory"
                message={error}
                onRetry={() => setReloadToken((value) => value + 1)}
              />
            ) : (
              <>
                {filterChips.length > 0 ? (
                  <PageFilters chips={filterChips} onRemoveChip={removeChip} onClear={clearLocalFilters} />
                ) : null}

                <section className="devops-incident-filter-surface cloud-inventory-filters">
                  <div className="devops-incident-filter-row">
                    <input
                      className="input"
                      type="search"
                      placeholder="Search name or resource ID"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      aria-label="Search resources"
                    />
                    <label className="devops-incident-filter-chip">
                      <span className="devops-incident-filter-chip__label">Team</span>
                      <input
                        className="devops-incident-filter-chip__control"
                        placeholder="slug"
                        value={team}
                        onChange={(e) => setTeam(e.target.value)}
                        aria-label="Team slug"
                      />
                    </label>
                    <label className="devops-incident-filter-chip">
                      <span className="devops-incident-filter-chip__label">Account</span>
                      <input
                        className="devops-incident-filter-chip__control"
                        placeholder={inventoryAccountPlaceholder(cloud)}
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                        aria-label="Account id"
                      />
                    </label>
                    <label className="devops-incident-filter-chip">
                      <span className="devops-incident-filter-chip__label">Env</span>
                      <input
                        className="devops-incident-filter-chip__control"
                        placeholder="dev, prod…"
                        value={env}
                        onChange={(e) => setEnv(e.target.value)}
                        aria-label="Environment"
                      />
                    </label>
                    <label className="devops-incident-filter-chip">
                      <span className="devops-incident-filter-chip__label">Region</span>
                      <input
                        className="devops-incident-filter-chip__control"
                        placeholder="us-east-1"
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        aria-label="Region"
                      />
                    </label>
                    <div className="devops-incident-filter-row__actions">
                      {hasLocalFilters ? (
                        <span className="devops-incident-filter-row__badge">{filterChips.length} active</span>
                      ) : null}
                      {hasLocalFilters ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={clearLocalFilters}>
                          Clear
                        </button>
                      ) : null}
                      <span className="ig-table-toolbar__count">
                        {loading ? 'Loading…' : `${rows.length} on page · ${total} total`}
                      </span>
                    </div>
                  </div>
                </section>

                <DataTable
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.id}
                  label="Cloud resources"
                  loading={loading}
                  onRowOpen={(row) => void router.push(`/cloud-resources/${row.id}`)}
                  empty={
                    <CloudStatePanel
                      kind="empty"
                      title="No resources yet"
                      message={`Nothing is listed for ${providerLabel(cloud)}. Connect an account, or clear the filters.`}
                      action={
                        <>
                          <CloudEmptyCatalogAction />
                          <button type="button" className="btn btn-secondary btn-sm" onClick={clearLocalFilters}>
                            Clear filters
                          </button>
                        </>
                      }
                    />
                  }
                />

                {total > PAGE_SIZE ? (
                  <div className="ig-table-toolbar" style={{ marginTop: 16, justifyContent: 'space-between' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
