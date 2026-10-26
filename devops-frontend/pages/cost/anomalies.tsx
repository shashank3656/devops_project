import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostFirstRun from '../../components/CostFirstRun';
import CostNav from '../../components/CostNav';
import CostTechnicalDetails from '../../components/CostTechnicalDetails';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { CostAnomalies, costQuery, fetchCostJson } from '../../lib/cost';

export default function CostAnomaliesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const [data, setData] = useState<CostAnomalies | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady) return;
    setLoading(true);
    fetchCostJson<CostAnomalies>(apiUrl, `/api/cost/anomalies${costQuery(basis, currency, { from, to })}`)
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router.isReady, basis, currency, from, to]);

  const rows = (data?.anomalies || []).filter((row) => row.resource_id || row.like_for_like);
  const insufficient = Boolean(data?.insufficient_data) || (!(data?.anomalies || []).length && (data?.prior_coverage || 'none') !== 'complete');

  return (
    <DevOpsLayout>
      <Head><title>Cost anomalies</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">Cost anomalies</h1>
            <p className="cost-shell__hint">Compared against the previous complete window. Incomplete stays Unknown, never a drop to $0.</p>
          </div>
        </div>
        <CostNav current="anomalies" />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <dl className="cost-k8s-meta" aria-label="Cost alert readiness">
          <div>
            <dt>Alerts enabled</dt>
            <dd>{data?.alerts?.alerts_enabled ? 'On' : 'Off'}</dd>
          </div>
          <div>
            <dt>Monitoring ready</dt>
            <dd>{data?.alerts?.monitoring_ready ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Delivery verified</dt>
            <dd>{data?.alerts?.delivery_verified ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Evaluation</dt>
            <dd>{data?.alerts?.blocked_reason || (data?.alerts?.monitoring_ready ? 'Ready' : 'Unknown')}</dd>
          </div>
        </dl>
        {loading ? <div className="empty-state">Loading anomalies…</div> : null}
        {!loading && insufficient ? (
          <CostFirstRun
            canOperate
            title="Not enough comparable data"
            primaryLabel="Ingest billed data"
          />
        ) : null}
        {!loading && !insufficient && !rows.length ? (
          <div className="empty-state">No anomalies in this complete window.</div>
        ) : null}
        {!loading && rows.length ? (
          <section className="portal-surface portal-surface--table">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Current</th>
                  <th>Baseline</th>
                  <th>Delta</th>
                  <th>Like-for-like</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.calc_id}>
                    <td>
                      {row.resource_id || 'Window'}{row.service ? ` · ${row.service}` : ''}
                    </td>
                    <td>{row.current?.display || 'Unknown'}</td>
                    <td>{row.baseline?.display || 'Unknown'}</td>
                    <td>{row.delta?.display || 'Unknown'}</td>
                    <td>{row.like_for_like ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <CostTechnicalDetails>
              <p>{data?.note}</p>
              {rows.map((row) => (
                <p key={row.calc_id}>{row.resource_id || 'Window'} · {row.calc_id}</p>
              ))}
            </CostTechnicalDetails>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
