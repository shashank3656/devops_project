import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import CloudHubNav from '../../components/CloudHubNav';
import CloudStatePanel from '../../components/CloudStatePanel';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { cloudInventoryAccountHref, parseInventoryAccountQuery } from '../../lib/cloudInventoryRoutes';
import {
  normalizeCloudProvider,
  providerChipTone,
  providerLabel,
  type CloudProviderId,
} from '../../lib/cloudProviders';
import { DataTable, PageHeader, portalFetch, type DataTableColumn } from '@infragate/ui';

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

export default function CloudAccountInventoryLandingPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const scope = parseInventoryAccountQuery(router.query.cloud, router.query.account_id);
  const cloud = scope?.cloud ?? 'aws';
  const accountId = scope?.accountId ?? '';

  const [rows, setRows] = useState<CloudResource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onboardedAccountId, setOnboardedAccountId] = useState<number | null>(null);

  const accountName = useMemo(() => {
    const named = rows.find((r) => r.account_name?.trim());
    return named?.account_name?.trim() || accountId;
  }, [rows, accountId]);

  const teamSlug = useMemo(() => rows[0]?.team_slug || '—', [rows]);

  const envCount = useMemo(() => new Set(rows.map((r) => r.environment).filter(Boolean)).size, [rows]);
  const regionCount = useMemo(() => new Set(rows.map((r) => r.region).filter(Boolean)).size, [rows]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!scope) {
      void router.replace('/cloud-resources');
    }
  }, [router, scope]);

  useEffect(() => {
    if (!accountId) return;
    const token = localStorage.getItem('devops_token');
    if (!token) {
      void router.replace('/login');
      return;
    }
    portalFetch(`${apiUrl}/api/devops/cloud/accounts`, { token })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
        const match = accounts.find(
          (a: { account_id?: string; provider?: string; id?: number }) =>
            String(a.account_id) === accountId && normalizeCloudProvider(a.provider || '') === cloud,
        );
        setOnboardedAccountId(typeof match?.id === 'number' ? match.id : null);
      })
      .catch(() => setOnboardedAccountId(null));
  }, [apiUrl, accountId, cloud, router]);

  useEffect(() => {
    if (!accountId) return;
    const token = localStorage.getItem('devops_token');
    if (!token) return;
    const params = new URLSearchParams({
      cloud,
      account_id: accountId,
      limit: String(PAGE_SIZE),
      page: String(page),
    });
    setLoading(true);
    setError('');
    portalFetch(`${apiUrl}/api/devops/cloud/resources?${params}`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          void router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Failed to load resources');
        setRows(Array.isArray(data.resources) ? data.resources : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load resources'))
      .finally(() => setLoading(false));
  }, [apiUrl, accountId, cloud, page, router]);

  const columns: DataTableColumn<CloudResource>[] = useMemo(
    () => [
      {
        id: 'display_name',
        header: 'Resource',
        cell: (row) => (
          <Link href={`/cloud-resources/${row.id}`} style={{ fontWeight: 500 }}>
            {row.display_name || row.resource_id}
          </Link>
        ),
      },
      { id: 'service_type', header: 'Service', cell: (row) => row.service_type },
      { id: 'environment', header: 'Env', cell: (row) => row.environment },
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

  const onCloudChange = (next: string) => {
    const value = normalizeCloudProvider(next) as CloudProviderId;
    void router.push(cloudInventoryAccountHref(value, accountId));
  };

  if (!scope) {
    return (
      <DevOpsLayout>
        <EmptyLoading />
      </DevOpsLayout>
    );
  }

  return (
    <DevOpsLayout>
      <Head>
        <title>{accountName} - Cloud account inventory</title>
      </Head>
      <div className="portal-page cloud-workspace-page">
        <PageHeader
          eyebrow="Cloud account"
          title={accountName}
          subtitle={`${providerLabel(cloud)} · ${accountId} · team ${teamSlug} — resources visible for your DevOps teams.`}
          actions={
            <>
              {onboardedAccountId ? (
                <Link href={`/cloud-accounts/${onboardedAccountId}`} className="btn btn-secondary">
                  Connection & trust
                </Link>
              ) : null}
              <Link href={`/cloud-resources?cloud=${encodeURIComponent(cloud)}`} className="btn btn-secondary">
                All inventory
              </Link>
            </>
          }
        />

        <CloudHubNav active="inventory" provider={cloud} onProviderChange={onCloudChange} />

        <section className="k8s-summary-strip" aria-label="Account inventory summary">
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Cloud</span>
            <strong className="k8s-summary-card__value">
              <span className={`ig-chip ig-chip--${providerChipTone(cloud)}`}>{providerLabel(cloud)}</span>
            </strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Resources</span>
            <strong className="k8s-summary-card__value">{loading ? '—' : total}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Environments (page)</span>
            <strong className="k8s-summary-card__value">{loading ? '—' : envCount}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Regions (page)</span>
            <strong className="k8s-summary-card__value">{loading ? '—' : regionCount}</strong>
          </div>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Inventory</span>
              <h2 className="portal-surface__title">Resources in this account</h2>
              <p className="portal-surface__subtitle">
                Read-only catalog for account <code>{accountId}</code>. Open a row for full resource context.
              </p>
            </div>
          </div>

          {error ? (
            <CloudStatePanel kind="error" title="Could not load account inventory" message={error} />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                label="Account resources"
                loading={loading}
                onRowOpen={(row) => void router.push(`/cloud-resources/${row.id}`)}
                empty={
                  <CloudStatePanel
                    kind="empty"
                    title="No resources in this account"
                    message="Nothing is seeded or synced for this account yet. Confirm the account is connected under Cloud accounts."
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
      </div>
    </DevOpsLayout>
  );
}

function EmptyLoading() {
  return (
    <div className="portal-page">
      <p className="portal-page__subtitle">Loading account inventory…</p>
    </div>
  );
}
