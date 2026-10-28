import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DeliveryHubNav from '../components/DeliveryHubNav';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { formatCI, formatReviewAge, formatRisk, pipelinesHref, type DeliveryCheck, type DeliveryCISummary } from '../lib/delivery';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface OpenPR {
  owner?: string;
  repo?: string;
  repo_owner?: string;
  repo_name?: string;
  pr_number: number;
  title: string;
  author: string;
  score: number;
  risk_level: string;
  request_id?: number;
  open_pr?: {
    age_days?: number;
    review_sla?: string;
    review_decision?: string;
    assignees?: string[];
    requested_reviewers?: string[];
    awaiting_owner?: boolean;
    approval_delay_days?: number;
    delay_known?: boolean;
    checks?: DeliveryCheck[];
    ci?: DeliveryCISummary;
  };
  pipeline?: {
    href?: string;
    pipeline_url?: string;
    label?: string;
  };
}

type ReviewBottleneckTeam = {
  repository?: string;
  open?: number;
  awaiting_owner?: number;
  overdue?: number;
  median_age_days?: number;
  median_approval_delay_days?: number;
  delay_known?: boolean;
};

type ReviewBottleneck = {
  awaiting_owner?: number;
  overdue?: number;
  open?: number;
  median_age_days?: number;
  median_approval_delay_days?: number;
  delay_known?: boolean;
  note?: string;
  teams?: ReviewBottleneckTeam[];
};

type RiskFilter = 'all' | 'high' | 'medium' | 'low';
type AgeFilter = 'all' | 'overdue' | 'awaiting';

export default function PullRequestsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<OpenPR[]>([]);
  const [bottleneck, setBottleneck] = useState<ReviewBottleneck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all');
  const [repoFilter, setRepoFilter] = useState('all');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence?view=pull-requests&limit=12`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (!res.ok) throw new Error(data?.error || 'Failed to load pull requests');
          const events = Array.isArray(data?.events) ? data.events : [];
          setItems(events.map((event: OpenPR) => ({
            ...event,
            owner: event.owner || event.repo_owner,
            repo: event.repo || event.repo_name,
          })));
          setBottleneck((data?.review_bottleneck as ReviewBottleneck | undefined) || null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load pull requests');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, router]);

  const repos = useMemo(() => {
    const names = Array.from(new Set(items.map((item) => item.repo).filter(Boolean))) as string[];
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }, [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const risk = formatRisk(item.score, item.risk_level).band;
      const age = formatReviewAge(item.open_pr?.age_days, item.open_pr?.review_sla);
      if (riskFilter !== 'all' && risk !== riskFilter) return false;
      if (ageFilter === 'overdue' && !age.overdue) return false;
      if (ageFilter === 'awaiting' && !item.open_pr?.awaiting_owner) return false;
      if (repoFilter !== 'all' && item.repo !== repoFilter) return false;
      if (!needle) return true;
      return `${item.title} ${item.repo} ${item.author} #${item.pr_number}`.toLowerCase().includes(needle);
    });
  }, [ageFilter, items, query, repoFilter, riskFilter]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Pull requests - OpsTrellis</title>
      </Head>
      <div className="delivery-shell">
        <header className="delivery-head">
          <div>
            <p className="delivery-kicker">Delivery</p>
            <h1 className="delivery-title">Pull requests</h1>
            <p className="delivery-lede">Review code changes, track checks and follow delivery outcomes.</p>
          </div>
        </header>
        <DeliveryHubNav active="pulls" />
        {bottleneck ? (
          <section className="delivery-stats" aria-label="Review bottlenecks">
            <article className="delivery-stat">
              <span className="delivery-stat__label">Awaiting owner</span>
              <strong className="delivery-stat__value">{bottleneck.awaiting_owner ?? 0}</strong>
              <p className="delivery-stat__hint">No assignee and no requested reviewer</p>
            </article>
            <article className="delivery-stat">
              <span className="delivery-stat__label">Overdue reviews</span>
              <strong className="delivery-stat__value">{bottleneck.overdue ?? 0}</strong>
              <p className="delivery-stat__hint">Past the seven-day review SLA</p>
            </article>
            <article className="delivery-stat">
              <span className="delivery-stat__label">Median age</span>
              <strong className="delivery-stat__value">{typeof bottleneck.median_age_days === 'number' ? `${bottleneck.median_age_days}d` : 'Unknown'}</strong>
              <p className="delivery-stat__hint">
                {bottleneck.delay_known
                  ? `Median approval delay ${bottleneck.median_approval_delay_days ?? 0}d`
                  : 'Approval delay Unknown until first approval time is recorded'}
              </p>
            </article>
          </section>
        ) : null}
        {error ? <div className="alert alert-error">{error}</div> : null}
        <div className="delivery-toolbar delivery-toolbar--pipe">
          <label className="delivery-search">
            <span className="delivery-search__label">Find pull request</span>
            <input
              className="delivery-search__input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, repository, or author"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="delivery-filters delivery-filters--pipe" role="group" aria-label="Risk">
            {([
              ['all', 'All'],
              ['high', 'High'],
              ['medium', 'Medium'],
              ['low', 'Low'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`delivery-filter delivery-filter--${id}${riskFilter === id ? ' is-active' : ''}`}
                onClick={() => setRiskFilter(id)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`delivery-filter delivery-filter--overdue${ageFilter === 'overdue' ? ' is-active' : ''}`}
              onClick={() => setAgeFilter(ageFilter === 'overdue' ? 'all' : 'overdue')}
            >
              Overdue
            </button>
            <button
              type="button"
              className={`delivery-filter delivery-filter--pending${ageFilter === 'awaiting' ? ' is-active' : ''}`}
              onClick={() => setAgeFilter(ageFilter === 'awaiting' ? 'all' : 'awaiting')}
            >
              Awaiting owner
            </button>
          </div>
          {repos.length > 1 ? (
            <label className="delivery-search delivery-search--repo">
              <span className="delivery-search__label">Repository</span>
              <select className="delivery-search__input" value={repoFilter} onChange={(event) => setRepoFilter(event.target.value)} aria-label="Repository">
                <option value="all">All repositories</option>
                {repos.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {loading ? <p className="delivery-empty">Loading pull requests…</p> : null}
        {!loading && items.length === 0 ? (
          <div className="delivery-empty-panel">
            <h2>No open pull requests</h2>
            <p>Connect a repository first, then open PRs appear here for review.</p>
            <Link href="/deploy-intelligence/onboard" className="btn btn-primary">Connect repository</Link>
          </div>
        ) : null}
        {!loading && items.length > 0 && visible.length === 0 ? (
          <p className="delivery-empty">No pull requests match this filter.</p>
        ) : null}
        {!loading && visible.length > 0 ? (
          <section className="delivery-panel">
            <div className="table-scroll">
              <table className="delivery-table">
                <thead>
                  <tr>
                    <th>Pull request</th>
                    <th>Risk</th>
                    <th>CI checks</th>
                    <th>Review age</th>
                    <th>Owner</th>
                    <th>Change request</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const risk = formatRisk(item.score, item.risk_level);
                    const ci = formatCI(item.open_pr?.ci, item.open_pr?.checks);
                    const age = formatReviewAge(item.open_pr?.age_days, item.open_pr?.review_sla);
                    const owner = item.owner || item.repo_owner || '';
                    const repo = item.repo || item.repo_name || '';
                    const href = `/deploy-intelligence/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?pr=${item.pr_number}`;
                    const pipeHref = item.pipeline?.href || pipelinesHref(owner, repo, item.pr_number);
                    return (
                      <tr key={`${owner}/${repo}#${item.pr_number}`}>
                        <td>
                          <Link href={href} className="delivery-pr-link">
                            <span className="delivery-pr-link__title">{item.title || `Pull request #${item.pr_number}`}</span>
                            <span className="delivery-pr-link__meta">#{item.pr_number} · {repo || 'Unknown'} · {item.author || 'Unknown'}</span>
                          </Link>
                        </td>
                        <td>
                          <span className={`delivery-status delivery-status--${risk.band}`}>{risk.label}</span>
                        </td>
                        <td>
                          <span className={`delivery-status delivery-status--${ci.tone}`}>{ci.label}</span>
                        </td>
                        <td>
                          {age.label}
                          {age.overdue ? <span className="delivery-status delivery-status--failed">Overdue</span> : null}
                        </td>
                        <td>
                          {item.open_pr?.awaiting_owner
                            ? <span className="delivery-status delivery-status--pending">Awaiting owner</span>
                            : (item.open_pr?.assignees?.[0] || item.open_pr?.requested_reviewers?.[0] || 'Assigned')}
                        </td>
                        <td>
                          {item.request_id ? <Link href={`/changes/${item.request_id}`}>CHG linked</Link> : 'Not linked'}
                        </td>
                        <td>
                          <div className="delivery-row-actions">
                            <Link href={pipeHref} className="btn btn-secondary btn-sm">Pipelines</Link>
                            <Link href={href} className="btn btn-primary btn-sm">Review</Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {bottleneck?.note ? <p className="delivery-table__hint">{bottleneck.note}</p> : null}
          </section>
        ) : null}
        {!loading && bottleneck?.teams?.length ? (
          <section className="delivery-panel">
            <p className="delivery-table__hint"><strong>Review trends by repository</strong></p>
            <div className="table-scroll">
              <table className="delivery-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Open</th>
                    <th>Awaiting owner</th>
                    <th>Overdue</th>
                    <th>Median age</th>
                    <th>Median approval delay</th>
                  </tr>
                </thead>
                <tbody>
                  {bottleneck.teams.map((team) => (
                    <tr key={team.repository}>
                      <td>{team.repository || 'Unknown'}</td>
                      <td>{team.open ?? 0}</td>
                      <td>{team.awaiting_owner ?? 0}</td>
                      <td>{team.overdue ?? 0}</td>
                      <td>{typeof team.median_age_days === 'number' ? `${team.median_age_days}d` : 'Unknown'}</td>
                      <td>{team.delay_known ? `${team.median_approval_delay_days ?? 0}d` : 'Unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
