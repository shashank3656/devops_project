import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostKpiStrip from '../../../components/CostKpiStrip';
import CostMixChart from '../../../components/CostMixChart';
import CostNav from '../../../components/CostNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CostAccountDashboard, budgetAlertLabel, costQuery, costToneForDisplay, costUnknownReason, downloadCostCSV, fetchCostCSV, fetchCostJson, importableLabel } from '../../../lib/cost';

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
  const [exporting, setExporting] = useState(false);

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
  const mix = data?.service_mix || [];
  const days = data?.daily || [];

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
            {data?.project?.id ? <Link href={`/cost/projects/${data.project.id}`} className="btn btn-secondary btn-sm">Project</Link> : null}
            <Link href="/cost" className="btn btn-secondary btn-sm">All projects</Link>
            {data?.can_operate ? <Link href="/cost/configuration" className="btn btn-secondary btn-sm">Import</Link> : null}
          </div>
        </div>
        <CostNav
          current="overview"
          compact
          crumbs={[
            { href: '/cost', label: 'Cost' },
            data?.project?.id ? { href: `/cost/projects/${data.project.id}`, label: data.project.name || 'Project' } : { href: '/cost', label: 'Project' },
            { label: title },
          ]}
        />
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
            <CostKpiStrip
              canOperate={data.can_operate}
              items={[
                {
                  label: 'This account',
                  value: spendUnknown ? 'Unknown' : data.spend?.display || 'Unknown',
                  hint: spendUnknown ? 'Incomplete stays Unknown, never $0' : `${basis} billed window`,
                  tone: costToneForDisplay(data.spend?.display),
                  unknown: costUnknownReason({
                    display: data.spend?.display,
                    coverage: data.spend?.coverage || data.coverage,
                    importStatus: data.import_status,
                    freshness: data.freshness,
                    stale: Boolean(data.stale_hint),
                  }),
                },
                {
                  label: 'Prior window',
                  value: data.compare?.prior?.display || 'Unknown',
                  hint: data.compare?.like_for_like ? 'Like-for-like' : 'Needs two complete windows',
                  tone: costToneForDisplay(data.compare?.prior?.display),
                  unknown: costUnknownReason({
                    display: data.compare?.prior?.display,
                    coverage: data.compare?.prior?.coverage || data.compare?.prior_coverage,
                  }),
                },
                {
                  label: 'Delta',
                  value: data.compare?.delta?.display || 'Unknown',
                  hint: 'Incomplete stays Unknown, never $0',
                  tone: costToneForDisplay(data.compare?.delta?.display),
                  unknown: costUnknownReason({
                    display: data.compare?.delta?.display,
                    coverage: data.compare?.delta?.coverage,
                  }),
                },
                {
                  label: 'Kubernetes',
                  value: data.kubernetes?.bound ? 'Bound' : 'Not bound',
                  hint: 'Breakdown of this bill, never extra',
                  tone: data.kubernetes?.bound ? 'k8s' : 'unknown',
                  href: data.kubernetes?.href || '/cost/kubernetes',
                },
              ]}
            />
            <div className="cost-ledger__meta">
              <Link href={`/cost/explorer${costQuery(basis, currency, { from: data.window_start || from, to: data.window_end || to })}`}>Explorer</Link>
              <Link href="/cost/optimization">Optimization</Link>
              {data.kubernetes?.href ? <Link href={data.kubernetes.href}>Kubernetes</Link> : null}
              {data.export_href ? (
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={exporting}
                  onClick={() => {
                    setExporting(true);
                    fetchCostCSV(apiUrl, `${data.export_href}${costQuery(basis, currency, { from: data.window_start || from, to: data.window_end || to })}`)
                      .then((text) => downloadCostCSV(text, 'cost-account.csv'))
                      .catch((err: Error) => setError(err.message))
                      .finally(() => setExporting(false));
                  }}
                >
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
              ) : null}
            </div>
            <section className="cost-dash cost-dash--split">
              <div className="cost-dash__graph">
                <span className="portal-surface__eyebrow">Service mix</span>
                <h2 className="portal-surface__title">Where spend sits</h2>
                <CostMixChart
                  mix={mix}
                  days={days}
                  familyHref={(family) => `/cost/explorer${costQuery(basis, currency, { from: data.window_start || from, to: data.window_end || to, family })}`}
                />
              </div>
              <div className="cost-dash__side">
                <span className="portal-surface__eyebrow">Import</span>
                <h2 className="portal-surface__title">What can still be brought in</h2>
                <div className="cost-import">
                  {(data.importable || []).map((item) => (
                    <Link key={item.id} href={item.href || '/cost/configuration'} className="cost-import__row">
                      <span>
                        <span className="cost-import__label">{item.label}</span>
                        <span className="cost-import__note">{item.note}</span>
                      </span>
                      <span className="cost-import__status">{importableLabel(item.status)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
            {(data.budgets || []).length ? (
              <section className="portal-surface portal-surface--tight">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Budgets</span>
                    <h2 className="portal-surface__title">Remaining uses this window</h2>
                  </div>
                  <Link href="/cost/budgets" className="btn btn-secondary btn-sm">Open budgets</Link>
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
                    Acceptance is not permission to execute. Copilot can cite CALC-COST IDs only.
                  </p>
                </div>
                <Link href="/cost/optimization" className="btn btn-secondary btn-sm">Open optimization</Link>
              </div>
              {(data.suggestions || []).length ? (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Calculation</th>
                      <th>Family</th>
                      <th>Finding</th>
                      <th>Savings</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.suggestions || []).map((row) => (
                      <tr key={row.calc_id}>
                        <td><Link href={row.href || '/cost/optimization'}>{row.calc_id}</Link></td>
                        <td>{row.family || 'Other'}</td>
                        <td>{row.finding_type}</td>
                        <td>{row.savings_high?.display || 'Unknown'}</td>
                        <td>{row.blocked_reason || row.lifecycle || row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="sre-meta__empty">No suggestions for this account yet. Import a complete window first.</p>
              )}
            </section>
            <p className="portal-surface__subtitle">{data.kubernetes?.note}</p>
            <p className="portal-surface__subtitle">{data.ai?.note || data.note}</p>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
