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
    label: 'Clusters',
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
  const scopePills = [
    query.cluster_name ? { label: 'Cluster', value: query.cluster_name } : null,
    query.namespace ? { label: 'Namespace', value: query.namespace } : null,
    query.environment ? { label: 'Environment', value: query.environment.toUpperCase() } : null,
    query.project_id ? { label: 'Project', value: `#${query.project_id}` } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

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
      </div>

      <div className="k8s-workspace">
        <aside className="k8s-workspace__aside">
          <div className="k8s-workspace__intro">
            <span className="k8s-workspace__eyebrow">K8s Cluster</span>
            <h2 className="k8s-workspace__title">Workspace</h2>
            <p className="k8s-workspace__copy">Move between clusters, workloads, services, ConfigMaps, and storage from one clean rail.</p>
          </div>

          <div className="k8s-workspace__section">
            <span className="k8s-workspace__section-label">Sections</span>
          </div>

          <nav className="k8s-workspace__nav" aria-label="Kubernetes workspace">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={getNavHref(item.href)}
                className={`k8s-workspace__nav-link ${isActive(item.href) ? 'k8s-workspace__nav-link--active' : ''}`}
              >
                <span className="k8s-workspace__nav-title">{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="k8s-workspace__aside-footer">
            <Link
              href={getNavHref('/k8s/onboard')}
              className={`k8s-workspace__primary-action ${onboardActive ? 'k8s-workspace__primary-action--active' : ''}`}
            >
              Onboard cluster
            </Link>
          </div>
        </aside>

        <div className="k8s-workspace__content">
          <div className="k8s-workspace__utility">
            <div className="k8s-workspace__utility-main">
              <div>
                <span className="k8s-workspace__utility-eyebrow">K8s workspace</span>
                <h2 className="k8s-workspace__utility-title">{title}</h2>
              </div>
              <div className="k8s-workspace__utility-side">
                {scopePills.length ? (
                  <div className="k8s-workspace__scope-pills" aria-label="Current K8s scope">
                    {scopePills.map((item) => (
                      <span key={`${item.label}-${item.value}`} className="k8s-workspace__scope-pill">
                        <span className="k8s-workspace__scope-label">{item.label}</span>
                        <strong className="k8s-workspace__scope-value">{item.value}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
                {actions ? <div className="k8s-workspace__utility-actions">{actions}</div> : null}
              </div>
            </div>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
