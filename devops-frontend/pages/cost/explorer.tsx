import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import CostAskButton from '../../components/CostAskButton';
import CostDailyChart from '../../components/CostDailyChart';
import CostDrawer from '../../components/CostDrawer';
import CostFirstRun from '../../components/CostFirstRun';
import CostFreshnessStrip from '../../components/CostFreshnessStrip';
import CostNav from '../../components/CostNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  CostExplorer,
  CostExplorerGroup,
  CostLine,
  costHref,
  costQuery,
  downloadCostCSV,
  fetchCostCSV,
  fetchCostJson,
  groupCostExplorerLines,
} from '../../lib/cost';

const GROUPS = [
  { id: 'service', label: 'Service' },
  { id: 'team', label: 'Team' },
  { id: 'account', label: 'Account' },
  { id: 'region', label: 'Region' },
  { id: 'resource', label: 'Resource' },
] as const;

export default function CostExplorerPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const service = typeof router.query.service === 'string' ? router.query.service : '';
  const region = typeof router.query.region === 'string' ? router.query.region : '';
  const account = typeof router.query.account === 'string' ? router.query.account : '';
  const team = typeof router.query.team === 'string' ? router.query.team : '';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const portalService = typeof router.query.portal_service === 'string' ? router.query.portal_service : '';
  const family = typeof router.query.family === 'string' ? router.query.family : '';
  const groupBy = typeof router.query.group === 'string' && GROUPS.some((item) => item.id === router.query.group)
    ? router.query.group
    : 'service';
  const search = typeof router.query.q === 'string' ? router.query.q : '';
  const [data, setData] = useState<CostExplorer | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<CostExplorerGroup | CostLine | null>(null);

  const filters = { service, region, account, team, from, to, portal_service: portalService, family };

  useEffect(() => {
    if (!router.isReady) return;
    setLoading(true);
    fetchCostJson<CostExplorer>(apiUrl, `/api/cost/explorer${costQuery(basis, currency, filters)}`)
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router.isReady, basis, currency, service, region, account, team, from, to, portalService, family]);

  const groups = useMemo(() => {
    const rows = groupCostExplorerLines(data?.lines || [], groupBy, data?.coverage || 'none', data?.currency || currency);
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => `${row.label} ${row.owner}`.toLowerCase().includes(query));
  }, [data, groupBy, search, currency]);

  const patch = (next: Record<string, string | undefined>) => {
    const query = { ...router.query };
    Object.entries(next).forEach(([key, value]) => {
      if (value) query[key] = value;
      else delete query[key];
    });
    void router.replace({ pathname: '/cost/explorer', query }, undefined, { shallow: true });
  };

  const exportCSV = async () => {
    setExporting(true);
    setError('');
    try {
      const text = await fetchCostCSV(apiUrl, `/api/cost/export${costQuery(basis, currency, filters)}`);
      downloadCostCSV(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cost export could not be loaded.');
    } finally {
      setExporting(false);
    }
  };

  const crumbs = [
    { href: costHref('/cost', router.query), label: 'Overview' },
    service ? { label: service } : null,
    team ? { label: team === 'unallocated' ? 'Unallocated' : team } : null,
    account ? { label: 'Account' } : null,
  ].filter(Boolean) as { href?: string; label: string }[];

  const openGroup = open && 'lines' in open ? open : null;
  const openLine = open && 'resource_id' in open && !('lines' in open) ? open : null;

  return (
    <DevOpsLayout>
      <Head><title>Cost explorer</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">Cost explorer</h1>
            <p className="cost-shell__hint">Investigate spend by service, team, account, region, or resource. Previous comparable cost stays Unknown until two complete windows exist.</p>
          </div>
        </div>
        <CostNav current="explorer" crumbs={crumbs} exporting={exporting} onExport={() => void exportCSV()} />
        <CostFreshnessStrip detail={data?.freshness_detail} coverage={data?.coverage} />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state">Loading billed lines…</div> : null}
        {!loading && data?.empty ? (
          <CostFirstRun
            canOperate
            title="No billed lines for this slice"
            primaryLabel="Ingest billed data"
          />
        ) : null}
        {!loading && data && !data.empty ? (
          <>
            <section className="cost-dash">
              <div className="cost-dash__graph">
                <div className="cost-dash__head">
                  <h2 className="portal-surface__title">Spend in this slice</h2>
                  <span className="cost-toolbar__dates">{data.total.display}</span>
                </div>
                <CostDailyChart
                  days={groups.slice(0, 14).map((row) => ({
                    label: row.label,
                    display: row.display,
                    percent: data.coverage === 'complete' && Number(groups[0]?.amount)
                      ? Math.max(3, Math.round((Number(row.amount) / Number(groups[0].amount)) * 100))
                      : 0,
                  }))}
                  emptyNote="Chart stays empty until a complete billed window exists."
                />
              </div>
            </section>
            <div className="cost-explorer-tools">
              <label className="cost-toolbar__field">
                <span>Group by</span>
                <select className="input" value={groupBy} onChange={(event) => patch({ group: event.target.value })}>
                  {GROUPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="cost-toolbar__field cost-toolbar__field--grow">
                <span>Search</span>
                <input className="input" value={search} placeholder="Service, team, or resource" onChange={(event) => patch({ q: event.target.value || undefined })} />
              </label>
              <div className="cost-saved">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => patch({ team: 'unallocated', group: 'team' })}>Unallocated spend</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => patch({ group: 'service' })}>Largest services</button>
              </div>
            </div>
            <section className="portal-surface portal-surface--table">
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>{GROUPS.find((item) => item.id === groupBy)?.label}</th>
                    <th>Owner</th>
                    <th>Cost</th>
                    <th>Previous comparable</th>
                    <th>Change</th>
                    <th>Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(row)}>
                          {row.label}
                        </button>
                      </td>
                      <td>{row.owner}</td>
                      <td>{row.display}</td>
                      <td>Unknown</td>
                      <td>Unknown</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="portal-surface__subtitle">{data.note}</p>
            </section>
          </>
        ) : null}
        <CostDrawer
          open={Boolean(open)}
          onClose={() => setOpen(null)}
          resetKey={openGroup?.key || openLine?.resource_id}
          eyebrow="Explorer"
          title={openGroup?.label || openLine?.service || 'Resource'}
          subtitle={openGroup ? `${openGroup.count} billed lines` : openLine?.resource_id}
          footer={
            <CostAskButton
              question="Explain this increase"
              context={`Period ${from || 'this month'} to ${to || 'today'}. Basis ${basis}. Group ${groupBy}. Coverage ${data?.coverage || 'Unknown'}. Amount ${openGroup?.display || 'Unknown'}. Source labelled CUR 2.0.`}
            >
              Explain this increase
            </CostAskButton>
          }
        >
          {openGroup ? (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Region</th>
                  <th>Team</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {openGroup.lines.slice(0, 40).map((line, index) => (
                  <tr key={`${line.resource_id}-${index}`}>
                    <td>{line.service}</td>
                    <td>{line.region || 'Unknown'}</td>
                    <td>{line.team_slug || 'Unallocated'}</td>
                    <td>{data?.coverage === 'complete' ? `${line.currency} ${line.amount}` : 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </CostDrawer>
      </div>
    </DevOpsLayout>
  );
}
