import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostNav from '../../components/CostNav';
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

  return (
    <DevOpsLayout>
      <Head><title>Cost anomalies</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Cost anomalies</h1>
            <p className="portal-page__subtitle">
              Like-for-like complete windows only. Incomplete coverage stays Unknown, never a drop to $0. Usage versus price stays Unknown without quantity.
            </p>
          </div>
        </div>
        <CostNav current="anomalies" />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <div className="portal-pill-row">
          <span className="portal-pill">Basis {basis}</span>
          <span className="portal-pill">Currency {currency}</span>
          <span className="portal-pill">Cost alerts {data?.notify_cost ? 'On' : 'Off'}</span>
          {data?.prior_window_start ? <span className="portal-pill">Prior {data.prior_window_start} to {data.prior_window_end}</span> : null}
          <span className="portal-pill">Prior coverage {data?.prior_coverage || 'none'}</span>
        </div>
        {loading ? <div className="empty-state">Loading anomalies…</div> : null}
        {!loading && !(data?.anomalies || []).length ? (
          <div className="empty-state">No anomaly detections for this window. Import a prior complete month to compare like-for-like.</div>
        ) : null}
        {!loading && (data?.anomalies || []).length ? (
          <section className="portal-surface portal-surface--table">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Calculation</th>
                  <th>Resource</th>
                  <th>Current</th>
                  <th>Baseline</th>
                  <th>Delta</th>
                  <th>Like-for-like</th>
                </tr>
              </thead>
              <tbody>
                {(data?.anomalies || []).map((row) => (
                  <tr key={row.calc_id}>
                    <td>
                      {row.calc_id}
                      <div className="portal-surface__subtitle">{row.note}</div>
                    </td>
                    <td>{row.resource_id || 'Window'}{row.service ? ` · ${row.service}` : ''}</td>
                    <td>{row.current?.display || 'Unknown'}</td>
                    <td>{row.baseline?.display || 'Unknown'}</td>
                    <td>{row.delta?.display || 'Unknown'}</td>
                    <td>{row.like_for_like ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="portal-surface__subtitle">{data?.note}</p>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
