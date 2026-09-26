import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CloudHubNav from '../../components/CloudHubNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  cloudAccountDetailHref,
  cloudInventoryAccountHref,
  environmentCatalogHref,
  inventoryListHref,
} from '../../lib/cloudCatalogLinks';
import { normalizeCloudProvider, providerChipTone, providerLabel } from '../../lib/cloudProviders';
import {
  buildPortalApiUrl,
  EmptyState,
  PageHeader,
  parsePortalNumericId,
  portalFetch,
  ResourceContextPanel,
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
  onboarded_account_id?: number | null;
}

interface CatalogLink {
  project_id: number;
  project_name: string;
  environment: string;
}

export default function CloudResourceDetailPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);
  const [item, setItem] = useState<CloudResource | null>(null);
  const [catalogLinks, setCatalogLinks] = useState<CatalogLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const token = typeof window !== 'undefined' ? localStorage.getItem('devops_token') : null;

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
        setCatalogLinks(Array.isArray(data.catalog_links) ? data.catalog_links : []);
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
              {item?.onboarded_account_id ? (
                <Link href={cloudAccountDetailHref(item.onboarded_account_id)} className="btn btn-secondary">
                  Cloud account
                </Link>
              ) : null}
              {catalogLinks.length === 1 ? (
                <Link
                  href={environmentCatalogHref(catalogLinks[0].project_id, catalogLinks[0].environment)}
                  className="btn btn-secondary"
                >
                  Environment catalog
                </Link>
              ) : null}
              {item ? (
                <Link href={accountLandingHref} className="btn btn-secondary">
                  Account inventory
                </Link>
              ) : null}
              {item ? (
                <Link
                  href={inventoryListHref({
                    cloud: item.cloud,
                    accountId: item.account_id,
                    environment: item.environment,
                    team: item.team_slug,
                  })}
                  className="btn btn-secondary"
                >
                  Filtered inventory
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

            <section className="portal-surface cloud-resource-detail">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Details</span>
                  <h2 className="portal-surface__title">Scope & identity</h2>
                </div>
              </div>
              <dl className="cloud-meta-list">
                <div className="cloud-meta-list__row">
                  <dt>Team</dt>
                  <dd>{item.team_slug}</dd>
                </div>
                <div className="cloud-meta-list__row">
                  <dt>Region</dt>
                  <dd>{item.region}</dd>
                </div>
                <div className="cloud-meta-list__row">
                  <dt>Account</dt>
                  <dd>
                    <Link href={accountLandingHref} className="cloud-meta-list__link">
                      {item.account_name} ({item.account_id})
                    </Link>
                    {item.onboarded_account_id ? (
                      <>
                        {' · '}
                        <Link href={cloudAccountDetailHref(item.onboarded_account_id)} className="cloud-meta-list__link">
                          Connection & trust
                        </Link>
                      </>
                    ) : null}
                  </dd>
                </div>
                <div className="cloud-meta-list__row">
                  <dt>Last updated</dt>
                  <dd>{item.updated_at ? new Date(item.updated_at).toLocaleString() : '—'}</dd>
                </div>
                <div className="cloud-meta-list__row cloud-meta-list__row--full">
                  <dt>Resource id</dt>
                  <dd>
                    <code className="portal-code-block cloud-meta-list__code">{item.resource_id}</code>
                  </dd>
                </div>
              </dl>
            </section>

            <ResourceContextPanel
              apiUrl={apiUrl}
              token={token}
              kind="cloud_resource"
              resourceId={resourceId}
              className="cloud-resource-context-panel"
            />

            {catalogLinks.length > 0 ? (
              <section className="portal-surface" style={{ marginTop: 16 }}>
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Catalog</span>
                    <h2 className="portal-surface__title">Linked environment catalog rows</h2>
                  </div>
                </div>
                <ul className="ig-simple-list">
                  {catalogLinks.map((link) => (
                    <li key={`${link.project_id}-${link.environment}`}>
                      <Link href={environmentCatalogHref(link.project_id, link.environment)} className="ig-cell-link">
                        {link.project_name} · {link.environment}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
