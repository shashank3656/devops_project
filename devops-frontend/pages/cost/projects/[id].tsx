import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CostKpiStrip from '../../../components/CostKpiStrip';
import CostMixChart from '../../../components/CostMixChart';
import CostNav from '../../../components/CostNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CostProjectDashboard, budgetAlertLabel, costQuery, costToneForDisplay, fetchCostJson, freshnessLabel, importableLabel } from '../../../lib/cost';

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
  const mix = data?.service_mix || [];
  const days = data?.daily || [];

  return (
    <DevOpsLayout>
      <Head><title>{title}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">{data?.project?.code || 'Project'}</span>
            <h1 className="portal-page__title">{title}</h1>
            <p className="portal-page__subtitle">
              Clouds and accounts in this project. Click an account for spend, import, and suggestions.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/cost" className="btn btn-secondary">All projects</Link>
          </div>
        </div>
        <CostNav current="overview" />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <div className="portal-pill-row">
          <button type="button" className={`btn btn-sm ${basis === 'actual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => {
            if (!id) return;
            void router.replace({ pathname: `/cost/projects/${id}`, query: { ...router.query, basis: 'actual', currency } }, undefined, { shallow: true });
          }}>Actual</button>
          <button type="button" className={`btn btn-sm ${basis === 'amortized' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => {
            if (!id) return;
            void router.replace({ pathname: `/cost/projects/${id}`, query: { ...router.query, basis: 'amortized', currency } }, undefined, { shallow: true });
          }}>Amortized</button>
        </div>
        {loading ? <div className="empty-state">Loading project spend…</div> : null}
        {!loading && data ? (
          <>
            <CostKpiStrip
              items={[
                {
                  label: 'Project spend',
                  value: spendUnknown ? 'Unknown' : data.spend?.display || 'Unknown',
                  hint: spendUnknown ? 'Incomplete stays Unknown, never $0' : `${basis} billed window`,
                  tone: costToneForDisplay(data.spend?.display),
                },
                {
                  label: 'Waiting',
                  value: String(data.waiting_count ?? 0),
                  hint: 'Suggestions that never execute',
                  tone: (data.waiting_count || 0) > 0 ? 'wait' : 'unknown',
                },
                {
                  label: 'Freshness',
                  value: freshnessLabel(data.freshness),
                  hint: data.window_start ? `${data.window_start} to ${data.window_end}` : 'Window',
                  tone: data.freshness === 'stale' ? 'stale' : data.freshness === 'current' ? 'billed' : 'unknown',
                },
                {
                  label: 'Access',
                  value: data.cost_role === 'operate' ? 'Operate' : 'View',
                  hint: 'Granted at project level',
                  tone: data.can_operate ? 'billed' : 'unknown',
                },
              ]}
            />
            <section className="cost-dash">
              <div className="cost-dash__graph">
                <span className="portal-surface__eyebrow">Service mix</span>
                <h2 className="portal-surface__title">Where spend sits</h2>
                <CostMixChart mix={mix} days={days} />
              </div>
              <div className="cost-dash__side">
                <span className="portal-surface__eyebrow">Accounts</span>
                <h2 className="portal-surface__title">Clouds in this project</h2>
                {(data.project?.clouds || []).map((cloud) => (
                  <div key={cloud.provider} className="cost-tree__cloud">
                    <div className="cost-tree__cloud-label">{cloud.provider}</div>
                    {(cloud.accounts || []).map((account) => (
                      <Link key={`${account.id}-${account.cloud_account_id}`} href={account.href} className="cost-tree__account">
                        <span>
                          <span className="cost-tree__account-name">{account.display_name}</span>
                          <span className="cost-tree__account-meta">
                            {account.environment || 'Unknown'} · {importableLabel(account.import_status)}
                          </span>
                        </span>
                        <span className="cost-tree__spend">{account.spend?.display || 'Unknown'}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </section>
            {(data.budgets || []).length ? (
              <section className="portal-surface portal-surface--tight">
                <h2 className="portal-surface__title">Budgets</h2>
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Remaining</th>
                      <th>Alert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.budgets || []).map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.remaining?.display || 'Unknown'}</td>
                        <td>{budgetAlertLabel(row.alert)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
            <section className="portal-surface portal-surface--tight">
              <h2 className="portal-surface__title">Waiting suggestions</h2>
              {(data.suggestions || []).length ? (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Calculation</th>
                      <th>Finding</th>
                      <th>Savings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.suggestions || []).map((row) => (
                      <tr key={row.calc_id}>
                        <td><Link href={row.href || '/cost/optimization'}>{row.calc_id}</Link></td>
                        <td>{row.finding_type}</td>
                        <td>{row.savings_high?.display || 'Unknown'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="sre-meta__empty">No waiting suggestions for this project.</p>}
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
