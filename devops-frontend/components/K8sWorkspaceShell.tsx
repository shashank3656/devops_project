import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { readQueryString } from '../lib/k8sWorkspace';

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

  const tabs = [
    { href: '/k8s', label: 'Cluster' },
    { href: '/k8s/workloads', label: 'Workloads' },
    { href: '/k8s/pods', label: 'Pods' },
    { href: '/k8s/logs', label: 'Logs' },
    { href: '/k8s/events', label: 'Events' },
    { href: '/k8s/services', label: 'Services' },
    { href: '/k8s/ingresses', label: 'Ingress' },
    { href: '/k8s/storage', label: 'Storage' },
    { href: '/k8s/certificates', label: 'TLS' },
    { href: '/k8s/onboard', label: 'Onboard' },
  ];

  return (
    <div className="portal-page">
      <div className="portal-page__header">
        <div>
          <span className="portal-page__eyebrow">Kubernetes</span>
          <h1 className="portal-page__title">{title}</h1>
          <p className="portal-page__subtitle">{subtitle}</p>
        </div>
      </div>
      <nav className="ig-k8s-tabs" aria-label="Kubernetes sections">
        {tabs.map((tab) => {
          const active = tab.href === '/k8s'
            ? router.pathname === '/k8s'
            : router.pathname === tab.href || router.pathname.startsWith(`${tab.href}/`);
          return (
            <Link key={tab.href} href={tab.href} className={active ? 'is-active' : ''}>
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="k8s-workspace k8s-workspace--content-only">
        <div className="k8s-workspace__content k8s-workspace__content--solo">
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
