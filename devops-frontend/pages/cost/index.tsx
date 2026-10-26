import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import CostBudgetBar from '../../components/CostBudgetBar';
import CostFirstRun from '../../components/CostFirstRun';
import CostFreshnessStrip from '../../components/CostFreshnessStrip';
import CostHero from '../../components/CostHero';
import CostMixChart from '../../components/CostMixChart';
import CostNav from '../../components/CostNav';
import CostUnknown from '../../components/CostUnknown';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  CostOverview,
  CostTreeProject,
  applyCostAnalysisFilters,
  costAccountStatus,
  costAccountStatusLabel,
  costQuery,
  costToneForDisplay,
  costUnknownReason,
  countCostAccounts,
  fetchCostJson,
  freshnessLabel,
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
  const [data, setData] = useState<CostOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
  const selectedProject = projects.length === 1 ? projects[0] : null;
  const windowQuery = { from: data?.window_start || from, to: data?.window_end || to };
  const explorerHref = (extra: Record<string, string>) => `/cost/explorer${costQuery(basis, currency, { ...windowQuery, ...extra })}`;
  const billReason = costUnknownReason({
    display: data?.operating_bill?.display,
    coverage: data?.coverage || data?.operating_bill?.coverage,
    freshness: data?.freshness,
    lineCount: data?.line_count,
  });
  const canOperate = data?.can_operate !== false;

  return (
    <DevOpsLayout>
      <Head><title>Cost analysis</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">Cost analysis</h1>
            <p className="cost-shell__hint">Project → cloud → account. Filters change this list. The operating bill is the billed window, not a filtered sum.</p>
          </div>
          <div className="portal-page__actions">
            {canOperate ? <Link href="/cost/configuration" className="btn btn-primary btn-sm">Enable Cost</Link> : null}
            <Link href="/cloud-accounts" className="btn btn-secondary btn-sm">Cloud accounts</Link>
          </div>
        </div>
        <CostNav current="overview" analysis={filterOptions} visibleAccounts={visibleAccounts} totalAccounts={totalAccounts} />
        <CostFreshnessStrip detail={data?.freshness_detail} />
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.reload()}>Retry</button>
          </div>
        ) : null}
        {loading ? <div className="empty-state">Loading operating bill…</div> : null}
        {!loading && empty ? <CostFirstRun canOperate={canOperate} /> : null}
        {!loading && !empty ? (
          <>
            <CostHero
              bill={billUnknown ? 'Unknown' : data?.operating_bill?.display || 'Unknown'}
              hint={billUnknown ? 'Incomplete stays Unknown, never $0' : `${basis} billed window`}
              tone={costToneForDisplay(data?.operating_bill?.display)}
              billReason={billReason}
              importHref="/cost/configuration"
              canOperate={canOperate}
              stats={[
                {
                  label: 'Unallocated',
                  value: data?.unallocated?.display || 'Unknown',
                  hint: 'No team yet',
                  tone: costToneForDisplay(data?.unallocated?.display),
                  href: explorerHref({ team: 'unallocated' }),
                  unknown: costUnknownReason({
                    display: data?.unallocated?.display,
                    coverage: data?.unallocated?.coverage || data?.coverage,
                    freshness: data?.freshness,
                    lineCount: data?.line_count,
                  }),
                },
                {
                  label: 'Ownership',
                  value: data?.ownership?.display || 'Unknown',
                  hint: 'Assigned to a team',
                  tone: costToneForDisplay(data?.ownership?.display),
                  unknown: costUnknownReason({
                    display: data?.ownership?.display,
                    coverage: data?.ownership?.coverage || data?.coverage,
                    freshness: data?.freshness,
                  }),
                },
                {
                  label: 'Kubernetes',
                  value: data?.kubernetes?.spend?.display || 'Unknown',
                  hint: 'Breakdown, never extra',
                  tone: 'k8s',
                  href: '/cost/kubernetes',
                  unknown: costUnknownReason({
                    display: data?.kubernetes?.spend?.display,
                    coverage: data?.kubernetes?.spend?.coverage || data?.coverage,
                    freshness: data?.freshness,
                  }),
                },
                {
                  label: 'Waiting',
                  value: String(data?.waiting_count ?? 0),
                  hint: 'Suggestions only',
                  tone: (data?.waiting_count || 0) > 0 ? 'wait' : 'unknown',
                  href: '/cost/optimization',
                },
                {
                  label: selectedProject ? 'Selected project' : 'Accounts',
                  value: selectedProject ? (selectedProject.spend?.display || 'Unknown') : `${visibleAccounts} of ${totalAccounts}`,
                  hint: selectedProject ? selectedProject.name : freshnessLabel(data?.freshness),
                  tone: selectedProject ? costToneForDisplay(selectedProject.spend?.display) : (data?.freshness === 'stale' ? 'stale' : 'billed'),
                  href: selectedProject ? (selectedProject.href || `/cost/projects/${selectedProject.id}`) : undefined,
                  unknown: selectedProject ? costUnknownReason({
                    display: selectedProject.spend?.display,
                    coverage: selectedProject.spend?.coverage || data?.coverage,
                    freshness: data?.freshness,
                  }) : null,
                },
              ]}
            />
            <section className="cost-dash">
              <div className="cost-dash__graph">
                <div className="cost-dash__head">
                  <h2 className="portal-surface__title">Where the bill sits</h2>
                  <div className="cost-legend">
                    <span className="cost-legend__item cost-legend__item--compute">Compute</span>
                    <span className="cost-legend__item cost-legend__item--database">Database</span>
                    <span className="cost-legend__item cost-legend__item--storage">Storage</span>
                    <span className="cost-legend__item cost-legend__item--other">Other</span>
                  </div>
                </div>
                <CostMixChart
                  mix={data?.service_mix || []}
                  days={data?.daily || []}
                  familyHref={(family) => explorerHref({ family })}
                />
              </div>
            </section>
            {filteredEmpty ? (
              <div className="empty-state">No accounts match these filters. Clear filters to see the full tree.</div>
            ) : (
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
            )}
            {(data?.budgets || []).length ? (
              <section className="cost-budget-board" aria-label="Budgets">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Budgets</span>
                    <h2 className="portal-surface__title">Remaining uses this window</h2>
                  </div>
                  <Link href={`/cost/budgets${costQuery(basis, currency, windowQuery)}`} className="btn btn-secondary btn-sm">Open budgets</Link>
                </div>
                <div className="cost-budget-board__grid">
                  {(data?.budgets || []).map((row) => (
                    <CostBudgetBar key={row.id} row={row} />
                  ))}
                </div>
              </section>
            ) : null}
            <p className="portal-surface__subtitle">{data?.ai?.note || data?.note}</p>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
