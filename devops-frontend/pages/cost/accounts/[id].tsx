import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostAttention from '../../../components/CostAttention';
import CostDailyChart from '../../../components/CostDailyChart';
import CostFreshnessStrip from '../../../components/CostFreshnessStrip';
import CostNav from '../../../components/CostNav';
import CostScorecard from '../../../components/CostScorecard';
import CostTechnicalDetails from '../../../components/CostTechnicalDetails';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CostAccountDashboard, budgetAlertLabel, costHref, costQuery, costUnknownReason, fetchCostJson, importableLabel } from '../../../lib/cost';

export default function CostAccountDashboardPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const [data, setData] = useState<CostAccountDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady || !id) return;
    setLoading(true);
    fetchCostJson<CostAccountDashboard>(apiUrl, `/api/cost/connections/${id}/dashboard${costQuery(basis, currency, { from, to })}`)
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router.isReady, id, basis, currency, from, to]);

  const title = data?.connection?.display_name || 'Account spend';
  const spendUnknown = !data?.spend || data.spend.display === 'Unknown';
  const days = data?.daily || [];
  const overviewHref = costHref('/cost', router.query);
  const projectHref = data?.project?.id ? costHref(`/cost/projects/${data.project.id}`, router.query) : overviewHref;
  const explorerHref = costHref('/cost/explorer', router.query);
  const riskBudget = (data?.budgets || []).find((row) => row.alert === 'over') || (data?.budgets || []).find((row) => row.alert === 'warn') || (data?.budgets || [])[0];
  const attention = [
    ...(data?.stale_hint ? [{ title: data.stale_hint.note || 'Billing data is stale', detail: 'Import a newer labelled window', href: data.stale_hint.href || '/cost/configuration', tone: 'source' as const }] : []),
    ...(data?.importable || []).filter((item) => item.status !== 'ready').map((item) => ({
      title: item.label,
      detail: item.note || importableLabel(item.status),
      href: item.href || '/cost/configuration',
      tone: 'source' as const,
    })),
    ...(data?.budgets || []).filter((row) => row.alert === 'over' || row.alert === 'warn').map((row) => ({
      title: row.alert === 'over' ? `${row.name} is over budget` : `${row.name} is near budget`,
      detail: `Remaining ${row.remaining?.display || 'Unknown'}`,
      href: costHref('/cost/budgets', router.query),
      tone: row.alert === 'over' ? 'risk' as const : 'alert' as const,
    })),
  ];

  return (
    <DevOpsLayout>
      <Head><title>{title}</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">{title}</h1>
            <p className="cost-shell__hint">
              {data?.project?.name || 'Project'} · {data?.cloud || 'Cloud'} · {data?.environment || 'Unknown'} · {data?.cost_role === 'operate' ? 'Operate' : 'View'}
            </p>
          </div>
          <div className="portal-page__actions">
            {data?.project?.id ? <Link href={projectHref} className="btn btn-secondary btn-sm">Project</Link> : null}
            <Link href={overviewHref} className="btn btn-secondary btn-sm">All projects</Link>
            {data?.can_operate ? <Link href={costHref('/cost/configuration', router.query)} className="btn btn-secondary btn-sm">Import</Link> : null}
          </div>
        </div>
        <CostNav
          current="overview"
          crumbs={[
            { href: overviewHref, label: 'Overview' },
            data?.project?.id ? { href: projectHref, label: data.project?.name || 'Project' } : { href: overviewHref, label: 'Project' },
            { label: title },
          ]}
        />
        <CostFreshnessStrip detail={data?.freshness_detail} />
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.reload()}>Retry</button>
          </div>
        ) : null}
        {data?.stale_hint ? (
          <div className="alert alert-info" role="status">
            {data.stale_hint.note}{' '}
            {data.can_operate ? <Link href={data.stale_hint.href || '/cost/configuration'}>Import</Link> : 'Ask someone with Cost operate to import.'}
          </div>
        ) : null}
        {loading ? <div className="empty-state">Loading account spend…</div> : null}
        {!loading && data ? (
          <>
            <CostScorecard
              canOperate={data.can_operate}
              items={[
                {
                  label: 'Spend to date',
                  value: spendUnknown ? 'Unknown' : data.spend?.display || 'Unknown',
                  comparison: data.compare?.like_for_like ? data.compare.delta?.display : 'Unknown',
                  comparisonLabel: 'Versus prior period',
                  visual: 'trend',
                  sparkline: days.map((row) => row.percent),
                  href: explorerHref,
                  unknown: costUnknownReason({
                    display: data.spend?.display,
                    coverage: data.spend?.coverage || data.coverage,
                    importStatus: data.import_status,
                    freshness: data.freshness,
                    stale: Boolean(data.stale_hint),
                  }),
                  meaning: 'spend',
                },
                {
                  label: 'Prior window',
                  value: data.compare?.prior?.display || 'Unknown',
                  comparisonLabel: 'Method',
                  comparison: data.compare?.like_for_like ? 'Like-for-like' : 'Needs two complete windows',
                  unknown: costUnknownReason({
                    display: data.compare?.prior?.display,
                    coverage: data.compare?.prior?.coverage || data.compare?.prior_coverage,
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
                  label: 'Potential savings',
                  value: data.suggestions?.[0]?.savings_high?.display || 'Unknown',
                  comparisonLabel: 'Status',
                  comparison: 'Estimated, not verified',
                  estimate: true,
                  visual: 'count',
                  countLabel: `${(data.suggestions || []).length} opportunities`,
                  href: costHref('/cost/optimization', router.query),
                  meaning: 'savings',
                },
              ]}
            />
            <section className="cost-dash cost-dash--split">
              <div className="cost-dash__graph">
                <div className="cost-dash__head">
                  <h2 className="portal-surface__title">Spend trend</h2>
                </div>
                <CostDailyChart days={days} currency={currency} />
              </div>
              <CostAttention items={attention} />
            </section>
            {(data.budgets || []).length ? (
              <section className="portal-surface portal-surface--tight">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Budgets</span>
                    <h2 className="portal-surface__title">Remaining uses this window</h2>
                  </div>
                  <Link href={costHref('/cost/budgets', router.query)} className="btn btn-secondary btn-sm">Open budgets</Link>
                </div>
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Spent</th>
                      <th>Remaining</th>
                      <th>Alert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.budgets || []).map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.spent?.display || 'Unknown'}</td>
                        <td>{row.remaining?.display || 'Unknown'}</td>
                        <td>{budgetAlertLabel(row.alert)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
            <section className="portal-surface portal-surface--tight">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Suggestions</span>
                  <h2 className="portal-surface__title">Stored calculations, not actions</h2>
                  <p className="portal-surface__subtitle">
                    Acceptance is not permission to execute. Suggestions never resize or delete resources.
                  </p>
                </div>
                <Link href={costHref('/cost/optimization', router.query)} className="btn btn-secondary btn-sm">Open optimization</Link>
              </div>
              {(data.suggestions || []).length ? (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Finding</th>
                      <th>Family</th>
                      <th>Savings</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.suggestions || []).map((row) => (
                      <tr key={row.calc_id}>
                        <td><Link href={row.href || '/cost/optimization'}>{row.finding_type}</Link></td>
                        <td>{row.family || 'Other'}</td>
                        <td>{row.savings_high?.display || 'Unknown'}</td>
                        <td>{row.blocked_reason || row.lifecycle || row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="sre-meta__empty">No suggestions for this account yet. Import a complete window first.</p>
              )}
              {(data.suggestions || []).length ? (
                <CostTechnicalDetails>
                  {(data.suggestions || []).map((row) => (
                    <p key={row.calc_id}>{row.finding_type} · {row.calc_id}</p>
                  ))}
                </CostTechnicalDetails>
              ) : null}
            </section>
            <p className="portal-surface__subtitle">{data.kubernetes?.note}</p>
            <p className="portal-surface__subtitle">{data.ai?.note || data.note}</p>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
