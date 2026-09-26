import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { buildClusterWorkspaceEntry, readK8sScopeFromQuery } from '../../../lib/k8sWorkspaceNav';
import { readQueryString } from '../../../lib/k8sWorkspace';

/** NF-02: legacy cluster URL → scoped workspace (query preserved). */
export default function DevOpsK8sClusterLegacyRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const routeCluster = readQueryString(router.query.cluster);
    const scope = readK8sScopeFromQuery(router.query);
    const clusterName = scope.cluster_name || routeCluster;
    if (!clusterName) {
      void router.replace('/k8s');
      return;
    }
    void router.replace(
      buildClusterWorkspaceEntry(clusterName, {
        project_id: scope.project_id,
        namespace: scope.namespace,
        environment: scope.environment,
      }),
    );
  }, [router]);

  return null;
}
