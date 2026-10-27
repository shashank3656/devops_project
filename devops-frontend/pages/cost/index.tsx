import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceScope } from '@infragate/ui';
import CostAskButton from '../../components/CostAskButton';
import CostAttention from '../../components/CostAttention';
import CostDailyChart from '../../components/CostDailyChart';
import CostFirstRun from '../../components/CostFirstRun';
import { CostPeriodControls } from '../../components/CostFilterBar';
import CostFreshnessStrip from '../../components/CostFreshnessStrip';
import CostNav from '../../components/CostNav';
import CostProjectList from '../../components/CostProjectList';
import CostSampleBanner from '../../components/CostSampleBanner';
import CostScorecard from '../../components/CostScorecard';
import CostSetupFlow from '../../components/CostSetupFlow';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  CostOverview,
  VisibleCostProject,
  applyCostAnalysisFilters,
  costAccountStatus,
  costAccountStatusLabel,
  costAskSourceLine,
  costCloudsForProject,
  costHref,
  costQuery,
  costUnknownReason,
  countCostAccounts,
  fetchCostJson,
  fetchVisibleCostProjects,
  sortCostTreeBySpend,
  uniqueCostFilterOptions,
} from '../../lib/cost';
import { COST_SAMPLE, COST_SAMPLE_DAYS, COST_SAMPLE_PRIOR_DAYS } from '../../lib/costSample';

export default function CostOverviewPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const { scope } = useWorkspaceScope();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const projectFilter = scope.projectId;
  const cloudFilter = typeof router.query.cloud === 'string' ? router.query.cloud : '';
  const environmentFilter = scope.environment;
  const freshnessFilter = typeof router.query.freshness === 'string' ? router.query.freshness : '';
  const importFilter = typeof router.query.import === 'string' ? router.query.import : '';
  const sample = router.query.sample === '1';
  const [data, setData] = useState<CostOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [projectsCatalog, setProjectsCatalog] = useState<VisibleCostProject[]>([]);

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

  useEffect(() => {
    fetchVisibleCostProjects(apiUrl).then(setProjectsCatalog).catch(() => setProjectsCatalog([]));
  }, [apiUrl]);

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
  const explorerHref = (extra: Record<string, string> = {}) => costHref('/cost/explorer', router.query, extra);
  const canOperate = data?.can_operate !== false;
  const showSample = sample && empty;
  const spark = showSample ? COST_SAMPLE_DAYS.map((row) => row.percent) : (data?.daily || []).map((row) => row.percent);
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
  const exportDisabled = empty || showSample;
  const exportReason = showSample ? 'Sample data cannot be exported.' : 'Connect a billing source to export costs.';

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
    if (exportDisabled) return;
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
          <h1 className="portal-page__title">Cost overview</h1>
          <div className="portal-page__actions">
            <CostPeriodControls />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={exporting || exportDisabled}
              title={exportDisabled ? exportReason : undefined}
              aria-label={exportDisabled ? exportReason : 'Export costs'}
              onClick={() => void exportCSV()}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
            <CostAskButton question="Summarize this billed window" context={`Period ${windowQuery.from || 'this month'} to ${windowQuery.to || 'today'}. Basis ${basis}. Coverage ${showSample ? 'sample' : data?.coverage || 'Unknown'}. Operating bill ${showSample ? COST_SAMPLE.spend : data?.operating_bill?.display || 'Unknown'}. ${costAskSourceLine(costCloudsForProject(projectsCatalog, projectFilter))}`}>
              Ask AI
            </CostAskButton>
          </div>
        </div>
        <CostNav
          current="overview"
          analysis={showSample ? undefined : filterOptions}
          visibleAccounts={visibleAccounts}
          totalAccounts={totalAccounts}
          sample={showSample}
        />
        {showSample ? <CostSampleBanner /> : <CostFreshnessStrip detail={data?.freshness_detail} coverage={data?.coverage} />}
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
        {!loading && (showSample || !empty) ? (
          <>
            <CostScorecard
              canOperate={canOperate}
              items={[
                {
                  label: 'Spend to date',
                  value: showSample ? COST_SAMPLE.spend : (billUnknown ? 'Unknown' : data?.operating_bill?.display || 'Unknown'),
                  comparison: showSample ? COST_SAMPLE.comparison : (compare?.like_for_like ? compare.delta?.display : 'Unknown'),
                  comparisonLabel: 'Versus prior period',
                  sparkline: spark,
                  visual: 'trend',
                  href: explorerHref(),
                  unknown: showSample ? null : spendReason,
                  meaning: 'spend',
                },
                {
                  label: 'Month-end forecast',
                  value: showSample ? COST_SAMPLE.forecast : (data?.forecast?.display || 'Unknown'),
                  comparisonLabel: 'Method',
                  comparison: showSample ? 'Run-rate range' : (data?.forecast?.method || 'Needs two complete windows'),
                  estimate: true,
                  visual: 'range',
                  rangeLow: showSample ? COST_SAMPLE.forecastLow : undefined,
                  rangeHigh: showSample ? COST_SAMPLE.forecastHigh : undefined,
                  href: explorerHref(),
                  unknown: showSample ? null : (forecastUnknown ? { code: 'incomplete', title: 'Forecast needs two complete windows', detail: data?.forecast?.note || 'Incomplete stays Unknown, never $0.' } : null),
                  meaning: 'spend',
                },
                {
                  label: 'Budget remaining',
                  value: showSample ? COST_SAMPLE.budgetRemaining : (riskBudget?.remaining?.display || 'Unknown'),
                  comparison: showSample ? '78% of monthly budget used' : (riskBudget ? `${riskBudget.name}` : 'No budget this month'),
                  comparisonLabel: 'Budget',
                  visual: 'progress',
                  progress: showSample ? COST_SAMPLE.budgetPercent : undefined,
                  href: showSample ? undefined : costHref('/cost/budgets', router.query),
                  unknown: showSample ? null : (remainingUnknown ? { code: 'incomplete', title: 'Budget remaining is Unknown', detail: 'Remaining stays Unknown until a complete billed window exists.' } : null),
                  meaning: riskBudget?.alert === 'over' ? 'risk' : 'neutral',
                },
                {
                  label: 'Potential monthly savings',
                  value: showSample ? COST_SAMPLE.savings : (data?.nonoverlapping_savings?.display || 'Unknown'),
                  comparisonLabel: 'Status',
                  comparison: 'Estimated, not verified',
                  estimate: true,
                  visual: 'count',
                  countLabel: showSample ? `${COST_SAMPLE.opportunityCount} opportunities` : ((data?.opportunities || []).length ? `${(data?.opportunities || []).length} opportunities` : undefined),
                  href: costHref('/cost/optimization', router.query),
                  unknown: showSample ? null : (savingsUnknown ? { code: 'incomplete', title: 'Estimated savings stay Unknown', detail: 'Overlapping recommendations are not summed.' } : null),
                  meaning: 'savings',
                },
              ]}
            />
            {filteredEmpty ? (
              <CostFirstRun canOperate={canOperate} title="No accounts match these filters" primaryLabel="Clear filters" primaryHref={costHref('/cost', { basis, currency, from, to })} />
            ) : !showSample ? (
              <CostProjectList projects={projects} query={router.query} />
            ) : null}
            <section className="cost-dash cost-dash--split">
              <div className="cost-dash__graph">
                <div className="cost-dash__head">
                  <h2 className="portal-surface__title">Spend trend</h2>
                  <div className="cost-legend">
                    <span className="cost-legend__item cost-legend__item--spend">This period</span>
                    <span className="cost-legend__item cost-legend__item--prior">Prior period</span>
                  </div>
                </div>
                <CostDailyChart
                  days={showSample ? COST_SAMPLE_DAYS : (data?.daily || [])}
                  prior={showSample ? COST_SAMPLE_PRIOR_DAYS : (data?.prior_daily || [])}
                  currency={currency}
                />
                <CostAskButton
                  question="Explain this increase"
                  context={`Period ${windowQuery.from || 'this month'} to ${windowQuery.to || 'today'}. Basis ${basis}. Change versus prior ${showSample ? COST_SAMPLE.comparison : (compare?.like_for_like ? compare.delta?.display : 'Unknown')}. Coverage ${showSample ? 'sample' : data?.coverage || 'Unknown'}.`}
                >
                  Explain this increase
                </CostAskButton>
              </div>
              <CostAttention items={showSample ? COST_SAMPLE.attention : attention} />
            </section>
            <section className="cost-split">
              <article className="cost-split__col">
                <h2>Billed by service</h2>
                {(showSample ? COST_SAMPLE.drivers : (data?.service_mix || [])).length ? (
                  <ul className="cost-driver-list">
                    {(showSample ? COST_SAMPLE.drivers : (data?.service_mix || [])).map((row) => (
                      <li key={row.label}>
                        <Link href={explorerHref({ family: row.label, group: 'service' })}>{row.label}</Link>
                        <span>{row.display}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No complete billed mix for this window. Incomplete is never $0. <Link href={explorerHref({ group: 'service' })}>Open explorer</Link></p>
                )}
              </article>
              <article className="cost-split__col">
                <h2>Savings opportunities</h2>
                {(showSample ? COST_SAMPLE.opportunities : (data?.opportunities || [])).length ? (
                  <ul className="cost-driver-list">
                    {(showSample ? COST_SAMPLE.opportunities : (data?.opportunities || [])).map((row) => (
                      <li key={row.calc_id}>
                        <Link href={costHref('/cost/optimization', router.query, row.calc_id.startsWith('sample') ? {} : { calc: row.calc_id })}>{row.finding_type}</Link>
                        <span>{row.savings_high?.display || 'Unknown'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No recommendations until billed data is connected.</p>
                )}
              </article>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
