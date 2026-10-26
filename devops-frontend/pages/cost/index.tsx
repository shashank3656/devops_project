import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import CostAskButton from '../../components/CostAskButton';
import CostAttention from '../../components/CostAttention';
import CostDailyChart from '../../components/CostDailyChart';
import CostFirstRun from '../../components/CostFirstRun';
import CostFreshnessStrip from '../../components/CostFreshnessStrip';
import CostNav from '../../components/CostNav';
import CostScorecard from '../../components/CostScorecard';
import CostSetupFlow from '../../components/CostSetupFlow';
import CostUnknown from '../../components/CostUnknown';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  CostOverview,
  CostTreeProject,
  applyCostAnalysisFilters,
  costAccountStatus,
  costAccountStatusLabel,
  costHref,
  costQuery,
  costUnknownReason,
  countCostAccounts,
  fetchCostJson,
  sortCostTreeBySpend,
  uniqueCostFilterOptions,
} from '../../lib/cost';

function accountHref(project: CostTreeProject, accountId: number) {
  const account = project.clouds.flatMap((cloud) => cloud.accounts).find((item) => item.id === accountId);
  return account?.href || `/cost/accounts/${accountId}`;
}

export default function CostOverviewPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const projectFilter = typeof router.query.project === 'string' ? router.query.project : '';
  const cloudFilter = typeof router.query.cloud === 'string' ? router.query.cloud : '';
  const environmentFilter = typeof router.query.environment === 'string' ? router.query.environment : '';
  const freshnessFilter = typeof router.query.freshness === 'string' ? router.query.freshness : '';
  const importFilter = typeof router.query.import === 'string' ? router.query.import : '';
  const sample = router.query.sample === '1';
  const [data, setData] = useState<CostOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    setLoading(true);
    fetchCostJson<CostOverview>(apiUrl, `/api/cost/overview${costQuery(basis, currency, { from, to })}`)
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router.isReady, basis, currency, from, to]);

  const allProjects = data?.projects || [];
  const filterOptions = useMemo(() => uniqueCostFilterOptions(allProjects), [allProjects]);
  const projects = useMemo(
    () => sortCostTreeBySpend(applyCostAnalysisFilters(allProjects, {
      project: projectFilter,
      cloud: cloudFilter,
      environment: environmentFilter,
      freshness: freshnessFilter,
      importStatus: importFilter,
    })),
    [allProjects, projectFilter, cloudFilter, environmentFilter, freshnessFilter, importFilter],
  );
  const empty = !allProjects.length;
  const filteredEmpty = !empty && !projects.length;
  const billUnknown = data?.operating_bill?.display === 'Unknown';
  const visibleAccounts = countCostAccounts(projects);
  const totalAccounts = countCostAccounts(allProjects);
  const windowQuery = { from: data?.window_start || from, to: data?.window_end || to };
  const explorerHref = (extra: Record<string, string>) => costHref('/cost/explorer', router.query, extra);
  const canOperate = data?.can_operate !== false;
  const showSample = sample && empty;
  const spark = (data?.daily || []).map((row) => row.percent);
  const riskBudget = (data?.budgets || []).find((row) => row.alert === 'over') || (data?.budgets || []).find((row) => row.alert === 'warn') || (data?.budgets || [])[0];
  const compare = data?.compare;
  const spendReason = costUnknownReason({
    display: data?.operating_bill?.display,
    coverage: data?.coverage || data?.operating_bill?.coverage,
    freshness: data?.freshness,
    lineCount: data?.line_count,
  });
  const forecastUnknown = !data?.forecast?.display || data.forecast.display === 'Unknown' || data.forecast.coverage !== 'complete';
  const savingsUnknown = !data?.nonoverlapping_savings?.display || data.nonoverlapping_savings.display === 'Unknown';
  const remainingUnknown = !riskBudget || riskBudget.remaining?.display === 'Unknown';

  const attention = [
    ...(data?.budgets || []).filter((row) => row.alert === 'over' || row.alert === 'warn').map((row) => ({
      title: row.alert === 'over' ? `${row.name} is over budget` : `${row.name} is near budget`,
      detail: `Remaining ${row.remaining?.display || 'Unknown'}`,
      href: costHref('/cost/budgets', router.query),
      tone: row.alert === 'over' ? 'risk' as const : 'alert' as const,
    })),
    ...(data?.anomalies || []).map((row) => ({
      title: 'Unusual increase',
      detail: `${row.service || 'Billed spend'} ${row.delta?.display || 'Unknown'} versus the prior complete window`,
      href: costHref('/cost/budgets', router.query, { tab: 'alerts' }),
      tone: 'alert' as const,
    })),
    ...(allProjects.flatMap((project) => project.clouds.flatMap((cloud) => cloud.accounts))
      .filter((account) => costAccountStatus(account) === 'not_imported' || costAccountStatus(account) === 'stale')
      .slice(0, 3)
      .map((account) => ({
        title: costAccountStatus(account) === 'stale' ? `${account.display_name} is stale` : `${account.display_name} has no billed import`,
        detail: costAccountStatusLabel(costAccountStatus(account)),
        href: costHref('/cost/configuration', router.query),
        tone: 'source' as const,
      }))),
  ];

  const exportCSV = async () => {
    setExporting(true);
    setError('');
    try {
      const { downloadCostCSV, fetchCostCSV } = await import('../../lib/cost');
      const text = await fetchCostCSV(apiUrl, `/api/cost/export${costQuery(basis, currency, windowQuery)}`);
      downloadCostCSV(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cost export could not be loaded.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>Cost overview</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">Cost overview</h1>
            <p className="cost-shell__hint">What we are spending, why it changed, and what to do next. Filters change the list. The operating bill is the billed window, not a filtered sum.</p>
          </div>
          <div className="portal-page__actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={exporting || empty} onClick={() => void exportCSV()}>
              {exporting ? 'Exporting…' : 'Export'}
            </button>
            <CostAskButton question="Summarize this billed window" context={`Period ${windowQuery.from || 'this month'} to ${windowQuery.to || 'today'}. Basis ${basis}. Coverage ${data?.coverage || 'Unknown'}. Operating bill ${data?.operating_bill?.display || 'Unknown'}. Source labelled CUR 2.0.`}>
              Ask AI
            </CostAskButton>
          </div>
        </div>
        <CostNav current="overview" analysis={filterOptions} visibleAccounts={visibleAccounts} totalAccounts={totalAccounts} />
        <CostFreshnessStrip detail={data?.freshness_detail} coverage={data?.coverage} />
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.reload()}>Retry</button>
          </div>
        ) : null}
        {loading ? <div className="empty-state">Loading operating bill…</div> : null}
        {!loading && empty && !showSample ? (
          <CostSetupFlow
            canOperate={canOperate}
            state="none"
            sampleHref={costHref('/cost', router.query, { sample: '1' })}
          />
        ) : null}
        {showSample ? (
          <div className="cost-sample" role="status">
            Sample dashboard — not billed data. Real totals stay Unknown until a complete import exists.
          </div>
        ) : null}
        {!loading && (showSample || !empty) ? (
          <>
            <CostScorecard
              canOperate={canOperate}
              items={[
                {
                  label: 'Spend to date',
                  value: showSample ? '$12,480' : (billUnknown ? 'Unknown' : data?.operating_bill?.display || 'Unknown'),
                  comparison: showSample ? '+8.4%' : (compare?.like_for_like ? compare.delta?.display : 'Unknown'),
                  comparisonLabel: 'Versus prior period',
                  hint: showSample ? 'Sample billed window' : (billUnknown ? 'Incomplete stays Unknown, never $0' : `${basis} billed window`),
                  sparkline: showSample ? [12, 18, 16, 22, 20, 28, 24] : spark,
                  href: explorerHref({}),
                  unknown: showSample ? null : spendReason,
                  meaning: 'spend',
                },
                {
                  label: 'Month-end forecast',
                  value: showSample ? '$18,200' : (data?.forecast?.display || 'Unknown'),
                  comparisonLabel: 'Method',
                  comparison: showSample ? 'Sample range' : (data?.forecast?.method || 'Needs two complete windows'),
                  estimate: true,
                  href: explorerHref({}),
                  unknown: showSample ? null : (forecastUnknown ? { code: 'incomplete', title: 'Forecast needs two complete windows', detail: data?.forecast?.note || 'Incomplete stays Unknown, never $0.' } : null),
                  meaning: 'spend',
                },
                {
                  label: 'Budget remaining',
                  value: showSample ? '$3,120' : (riskBudget?.remaining?.display || 'Unknown'),
                  comparison: showSample ? 'Warn at 80%' : (riskBudget ? `${riskBudget.name}` : 'No budget this month'),
                  comparisonLabel: 'Budget',
                  href: costHref('/cost/budgets', router.query),
                  unknown: showSample ? null : (remainingUnknown ? { code: 'incomplete', title: 'Budget remaining is Unknown', detail: 'Remaining stays Unknown until a complete billed window exists.' } : null),
                  meaning: riskBudget?.alert === 'over' ? 'risk' : 'neutral',
                },
                {
                  label: 'Potential monthly savings',
                  value: showSample ? '$640' : (data?.nonoverlapping_savings?.display || 'Unknown'),
                  comparisonLabel: 'Status',
                  comparison: 'Estimated, not verified',
                  estimate: true,
                  href: costHref('/cost/optimization', router.query),
                  unknown: showSample ? null : (savingsUnknown ? { code: 'incomplete', title: 'Estimated savings stay Unknown', detail: 'Overlapping recommendations are not summed.' } : null),
                  meaning: 'savings',
                },
              ]}
            />
            <section className="cost-dash cost-dash--split">
              <div className="cost-dash__graph">
                <div className="cost-dash__head">
                  <h2 className="portal-surface__title">Daily spend</h2>
                  <div className="cost-legend">
                    <span className="cost-legend__item cost-legend__item--spend">This period</span>
                    <span className="cost-legend__item cost-legend__item--prior">Prior period</span>
                  </div>
                </div>
                <CostDailyChart
                  days={showSample ? [
                    { label: '01', display: '$400', percent: 40 },
                    { label: '08', display: '$520', percent: 55 },
                    { label: '15', display: '$610', percent: 70 },
                    { label: '22', display: '$480', percent: 50 },
                  ] : (data?.daily || [])}
                  prior={showSample ? [] : (data?.prior_daily || [])}
                />
                <CostAskButton
                  question="Explain this increase"
                  context={`Period ${windowQuery.from || 'this month'} to ${windowQuery.to || 'today'}. Basis ${basis}. Change versus prior ${compare?.like_for_like ? compare.delta?.display : 'Unknown'}. Coverage ${data?.coverage || 'Unknown'}.`}
                >
                  Explain this increase
                </CostAskButton>
              </div>
              <CostAttention items={showSample ? [{ title: 'Sample budget risk', detail: 'Example only. Not a live alert.', tone: 'alert' }] : attention} />
            </section>
            <section className="cost-split">
              <article className="cost-split__col">
                <h2>Top cost drivers</h2>
                {(showSample ? [{ label: 'Compute', display: '$7,200' }, { label: 'Database', display: '$3,100' }] : (data?.service_mix || [])).length ? (
                  <ul className="cost-driver-list">
                    {(showSample ? [{ label: 'Compute', display: '$7,200' }, { label: 'Database', display: '$3,100' }] : (data?.service_mix || [])).map((row) => (
                      <li key={row.label}>
                        <Link href={explorerHref({ family: row.label })}>{row.label}</Link>
                        <span>{row.display}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No complete service mix for this window.</p>
                )}
              </article>
              <article className="cost-split__col">
                <h2>Top savings opportunities</h2>
                {(showSample ? [{ calc_id: 'sample', finding_type: 'Review idle compute', savings_high: { display: '$640' } }] : (data?.opportunities || [])).length ? (
                  <ul className="cost-driver-list">
                    {(showSample ? [{ calc_id: 'sample', finding_type: 'Review idle compute', savings_high: { display: '$640' } }] : (data?.opportunities || [])).map((row) => (
                      <li key={row.calc_id}>
                        <Link href={costHref('/cost/optimization', router.query, row.calc_id === 'sample' ? {} : { calc: row.calc_id })}>{row.finding_type}</Link>
                        <span>{row.savings_high?.display || 'Unknown'} estimate</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No recommendations for this window.</p>
                )}
              </article>
            </section>
            {filteredEmpty ? (
              <CostFirstRun canOperate={canOperate} title="No accounts match these filters" primaryLabel="Clear filters" primaryHref={costHref('/cost', { basis, currency, from, to })} />
            ) : !showSample ? (
              <section className="cost-tree" aria-label="Cost by project">
                {projects.map((project) => (
                  <article key={project.id} className="cost-tree__project">
                    <header className="cost-tree__project-head">
                      <div>
                        <span className="portal-surface__eyebrow">{project.code || 'Project'}</span>
                        <h2 className="cost-tree__project-name">
                          <Link href={project.href || `/cost/projects/${project.id}`}>{project.name}</Link>
                        </h2>
                      </div>
                      <p className="cost-tree__spend">
                        {costUnknownReason({ display: project.spend?.display, coverage: project.spend?.coverage })
                          ? <CostUnknown reason={costUnknownReason({ display: project.spend?.display, coverage: project.spend?.coverage })!} canOperate={project.can_operate} />
                          : (project.spend?.display || 'Unknown')}
                      </p>
                    </header>
                    {(project.clouds || []).map((cloud) => (
                      <div key={cloud.provider} className="cost-tree__cloud">
                        <div className="cost-tree__cloud-label">{cloud.provider}</div>
                        {(cloud.accounts || []).map((account) => {
                          const status = costAccountStatus(account);
                          const reason = costUnknownReason({
                            display: account.spend?.display,
                            coverage: account.spend?.coverage,
                            importStatus: account.import_status,
                            freshness: account.freshness,
                            stale: Boolean(account.stale_hint),
                          });
                          return (
                            <div
                              key={`${account.id}-${account.cloud_account_id}`}
                              className={`cost-tree__account${status === 'not_imported' ? ' is-missing' : ''}${status === 'stale' ? ' is-stale' : ''}`}
                            >
                              <Link href={account.href || accountHref(project, account.id)} className="cost-tree__account-main">
                                <span className={`cost-dot cost-dot--${status}`} title={costAccountStatusLabel(status)} />
                                <span>
                                  <span className="cost-tree__account-name">{account.display_name}</span>
                                  <span className="cost-tree__account-meta">{account.environment || 'Unknown'}</span>
                                </span>
                              </Link>
                              <span className="cost-tree__spend">
                                {reason
                                  ? <CostUnknown reason={reason} canOperate={project.can_operate} />
                                  : (account.spend?.display || 'Unknown')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </article>
                ))}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
