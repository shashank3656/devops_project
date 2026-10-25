import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostNav from '../../components/CostNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { CostExplorer, costQuery, downloadCostCSV, fetchCostCSV, fetchCostJson } from '../../lib/cost';

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
  const [data, setData] = useState<CostExplorer | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const filters = { service, region, account, team, from, to, portal_service: portalService };

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
  }, [apiUrl, router.isReady, basis, currency, service, region, account, team, from, to, portalService]);

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

  return (
    <DevOpsLayout>
      <Head><title>Cost explorer</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">Cost explorer</h1>
            <p className="cost-shell__hint">Same window and basis as Analysis. Actual and amortized stay on separate columns. Press Enter to apply a text filter.</p>
          </div>
        </div>
        <CostNav current="explorer" exporting={exporting} onExport={() => void exportCSV()} />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state">Loading billed lines…</div> : null}
        {!loading && data?.empty ? (
          <div className="empty-state">No billed lines for this slice. Import a fixture on Configuration, or widen the filters. Coverage stays Unknown until a complete revision exists.</div>
        ) : null}
        {!loading && data && !data.empty ? (
          <section className="portal-surface portal-surface--table">
            <div className="portal-pill-row">
              <span className="portal-pill">Total {data.total.display}</span>
              <span className="portal-pill">Unallocated {data.unallocated.display}</span>
              <span className="portal-pill">Ownership {data.ownership?.display || 'Unknown'}</span>
              <span className="portal-pill">Coverage {data.coverage}</span>
              <span className="portal-pill">Currency {data.currency}</span>
              {data.window_start ? <span className="portal-pill">{data.window_start} to {data.window_end}</span> : null}
              {portalService ? <span className="portal-pill">Portal service {portalService}</span> : null}
            </div>
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Account</th>
                  <th>Region</th>
                  <th>Resource</th>
                  <th>Team</th>
                  <th>Amount ({basis})</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line, index) => (
                  <tr key={`${line.resource_id}-${index}`}>
                    <td>{line.service}</td>
                    <td>{line.account_id || 'Unknown'}</td>
                    <td>{line.region || 'Unknown'}</td>
                    <td>{line.resource_id}</td>
                    <td>{line.team_slug || 'Unallocated'}</td>
                    <td>{data.coverage === 'complete' ? `${line.currency} ${line.amount}` : 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="portal-surface__subtitle">{data.note}</p>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
