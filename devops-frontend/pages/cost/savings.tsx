import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostNav from '../../components/CostNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { CostSavings, costQuery, fetchCostJson } from '../../lib/cost';

export default function CostSavingsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const [data, setData] = useState<CostSavings | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady) return;
    setLoading(true);
    fetchCostJson<CostSavings>(apiUrl, `/api/cost/savings${costQuery(basis, currency, { from, to })}`)
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router.isReady, basis, currency, from, to]);

  return (
    <DevOpsLayout>
      <Head><title>Cost savings</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Cost savings</h1>
            <p className="portal-page__subtitle">
              Detected to verified, including Inconclusive. Acceptance is not permission to execute. Overlapping verified bill reductions on one resource count once.
            </p>
          </div>
        </div>
        <CostNav current="savings" />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <div className="portal-pill-row">
          <span className="portal-pill">Verified bill reduction {data?.verified_bill_reduction?.display || 'Unknown'}</span>
          <span className="portal-pill">Executes No</span>
          <span className="portal-pill">Pauses workloads No</span>
        </div>
        {loading ? <div className="empty-state">Loading savings…</div> : null}
        {!loading ? (
          <>
            <section className="portal-surface portal-surface--table">
              <h2 className="portal-surface__title">Waiting for me</h2>
              {!(data?.waiting || []).length ? (
                <p className="sre-meta__empty">No cost recommendations are waiting.</p>
              ) : (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Calculation</th>
                      <th>Lifecycle</th>
                      <th>Waiting</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.waiting || []).map((row) => (
                      <tr key={row.calc_id}>
                        <td>
                          <Link href={`/cost/optimization?calc=${encodeURIComponent(row.calc_id)}`}>{row.calc_id}</Link>
                          <div className="portal-surface__subtitle">{row.resource_id}</div>
                        </td>
                        <td>{row.lifecycle || row.status}</td>
                        <td>{row.waiting_for}</td>
                        <td>{row.change_id ? <Link href={row.change_href || `/changes/${row.change_id}`}>{row.change_number}</Link> : 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="portal-surface portal-surface--table">
              <h2 className="portal-surface__title">Verification outcomes</h2>
              {!(data?.outcomes || []).length ? (
                <p className="sre-meta__empty">No measured outcomes yet. Verification can be Inconclusive.</p>
              ) : (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Calculation</th>
                      <th>Outcome</th>
                      <th>Bill reduction</th>
                      <th>Allocation reduction</th>
                      <th>Cost avoidance</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.outcomes || []).map((row) => (
                      <tr key={row.calc_id}>
                        <td>
                          {row.calc_id}
                          <div className="portal-surface__subtitle">{row.note}</div>
                        </td>
                        <td>{row.lifecycle || row.verification}</td>
                        <td>{row.bill_reduction?.display || 'Unknown'}</td>
                        <td>{row.allocation_reduction?.display || 'Unknown'}</td>
                        <td>{row.cost_avoidance?.display || 'Unknown'}</td>
                        <td>{row.change_id ? <Link href={row.change_href || `/changes/${row.change_id}`}>{row.change_number}</Link> : 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="portal-surface__subtitle">{data?.note}</p>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
