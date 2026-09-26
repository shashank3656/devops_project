import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState, type ReactNode } from 'react';
import { useApiUrl } from '../context/ApiUrlContext';
import { buildK8sHref, fetchK8sOverview } from '../lib/k8sWorkspace';
import {
  K8S_CATALOG_HREF,
  K8S_ONBOARD_HREF,
  K8S_WORKSPACE_TAB_GROUPS,
  buildK8sCatalogHref,
  buildK8sWorkspaceHref,
  hasK8sClusterScope,
  isK8sWorkspaceListPath,
  pathnameToView,
  type K8sScopeQuery,
} from '../lib/k8sWorkspaceNav';

interface K8sWorkspaceShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  actions?: ReactNode;
  queryState?: K8sScopeQuery;
}

export default function K8sWorkspaceShell({
  title,
  subtitle,
  children,
  actions,
  queryState = {},
}: K8sWorkspaceShellProps) {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const scope = queryState;
  const scoped = hasK8sClusterScope(scope);
  const activeView = pathnameToView(router.pathname);
  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!isK8sWorkspaceListPath(router.pathname)) return;
    if (hasK8sClusterScope(scope)) return;
    void router.replace(buildK8sCatalogHref(scope));
  }, [router, router.isReady, router.pathname, scope, scope.cluster_name, scope.environment, scope.project_id]);

  useEffect(() => {
    if (!scoped || !scope.cluster_name) {
      setNamespaceOptions([]);
      return;
    }
    let active = true;
    fetchK8sOverview(apiUrl, {
      project_id: scope.project_id,
      cluster_name: scope.cluster_name,
      environment: scope.environment,
    })
      .then((overview) => {
        if (active) setNamespaceOptions(overview.namespaces || []);
      })
      .catch(() => {
        if (active) setNamespaceOptions([]);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, scope.cluster_name, scope.environment, scope.project_id, scoped]);

  const catalogHref = buildK8sHref(K8S_CATALOG_HREF, {
    project_id: scope.project_id,
    environment: scope.environment,
  });
  const onboardHref = buildK8sHref(K8S_ONBOARD_HREF, {
    project_id: scope.project_id,
    environment: scope.environment,
  });
  const overviewHref = scoped ? buildK8sWorkspaceHref('overview', scope) : catalogHref;

  const onNamespaceChange = (namespace: string) => {
    const view = activeView && activeView !== 'overview' ? activeView : 'overview';
    const href = buildK8sWorkspaceHref(view, {
      ...scope,
      namespace: namespace || undefined,
    });
    void router.push(href);
  };

  if (router.isReady && isK8sWorkspaceListPath(router.pathname) && !scoped) {
    return null;
  }

  return (
    <div className="portal-page k8s-workspace-page">
      <div className="portal-page__header">
        <div>
          <span className="portal-page__eyebrow">Kubernetes workspace</span>
          <h1 className="portal-page__title">{title}</h1>
          <p className="portal-page__subtitle">{subtitle}</p>
          {scoped ? (
            <p className="portal-page__subtitle k8s-workspace-scope" style={{ marginTop: 8 }}>
              Cluster{' '}
              <Link href={overviewHref} className="k8s-workspace-rail__link">
                <strong>{scope.cluster_name}</strong>
              </Link>
              {scope.environment ? (
                <>
                  {' '}
                  · env <strong>{scope.environment}</strong>
                </>
              ) : null}
            </p>
          ) : (
            <p className="portal-page__subtitle" style={{ marginTop: 8 }}>
              Pick a cluster from the catalog to scope workloads, pods, and logs in one place.
            </p>
          )}
        </div>
        {actions ? <div className="portal-page__actions">{actions}</div> : null}
      </div>

      <nav className="k8s-workspace-rail" aria-label="Kubernetes workspace">
        <Link
          href={catalogHref}
          className={router.pathname === '/k8s' ? 'k8s-workspace-rail__link is-active' : 'k8s-workspace-rail__link'}
        >
          Clusters
        </Link>
        <Link
          href={onboardHref}
          className={
            router.pathname.startsWith('/k8s/onboard') ? 'k8s-workspace-rail__link is-active' : 'k8s-workspace-rail__link'
          }
        >
          Connections
        </Link>
        {scoped ? (
          <>
            <span className="k8s-workspace-rail__sep" aria-hidden />
            <label className="k8s-workspace-rail__namespace">
              <span className="k8s-workspace-rail__label">Namespace</span>
              <select
                className="input k8s-workspace-rail__select"
                value={scope.namespace || ''}
                onChange={(event) => onNamespaceChange(event.target.value)}
              >
                <option value="">All namespaces</option>
                {namespaceOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </nav>

      {scoped ? (
        <div className="k8s-workspace-tabs" role="tablist" aria-label="Resource types">
          {K8S_WORKSPACE_TAB_GROUPS.map((group) => (
            <div key={group.label} className="k8s-workspace-tabs__group">
              <span className="k8s-workspace-tabs__group-label">{group.label}</span>
              <div className="ig-k8s-tabs ig-k8s-tabs--inline">
                {group.tabs.map((tab) => {
                  const href = buildK8sWorkspaceHref(tab.view, scope);
                  const active = activeView === tab.view;
                  return (
                    <Link key={tab.view} href={href} className={active ? 'is-active' : ''} role="tab" aria-selected={active}>
                      {tab.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {children}
    </div>
  );
}
