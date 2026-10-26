import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostKpiStrip from '../../components/CostKpiStrip';
import CostNav from '../../components/CostNav';
import CostTechnicalDetails from '../../components/CostTechnicalDetails';
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
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">Cost savings</h1>
            <p className="cost-shell__hint">Detected to verified, including Inconclusive. Overlapping verified reductions on one resource count once.</p>
          </div>
        </div>
        <CostNav current="savings" />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <CostKpiStrip
          items={[
            {
              label: 'Estimated savings',
              value: data?.estimated_savings?.display || 'Unknown',
              hint: 'Potential, not verified',
              tone: 'wait',
            },
            {
              label: 'Verified bill reduction',
              value: data?.verified_bill_reduction?.display || 'Unknown',
              hint: 'Overlapping counts once',
              tone: 'billed',
            },
            {
              label: 'Released capacity',
              value: data?.released_capacity?.display || 'Unknown',
              hint: 'Not added to bill reduction',
              tone: 'k8s',
            },
          ]}
        />
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
                      <th>Finding</th>
                      <th>Lifecycle</th>
                      <th>Waiting</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.waiting || []).map((row) => (
                      <tr key={row.calc_id}>
                        <td>
                          <Link href={`/cost/optimization?calc=${encodeURIComponent(row.calc_id)}`}>{row.finding_type || row.waiting_for || 'Review'}</Link>
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
                      <th>Finding</th>
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
                          {row.finding_type || row.lifecycle || 'Outcome'}
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
              <CostTechnicalDetails>
                {(data?.waiting || []).map((row) => <p key={row.calc_id}>{row.calc_id}</p>)}
                {(data?.outcomes || []).map((row) => <p key={`out-${row.calc_id}`}>{row.calc_id}</p>)}
              </CostTechnicalDetails>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
