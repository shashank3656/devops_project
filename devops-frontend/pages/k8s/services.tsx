import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  buildK8sHref,
  fetchK8sPods,
  fetchK8sServices,
  fetchK8sWorkloads,
  K8sPodsData,
  K8sServicesData,
  K8sWorkloadsData,
  readQueryString,
} from '../../lib/k8sWorkspace';

function normalizeDependencyName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

type K8sServiceRow = K8sServicesData['items'][number];

function buildServiceKey(item: Pick<K8sServiceRow, 'cluster_name' | 'namespace' | 'name'>) {
  return `${item.cluster_name}::${item.namespace}::${item.name}`;
}

function describeServiceRisk(item: K8sServiceRow) {
  const exposure = item.exposure.trim().toLowerCase();
  const type = item.type.trim().toLowerCase();
  const ingressBacked = item.ingress_host.trim() !== '';
  const isExternal =
    (exposure !== '' && exposure !== 'internal') || ingressBacked || item.external_ip.trim() !== '';
  const noSelector = item.selector.trim() === '';
  const addressGap =
    !item.cluster_ip.trim() &&
    !item.external_ip.trim() &&
    !item.ingress_host.trim() &&
    type !== 'externalname';
  const issues: string[] = [];

  if (isExternal) {
    issues.push(
      ingressBacked
        ? 'Traffic can reach this service through an ingress route.'
        : 'Traffic can reach this service directly from outside the cluster.',
    );
  }
  if (noSelector) {
    issues.push('Selector is missing, so backend ownership is unclear.');
  }
  if (addressGap) {
    issues.push('No cluster or external address is published yet.');
  }
  if (type === 'externalname') {
    issues.push('This service depends on an external name outside the cluster boundary.');
  }

  const riskScore =
    (isExternal ? 3 : 0) +
    (ingressBacked ? 2 : 0) +
    (noSelector ? 3 : 0) +
    (addressGap ? 2 : 0) +
    (type === 'externalname' ? 1 : 0);

  return {
    ingressBacked,
    isExternal,
    noSelector,
    addressGap,
    riskScore,
    issues,
  };
}

export default function DevOpsK8sServicesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [overview, setOverview] = useState<K8sServicesData | null>(null);
  const [workloadOverview, setWorkloadOverview] = useState<K8sWorkloadsData | null>(null);
  const [podOverview, setPodOverview] = useState<K8sPodsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [environment, setEnvironment] = useState('');
  const [search, setSearch] = useState('');
  const [selectedServiceKey, setSelectedServiceKey] = useState('');

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

    Promise.all([
      fetchK8sServices(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
      fetchK8sWorkloads(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
      fetchK8sPods(apiUrl, {
        project_id: projectId || undefined,
        cluster_name: clusterName || undefined,
        namespace: namespace || undefined,
        environment: environment || undefined,
      }),
    ])
      .then(([data, workloadData, podData]) => {
        if (!active) return;
        setOverview(data);
        setWorkloadOverview(workloadData);
        setPodOverview(podData);
      })
      .catch((err) => {
        if (!active) return;
        setOverview(null);
        setWorkloadOverview(null);
        setPodOverview(null);
        setError(err instanceof Error ? err.message : 'Failed to load services');
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
      [item.name, item.namespace, item.cluster_name, item.type, item.ports, item.exposure, item.selector]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [overview?.items, search]);

  const summary = useMemo(
    () => ({
      services: visibleRows.length,
      external: visibleRows.filter((item) => item.exposure.toLowerCase() !== 'internal').length,
      namespaces: new Set(visibleRows.map((item) => item.namespace)).size,
      clusters: new Set(visibleRows.map((item) => item.cluster_name)).size,
    }),
    [visibleRows],
  );

  const servicePressure = useMemo(() => {
    const namespaceMap = new Map<
      string,
      {
        namespace: string;
        serviceCount: number;
        exposedServices: number;
        ingressBacked: number;
        selectorGaps: number;
        addressGaps: number;
        clusterCount: number;
        clusters: Set<string>;
        riskScore: number;
      }
    >();

    const riskyServices = visibleRows
      .map((item) => {
        const exposure = item.exposure.trim().toLowerCase();
        const type = item.type.trim().toLowerCase();
        const ingressBacked = item.ingress_host.trim() !== '';
        const isExternal =
          (exposure !== '' && exposure !== 'internal') || ingressBacked || item.external_ip.trim() !== '';
        const noSelector = item.selector.trim() === '';
        const addressGap = !item.cluster_ip.trim() && !item.external_ip.trim() && !item.ingress_host.trim() && type !== 'externalname';
        const issues: string[] = [];

        if (isExternal) {
          issues.push(
            ingressBacked
              ? 'Traffic can reach this service through an ingress route.'
              : 'Traffic can reach this service directly from outside the cluster.',
          );
        }
        if (noSelector) {
          issues.push('Selector is missing, so backend ownership is unclear.');
        }
        if (addressGap) {
          issues.push('No cluster or external address is published yet.');
        }
        if (type === 'externalname') {
          issues.push('This service depends on an external name outside the cluster boundary.');
        }

        const riskScore =
          (isExternal ? 3 : 0) +
          (ingressBacked ? 2 : 0) +
          (noSelector ? 3 : 0) +
          (addressGap ? 2 : 0) +
          (type === 'externalname' ? 1 : 0);

        const namespaceSummary = namespaceMap.get(item.namespace) || {
          namespace: item.namespace,
          serviceCount: 0,
          exposedServices: 0,
          ingressBacked: 0,
          selectorGaps: 0,
          addressGaps: 0,
          clusterCount: 0,
          clusters: new Set<string>(),
          riskScore: 0,
        };

        namespaceSummary.serviceCount += 1;
        namespaceSummary.exposedServices += isExternal ? 1 : 0;
        namespaceSummary.ingressBacked += ingressBacked ? 1 : 0;
        namespaceSummary.selectorGaps += noSelector ? 1 : 0;
        namespaceSummary.addressGaps += addressGap ? 1 : 0;
        namespaceSummary.riskScore += riskScore;
        namespaceSummary.clusters.add(item.cluster_name);
        namespaceSummary.clusterCount = namespaceSummary.clusters.size;
        namespaceMap.set(item.namespace, namespaceSummary);

        return {
          ...item,
          ingressBacked,
          isExternal,
          noSelector,
          addressGap,
          riskScore,
          issues,
        };
      })
      .sort((left, right) => {
        if (right.riskScore !== left.riskScore) {
          return right.riskScore - left.riskScore;
        }
        return left.name.localeCompare(right.name);
      });

    const namespacePressure = [...namespaceMap.values()]
      .map(({ clusters: _clusters, ...item }) => item)
      .sort((left, right) => {
        if (right.riskScore !== left.riskScore) {
          return right.riskScore - left.riskScore;
        }
        return left.namespace.localeCompare(right.namespace);
      });

    return {
      edgeEntryPoints: riskyServices.filter((item) => item.isExternal).length,
      selectorGaps: riskyServices.filter((item) => item.noSelector).length,
      ingressBacked: riskyServices.filter((item) => item.ingressBacked).length,
      addressGaps: riskyServices.filter((item) => item.addressGap).length,
      hotspotNamespaces: namespacePressure.filter((item) => item.riskScore > 0).length,
      topNamespaces: namespacePressure.filter((item) => item.riskScore > 0).slice(0, 3),
      riskyServices: riskyServices.filter((item) => item.riskScore > 0).slice(0, 4),
    };
  }, [visibleRows]);

  const serviceGuidance = useMemo(() => {
    const guidance: string[] = [];
    if (servicePressure.selectorGaps > 0) {
      guidance.push(
        `${servicePressure.selectorGaps} services are missing selectors. Those are the first places to confirm workload ownership before an incident fans out.`,
      );
    }
    if (servicePressure.edgeEntryPoints > 0) {
      guidance.push(
        `${servicePressure.edgeEntryPoints} services are reachable from an edge path. Pair those with ingress and certificate review when traffic behavior looks unstable.`,
      );
    }
    if (servicePressure.addressGaps > 0) {
      guidance.push(
        `${servicePressure.addressGaps} services have an address gap. Check whether those are intentional handoff points or incomplete service wiring.`,
      );
    }
    if (guidance.length === 0) {
      guidance.push('Service dependency pressure is low right now. This page is in a good state for routine exposure review and namespace hygiene checks.');
    }
    return guidance;
  }, [servicePressure.addressGaps, servicePressure.edgeEntryPoints, servicePressure.selectorGaps]);

  const namespaceDependencyMap = useMemo(() => {
    const namespaceMap = new Map<
      string,
      {
        namespace: string;
        serviceCount: number;
        edgeCount: number;
        ingressCount: number;
        selectorGapCount: number;
        addressGapCount: number;
        topServices: Array<{
          name: string;
          type: string;
          exposure: string;
          riskScore: number;
          ingressHost: string;
        }>;
      }
    >();

    visibleRows.forEach((item) => {
      const exposure = item.exposure.trim().toLowerCase();
      const ingressBacked = item.ingress_host.trim() !== '';
      const isExternal =
        (exposure !== '' && exposure !== 'internal') || ingressBacked || item.external_ip.trim() !== '';
      const noSelector = item.selector.trim() === '';
      const addressGap =
        !item.cluster_ip.trim() && !item.external_ip.trim() && !item.ingress_host.trim() && item.type.trim().toLowerCase() !== 'externalname';
      const riskScore =
        (isExternal ? 3 : 0) +
        (ingressBacked ? 2 : 0) +
        (noSelector ? 3 : 0) +
        (addressGap ? 2 : 0);

      const summary = namespaceMap.get(item.namespace) || {
        namespace: item.namespace,
        serviceCount: 0,
        edgeCount: 0,
        ingressCount: 0,
        selectorGapCount: 0,
        addressGapCount: 0,
        topServices: [],
      };

      summary.serviceCount += 1;
      summary.edgeCount += isExternal ? 1 : 0;
      summary.ingressCount += ingressBacked ? 1 : 0;
      summary.selectorGapCount += noSelector ? 1 : 0;
      summary.addressGapCount += addressGap ? 1 : 0;
      summary.topServices.push({
        name: item.name,
        type: item.type || 'Service',
        exposure: item.exposure || 'internal',
        riskScore,
        ingressHost: item.ingress_host,
      });
      summary.topServices.sort((left, right) => {
        if (right.riskScore !== left.riskScore) {
          return right.riskScore - left.riskScore;
        }
        return left.name.localeCompare(right.name);
      });
      summary.topServices = summary.topServices.slice(0, 4);
      namespaceMap.set(item.namespace, summary);
    });

    return [...namespaceMap.values()]
      .sort((left, right) => {
        const leftScore = left.edgeCount * 3 + left.selectorGapCount * 2 + left.addressGapCount * 2 + left.ingressCount;
        const rightScore = right.edgeCount * 3 + right.selectorGapCount * 2 + right.addressGapCount * 2 + right.ingressCount;
        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }
        return left.namespace.localeCompare(right.namespace);
      })
      .slice(0, 4);
  }, [visibleRows]);

  const serviceRuntimeTrace = useMemo(() => {
    const workloads = workloadOverview?.items || [];
    const pods = podOverview?.items || [];

    return visibleRows
      .map((service) => {
        const risk = describeServiceRisk(service);
        const serviceKey = buildServiceKey(service);
        const normalizedService = normalizeDependencyName(service.name);
        const selectorTokens = service.selector
          .split(/[,\s=]+/)
          .map((item) => normalizeDependencyName(item))
          .filter(Boolean);

        const matchedWorkloads = workloads.filter((workload) => {
          if (workload.namespace !== service.namespace || workload.cluster_name !== service.cluster_name) return false;
          const normalizedWorkload = normalizeDependencyName(workload.name);
          return (
            normalizedWorkload.includes(normalizedService) ||
            normalizedService.includes(normalizedWorkload) ||
            selectorTokens.some(
              (token) => token && (normalizedWorkload.includes(token) || token.includes(normalizedWorkload)),
            )
          );
        });

        const matchedPods = pods.filter((pod) => {
          if (pod.namespace !== service.namespace || pod.cluster_name !== service.cluster_name) return false;
          const normalizedPod = normalizeDependencyName(pod.name);
          return (
            normalizedPod.includes(normalizedService) ||
            matchedWorkloads.some((workload) => normalizedPod.includes(normalizeDependencyName(workload.name)))
          );
        });

        const unhealthyPods = matchedPods.filter((pod) => {
          const status = pod.status.trim().toLowerCase();
          return status !== 'running' && status !== 'healthy' && status !== 'ready';
        });

        return {
          serviceKey,
          service: {
            ...service,
            ...risk,
          },
          matchedWorkloads,
          matchedPods,
          unhealthyPods,
          restartPressure: matchedPods.reduce((sum, pod) => sum + pod.restarts, 0),
        };
      })
      .sort((left, right) => {
        if (right.service.riskScore !== left.service.riskScore) {
          return right.service.riskScore - left.service.riskScore;
        }
        return left.service.name.localeCompare(right.service.name);
      });
  }, [podOverview?.items, visibleRows, workloadOverview?.items]);

  const serviceTraceHighlights = useMemo(
    () => serviceRuntimeTrace.filter((item) => item.service.riskScore > 0).slice(0, 4),
    [serviceRuntimeTrace],
  );

  useEffect(() => {
    if (serviceRuntimeTrace.length === 0) {
      if (selectedServiceKey) setSelectedServiceKey('');
      return;
    }
    if (selectedServiceKey && serviceRuntimeTrace.some((item) => item.serviceKey === selectedServiceKey)) {
      return;
    }
    setSelectedServiceKey(serviceRuntimeTrace[0].serviceKey);
  }, [selectedServiceKey, serviceRuntimeTrace]);

  const activeServiceDrilldown = useMemo(() => {
    if (!serviceRuntimeTrace.length) return null;
    const selected =
      serviceRuntimeTrace.find((item) => item.serviceKey === selectedServiceKey) || serviceRuntimeTrace[0];
    const namespacePeers = serviceRuntimeTrace
      .filter(
        (item) =>
          item.service.namespace === selected.service.namespace && item.serviceKey !== selected.serviceKey,
      )
      .sort((left, right) => right.service.riskScore - left.service.riskScore)
      .slice(0, 4)
      .map((item) => item.service);

    return {
      ...selected,
      namespacePeers,
      namespacePeerExposure: namespacePeers.filter((item) => item.isExternal || item.ingressBacked).length,
    };
  }, [selectedServiceKey, serviceRuntimeTrace]);

  const serviceColumns: DataTableColumn<K8sServiceRow>[] = [
    {
      id: 'service',
      header: 'Service',
      cell: (item) => (
        <div className="ig-cell-stack">
          <Link
            href={buildK8sHref(`/k8s/services/${encodeURIComponent(item.name)}`, {
              project_id: projectId || undefined,
              cluster_name: item.cluster_name || undefined,
              namespace: item.namespace || undefined,
              environment: environment || undefined,
            })}
            className="ig-cell-link"
          >
            <span className="ig-cell-title">{item.name}</span>
          </Link>
          <span className="ig-cell-meta">{item.selector || 'No selector'}</span>
        </div>
      ),
    },
    { id: 'namespace', header: 'Namespace', cell: (item) => item.namespace },
    { id: 'type', header: 'Type', cell: (item) => item.type || '—' },
    { id: 'cluster_ip', header: 'Cluster IP', cell: (item) => <span className="ig-mono">{item.cluster_ip || '—'}</span> },
    { id: 'external_ip', header: 'External IP', cell: (item) => <span className="ig-mono">{item.external_ip || '—'}</span> },
    { id: 'ingress', header: 'Ingress', cell: (item) => item.ingress_host || '—' },
    { id: 'ports', header: 'Ports', cell: (item) => <span className="ig-mono">{item.ports || '—'}</span> },
    {
      id: 'exposure',
      header: 'Exposure',
      cell: (item) => {
        const exposure = item.exposure || 'internal';
        return <span className={`ig-chip ig-chip--${exposure.toLowerCase() === 'internal' ? 'muted' : 'info'}`}>{exposure}</span>;
      },
    },
    { id: 'cluster', header: 'Cluster', cell: (item) => item.cluster_name },
  ];

  return (
    <>
      <Head>
        <title>Services - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Services"
          subtitle="Inspect service exposure in the same cluster-first pattern: choose a cluster, narrow the namespace, then work through the service list."
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
                <span className="portal-surface__eyebrow">Cluster services</span>
                <h2 className="portal-surface__title">Service and exposure map</h2>
                <p className="portal-surface__subtitle">
                  Review internal and external service exposure without leaving the K8s workspace.
                </p>
              </div>
            </div>

            <div className="k8s-summary-strip">
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Services</span>
                <strong className="k8s-summary-card__value">{summary.services}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Externally exposed</span>
                <strong className="k8s-summary-card__value">{summary.external}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Namespaces</span>
                <strong className="k8s-summary-card__value">{summary.namespaces}</strong>
              </div>
              <div className="k8s-summary-card">
                <span className="k8s-summary-card__label">Clusters</span>
                <strong className="k8s-summary-card__value">{summary.clusters}</strong>
              </div>
            </div>

            <div className="k8s-filterbar k8s-filterbar--resources">
              <label className="k8s-filterbar__field k8s-filterbar__field--search">
                <span className="k8s-filterbar__label">Search</span>
                <input
                  className="input k8s-filterbar__input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search service, selector, or ports"
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

            <div className="k8s-diagnostic-grid">
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Edge entry points</span>
                <strong className="k8s-diagnostic-card__value">{servicePressure.edgeEntryPoints}</strong>
                <span className="k8s-diagnostic-card__meta">Services reachable through an ingress host, external IP, or explicit external exposure.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Selector gaps</span>
                <strong className="k8s-diagnostic-card__value">{servicePressure.selectorGaps}</strong>
                <span className="k8s-diagnostic-card__meta">Services where backend ownership is unclear because the selector is missing.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Ingress-backed</span>
                <strong className="k8s-diagnostic-card__value">{servicePressure.ingressBacked}</strong>
                <span className="k8s-diagnostic-card__meta">Services already sitting behind an ingress route and certificate path.</span>
              </div>
              <div className="k8s-diagnostic-card">
                <span className="k8s-diagnostic-card__label">Hotspot namespaces</span>
                <strong className="k8s-diagnostic-card__value">{servicePressure.hotspotNamespaces}</strong>
                <span className="k8s-diagnostic-card__meta">Namespaces with enough exposure or dependency gaps to deserve a second look.</span>
              </div>
            </div>

            <div className="k8s-spotlight-grid">
              {servicePressure.topNamespaces.map((item) => (
                <article key={item.namespace} className="k8s-spotlight-card">
                  <div className="k8s-spotlight-card__header">
                    <div>
                      <h3 className="k8s-spotlight-card__title">{item.namespace}</h3>
                      <p className="k8s-spotlight-card__meta">{item.clusterCount} clusters represented in the current service view.</p>
                    </div>
                    <span className="portal-pill">Pressure {item.riskScore}</span>
                  </div>
                  <div className="k8s-spotlight-card__stats">
                    <span>Services {item.serviceCount}</span>
                    <span>Exposed {item.exposedServices}</span>
                    <span>Ingress {item.ingressBacked}</span>
                    <span>Selector gaps {item.selectorGaps}</span>
                  </div>
                </article>
              ))}
              {!loading && servicePressure.topNamespaces.length === 0 ? (
                <div className="portal-empty">
                  <p>No namespace dependency hotspots are visible for the current service filters.</p>
                </div>
              ) : null}
            </div>

            <div className="k8s-detail-columns">
              <div className="k8s-section-stack">
                <h3 className="k8s-section-stack__title">Service dependency trace</h3>
                <div className="k8s-trace-list">
                  {serviceTraceHighlights.map(({ service: item }) => (
                    <article key={`${item.cluster_name}-${item.namespace}-${item.name}-trace`} className="k8s-trace-item">
                      <div className="k8s-trace-item__header">
                        <strong className="k8s-trace-item__title">{item.name}</strong>
                        <span className="portal-pill">Risk {item.riskScore}</span>
                      </div>
                      <p className="k8s-trace-item__meta">
                        {item.namespace} · {item.cluster_name} · {item.type || 'Service'} ·{' '}
                        {item.ports || 'Ports pending'}
                      </p>
                      <div className="k8s-trace-item__issues">
                        {item.issues.map((issue) => (
                          <span key={`${item.name}-${issue}`} className="k8s-trace-item__issue">
                            {issue}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                  {!loading && serviceTraceHighlights.length === 0 ? (
                    <div className="portal-empty">
                      <p>No risky service paths are visible for the current filter set.</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="k8s-section-stack">
                <h3 className="k8s-section-stack__title">Recommended next checks</h3>
                <div className="k8s-guidance-list">
                  {serviceGuidance.map((item) => (
                    <div key={item} className="k8s-guidance-list__item">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="k8s-section-stack">
              <h3 className="k8s-section-stack__title">Namespace to service dependency map</h3>
              <div className="k8s-spotlight-grid">
                {namespaceDependencyMap.map((item) => (
                  <article key={item.namespace} className="k8s-spotlight-card">
                    <div className="k8s-spotlight-card__header">
                      <div>
                        <h3 className="k8s-spotlight-card__title">{item.namespace}</h3>
                        <p className="k8s-spotlight-card__meta">
                          {item.serviceCount} services · {item.edgeCount} edge paths · {item.ingressCount} ingress-backed
                        </p>
                      </div>
                      <span className="portal-pill">Selector gaps {item.selectorGapCount}</span>
                    </div>
                    <div className="k8s-spotlight-card__stats">
                      <span>Address gaps {item.addressGapCount}</span>
                      <span>Top dependencies {item.topServices.length}</span>
                    </div>
                    <div className="k8s-service-chip-list">
                      {item.topServices.map((service) => (
                        <div key={`${item.namespace}-${service.name}`} className="k8s-service-chip">
                          <strong>{service.name}</strong>
                          <span>{service.type}</span>
                          <span>{service.ingressHost || service.exposure}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                {!loading && namespaceDependencyMap.length === 0 ? (
                  <div className="portal-empty">
                    <p>No namespace dependency map is available for the current filter set.</p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="k8s-section-stack">
              <h3 className="k8s-section-stack__title">Service to pod dependency drilldown</h3>
              <div className="k8s-trace-list">
                {serviceRuntimeTrace.map(({ service, matchedWorkloads, matchedPods, unhealthyPods, restartPressure }) => (
                  <article key={`${service.cluster_name}-${service.namespace}-${service.name}-runtime`} className="k8s-trace-item">
                    <div className="k8s-trace-item__header">
                      <div className="k8s-trace-item__title">{service.name}</div>
                      <span className="portal-pill">Risk {service.riskScore}</span>
                    </div>
                    <p className="k8s-trace-item__meta">
                      {service.namespace} · {matchedWorkloads.length} workload(s) · {matchedPods.length} pod(s) · restarts {restartPressure}
                    </p>
                    <div className="k8s-trace-item__issues">
                      {matchedWorkloads.length === 0 ? (
                        <span className="k8s-trace-item__issue">No matching workload was found in the current namespace.</span>
                      ) : null}
                      {matchedPods.length === 0 ? (
                        <span className="k8s-trace-item__issue">No matching pods are visible for this service path.</span>
                      ) : null}
                      {unhealthyPods.length > 0 ? (
                        <span className="k8s-trace-item__issue">{unhealthyPods.length} pod(s) are not healthy or running.</span>
                      ) : null}
                      {matchedWorkloads.slice(0, 3).map((workload) => (
                        <span key={`${service.name}-${workload.name}`} className="k8s-trace-item__issue">
                          Workload {workload.name}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
                {!loading && serviceRuntimeTrace.length === 0 ? (
                  <div className="portal-empty">
                    <p>No service runtime dependency drilldown is available yet.</p>
                  </div>
                ) : null}
              </div>
            </div>

            {activeServiceDrilldown ? (
              <section className="k8s-spotlight-card">
                <div className="k8s-spotlight-card__header">
                  <div>
                    <span className="portal-surface__eyebrow">Service drilldown</span>
                    <h3 className="k8s-spotlight-card__title">{activeServiceDrilldown.service.name}</h3>
                    <p className="k8s-spotlight-card__meta">
                      {activeServiceDrilldown.service.namespace} · {activeServiceDrilldown.service.cluster_name} ·{' '}
                      {activeServiceDrilldown.service.type || 'Service'}
                    </p>
                  </div>
                  <div className="catalog-editor__footer-actions">
                    <Link
                      href={buildK8sHref(
                        `/k8s/services/${encodeURIComponent(activeServiceDrilldown.service.name)}`,
                        {
                          project_id: projectId || undefined,
                          cluster_name: activeServiceDrilldown.service.cluster_name || undefined,
                          namespace: activeServiceDrilldown.service.namespace || undefined,
                          environment: environment || undefined,
                        },
                      )}
                      className="btn btn-secondary"
                    >
                      Open service detail
                    </Link>
                    <span className="portal-pill">Risk {activeServiceDrilldown.service.riskScore}</span>
                  </div>
                </div>

                <div className="k8s-diagnostic-grid">
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Matched workloads</span>
                    <strong className="k8s-diagnostic-card__value">{activeServiceDrilldown.matchedWorkloads.length}</strong>
                    <span className="k8s-diagnostic-card__meta">Workloads that look connected to this service path or selector.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Matched pods</span>
                    <strong className="k8s-diagnostic-card__value">{activeServiceDrilldown.matchedPods.length}</strong>
                    <span className="k8s-diagnostic-card__meta">Pods currently sitting behind the service and matched workloads.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Restart pressure</span>
                    <strong className="k8s-diagnostic-card__value">{activeServiceDrilldown.restartPressure}</strong>
                    <span className="k8s-diagnostic-card__meta">Combined restart count across the current pod set.</span>
                  </div>
                  <div className="k8s-diagnostic-card">
                    <span className="k8s-diagnostic-card__label">Namespace peers</span>
                    <strong className="k8s-diagnostic-card__value">{activeServiceDrilldown.namespacePeers.length}</strong>
                    <span className="k8s-diagnostic-card__meta">
                      {activeServiceDrilldown.namespacePeerExposure} peer services also expose edge traffic here.
                    </span>
                  </div>
                </div>

                <div className="k8s-detail-columns">
                  <div className="k8s-section-stack">
                    <h3 className="k8s-section-stack__title">Dependency path</h3>
                    <div className="k8s-trace-list">
                      <article className="k8s-trace-item">
                        <div className="k8s-trace-item__header">
                          <strong className="k8s-trace-item__title">Service edge and selector posture</strong>
                          <span className="portal-pill">
                            {activeServiceDrilldown.service.ingress_host || activeServiceDrilldown.service.exposure || 'internal'}
                          </span>
                        </div>
                        <p className="k8s-trace-item__meta">
                          {activeServiceDrilldown.service.ports || 'Ports pending'} · Selector{' '}
                          {activeServiceDrilldown.service.selector || 'missing'}
                        </p>
                        <div className="k8s-trace-item__issues">
                          {activeServiceDrilldown.service.issues.map((issue) => (
                            <span key={`${activeServiceDrilldown.serviceKey}-${issue}`} className="k8s-trace-item__issue">
                              {issue}
                            </span>
                          ))}
                          {activeServiceDrilldown.service.issues.length === 0 ? (
                            <span className="k8s-trace-item__issue">No immediate edge or selector issue is visible for this service.</span>
                          ) : null}
                        </div>
                      </article>

                      {activeServiceDrilldown.matchedWorkloads.slice(0, 4).map((workload) => (
                        <article
                          key={`${activeServiceDrilldown.serviceKey}-${workload.name}`}
                          className="k8s-trace-item"
                        >
                          <div className="k8s-trace-item__header">
                            <strong className="k8s-trace-item__title">{workload.name}</strong>
                            <span className="portal-pill">
                              Ready {workload.ready_replicas}/{workload.replicas}
                            </span>
                          </div>
                        <p className="k8s-trace-item__meta">
                          {workload.namespace} · {workload.status} · ready {workload.ready_replicas}/{workload.replicas} · cpu{' '}
                          {workload.cpu_utilization_pct}%
                        </p>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="k8s-section-stack">
                    <h3 className="k8s-section-stack__title">Namespace peer services</h3>
                    <div className="k8s-service-chip-list">
                      {activeServiceDrilldown.namespacePeers.map((item) => (
                        <div key={`${activeServiceDrilldown.service.namespace}-${item.name}`} className="k8s-service-chip">
                          <strong>{item.name}</strong>
                          <span>{item.type || 'Service'}</span>
                          <span>{item.ingress_host || item.exposure || 'internal'}</span>
                        </div>
                      ))}
                      {activeServiceDrilldown.namespacePeers.length === 0 ? (
                        <div className="portal-empty">
                          <p>No other peer services are visible in this namespace for the current filter set.</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            <div className="ig-legacy-table">
              <DataTable<K8sServiceRow>
                label="Cluster services"
                columns={serviceColumns}
                rows={visibleRows}
                rowKey={buildServiceKey}
                loading={loading}
                activeKey={selectedServiceKey || null}
                onRowOpen={(item) => setSelectedServiceKey(buildServiceKey(item))}
                empty={<EmptyState title="No services found" body="No services match the current filters." />}
              />
            </div>
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
