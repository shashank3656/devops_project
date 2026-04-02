import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
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

  return (
    <div className="portal-page">
      <div className="portal-page__header">
        <div>
          <span className="portal-page__eyebrow">Kubernetes Engine</span>
          <h1 className="portal-page__title">{title}</h1>
          <p className="portal-page__subtitle">{subtitle}</p>
        </div>
      </div>

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
