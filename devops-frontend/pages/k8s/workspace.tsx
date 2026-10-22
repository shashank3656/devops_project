import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sOperatorNextSteps from '../../components/K8sOperatorNextSteps';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import { buildK8sWorkspaceHref, readK8sScopeFromQuery } from '../../lib/k8sWorkspaceNav';
import {
  buildK8sHref,
  fetchK8sClusterDetail,
  formatDateTime,
  K8sClusterDetailData,
  readQueryString,
} from '../../lib/k8sWorkspace';

export default function DevOpsK8sWorkspacePage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const scope = readK8sScopeFromQuery(router.query);
  const [detail, setDetail] = useState<K8sClusterDetailData | null>(null);
  const [k8sAccess, setK8sAccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!router.isReady) return;
    if (!scope.cluster_name) {
      void router.replace(buildK8sHref('/k8s', { project_id: scope.project_id, environment: scope.environment }));
    }
  }, [router, scope.cluster_name, scope.project_id, scope.environment]);

  useEffect(() => {
    if (!router.isReady || !scope.cluster_name) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sClusterDetail(apiUrl, {
      project_id: scope.project_id,
      cluster_name: scope.cluster_name,
      namespace: scope.namespace,
      environment: scope.environment,
    })
      .then((data) => {
        if (active) {
          setDetail(data);
          setK8sAccess(data.k8s_access || '');
        }
      })
      .catch((err) => {
        if (active) {
          setDetail(null);
          setError(err instanceof Error ? err.message : 'Failed to load cluster workspace');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, refreshKey, router.isReady, scope.cluster_name, scope.namespace, scope.project_id, scope.environment]);

  if (!scope.cluster_name) {
    return null;
  }

  return (
    <>
      <Head>
        <title>{scope.cluster_name} - Kubernetes workspace</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title={scope.cluster_name}
          subtitle="Cluster overview — pick a resource tab to drill into workloads, pods, networking, or logs without losing context."
          queryState={scope}
          actions={
            <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((v) => v + 1)}>
              Refresh
            </button>
          }
        >
          {error ? (
            <div className="portal-table-state portal-table-state--error">
              <h3 className="portal-table-state__title">Could not open this cluster workspace</h3>
              <p className="portal-table-state__copy">{error}</p>
              <div className="portal-table-state__actions">
                <Link href={buildK8sHref('/k8s', { project_id: scope.project_id, environment: scope.environment })} className="btn btn-secondary">
                  Back to cluster catalog
                </Link>
              </div>
            </div>
          ) : !loading && !detail ? (
            <div className="portal-table-state portal-table-state--empty">
              <h3 className="portal-table-state__title">Cluster not found or not onboarded</h3>
              <p className="portal-table-state__copy">
                This workspace URL does not match an onboarded cluster you can access. Pick another cluster from the catalog or onboard a new connection.
              </p>
              <div className="portal-table-state__actions">
                <Link href={buildK8sHref('/k8s', { project_id: scope.project_id, environment: scope.environment })} className="btn btn-secondary">
                  Cluster catalog
                </Link>
                {k8sAccess === 'write' ? (
                  <Link href={buildK8sHref('/k8s/onboard/new', { project_id: scope.project_id, environment: scope.environment })} className="btn btn-primary">
                    Onboard cluster
                  </Link>
                ) : null}
              </div>
            </div>
          ) : loading ? (
            <p className="portal-page__subtitle">Loading cluster context…</p>
          ) : detail ? (
            <>
              <section className="k8s-summary-strip" aria-label="Cluster summary">
                <div className="k8s-summary-card">
                  <span className="k8s-summary-card__label">Health</span>
                  <strong className="k8s-summary-card__value">{detail.cluster?.health_status || '—'}</strong>
                </div>
                <div className="k8s-summary-card">
                  <span className="k8s-summary-card__label">Namespaces</span>
                  <strong className="k8s-summary-card__value">{detail.summary.namespace_count}</strong>
                </div>
                <div className="k8s-summary-card">
                  <span className="k8s-summary-card__label">Workloads</span>
                  <strong className="k8s-summary-card__value">{detail.summary.deployment_count}</strong>
                </div>
                <div className="k8s-summary-card">
                  <span className="k8s-summary-card__label">Pods</span>
                  <strong className="k8s-summary-card__value">{detail.summary.pod_count}</strong>
                </div>
              </section>

              <section className="portal-surface" style={{ marginTop: 16 }}>
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Quick open</span>
                    <h2 className="portal-surface__title">Resources in this cluster</h2>
                  </div>
                </div>
                <div className="portal-form-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <Link href={buildK8sWorkspaceHref('workloads', scope)} className="btn btn-secondary btn-sm">
                    Workloads
                  </Link>
                  <Link href={buildK8sWorkspaceHref('pods', scope)} className="btn btn-secondary btn-sm">
                    Pods
                  </Link>
                  <Link href={buildK8sWorkspaceHref('logs', scope)} className="btn btn-secondary btn-sm">
                    Logs
                  </Link>
                  <Link href={buildK8sWorkspaceHref('events', scope)} className="btn btn-secondary btn-sm">
                    Events
                  </Link>
                </div>
                {detail.cluster?.updated_at ? (
                  <p className="portal-surface__subtitle">
                    Last sync {formatDateTime(detail.cluster.updated_at)}
                    {readQueryString(router.query.namespace) ? ` · namespace ${readQueryString(router.query.namespace)}` : ''}
                  </p>
                ) : null}
              </section>

              <K8sOperatorNextSteps
                title="Operator handoff"
                subtitle="Jump into the resource view you need while keeping this cluster and namespace context."
                items={[
                  {
                    href: buildK8sWorkspaceHref('workloads', scope),
                    label: 'Workloads',
                    detail: 'Deployments and rollout health for this cluster.',
                  },
                  {
                    href: buildK8sWorkspaceHref('pods', scope),
                    label: 'Pods',
                    detail: 'Pod inventory, restarts, and drill-down to logs or terminal.',
                  },
                  {
                    href: buildK8sWorkspaceHref('logs', scope),
                    label: 'Logs',
                    detail: 'Stream or search logs without leaving the workspace chrome.',
                  },
                  {
                    href: buildK8sWorkspaceHref('events', scope),
                    label: 'Events',
                    detail: 'Recent cluster and namespace events.',
                  },
                ]}
              />
            </>
          ) : null}
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
