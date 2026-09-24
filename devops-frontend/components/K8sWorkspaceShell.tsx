import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import Link from 'next/link';

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
}: K8sWorkspaceShellProps) {
  const router = useRouter();

  const tabs = [
    { href: '/k8s', label: 'Clusters' },
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
        {actions ? <div className="portal-page__actions">{actions}</div> : null}
      </div>
      <nav className="ig-k8s-tabs" aria-label="Kubernetes sections">
        {tabs.map((tab) => {
          const active =
            tab.href === '/k8s'
              ? router.pathname === '/k8s'
              : router.pathname === tab.href || router.pathname.startsWith(`${tab.href}/`);
          return (
            <Link key={tab.href} href={tab.href} className={active ? 'is-active' : ''}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
