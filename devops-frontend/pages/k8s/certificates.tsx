import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { fetchK8sCertificates, K8sCertificatesData, readQueryString } from '../../lib/k8sWorkspace';

type CertificateRow = K8sCertificatesData['items'][number];

function certificateTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'ready') return 'low';
  if (normalized === 'warning' || normalized === 'expiring') return 'medium';
  if (normalized === 'critical' || normalized === 'expired') return 'danger';
  return 'neutral';
}

function firstCertificateHost(hosts: string): string {
  return (hosts || '')
    .split(',')
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('*')) || '';
}

function certificateColumns(projectId: string): DataTableColumn<CertificateRow>[] {
  return [
  {
    id: 'certificate',
    header: 'Certificate',
    cell: (item) => (
      <div className="ig-cell-stack">
        <span className="ig-cell-title">{item.name}</span>
        <span className="ig-cell-meta">{item.managed_by || 'cert-manager'}</span>
      </div>
    ),
  },
  { id: 'secret', header: 'Secret', cell: (item) => item.secret_name || '—' },
  { id: 'hosts', header: 'Hosts', cell: (item) => item.hosts || '—' },
  { id: 'issuer', header: 'Issuer', cell: (item) => item.issuer || '—' },
  {
    id: 'status',
    header: 'Status',
    cell: (item) => <span className={`ig-chip ig-chip--${certificateTone(item.status)}`}>{item.status || 'unknown'}</span>,
  },
  {
    id: 'expires',
    header: 'Expires',
    cell: (item) => (item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '—'),
  },
  { id: 'days_left', header: 'Days left', align: 'right', className: 'ig-cell-num', cell: (item) => item.days_remaining },
  { id: 'namespace', header: 'Namespace', cell: (item) => item.namespace },
  { id: 'cluster', header: 'Cluster', cell: (item) => item.cluster_name },
  {
    id: 'expiry',
    header: 'Expiry tracking',
    cell: (item) => {
      const host = firstCertificateHost(item.hosts);
      if (!host) return 'Issued in cluster is not served-endpoint proof';
      const collector = host.endsWith('.local') || host.endsWith('.internal') || host === 'internal.example.com' ? '&collector=private' : '';
      return (
        <Link href={`/certificates/new?hostname=${encodeURIComponent(host)}&project_id=${encodeURIComponent(projectId)}${collector}`}>
          Register served endpoint
        </Link>
      );
    },
  },
];
}

export default function DevOpsK8sCertificatesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [overview, setOverview] = useState<K8sCertificatesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(readQueryString(router.query.project_id));
    setClusterName(readQueryString(router.query.cluster_name));
    setNamespace(readQueryString(router.query.namespace));
    setEnvironment(readQueryString(router.query.environment));
  }, [
    router.isReady,
    router.query.cluster_name,
    router.query.environment,
    router.query.namespace,
    router.query.project_id,
  ]);

  useEffect(() => {
    if (!router.isReady) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sCertificates(apiUrl, {
      project_id: projectId || undefined,
      cluster_name: clusterName || undefined,
      namespace: namespace || undefined,
      environment: environment || undefined,
    })
      .then((data) => {
        if (!active) return;
        setOverview(data);
      })
      .catch((err) => {
        if (!active) return;
        setOverview(null);
        setError(err instanceof Error ? err.message : 'Failed to load certificates');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, clusterName, environment, namespace, projectId, refreshKey, router.isReady]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = overview?.items || [];
    if (!query) return rows;
    return rows.filter((item) =>
      [item.name, item.namespace, item.cluster_name, item.secret_name, item.hosts, item.issuer, item.status]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [overview?.items, search]);

  const summary = useMemo(
    () => ({
      certificates: visibleRows.length,
      healthy: visibleRows.filter((item) => item.status.toLowerCase() === 'healthy').length,
      unknown: visibleRows.filter((item) => !['healthy', 'warning', 'expiring'].includes(item.status.toLowerCase())).length,
      warning: visibleRows.filter((item) => item.status.toLowerCase() === 'warning').length,
      expiring: visibleRows.filter((item) => item.status.toLowerCase() === 'expiring').length,
    }),
    [visibleRows],
  );

  return (
    <>
      <Head>
        <title>TLS & Certificates - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="TLS & Certificates"
          subtitle="Treat certificate posture as an operator surface: scan expiry risk, issuers, and cluster spread without leaving the K8s workspace."
          queryState={{ project_id: projectId, cluster_name: clusterName, namespace, environment }}
          actions={
            <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          }
        >
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">TLS posture</span>
                <h2 className="portal-surface__title">Certificate watchlist</h2>
                <p className="portal-surface__subtitle">
                  Cluster issued certificates are not proof the currently served endpoint was observed. Register the served hostname separately.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Certificates</span>
                <strong className="k8s-summary-card__value">{summary.certificates}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Healthy</span>
                <strong className="k8s-summary-card__value">{summary.healthy}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Unknown</span>
                <strong className="k8s-summary-card__value">{summary.unknown}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Warning</span>
                <strong className="k8s-summary-card__value">{summary.warning}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Expiring</span>
                <strong className="k8s-summary-card__value">{summary.expiring}</strong>
              </div>
            </div>

            <div className="k8s-filterbar k8s-filterbar--resources">
              <label className="k8s-filterbar__field k8s-filterbar__field--search">
                <span className="k8s-filterbar__label">Search</span>
                <input
                  className="input k8s-filterbar__input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search certificate, host, issuer, or secret"
                />
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">K8s cluster</span>
                <select
                  className="input k8s-filterbar__input"
                  value={clusterName}
                  onChange={(event) => {
                    setClusterName(event.target.value);
                    setNamespace('');
                  }}
                >
                  <option value="">All clusters</option>
                  {(overview?.clusters || []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Namespace</span>
                <select className="input k8s-filterbar__input" value={namespace} onChange={(event) => setNamespace(event.target.value)}>
                  <option value="">All namespaces</option>
                  {(overview?.namespaces || []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="k8s-filterbar__field">
                <span className="k8s-filterbar__label">Environment</span>
                <select
                  className="input k8s-filterbar__input"
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                >
                  <option value="">All environments</option>
                  {(overview?.environments || []).map((item) => (
                    <option key={item} value={item}>
                      {item.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              <div className="k8s-filterbar__actions">
                <span className="portal-pill">{visibleRows.length} visible</span>
                {(search || clusterName || namespace || environment) ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearch('');
                      setClusterName('');
                      setNamespace('');
                      setEnvironment('');
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <div className="ig-legacy-table">
              <DataTable<CertificateRow>
                label="Certificate watchlist"
                columns={certificateColumns(projectId)}
                rows={visibleRows}
                rowKey={(item) => `${item.cluster_name}-${item.namespace}-${item.name}`}
                loading={loading}
                empty={<EmptyState title="No certificates found" body="No certificates match the current filters." />}
              />
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
