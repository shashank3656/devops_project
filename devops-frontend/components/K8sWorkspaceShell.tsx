import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { buildK8sHref, readQueryString } from '../lib/k8sWorkspace';

interface K8sWorkspaceShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  actions?: ReactNode;
  queryState?: {
    project_id?: string;
    cluster_name?: string;
    namespace?: string;
    environment?: string;
  };
}

const NAV_ITEMS = [
  {
    href: '/k8s',
    label: 'K8s Clusters',
    copy: 'Browse onboarded clusters and jump into a selected cluster.',
  },
  {
    href: '/k8s/workloads',
    label: 'Workloads',
    copy: 'Inspect deployments running inside the selected cluster.',
  },
  {
    href: '/k8s/services',
    label: 'Services',
    copy: 'Review cluster networking and service exposure.',
  },
  {
    href: '/k8s/configmaps',
    label: 'ConfigMaps',
    copy: 'Check shared runtime configuration and mounted config.',
  },
  {
    href: '/k8s/storage',
    label: 'Storage',
    copy: 'Track persistent volumes, claims, and mounted storage.',
  },
];

export default function K8sWorkspaceShell({
  title,
  subtitle,
  children,
  actions,
  queryState,
}: K8sWorkspaceShellProps) {
  const router = useRouter();
  const defaultQueryState = {
    project_id: readQueryString(router.query.project_id),
    cluster_name: readQueryString(router.query.cluster_name),
    namespace: readQueryString(router.query.namespace),
    environment: readQueryString(router.query.environment),
  };
  const query = queryState || defaultQueryState;

  const getNavHref = (href: string) => {
    if (href === '/k8s') {
      return buildK8sHref(href, {
        project_id: query.project_id,
        environment: query.environment,
      });
    }
    if (href === '/k8s/onboard') {
      return buildK8sHref(href, {
        project_id: query.project_id,
        environment: query.environment,
      });
    }
    return buildK8sHref(href, query);
  };

  const isActive = (href: string) => {
    if (href === '/k8s') return router.pathname === '/k8s';
    return router.pathname === href || router.pathname.startsWith(`${href}/`);
  };
  const onboardActive = router.pathname === '/k8s/onboard';

  return (
    <div className="portal-page">
      <div className="portal-page__header">
        <div>
          <span className="portal-page__eyebrow">Kubernetes Engine</span>
          <h1 className="portal-page__title">{title}</h1>
          <p className="portal-page__subtitle">{subtitle}</p>
        </div>
        {actions ? <div className="portal-page__actions">{actions}</div> : null}
      </div>

      <div className="k8s-workspace">
        <aside className="k8s-workspace__aside">
          <div className="k8s-workspace__intro">
            <span className="k8s-workspace__eyebrow">Workspace</span>
            <h2 className="k8s-workspace__title">Kubernetes Engine</h2>
            <p className="k8s-workspace__copy">
              Use the same cluster-first flow across the DevOps portal: start with the cluster, then move into the resource view you need.
            </p>
          </div>

          <nav className="k8s-workspace__nav" aria-label="Kubernetes workspace">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={getNavHref(item.href)}
                className={`k8s-workspace__nav-link ${isActive(item.href) ? 'k8s-workspace__nav-link--active' : ''}`}
              >
                <span className="k8s-workspace__nav-title">{item.label}</span>
                <span className="k8s-workspace__nav-copy">{item.copy}</span>
              </Link>
            ))}
          </nav>

          <Link
            href={getNavHref('/k8s/onboard')}
            className={`k8s-workspace__primary-action ${onboardActive ? 'k8s-workspace__primary-action--active' : ''}`}
          >
            Onboard cluster
          </Link>
        </aside>

        <div className="k8s-workspace__content">{children}</div>
      </div>
    </div>
  );
}
