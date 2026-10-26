import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostDailyChart from '../../../components/CostDailyChart';
import CostNav from '../../../components/CostNav';
import CostProjectList from '../../../components/CostProjectList';
import CostScorecard from '../../../components/CostScorecard';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CostProjectDashboard, costHref, costQuery, costUnknownReason, fetchCostJson, freshnessLabel } from '../../../lib/cost';

export default function CostProjectDashboardPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const [data, setData] = useState<CostProjectDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady || !id) return;
    setLoading(true);
    fetchCostJson<CostProjectDashboard>(apiUrl, `/api/cost/projects/${id}${costQuery(basis, currency, { from, to })}`)
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router.isReady, id, basis, currency, from, to]);

  const title = data?.project?.name || 'Project spend';
  const spendUnknown = !data?.spend || data.spend.display === 'Unknown';
  const overviewHref = costHref('/cost', router.query);
  const riskBudget = (data?.budgets || []).find((row) => row.alert === 'over') || (data?.budgets || []).find((row) => row.alert === 'warn') || (data?.budgets || [])[0];

  return (
    <DevOpsLayout>
      <Head><title>{title}</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">{title}</h1>
            <p className="cost-shell__hint">{data?.project?.code || 'Project'} · Open an account dashboard for that billed window.</p>
          </div>
          <div className="portal-page__actions">
            <Link href={overviewHref} className="btn btn-secondary btn-sm">All projects</Link>
          </div>
        </div>
        <CostNav
          current="overview"
          crumbs={[
            { href: overviewHref, label: 'Overview' },
            { label: title },
          ]}
        />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state">Loading project spend…</div> : null}
        {!loading && data ? (
          <>
            <CostScorecard
              canOperate={data.can_operate}
              items={[
                {
                  label: 'Project spend',
                  value: spendUnknown ? 'Unknown' : data.spend?.display || 'Unknown',
                  comparisonLabel: 'Window',
                  comparison: data.window_start && data.window_end ? `${data.window_start} to ${data.window_end}` : 'Billed window',
                  visual: 'trend',
                  sparkline: (data.daily || []).map((row) => row.percent),
                  unknown: costUnknownReason({
                    display: data.spend?.display,
                    coverage: data.spend?.coverage || data.coverage,
                    freshness: data.freshness,
                  }),
                  meaning: 'spend',
                },
                {
                  label: 'Budget remaining',
                  value: riskBudget?.remaining?.display || 'Unknown',
                  comparisonLabel: 'Budget',
                  comparison: riskBudget?.name || 'No budget this month',
                  href: costHref('/cost/budgets', router.query),
                  meaning: riskBudget?.alert === 'over' ? 'risk' : 'neutral',
                },
                {
                  label: 'Waiting recommendations',
                  value: String(data.waiting_count ?? 0),
                  comparisonLabel: 'Status',
                  comparison: 'Estimated, not executed',
                  visual: 'count',
                  countLabel: `${data.waiting_count ?? 0} waiting`,
                  href: costHref('/cost/optimization', router.query),
                  meaning: 'savings',
                },
                {
                  label: 'Freshness',
                  value: freshnessLabel(data.freshness),
                  comparisonLabel: 'Access',
                  comparison: data.cost_role === 'operate' ? 'Operate' : 'View',
                  meaning: 'neutral',
                },
              ]}
            />
            <section className="cost-dash">
              <div className="cost-dash__graph">
                <div className="cost-dash__head">
                  <h2 className="portal-surface__title">Spend trend</h2>
                </div>
                <CostDailyChart days={data.daily || []} currency={currency} />
              </div>
            </section>
            {data.project ? <CostProjectList projects={[data.project]} query={router.query} title="Accounts in this project" showProjectAction={false} /> : null}
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
