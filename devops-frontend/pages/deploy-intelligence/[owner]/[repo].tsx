import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import {
  DataTable,
  EmptyState,
  InspectorDrawer,
  PRImpactBrief,
  SegmentedControl,
  type DataTableColumn,
  type DeployIntelChangeBrief,
  type PRImpactBriefData,
} from '@infragate/ui';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

type Section = 'merges' | 'open';

interface OpenPRMeta {
  is_draft?: boolean;
  age_days?: number;
  review_sla?: string;
  review_detail?: string;
  assignees?: string[];
  requested_reviewers?: string[];
  checks?: RequiredCheck[];
  preview_environments?: { request_id: number; env: string; label: string; expires_at?: string }[];
  suggest_ticket?: boolean;
  suggest_ticket_reason?: string;
  conflicts_with?: number[];
}

interface DeployEvent {
  id?: number;
  pr_number: number;
  request_id?: number;
  title: string;
  author: string;
  base_branch: string;
  head_branch: string;
  merged_at?: string;
  commit_count: number;
  file_count: number;
  additions: number;
  deletions: number;
  score: number;
  risk_level: string;
  summary: string;
  pr_url: string;
  impact: PRImpactBriefData;
  open_pr?: OpenPRMeta;
  change_brief?: DeployIntelChangeBrief;
  similar_merges?: {
    pr_number: number;
    title: string;
    headline?: string;
    overlap?: string[];
    later_revert?: { pr_number: number; title: string };
    pr_url?: string;
  }[];
  github_post?: {
    check_posted?: boolean;
    comment_posted?: boolean;
    check_name?: string;
    conclusion?: string;
    error?: string;
  };
}

interface RepoSummary {
  owner: string;
  name: string;
  base_branch: string;
  ready: boolean;
  merge_count: number;
  open_pr_count: number;
  setup_summary: string;
  webhook_path: string;
}

interface RequiredCheck {
  key: string;
  label: string;
  required: boolean;
  present: boolean;
  status: string;
  detail?: string;
}

interface BranchProtectionInsight {
  base_branch: string;
  protected: boolean;
  enforcement?: string;
  required_checks: RequiredCheck[];
  recommendations?: string[];
  summary: string;
  github_configured: boolean;
}

interface DeployFrequencyBucket {
  period_start: string;
  period_label: string;
  merge_count: number;
  high_risk_merges: number;
}

interface RepoInsights {
  branch_protection: BranchProtectionInsight;
  deploy_frequency: DeployFrequencyBucket[];
}

interface GitHubFetchMeta {
  configured: boolean;
  allowed: boolean;
  ready: boolean;
  error?: string;
  fetched_at?: string;
  listed: number;
  total_open: number;
  truncated: boolean;
  max_listed: number;
}

function riskChipTone(level: string): 'low' | 'medium' | 'high' | 'danger' | 'ok' | 'info' | 'neutral' {
  if (level === 'high') return 'danger';
  if (level === 'medium') return 'medium';
  if (level === 'low') return 'low';
  return 'neutral';
}

export default function DeployIntelligenceRepoPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const owner = typeof router.query.owner === 'string' ? router.query.owner : '';
  const repo = typeof router.query.repo === 'string' ? router.query.repo : '';

  const [section, setSection] = useState<Section>('merges');
  const [events, setEvents] = useState<DeployEvent[]>([]);
  const [repoMeta, setRepoMeta] = useState<RepoSummary | null>(null);
  const [future, setFuture] = useState<string[]>([]);
  const [insights, setInsights] = useState<RepoInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DeployEvent | null>(null);
  const [refreshPR, setRefreshPR] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [githubMeta, setGithubMeta] = useState<GitHubFetchMeta | null>(null);
  const [githubError, setGithubError] = useState('');
  const [baseFilter, setBaseFilter] = useState<'all' | 'production'>('production');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [suggestingTicket, setSuggestingTicket] = useState(false);
  const [ticketMessage, setTicketMessage] = useState('');
  const [ackReasons, setAckReasons] = useState('');
  const [protecting, setProtecting] = useState(false);
  const [protectMessage, setProtectMessage] = useState('');

  const load = async (refreshNumber?: number, options?: { batchDeep?: boolean }) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !owner || !repo) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        owner,
        repo,
        limit: '100',
        section,
      });
      if (section === 'open') {
        query.set('fetch_github', '1');
        if (baseFilter === 'production') query.set('base_filter', 'production');
        if (includeDrafts) query.set('include_drafts', '1');
        if (options?.batchDeep) query.set('batch_deep', '1');
      }
      if (refreshNumber && refreshNumber > 0) query.set('refresh_pr', String(refreshNumber));
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to load pull request analysis');
        return;
      }
      setRepoMeta(data?.repo || null);
      const nextEvents: DeployEvent[] = Array.isArray(data?.events) ? data.events : [];
      setEvents(nextEvents);
      setFuture(Array.isArray(data?.future_capabilities) ? data.future_capabilities : []);
      setInsights((data?.insights as RepoInsights) || null);
      setGithubMeta((data?.github as GitHubFetchMeta) || null);
      setGithubError(typeof data?.github_error === 'string' ? data.github_error : '');
      if (refreshNumber && refreshNumber > 0) {
        const match = nextEvents.find((e) => e.pr_number === refreshNumber);
        if (match) setSelected(match);
      }
    } catch {
      setError('Failed to load pull request analysis');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [apiUrl, router.isReady, owner, repo, section, baseFilter, includeDrafts]);

  const applyRecommendedProtection = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const branch = insights?.branch_protection.base_branch || repoMeta?.base_branch || 'main';
    const ok = window.confirm(
      `Apply recommended SetuOps checks on ${owner}/${repo} branch ${branch}?\n\nThis will require infragate/plan-review and infragate/policy, and will create branch protection if it is missing.`,
    );
    if (!ok) return;
    setProtecting(true);
    setProtectMessage('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/protect-branch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, name: repo, base_branch: branch, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProtectMessage(data?.error || 'Could not apply branch protection');
        return;
      }
      setProtectMessage('Recommended branch protection applied.');
      void load();
    } catch {
      setProtectMessage('Could not apply branch protection');
    } finally {
      setProtecting(false);
    }
  };

  const suggestTicket = async (prNumber: number, acknowledged = false) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const reasons = ackReasons.split('\n').map((line) => line.trim()).filter(Boolean);
    setSuggestingTicket(true);
    setTicketMessage('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/suggest-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          name: repo,
          pr_number: prNumber,
          acknowledged,
          reasons,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 428 && data?.ack_reasons_required) {
        setTicketMessage(data?.error || 'Add exception reasons, then create the ticket.');
        return;
      }
      if (!res.ok) {
        setTicketMessage(data?.error || 'Could not create ticket');
        return;
      }
      setTicketMessage(data?.message || `Ticket #${data?.request_id} created`);
      setAckReasons('');
      void load();
    } catch {
      setTicketMessage('Could not create ticket');
    } finally {
      setSuggestingTicket(false);
    }
  };

  const onRowOpen = (row: DeployEvent) => {
    setSelected(row);
    if (section === 'open') {
      setRefreshing(true);
      void load(row.pr_number);
    }
  };

  const columns: DataTableColumn<DeployEvent>[] = useMemo(
    () => [
      {
        id: 'pr',
        header: 'Pull request',
        cell: (row) => (
          <div className="ig-cell-stack">
            <span className="ig-cell-title">{row.title || `PR #${row.pr_number}`}</span>
            <span className="ig-cell-meta">
              #{row.pr_number} · {row.author || 'unknown'} · {row.head_branch} → {row.base_branch}
            </span>
          </div>
        ),
      },
      {
        id: 'commits',
        header: 'Commits',
        align: 'right',
        className: 'ig-cell-num',
        cell: (row) => row.commit_count,
      },
      {
        id: 'files',
        header: 'Files',
        align: 'right',
        className: 'ig-cell-num',
        cell: (row) => row.file_count,
      },
      {
        id: 'diff',
        header: 'Diff',
        align: 'right',
        className: 'ig-cell-num',
        cell: (row) => `+${row.additions}/-${row.deletions}`,
      },
      {
        id: 'changing',
        header: 'Changing',
        cell: (row) => {
          const brief = row.change_brief || row.impact?.change_brief;
          return <span className="ig-cell-title">{brief?.headline || '—'}</span>;
        },
      },
      {
        id: 'risk-because',
        header: 'Risk because',
        cell: (row) => {
          const reasons = row.change_brief?.risk_because || row.impact?.change_brief?.risk_because || [];
          if (reasons.length === 0) return <span className="ig-cell-meta">—</span>;
          return <span className="ig-cell-meta">{reasons[0]}</span>;
        },
      },
      ...(section === 'open'
        ? [
            {
              id: 'conflicts',
              header: 'Stack',
              cell: (row: DeployEvent) => {
                const conflicts = row.open_pr?.conflicts_with || [];
                if (conflicts.length === 0) return <span className="ig-cell-meta">—</span>;
                return <span className="ig-cell-meta">#{conflicts.join(', #')}</span>;
              },
            } as DataTableColumn<DeployEvent>,
          ]
        : []),
      {
        id: 'risk',
        header: 'Risk',
        cell: (row) => (
          <span className={`ig-chip ig-chip--${riskChipTone(row.risk_level)}`}>
            {row.risk_level} · {row.score}
          </span>
        ),
      },
      ...(section === 'open'
        ? [
            {
              id: 'github-brief',
              header: 'GitHub brief',
              cell: (row: DeployEvent) => {
                const posted = row.github_post;
                const deployCheck = row.open_pr?.checks?.find((check) => check.key === 'deploy_intel');
                if (posted?.comment_posted || posted?.check_posted) {
                  return (
                    <span className={`ig-chip ig-chip--${posted.check_posted ? 'ok' : 'info'}`}>
                      {posted.check_posted ? 'Check + comment' : 'Comment posted'}
                    </span>
                  );
                }
                if (deployCheck?.status === 'ok') {
                  return <span className="ig-chip ig-chip--ok">Posted</span>;
                }
                return <span className="ig-cell-meta">Open row to post</span>;
              },
            },
          ]
        : []),
      {
        id: 'when',
        header: section === 'merges' ? 'Merged' : 'Review SLA',
        cell: (row) => {
          if (section === 'merges' && row.merged_at) return new Date(row.merged_at).toLocaleString();
          if (section === 'open' && row.open_pr) {
            const sla = row.open_pr.review_sla || 'ok';
            return (
              <span className={`ig-chip ig-chip--${sla === 'breach' ? 'danger' : sla === 'warning' ? 'medium' : 'ok'}`}>
                {row.open_pr.age_days ?? 0}d · {sla}
              </span>
            );
          }
          return section === 'open' ? 'Open' : '—';
        },
      },
      ...(section === 'open'
        ? [
            {
              id: 'checks',
              header: 'CI checks',
              cell: (row: DeployEvent) => {
                const checks = row.open_pr?.checks || [];
                const ok = checks.filter((c) => c.status === 'ok').length;
                const missing = checks.filter((c) => c.status === 'missing').length;
                if (checks.length === 0) return '—';
                return (
                  <span className="ig-cell-meta">
                    {ok}/{checks.length} ok{missing > 0 ? ` · ${missing} gap` : ''}
                  </span>
                );
              },
            } as DataTableColumn<DeployEvent>,
          ]
        : []),
      {
        id: 'request',
        header: 'Request',
        cell: (row) =>
          row.request_id ? (
            <Link href={`/tickets?id=${row.request_id}`} className="ig-cell-link" onClick={(e) => e.stopPropagation()}>
              #{row.request_id}
            </Link>
          ) : (
            '—'
          ),
      },
    ],
    [section],
  );

  const brief: PRImpactBriefData | null = selected?.impact?.pr_number
    ? selected.impact
    : selected
      ? {
          request_id: selected.request_id,
          pr_number: selected.pr_number,
          pr_url: selected.pr_url,
          title: selected.title,
          author: selected.author,
          base_branch: selected.base_branch,
          head_branch: selected.head_branch,
          merge_state: section === 'open' ? 'open' : 'merged',
          deploy_status: section === 'open' ? 'open' : 'merged',
          commit_count: selected.commit_count,
          file_count: selected.file_count,
          additions: selected.additions,
          deletions: selected.deletions,
          blast_radius: selected.impact?.blast_radius || [],
          score: selected.score,
          risk_level: selected.risk_level as PRImpactBriefData['risk_level'],
          summary: selected.summary,
          recommended_action: selected.impact?.recommended_action || '',
          factors: selected.impact?.factors || [],
          commits: selected.impact?.commits,
          files: selected.impact?.files,
          change_brief: selected.change_brief || selected.impact?.change_brief,
          plan_delta: selected.impact?.plan_delta,
          similar_merges: selected.similar_merges || selected.impact?.similar_merges,
        }
      : null;

  const rowKey = (row: DeployEvent) => row.id ?? row.pr_number;

  return (
    <DevOpsLayout>
      <Head>
        <title>
          {owner}/{repo} - Deploy intelligence
        </title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Deploy intelligence</span>
            <h1 className="portal-page__title">
              {owner}/{repo}
            </h1>
            <p className="portal-page__subtitle">
              {repoMeta?.setup_summary ||
                'See what each pull request changes and why it is risky before merge or promotion.'}
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/deploy-intelligence" className="btn btn-secondary">
              All repositories
            </Link>
            {selected?.pr_url ? (
              <a href={selected.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                Open on GitHub
              </a>
            ) : null}
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        {insights ? (
          <div className="portal-detail-grid" style={{ marginBottom: 24 }}>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Branch protection</span>
                  <h2 className="portal-surface__title">Required CI checks</h2>
                  <p className="portal-surface__subtitle">{insights.branch_protection.summary}</p>
                </div>
                <span className={`ig-chip ig-chip--${insights.branch_protection.protected ? 'ok' : 'medium'}`}>
                  {insights.branch_protection.protected ? 'Protected' : 'Not protected'}
                </span>
              </div>
              <ul className="portal-list">
                {insights.branch_protection.required_checks.map((check) => (
                  <li key={check.key}>
                    <code>{check.label}</code>{' '}
                    <span className={`ig-chip ig-chip--${check.status === 'ok' ? 'ok' : check.status === 'missing' ? 'danger' : 'neutral'}`}>
                      {check.status}
                    </span>
                  </li>
                ))}
              </ul>
              {insights.branch_protection.recommendations && insights.branch_protection.recommendations.length > 0 ? (
                <ul className="portal-list" style={{ marginTop: 12 }}>
                  {insights.branch_protection.recommendations.map((rec) => (
                    <li key={rec}>{rec}</li>
                  ))}
                </ul>
              ) : null}
              {insights.branch_protection.recommendations && insights.branch_protection.recommendations.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={protecting || !insights.branch_protection.github_configured}
                    onClick={() => void applyRecommendedProtection()}
                  >
                    {protecting ? 'Applying…' : 'Apply recommended protection'}
                  </button>
                  {protectMessage ? <p className="portal-surface__subtitle" style={{ marginTop: 8 }}>{protectMessage}</p> : null}
                </div>
              ) : null}
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Deploy frequency</span>
                  <h2 className="portal-surface__title">Merges to base (weekly)</h2>
                  <p className="portal-surface__subtitle">Production-branch merges stored for this repository.</p>
                </div>
              </div>
              {insights.deploy_frequency.length === 0 ? (
                <p className="portal-surface__subtitle">No merge history yet for charting.</p>
              ) : (
                <div className="deploy-intel-chart" role="img" aria-label="Weekly merge counts">
                  {(() => {
                    const max = Math.max(...insights.deploy_frequency.map((b) => b.merge_count), 1);
                    return insights.deploy_frequency.map((bucket) => (
                      <div key={bucket.period_label} className="deploy-intel-chart__row">
                        <span className="deploy-intel-chart__label">{bucket.period_label}</span>
                        <div className="deploy-intel-chart__bar-track">
                          <div
                            className="deploy-intel-chart__bar deploy-intel-chart__bar--merge"
                            style={{ width: `${Math.max(8, (bucket.merge_count / max) * 100)}%` }}
                            title={`${bucket.merge_count} merge(s)`}
                          />
                          {bucket.high_risk_merges > 0 ? (
                            <div
                              className="deploy-intel-chart__bar deploy-intel-chart__bar--risk"
                              style={{ width: `${Math.max(4, (bucket.high_risk_merges / max) * 100)}%` }}
                              title={`${bucket.high_risk_merges} high risk`}
                            />
                          ) : null}
                        </div>
                        <span className="deploy-intel-chart__value">{bucket.merge_count}</span>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </section>
          </div>
        ) : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Pull requests</span>
              <h2 className="portal-surface__title">PR analysis</h2>
              <p className="portal-surface__subtitle">
                Base branch <strong>{repoMeta?.base_branch || 'main'}</strong> · {repoMeta?.merge_count ?? 0} stored merges ·{' '}
                {repoMeta?.open_pr_count ?? 0} open on GitHub
              </p>
            </div>
            <SegmentedControl
              label="Pull request section"
              value={section}
              onChange={(value) => setSection(value === 'open' ? 'open' : 'merges')}
              options={[
                { value: 'merges', label: 'Merged to base' },
                { value: 'open', label: 'Open PRs' },
              ]}
            />
          </div>

          {section === 'merges' ? (
            <form
              className="ig-lifecycle__row"
              style={{ marginBottom: 16 }}
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(refreshPR, 10);
                if (!n) return;
                setRefreshing(true);
                void load(n);
              }}
            >
              <input
                className="ig-lifecycle__select"
                placeholder="Backfill merged PR #"
                value={refreshPR}
                onChange={(e) => setRefreshPR(e.target.value)}
                aria-label="Pull request number to analyze"
              />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={refreshing || !refreshPR.trim()}>
                {refreshing ? 'Analyzing…' : 'Analyze & store merge'}
              </button>
            </form>
          ) : (
            <div className="ig-lifecycle__row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <SegmentedControl
                label="Base branch filter"
                value={baseFilter}
                onChange={(v) => setBaseFilter(v === 'production' ? 'production' : 'all')}
                options={[
                  { value: 'production', label: `→ ${repoMeta?.base_branch || 'main'}` },
                  { value: 'all', label: 'All open' },
                ]}
              />
              <label className="portal-toolbar__item" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
                <span className="credential-audit-label">Include drafts</span>
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={loading || refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void load();
                }}
              >
                {refreshing || loading ? 'Fetching from GitHub…' : 'Refresh from GitHub'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={loading || refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void load(undefined, { batchDeep: true });
                }}
                title="Deep-analyze up to 12 PRs (commits, files, CI checks)"
              >
                Batch analyze
              </button>
              {githubMeta?.fetched_at ? (
                <span className="portal-surface__subtitle" style={{ margin: 0 }}>
                  Last fetch {new Date(githubMeta.fetched_at).toLocaleString()} · {githubMeta.listed} listed
                  {githubMeta.truncated ? ` (cap ${githubMeta.max_listed}; more open on GitHub)` : ''}
                </span>
              ) : null}
              {githubError ? <span className="alert alert-error" style={{ margin: 0, padding: '8px 12px' }}>{githubError}</span> : null}
              {!githubMeta?.configured && section === 'open' ? (
                <span className="portal-surface__subtitle" style={{ margin: 0 }}>
                  Configure <code>GITHUB_TOKEN</code> on the backend to list open pull requests.
                </span>
              ) : null}
            </div>
          )}

          <div className="ig-legacy-table">
            <DataTable<DeployEvent>
              label={section === 'merges' ? 'Merged pull requests' : 'Open pull requests (live analysis)'}
              columns={columns}
              rows={events}
              rowKey={rowKey}
              loading={loading}
              activeKey={selected ? rowKey(selected) : null}
              onRowOpen={onRowOpen}
              empty={
                <EmptyState
                  title={section === 'merges' ? 'No merge analyses yet' : 'No open pull requests'}
                  body={
                    section === 'merges'
                      ? 'Merge to the production base branch or backfill a PR number above.'
                      : githubError
                        ? 'Fix GitHub access above, then use Refresh from GitHub.'
                        : 'No open pull requests on this repository, or the list is still loading.'
                  }
                />
              }
            />
          </div>
        </section>

        {future.length > 0 ? (
          <section className="portal-surface" style={{ marginTop: 24 }}>
            <span className="portal-surface__eyebrow">Coming next for this repo</span>
            <ul className="portal-list">
              {future.map((item) => (
                <li key={item}>
                  <code>{item}</code>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <InspectorDrawer open={Boolean(selected)} title={selected ? `PR #${selected.pr_number}` : 'PR analysis'} onClose={() => setSelected(null)}>
        {selected?.change_brief || selected?.impact?.change_brief ? (
          <div className="portal-surface" style={{ marginBottom: 16 }}>
            <span className="portal-surface__eyebrow">Change brief</span>
            <h3 className="portal-surface__title" style={{ marginTop: 4 }}>
              {(selected.change_brief || selected.impact.change_brief)?.headline}
            </h3>
            {(selected.change_brief || selected.impact.change_brief)?.multi_env ? (
              <p className="portal-surface__subtitle">This PR touches more than one environment path.</p>
            ) : null}
            {(selected.change_brief || selected.impact.change_brief)?.changing?.length ? (
              <ul className="portal-list" style={{ marginTop: 10 }}>
                {(selected.change_brief || selected.impact.change_brief)!.changing.map((group) => (
                  <li key={group.key}>
                    {group.label} · {group.count} file{group.count === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            ) : null}
            {(selected.change_brief || selected.impact.change_brief)?.risk_because?.length ? (
              <ul className="portal-list" style={{ marginTop: 10 }}>
                {(selected.change_brief || selected.impact.change_brief)!.risk_because.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {selected.impact?.plan_delta?.has_plan ? (
              <p className="portal-surface__subtitle" style={{ marginTop: 10 }}>
                Plan vs PR: {selected.impact.plan_delta.summary}
              </p>
            ) : null}
            {(selected.similar_merges || selected.impact?.similar_merges)?.length ? (
              <ul className="portal-list" style={{ marginTop: 10 }}>
                {(selected.similar_merges || selected.impact?.similar_merges || []).map((item) => (
                  <li key={item.pr_number}>
                    Similar #{item.pr_number} {item.headline || item.title}
                    {item.later_revert ? ` · later revert #${item.later_revert.pr_number}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {selected?.open_pr ? (
          <div className="portal-surface" style={{ marginBottom: 16 }}>
            {(() => {
              const posted = selected.github_post;
              const deployCheck = selected.open_pr.checks?.find((check) => check.key === 'deploy_intel');
              const postedOk = Boolean(posted?.check_posted || posted?.comment_posted || deployCheck?.status === 'ok');
              return (
                <span className={`ig-chip ig-chip--${postedOk ? 'ok' : posted?.error ? 'danger' : 'neutral'}`} style={{ marginRight: 8 }}>
                  {posted?.check_posted
                    ? 'infragate/deploy-intel posted'
                    : posted?.comment_posted
                      ? 'PR comment posted'
                      : postedOk
                        ? 'GitHub brief posted'
                        : 'GitHub brief not posted'}
                </span>
              );
            })()}
            {selected.open_pr.is_draft ? <span className="ig-chip ig-chip--neutral">Draft</span> : null}
            {selected.open_pr.conflicts_with && selected.open_pr.conflicts_with.length > 0 ? (
              <p className="portal-surface__subtitle" style={{ marginTop: 8 }}>
                Overlaps open PRs #{selected.open_pr.conflicts_with.join(', #')}
              </p>
            ) : null}
            {selected.open_pr.review_detail ? <p className="portal-surface__subtitle">{selected.open_pr.review_detail}</p> : null}
            {selected.open_pr.checks && selected.open_pr.checks.length > 0 ? (
              <ul className="portal-list">
                {selected.open_pr.checks.map((c) => (
                  <li key={c.key}>
                    <code>{c.label}</code>{' '}
                    <span className={`ig-chip ig-chip--${c.status === 'ok' ? 'ok' : c.status === 'missing' ? 'danger' : 'neutral'}`}>
                      {c.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {selected.open_pr.preview_environments && selected.open_pr.preview_environments.length > 0 ? (
              <ul className="portal-list" style={{ marginTop: 12 }}>
                {selected.open_pr.preview_environments.map((p) => (
                  <li key={p.request_id}>
                    <Link href={`/tickets?id=${p.request_id}`} className="ig-cell-link">
                      {p.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {selected.open_pr.suggest_ticket && !selected.request_id ? (
              <div style={{ marginTop: 12 }}>
                <label className="portal-toolbar__item">
                  <span className="credential-audit-label">Exception reasons (required for high risk)</span>
                  <textarea
                    className="input"
                    rows={3}
                    value={ackReasons}
                    onChange={(event) => setAckReasons(event.target.value)}
                    placeholder="Why this high-risk PR can proceed as a ticket"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 8 }}
                  disabled={suggestingTicket}
                  onClick={() => void suggestTicket(selected.pr_number, ackReasons.trim().length > 0)}
                >
                  {suggestingTicket ? 'Creating ticket…' : 'Create SetuOps ticket'}
                </button>
              </div>
            ) : null}
            {selected.open_pr.suggest_ticket_reason ? (
              <p className="portal-surface__subtitle" style={{ marginTop: 8 }}>
                {selected.open_pr.suggest_ticket_reason}
              </p>
            ) : null}
            {ticketMessage ? <p className="portal-surface__subtitle">{ticketMessage}</p> : null}
          </div>
        ) : null}
        {selected?.github_post ? (
          <p className="portal-surface__subtitle" style={{ marginBottom: 12 }}>
            GitHub brief:{' '}
            {selected.github_post.comment_posted ? 'comment posted' : 'comment not posted'}
            {selected.github_post.check_posted ? ' · check posted' : ' · check needs GitHub App'}
            {selected.github_post.error ? ` · ${selected.github_post.error}` : ''}
          </p>
        ) : null}
        {brief ? <PRImpactBrief brief={brief} /> : null}
      </InspectorDrawer>
    </DevOpsLayout>
  );
}
