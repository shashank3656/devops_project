import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DeliveryHubNav from '../components/DeliveryHubNav';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { formatCI, formatReviewAge, formatRisk, type DeliveryCheck, type DeliveryCISummary } from '../lib/delivery';

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
    checks?: DeliveryCheck[];
    ci?: DeliveryCISummary;
  };
}

export default function PullRequestsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<OpenPR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

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
        if (!res.ok) throw new Error(data?.error || 'Failed to load pull requests');
        const events = Array.isArray(data?.events) ? data.events : [];
        if (!cancelled) {
          setItems(events.map((event: OpenPR) => ({
            ...event,
            owner: event.owner || event.repo_owner,
            repo: event.repo || event.repo_name,
          })));
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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.title} ${item.repo} ${item.author} #${item.pr_number}`.toLowerCase().includes(needle));
  }, [items, query]);

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
        {error ? <div className="alert alert-error">{error}</div> : null}
        <div className="delivery-toolbar">
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
        </div>
        {loading ? <p className="delivery-empty">Loading pull requests…</p> : null}
        {!loading && items.length === 0 ? (
          <div className="delivery-empty-panel">
            <h2>No open pull requests</h2>
            <p>Connect a repository first, then open PRs appear here for review.</p>
            <Link href="/deploy-intelligence/onboard" className="btn btn-primary">Connect repository</Link>
          </div>
        ) : null}
        {!loading && items.length > 0 ? (
          <section className="delivery-panel">
            <div className="table-scroll">
              <table className="delivery-table">
                <thead>
                  <tr>
                    <th>Pull request</th>
                    <th>Risk</th>
                    <th>CI checks</th>
                    <th>Review age</th>
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
                          {item.request_id ? <Link href={`/changes/${item.request_id}`}>CHG linked</Link> : 'Not linked'}
                        </td>
                        <td>
                          <Link href={href} className="btn btn-primary btn-sm">Review</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
