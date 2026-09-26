import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CloudHubNav from '../../components/CloudHubNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { cloudInventoryAccountHref } from '../../lib/cloudInventoryRoutes';
import { normalizeCloudProvider, providerChipTone, providerLabel } from '../../lib/cloudProviders';
import { buildPortalApiUrl, EmptyState, PageHeader, parsePortalNumericId, portalFetch } from '@infragate/ui';

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

export default function CloudResourceDetailPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);
  const [item, setItem] = useState<CloudResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!resourceId) return;
    const token = localStorage.getItem('devops_token');
    if (!token) {
      void router.replace('/login');
      return;
    }
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/cloud/resources/${resourceId}`), { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) {
          void router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Resource not found');
        setItem(data.resource || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [apiUrl, resourceId, router]);

  const cloud = item ? normalizeCloudProvider(item.cloud) : 'aws';
  const accountLandingHref = item ? cloudInventoryAccountHref(item.cloud, item.account_id) : '/cloud-resources';

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.display_name || 'Resource'} - Cloud inventory</title>
      </Head>
      <div className="portal-page cloud-workspace-page">
        <PageHeader
          eyebrow="Cloud resource"
          title={item?.display_name || 'Resource detail'}
          subtitle="Read-only context before any future day-2 action."
          actions={
            <>
              {item ? (
                <Link href={accountLandingHref} className="btn btn-secondary">
                  Account overview
                </Link>
              ) : null}
              <Link href={`/cloud-resources?cloud=${encodeURIComponent(cloud)}`} className="btn btn-secondary">
                Back to inventory
              </Link>
            </>
          }
        />

        {item ? (
          <CloudHubNav
            active="inventory"
            provider={cloud}
            onProviderChange={(next) => {
              const value = normalizeCloudProvider(next);
              void router.push(`/cloud-resources?cloud=${encodeURIComponent(value)}`);
            }}
          />
        ) : null}

        {loading ? (
          <EmptyState title="Loading" body="Fetching resource details…" />
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : item ? (
          <>
            <section className="k8s-summary-strip" aria-label="Resource summary">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Cloud</span>
                <strong className="k8s-summary-card__value">
                  <span className={`ig-chip ig-chip--${providerChipTone(item.cloud)}`}>{providerLabel(item.cloud)}</span>
                </strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Service</span>
                <strong className="k8s-summary-card__value">{item.service_type}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Environment</span>
                <strong className="k8s-summary-card__value">{item.environment}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Status</span>
                <strong className="k8s-summary-card__value">
                  <span className="ig-chip ig-chip--ok">{item.status}</span>
                </strong>
              </div>
            </section>

            <div className="portal-surface">
              <dl className="admin-status-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <dt>Team</dt>
                  <dd>{item.team_slug}</dd>
                </div>
                <div>
                  <dt>Region</dt>
                  <dd>{item.region}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>
                    <Link href={accountLandingHref} style={{ fontWeight: 500 }}>
                      {item.account_name} ({item.account_id})
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{item.updated_at ? new Date(item.updated_at).toLocaleString() : '—'}</dd>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <dt>Resource id</dt>
                  <dd>
                    <code>{item.resource_id}</code>
                  </dd>
                </div>
              </dl>
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
