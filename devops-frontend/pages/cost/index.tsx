import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import CostKpiStrip from '../../components/CostKpiStrip';
import CostMixChart from '../../components/CostMixChart';
import CostNav from '../../components/CostNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  CostOverview,
  CostTreeProject,
  applyCostAnalysisFilters,
  budgetAlertLabel,
  costQuery,
  costToneForDisplay,
  countCostAccounts,
  fetchCostJson,
  freshnessLabel,
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
    () => applyCostAnalysisFilters(allProjects, {
      project: projectFilter,
      cloud: cloudFilter,
      environment: environmentFilter,
      freshness: freshnessFilter,
      importStatus: importFilter,
    }),
    [allProjects, projectFilter, cloudFilter, environmentFilter, freshnessFilter, importFilter],
  );
  const empty = !allProjects.length;
  const filteredEmpty = !empty && !projects.length;
  const billUnknown = data?.operating_bill?.display === 'Unknown';
  const visibleAccounts = countCostAccounts(projects);
  const totalAccounts = countCostAccounts(allProjects);
  const selectedProject = projects.length === 1 ? projects[0] : null;

  return (
    <DevOpsLayout>
      <Head><title>Cost analysis</title></Head>
      <div className="portal-page cost-analysis">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Cost analysis</h1>
            <p className="portal-page__subtitle">
              Project, then cloud, then account. Filters change the list below. Operating bill is the billed window, not a filtered sum.
            </p>
          </div>
          <div className="portal-page__actions">
            {data?.can_operate !== false ? <Link href="/cost/configuration" className="btn btn-primary">Enable Cost</Link> : null}
            <Link href="/cloud-accounts" className="btn btn-secondary">Cloud accounts</Link>
          </div>
        </div>
        <CostNav current="overview" analysis={filterOptions} />
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.reload()}>Retry</button>
          </div>
        ) : null}
        {loading ? <div className="empty-state">Loading operating bill…</div> : null}
        {!loading && empty ? (
          <section className="portal-surface">
            <div className="empty-state">
              No Cost accounts in a project you can see. Assign a cloud account to a project, enable Cost, then import billed lines. Demo inventory accounts stay out.
            </div>
          </section>
        ) : null}
        {!loading && !empty ? (
          <>
            <CostKpiStrip
              items={[
                {
                  label: 'Operating bill',
                  value: billUnknown ? 'Unknown' : data?.operating_bill?.display || 'Unknown',
                  hint: billUnknown ? 'Incomplete stays Unknown, never $0' : `${basis} billed window`,
                  tone: costToneForDisplay(data?.operating_bill?.display),
                },
                {
                  label: 'Unallocated',
                  value: data?.unallocated?.display || 'Unknown',
                  hint: 'Lines without a team yet',
                  tone: costToneForDisplay(data?.unallocated?.display),
                },
                {
                  label: 'Ownership',
                  value: data?.ownership?.display || 'Unknown',
                  hint: 'Share with a team',
                  tone: costToneForDisplay(data?.ownership?.display),
                },
                {
                  label: 'Kubernetes',
                  value: data?.kubernetes?.spend?.display || 'Unknown',
                  hint: 'Breakdown of this bill, never extra',
                  tone: 'k8s',
                },
                {
                  label: 'Waiting',
                  value: String(data?.waiting_count ?? 0),
                  hint: 'Suggestions that never execute',
                  tone: (data?.waiting_count || 0) > 0 ? 'wait' : 'unknown',
                },
                {
                  label: selectedProject ? 'Selected project' : 'Accounts in view',
                  value: selectedProject ? (selectedProject.spend?.display || 'Unknown') : `${visibleAccounts} of ${totalAccounts}`,
                  hint: selectedProject ? selectedProject.name : freshnessLabel(data?.freshness),
                  tone: selectedProject ? costToneForDisplay(selectedProject.spend?.display) : (data?.freshness === 'stale' ? 'stale' : 'billed'),
                },
              ]}
            />
            <section className="cost-dash">
              <div className="cost-dash__graph">
                <span className="portal-surface__eyebrow">Service mix</span>
                <h2 className="portal-surface__title">Where the bill sits</h2>
                <CostMixChart mix={data?.service_mix || []} days={data?.daily || []} />
              </div>
              <div className="cost-dash__side">
                <span className="portal-surface__eyebrow">Read this first</span>
                <h2 className="portal-surface__title">How to scan the board</h2>
                <ol className="cost-guide">
                  <li>Teal is billed. Lavender is Unknown or missing.</li>
                  <li>Set window and basis, then project, cloud, and environment.</li>
                  <li>Click an account for spend, import, and suggestions.</li>
                  <li>Kubernetes is a slice of the cloud bill, never a second total.</li>
                </ol>
                <div className="cost-legend">
                  <span className="cost-legend__item cost-legend__item--compute">Compute</span>
                  <span className="cost-legend__item cost-legend__item--database">Database</span>
                  <span className="cost-legend__item cost-legend__item--storage">Storage</span>
                  <span className="cost-legend__item cost-legend__item--other">Other</span>
                </div>
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
                      <p className="cost-tree__spend">{project.spend?.display || 'Unknown'}</p>
                    </header>
                    {(project.clouds || []).map((cloud) => (
                      <div key={cloud.provider} className="cost-tree__cloud">
                        <div className="cost-tree__cloud-label">{cloud.provider}</div>
                        {(cloud.accounts || []).map((account) => (
                          <Link
                            key={`${account.id}-${account.cloud_account_id}`}
                            href={account.href || accountHref(project, account.id)}
                            className={`cost-tree__account${account.import_status === 'not_imported' ? ' is-missing' : ''}${account.stale_hint ? ' is-stale' : ''}`}
                          >
                            <span>
                              <span className="cost-tree__account-name">{account.display_name}</span>
                              <span className="cost-tree__account-meta">
                                {account.environment || 'Unknown'} · {freshnessLabel(account.freshness)}
                                {account.import_status === 'not_imported' ? ' · Not imported' : ''}
                                {account.stale_hint ? ' · Stale' : ''}
                              </span>
                            </span>
                            <span className="cost-tree__spend">{account.spend?.display || 'Unknown'}</span>
                          </Link>
                        ))}
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
                  <Link href={`/cost/budgets${costQuery(basis, currency, { from: data?.window_start || from, to: data?.window_end || to })}`} className="btn btn-secondary btn-sm">Open budgets</Link>
                </div>
                <div className="cost-budget-board__grid">
                  {(data?.budgets || []).map((row) => (
                    <article key={row.id} className={`cost-budget cost-budget--${(row.alert || 'unknown').toLowerCase()}`}>
                      <span className="cost-kpi__label">{row.name}</span>
                      <strong className="cost-kpi__value">{row.remaining?.display || 'Unknown'}</strong>
                      <span className="cost-kpi__hint">Spent {row.spent?.display || 'Unknown'} · {budgetAlertLabel(row.alert)}</span>
                    </article>
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
