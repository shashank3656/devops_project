import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostDrawer from '../../components/CostDrawer';
import CostFirstRun from '../../components/CostFirstRun';
import CostKpiStrip from '../../components/CostKpiStrip';
import CostNav from '../../components/CostNav';
import CostPageTabs from '../../components/CostPageTabs';
import CostTechnicalDetails from '../../components/CostTechnicalDetails';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  CostK8sBinding,
  CostK8sCatalog,
  CostK8sCollectionHealth,
  CostK8sOptimization,
  CostK8sRecommendation,
  CostK8sReconciliation,
  CostK8sWorkload,
  CostK8sWorkloads,
  costQuery,
  fetchCostJson,
  formatCostWindowRange,
  readinessLabel,
  resolvedCostWindow,
  sampleCostK8sSnapshot,
} from '../../lib/cost';

const TABS = [
  { id: 'overview', label: 'Cluster' },
  { id: 'allocation', label: 'Namespaces' },
  { id: 'workloads', label: 'Workloads' },
  { id: 'optimization', label: 'Opportunities' },
  { id: 'collection', label: 'Data health' },
] as const;

type CostK8sTab = (typeof TABS)[number]['id'];

function collectorLabel(value: string | undefined) {
  return (value || '').toLowerCase() === 'current' ? 'Current' : 'Unknown';
}

function constraintLabel(value: string | undefined) {
  return value && value.trim() ? value : 'Unknown';
}

function metricLabel(value?: { display?: string } | null) {
  return value?.display || 'Needs more data';
}

export default function CostKubernetesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const focusCluster = typeof router.query.cluster_name === 'string' ? router.query.cluster_name : '';
  const queryId = typeof router.query.id === 'string' ? router.query.id : '';
  const group = typeof router.query.group === 'string' && ['namespace', 'controller', 'team'].includes(router.query.group)
    ? router.query.group
    : 'namespace';
  const distributeIdle = router.query.distribute_idle === '1';
  const tabParam = typeof router.query.tab === 'string'
    ? (router.query.tab === 'reconciliation' ? 'overview' : router.query.tab)
    : 'overview';
  const tab: CostK8sTab = TABS.some((item) => item.id === tabParam) ? (tabParam as CostK8sTab) : 'overview';
  const [data, setData] = useState<CostK8sCatalog | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [costConnectionId, setCostConnectionId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [openYaml, setOpenYaml] = useState(0);
  const [workloads, setWorkloads] = useState<CostK8sWorkloads | null>(null);
  const [reconciliation, setReconciliation] = useState<CostK8sReconciliation | null>(null);
  const [optimization, setOptimization] = useState<CostK8sOptimization | null>(null);
  const [health, setHealth] = useState<CostK8sCollectionHealth | null>(null);
  const [openRec, setOpenRec] = useState<CostK8sRecommendation | null>(null);
  const [openWorkload, setOpenWorkload] = useState<CostK8sWorkload | null>(null);
  const [snapshotJSON, setSnapshotJSON] = useState(sampleCostK8sSnapshot());

  const setQuery = (patch: Record<string, string>) => {
    void router.replace({ pathname: '/cost/kubernetes', query: { ...router.query, ...patch } }, undefined, { shallow: true });
  };

  const load = () => {
    setLoading(true);
    fetchCostJson<CostK8sCatalog>(apiUrl, '/api/cost/kubernetes/clusters')
      .then((payload) => {
        setData(payload);
        setError('');
        setConnectionId((current) => current || (payload.eligible?.[0] ? String(payload.eligible[0].id) : ''));
        setCostConnectionId((current) => current || (payload.cost_connections?.[0] ? String(payload.cost_connections[0].id) : ''));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiUrl]);

  useEffect(() => {
    if (!router.isReady || !data?.clusters?.length || queryId) return;
    const match = data.clusters.find((row) => row.cluster_name === focusCluster) || data.clusters[0];
    if (match) setQuery({ id: String(match.id) });
  }, [router.isReady, data, queryId, focusCluster]);

  useEffect(() => {
    if (!queryId) {
      setWorkloads(null);
      setReconciliation(null);
      setOptimization(null);
      setHealth(null);
      return;
    }
    const idle = distributeIdle ? '1' : '0';
    fetchCostJson<CostK8sWorkloads>(apiUrl, `/api/cost/kubernetes/clusters/${queryId}/workloads${costQuery('', '', { group })}`)
      .then((payload) => setWorkloads(payload))
      .catch(() => setWorkloads(null));
    fetchCostJson<CostK8sReconciliation>(apiUrl, `/api/cost/kubernetes/clusters/${queryId}/reconciliation?distribute_idle=${idle}`)
      .then((payload) => setReconciliation(payload))
      .catch(() => setReconciliation(null));
    fetchCostJson<CostK8sOptimization>(apiUrl, `/api/cost/kubernetes/clusters/${queryId}/optimization`)
      .then((payload) => setOptimization(payload))
      .catch(() => setOptimization(null));
    fetchCostJson<CostK8sCollectionHealth>(apiUrl, `/api/cost/kubernetes/clusters/${queryId}/collection-health`)
      .then((payload) => setHealth(payload))
      .catch(() => setHealth(null));
  }, [apiUrl, queryId, loading, distributeIdle, group]);

  const selected = (data?.clusters || []).find((row) => String(row.id) === queryId) || null;
  const canOperate = data?.can_operate !== false;

  const bind = async () => {
    setActing('bind');
    setNotice('');
    setToken('');
    try {
      await fetchCostJson(apiUrl, '/api/cost/kubernetes/clusters', {
        method: 'POST',
        body: JSON.stringify({
          k8s_connection_id: Number(connectionId),
          cost_connection_id: costConnectionId ? Number(costConnectionId) : 0,
        }),
      });
      setNotice('Cluster bound for Cost. Inventory, metrics, allocation, and billing reconciled stay Unknown until each source exists. This product does not install OpenCost.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cluster could not be bound.');
    } finally {
      setActing('');
    }
  };

  const act = async (row: CostK8sBinding, action: 'validate' | 'fixture' | 'sync') => {
    setActing(`${row.id}-${action}`);
    setNotice('');
    setToken('');
    try {
      const payload = await fetchCostJson<{ note?: string; token?: string }>(
        apiUrl,
        `/api/cost/kubernetes/clusters/${row.id}/${action}`,
        { method: 'POST', body: '{}' },
      );
      if (payload.token) setToken(payload.token);
      setNotice(payload.note || 'Saved.');
      if (!queryId) setQuery({ id: String(row.id) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cluster action failed.');
    } finally {
      setActing('');
    }
  };

  const importSnapshot = async () => {
    setActing('snapshot');
    setNotice('');
    try {
      const parsed = JSON.parse(snapshotJSON) as Record<string, unknown>;
      const payload = await fetchCostJson<{ note?: string }>(apiUrl, `/api/cost/kubernetes/clusters/${queryId}/snapshots`, {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      setNotice(payload.note || 'Snapshot stored. Deleted pods keep their UID. Missing metrics stay Needs more data.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Snapshot could not be stored.');
    } finally {
      setActing('');
    }
  };

  const selectedFrom = typeof router.query.from === 'string' ? router.query.from : '';
  const selectedTo = typeof router.query.to === 'string' ? router.query.to : '';
  const selectedWindow = resolvedCostWindow(selectedFrom, selectedTo);
  const selectedPeriod = formatCostWindowRange(selectedWindow.from, selectedWindow.to) || 'This month';
  const clusterWindow = workloads?.snapshot
    ? (formatCostWindowRange(workloads.snapshot.window_start, workloads.snapshot.window_end) || `${workloads.snapshot.window_start} → ${workloads.snapshot.window_end}`)
    : 'No cluster data for this period';
  const billingBasis = (reconciliation?.basis || 'actual') === 'amortized' ? 'Amortized' : 'Actual';

  return (
    <DevOpsLayout>
      <Head><title>Kubernetes cost</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">Kubernetes cost</h1>
            <p className="cost-shell__hint">Cluster → namespace → workload. Mapped cluster cost is a breakdown of the cloud bill, never an extra line.</p>
          </div>
          <div className="portal-page__actions">
            {selected ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(selected, 'sync')} disabled={acting === `${selected.id}-sync` || !canOperate}>
                Refresh data
              </button>
            ) : null}
            <Link href="/k8s" className="btn btn-secondary btn-sm">Kubernetes workspace</Link>
          </div>
        </div>
        <CostNav current="kubernetes" />
        <section className="cost-first-run" aria-label="Kubernetes Cost pilot">
          <h2>One nonproduction cluster</h2>
          <ol className="cost-first-run__steps">
            <li>
              <strong>Bind a nonprod cluster</strong>
              <span>The pilot is one read-only nonproduction cluster. Production stays out. Cost does not install OpenCost.</span>
            </li>
            <li>
              <strong>Collector current</strong>
              <span>Private collector or labelled snapshot. Collector failure stays Unknown, never Healthy.</span>
            </li>
            <li>
              <strong>Billing reconciled</strong>
              <span>Mapped cluster cost is a breakdown of the cloud bill. It is never added as an extra line.</span>
            </li>
          </ol>
        </section>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
        {token ? (
          <div className="alert alert-success" role="status">
            Collector token shown once: <code>{token}</code>. The API stores only a hash.
          </div>
        ) : null}
        <dl className="cost-k8s-meta">
          <div>
            <dt>Selected period</dt>
            <dd>{selectedPeriod}</dd>
          </div>
          <div>
            <dt>Cluster data</dt>
            <dd>{clusterWindow}</dd>
          </div>
          <div>
            <dt>Billing basis</dt>
            <dd>{billingBasis} invoice</dd>
          </div>
          <div>
            <dt>Estimate source</dt>
            <dd>List price, labelled Estimated — not the invoice</dd>
          </div>
        </dl>
        {(data?.clusters || []).length ? (
          <div className="portal-pill-row">
            <label>
              Cluster
              <select className="input" value={queryId} onChange={(event) => setQuery({ id: event.target.value })}>
                {(data?.clusters || []).map((row) => (
                  <option key={row.id} value={row.id}>{row.cluster_name} · {row.environment}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <CostPageTabs tabs={[...TABS]} current={tab} onSelect={(id) => setQuery({ tab: id })} />
        {loading ? <div className="empty-state">Loading cluster bindings…</div> : null}
        {!loading && tab === 'overview' && !(data?.clusters || []).length ? (
          <CostFirstRun
            canOperate={canOperate}
            title="Connect a cluster to see Kubernetes cost"
            primaryHref="/k8s"
            primaryLabel="Open Kubernetes workspace"
          />
        ) : null}
        {!loading && tab === 'overview' ? (
          <>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Connect cluster</span>
                  <h2 className="portal-surface__title">Bind an existing Kubernetes connection</h2>
                  <p className="portal-surface__subtitle">
                    The Kubernetes Cost pilot is one nonproduction cluster, read-only. Cost does not create a new cluster connection, does not apply RBAC, and cannot edit workloads.
                  </p>
                </div>
              </div>
              {(data?.eligible || []).length && canOperate ? (
                <div className="portal-pill-row">
                  <label>
                    Cluster
                    <select className="input" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
                      {data?.eligible.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.cluster_name} · {row.environment} · {row.project_code || row.project_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cloud Cost connection
                    <select className="input" value={costConnectionId} onChange={(event) => setCostConnectionId(event.target.value)}>
                      <option value="">None yet</option>
                      {(data?.cost_connections || []).map((row) => (
                        <option key={row.id} value={row.id}>{row.display_name || row.account_id}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn btn-primary" onClick={bind} disabled={!connectionId || acting === 'bind'}>
                    Connect cluster
                  </button>
                </div>
              ) : (
                <p className="sre-meta__empty">
                  {!canOperate
                    ? 'You can view cluster spend. Cost operate is required to bind a cluster or upload a snapshot.'
                    : (data?.clusters || []).length
                      ? 'The Kubernetes Cost pilot is limited to one nonproduction cluster. Production stays out.'
                      : 'No nonproduction Kubernetes connection is visible. Onboard a nonprod cluster in the Kubernetes workspace first.'}
                </p>
              )}
            </section>
            <section className="portal-surface portal-surface--table">
              <h2 className="portal-surface__title">Bound clusters</h2>
              {!(data?.clusters || []).length ? (
                <p className="sre-meta__empty">No cluster is bound for Cost yet.</p>
              ) : (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Cluster</th>
                      <th>Billed cost</th>
                      <th>Idle cost</th>
                      <th>Collection</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.clusters || []).map((row) => {
                      const active = String(row.id) === queryId;
                      return (
                        <tr key={row.id} className={active || (focusCluster && row.cluster_name === focusCluster) ? 'is-selected' : undefined}>
                          <td>
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setQuery({ id: String(row.id), tab: 'overview' })}>
                              {row.cluster_name}
                            </button>
                            <div className="portal-surface__subtitle">{row.project_code || row.project_name} · {row.environment} · {row.cloud || 'Unknown cloud'}</div>
                          </td>
                          <td>{active ? (reconciliation?.billed_mapped?.display || 'Unknown') : 'Unknown'}</td>
                          <td>{active ? metricLabel(reconciliation?.estimated_idle) : 'Needs more data'}</td>
                          <td>
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setQuery({ id: String(row.id), tab: 'collection' })}>
                              Collection health
                            </button>
                          </td>
                          <td>
                            <div className="portal-page__actions">
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(row, 'validate')} disabled={acting === `${row.id}-validate`}>Validate</button>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(row, 'fixture')} disabled={acting === `${row.id}-fixture` || !canOperate}>Least-privilege sample</button>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(row, 'sync')} disabled={acting === `${row.id}-sync` || !canOperate}>Refresh data</button>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenYaml(openYaml === row.id ? 0 : row.id)}>RBAC</button>
                            </div>
                            {(row.capability_gaps || []).length ? (
                              <ul className="portal-surface__subtitle">
                                {(row.capability_gaps || []).map((gap) => <li key={gap}>{gap}</li>)}
                              </ul>
                            ) : null}
                            {openYaml === row.id ? <pre className="code-block">{row.rbac_yaml || data?.rbac_yaml}</pre> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
            {selected ? (
            <section className="portal-surface">
              <h2 className="portal-surface__title">Scorecards</h2>
              <p className="portal-surface__subtitle">Billed mapped cost is a breakdown of the cloud invoice. Idle and savings estimates use list price and are not added to the cloud total.</p>
              <CostKpiStrip
                items={[
                  {
                    label: 'Billed cost',
                    value: reconciliation?.billed_mapped?.display || 'Unknown',
                    hint: 'Mapped from the cloud bill',
                    tone: reconciliation?.billed_mapped?.display && reconciliation.billed_mapped.display !== 'Unknown' ? 'billed' : 'unknown',
                  },
                  {
                    label: 'Idle cost',
                    value: metricLabel(reconciliation?.estimated_idle),
                    hint: 'List-price estimate',
                    tone: 'k8s',
                  },
                  {
                    label: 'Allocation coverage',
                    value: workloads?.coverage === 'complete' ? 'Complete' : workloads?.coverage === 'incomplete' ? 'Incomplete' : 'Unknown',
                    hint: 'Missing stays Unknown',
                    tone: workloads?.coverage === 'complete' ? 'billed' : 'unknown',
                  },
                  {
                    label: 'Potential savings',
                    value: optimization?.bill_reduction?.display || 'Unknown',
                    hint: 'Does not execute',
                    tone: optimization?.bill_reduction?.display && optimization.bill_reduction.display !== 'Unknown' ? 'wait' : 'unknown',
                  },
                ]}
              />
            </section>
            ) : null}
          </>
        ) : null}
        {!loading && tab === 'allocation' ? (
          <section className="portal-surface portal-surface--table">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Allocation</h2>
                <p className="portal-surface__subtitle">{workloads?.note || 'Estimated/list price is not the invoice. Distribute idle is a reporting policy and does not mutate history.'}</p>
              </div>
              <div className="portal-page__actions">
                <label>
                  Group
                  <select className="input" value={group} onChange={(event) => setQuery({ group: event.target.value })}>
                    <option value="namespace">Namespace</option>
                    <option value="controller">Controller</option>
                    <option value="team">Team</option>
                  </select>
                </label>
                <label className="portal-pill">
                  <input type="checkbox" checked={distributeIdle} onChange={(event) => setQuery({ distribute_idle: event.target.checked ? '1' : '0' })} />
                  {' '}Distribute idle
                </label>
              </div>
            </div>
            <div className="portal-pill-row">
              <span className="portal-pill">USD · {reconciliation?.basis || 'actual'} · {clusterWindow}</span>
              <span className="portal-pill">Workload {metricLabel(reconciliation?.estimated_workload)}</span>
              <span className="portal-pill">Idle {metricLabel(reconciliation?.estimated_idle)}</span>
              <span className="portal-pill">Shared {metricLabel(reconciliation?.estimated_shared)}</span>
              <span className="portal-pill">Unallocated {metricLabel(reconciliation?.estimated_unallocated)}</span>
              <span className="portal-pill">Estimated total {metricLabel(reconciliation?.estimated_total)}</span>
            </div>
            {!(workloads?.allocations || []).length ? (
              <p className="sre-meta__empty">No snapshot identities yet.</p>
            ) : (
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Owner</th>
                    <th>HPA</th>
                    <th>VPA</th>
                    <th>PDB</th>
                    <th>Managed by</th>
                    <th>Estimated allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {(workloads?.allocations || []).map((row) => (
                    <tr key={row.group_key}>
                      <td>
                        {row.controller_name || row.namespace || row.group_key}
                        <div className="portal-surface__subtitle">{row.group_by} · {row.namespace} · {row.workload_count} workloads</div>
                      </td>
                      <td>{constraintLabel(row.owner)}</td>
                      <td>{constraintLabel(row.hpa)}</td>
                      <td>{constraintLabel(row.vpa)}</td>
                      <td>{constraintLabel(row.pdb)}</td>
                      <td>{constraintLabel(row.managed_by)}</td>
                      <td>{metricLabel(row.allocation_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(workloads?.missing_ownership || []).length ? (
              <>
                <h3 className="portal-surface__title">Missing ownership</h3>
                <ul className="portal-surface__subtitle">
                  {(workloads?.missing_ownership || []).map((row) => (
                    <li key={row.workload_key}>{row.controller_name || row.workload_key} · {row.namespace} · owner Unknown</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
        {!loading && tab === 'workloads' ? (
          <section className="portal-surface portal-surface--table">
            <h2 className="portal-surface__title">Workloads</h2>
            <p className="portal-surface__subtitle">{workloads?.note || 'HPA, VPA, PDB, and managed-by stay visible. Missing history is Needs more data, not zero usage.'}</p>
            {!(workloads?.workloads || []).length ? (
              <p className="sre-meta__empty">No snapshot identities yet.</p>
            ) : (
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Workload</th>
                    <th>Owner</th>
                    <th>Pods</th>
                    <th>CPU request / usage</th>
                    <th>Memory request / usage</th>
                    <th>Estimated allocation</th>
                    <th>HPA</th>
                    <th>VPA</th>
                    <th>PDB</th>
                    <th>Managed by</th>
                  </tr>
                </thead>
                <tbody>
                  {(workloads?.workloads || []).map((row) => (
                    <tr key={row.workload_key}>
                      <td>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpenWorkload(row)}>
                          {row.controller_name || row.workload_key}
                        </button>
                        <div className="portal-surface__subtitle">{row.namespace} · {row.controller_kind}</div>
                      </td>
                      <td>{constraintLabel(row.owner)}</td>
                      <td>{row.pod_count}{row.deleted_count ? ` · ${row.deleted_count} deleted` : ''}</td>
                      <td>{row.cpu_request || 'Unknown'} / {metricLabel(row.cpu_usage)}</td>
                      <td>{row.memory_request || 'Unknown'} / {metricLabel(row.memory_usage)}</td>
                      <td>{metricLabel(row.allocation_total)}</td>
                      <td>{constraintLabel(row.hpa)}</td>
                      <td>{constraintLabel(row.vpa)}</td>
                      <td>{constraintLabel(row.pdb)}</td>
                      <td>{constraintLabel(row.managed_by)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(workloads?.pods || []).length ? (
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Pod UID</th>
                    <th>Name</th>
                    <th>Deleted</th>
                    <th>HPA</th>
                    <th>VPA</th>
                    <th>PDB</th>
                    <th>Managed by</th>
                    <th>Estimated allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {(workloads?.pods || []).map((row) => (
                    <tr key={row.pod_uid}>
                      <td>{row.pod_uid}</td>
                      <td>{row.pod_name}</td>
                      <td>{row.deleted ? 'Yes' : 'No'}</td>
                      <td>{constraintLabel(row.hpa)}</td>
                      <td>{constraintLabel(row.vpa)}</td>
                      <td>{constraintLabel(row.pdb)}</td>
                      <td>{constraintLabel(row.managed_by)}</td>
                      <td>{metricLabel(row.allocation_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        ) : null}
        {!loading && tab === 'optimization' ? (
          <section className="portal-surface portal-surface--table">
            <h2 className="portal-surface__title">Optimization</h2>
            <p className="portal-surface__subtitle">{optimization?.note || 'Allocated reduction, potential bill savings, and capacity released stay separate. Request-only change reports capacity, not cash. Copilot cannot invent SKUs.'}</p>
            <div className="portal-pill-row">
              <span className="portal-pill">Allocated reduction {metricLabel(optimization?.allocated_reduction)}</span>
              <span className="portal-pill">Potential bill savings {optimization?.bill_reduction?.display || 'Unknown'}</span>
              <span className="portal-pill">Capacity released {optimization?.capacity_released?.display || 'Unknown'}</span>
              <span className="portal-pill">Invent SKU No</span>
            </div>
            {!(optimization?.recommendations || []).length ? (
              <p className="sre-meta__empty">No workload recommendations yet. Upload a snapshot first.</p>
            ) : (
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Workload</th>
                    <th>Status</th>
                    <th>Kind</th>
                    <th>HPA</th>
                    <th>VPA</th>
                    <th>PDB</th>
                    <th>Managed by</th>
                    <th>Allocated reduction</th>
                    <th>Bill savings</th>
                    <th>Capacity released</th>
                  </tr>
                </thead>
                <tbody>
                  {(optimization?.recommendations || []).map((row) => (
                    <tr key={row.calc_id} className={openRec?.calc_id === row.calc_id ? 'is-selected' : undefined}>
                      <td>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpenRec(row)}>
                          {row.controller_name || row.workload_key}
                        </button>
                        <div className="portal-surface__subtitle">{row.namespace}</div>
                      </td>
                      <td>{row.status}</td>
                      <td>{row.change_kind || row.finding_type}</td>
                      <td>{constraintLabel(row.hpa)}</td>
                      <td>{constraintLabel(row.vpa)}</td>
                      <td>{constraintLabel(row.pdb)}</td>
                      <td>{constraintLabel(row.managed_by)}</td>
                      <td>{metricLabel(row.allocation_reduction)}</td>
                      <td>{row.bill_reduction?.display || 'Unknown'}</td>
                      <td>{row.capacity_released?.display || 'Unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ) : null}
        {!loading && tab === 'overview' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Reconciliation</span>
                <h2 className="portal-surface__title">Mapped cluster cost is a breakdown</h2>
                <p className="portal-surface__subtitle">{reconciliation?.note || 'Node provider IDs map to billed resources. Unmapped billed lines stay on the parent ledger. Estimated/list price is not the invoice.'}</p>
              </div>
              <label className="portal-pill">
                <input type="checkbox" checked={distributeIdle} onChange={(event) => setQuery({ distribute_idle: event.target.checked ? '1' : '0' })} />
                {' '}Distribute idle
              </label>
            </div>
            <div className="portal-pill-row">
              <span className="portal-pill">USD · {reconciliation?.basis || 'actual'} · {clusterWindow}</span>
              <span className="portal-pill">Billed mapped {reconciliation?.billed_mapped?.display || 'Unknown'}</span>
              <span className="portal-pill">Billed unmapped {reconciliation?.billed_unmapped?.display || 'Unknown'}</span>
              <span className="portal-pill">Estimated total {metricLabel(reconciliation?.estimated_total)}</span>
              <span className="portal-pill">Workload {metricLabel(reconciliation?.estimated_workload)}</span>
              <span className="portal-pill">Idle {metricLabel(reconciliation?.estimated_idle)}</span>
              <span className="portal-pill">Shared {metricLabel(reconciliation?.estimated_shared)}</span>
              <span className="portal-pill">Residual {reconciliation?.residual?.display || 'Unknown'}</span>
              <span className="portal-pill">Billing reconciled {readinessLabel(reconciliation?.billing_reconciled)}</span>
              <span className="portal-pill">Added to cloud total No</span>
            </div>
            {(reconciliation?.unsupported_gaps || []).length ? (
              <ul className="portal-surface__subtitle">
                {reconciliation?.unsupported_gaps?.map((gap) => <li key={gap}>{gap}</li>)}
              </ul>
            ) : null}
          </section>
        ) : null}
        {!loading && tab === 'collection' ? (
          <>
            <section className="portal-surface">
              <h2 className="portal-surface__title">Collection health</h2>
              <p className="portal-surface__subtitle">{health?.note || 'Collector failure is Unknown, never Healthy.'}</p>
              <div className="portal-pill-row">
                <span className="portal-pill">Collector {collectorLabel(health?.collector_health || selected?.collector_health)}</span>
                <span className="portal-pill">Inventory {readinessLabel(health?.inventory_readiness || selected?.inventory_readiness)}</span>
                <span className="portal-pill">Metrics {readinessLabel(health?.metrics_readiness || selected?.metrics_readiness)}</span>
                <span className="portal-pill">Allocation {readinessLabel(health?.allocation_readiness || selected?.allocation_readiness)}</span>
                <span className="portal-pill">Billing reconciled {readinessLabel(health?.billing_reconciled || selected?.billing_reconciled)}</span>
                <span className="portal-pill">Last ingest {health?.last_ingested_at || 'Unknown'}</span>
                <span className="portal-pill">Public scrape No</span>
                <span className="portal-pill">Worker can edit No</span>
                <span className="portal-pill">Installs OpenCost No</span>
                <span className="portal-pill">Added to cloud total No</span>
                <span className="portal-pill">Pilot one nonprod cluster</span>
              </div>
              {(health?.capability_gaps || selected?.capability_gaps || []).length ? (
                <ul className="portal-surface__subtitle">
                  {(health?.capability_gaps || selected?.capability_gaps || []).map((gap) => <li key={gap}>{gap}</li>)}
                </ul>
              ) : null}
            </section>
            <section className="portal-surface">
              <h2 className="portal-surface__title">Nonprod pilot checks</h2>
              <p className="portal-surface__subtitle">{health?.pilot?.note || data?.pilot?.note || 'One nonproduction cluster, read-only. Collector failure is Unknown, never Healthy. The worker cannot edit workloads.'}</p>
              <div className="portal-pill-row">
                <span className="portal-pill">Scope {health?.pilot?.scope || data?.pilot?.scope || 'nonproduction'}</span>
                <span className="portal-pill">Max clusters {health?.pilot?.max_clusters ?? data?.pilot?.max_clusters ?? 1}</span>
                <span className="portal-pill">Read-only Yes</span>
                <span className="portal-pill">Overhead {health?.pilot?.overhead?.display || 'Unknown'}</span>
                <span className="portal-pill">Collector after restart {collectorLabel(health?.pilot?.restart?.collector_health)}</span>
                <span className="portal-pill">Workloads restarted No</span>
                <span className="portal-pill">Access {health?.pilot?.access?.page_grant || 'cost'}</span>
                <span className="portal-pill">Worker can edit No</span>
                <span className="portal-pill">Installs OpenCost No</span>
              </div>
              <p className="portal-surface__subtitle">{health?.pilot?.overhead?.note}</p>
              <p className="portal-surface__subtitle">{health?.pilot?.restart?.note}</p>
              <p className="portal-surface__subtitle">{health?.pilot?.access?.note}</p>
            </section>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">OpenCost snapshot</span>
                  <h2 className="portal-surface__title">Private collector or labelled upload</h2>
                  <p className="portal-surface__subtitle">
                    Replay keeps one identity set. An older snapshot cannot overwrite a newer one. Include HPA, VPA, PDB, and managed-by when the inventory has them; missing stays Unknown.
                  </p>
                </div>
              </div>
              {queryId ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={importSnapshot} disabled={acting === 'snapshot' || !canOperate}>
                    Upload snapshot
                  </button>
                  <textarea className="input" rows={12} value={snapshotJSON} onChange={(event) => setSnapshotJSON(event.target.value)} />
                </>
              ) : <p className="sre-meta__empty">Bind a cluster before uploading a snapshot.</p>}
            </section>
          </>
        ) : null}
        <CostDrawer
          open={Boolean(openWorkload)}
          onClose={() => setOpenWorkload(null)}
          resetKey={openWorkload?.workload_key}
          eyebrow={openWorkload?.namespace}
          title={openWorkload?.controller_name || openWorkload?.workload_key || 'Workload'}
          subtitle={`${openWorkload?.controller_kind || 'Workload'} · ${openWorkload?.pod_count || 0} pods`}
        >
          {openWorkload ? (
            <dl className="sre-meta">
              <div className="sre-meta__item"><dt>CPU request / usage</dt><dd>{openWorkload.cpu_request || 'Unknown'} / {metricLabel(openWorkload.cpu_usage)}</dd></div>
              <div className="sre-meta__item"><dt>Memory request / usage</dt><dd>{openWorkload.memory_request || 'Unknown'} / {metricLabel(openWorkload.memory_usage)}</dd></div>
              <div className="sre-meta__item"><dt>Allocation</dt><dd>{metricLabel(openWorkload.allocation_total)}</dd></div>
              <div className="sre-meta__item"><dt>Owner</dt><dd>{constraintLabel(openWorkload.owner)}</dd></div>
              <div className="sre-meta__item"><dt>Constraints</dt><dd>HPA {constraintLabel(openWorkload.hpa)} · VPA {constraintLabel(openWorkload.vpa)} · PDB {constraintLabel(openWorkload.pdb)}</dd></div>
            </dl>
          ) : null}
          {(workloads?.pods || []).filter((pod) => !openWorkload || pod.controller_name === openWorkload.controller_name).slice(0, 20).map((pod) => (
            <p key={pod.pod_uid} className="portal-surface__subtitle">{pod.pod_name} · {pod.deleted ? 'deleted' : 'running'} · {metricLabel(pod.allocation_total)}</p>
          ))}
        </CostDrawer>
        <CostDrawer
          open={Boolean(openRec)}
          onClose={() => setOpenRec(null)}
          resetKey={openRec?.calc_id}
          eyebrow="Opportunity"
          title={openRec?.controller_name || openRec?.workload_key || 'Workload'}
          subtitle={openRec?.finding_type}
        >
          {openRec ? (
            <>
              <p className="portal-surface__subtitle">{openRec.evidence}</p>
              <p className="portal-surface__subtitle">{openRec.proposed_action}</p>
              <p className="portal-surface__subtitle">Bill reduction {openRec.bill_reduction?.display || 'Unknown'} can reduce the cloud bill. Capacity released {openRec.capacity_released?.display || 'Unknown'} is not cash.</p>
              <p className="portal-surface__subtitle">This worker cannot create or apply a change.</p>
              <CostTechnicalDetails>
                <p>{openRec.calculation || openRec.calc_id}</p>
              </CostTechnicalDetails>
            </>
          ) : null}
        </CostDrawer>
      </div>
    </DevOpsLayout>
  );
}
