import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DeliveryHubNav from '../../components/DeliveryHubNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface RepoSummary {
  id: number;
  owner: string;
  name: string;
  base_branch: string;
  enabled: boolean;
  ready: boolean;
  merge_count: number;
  high_risk_30d: number;
  open_pr_count: number;
  last_merged_at?: string;
  setup_summary: string;
}

function formatLastMerged(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DeployIntelligenceIndexPage() {
  const apiUrl = useApiUrl();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'ready' | 'setup'>('all');

  const load = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to load repositories');
        return;
      }
      setRepos(Array.isArray(data?.repos) ? data.repos : []);
    } catch {
      setError('Failed to load repositories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl]);

  const readyCount = repos.filter((repo) => repo.ready).length;
  const setupCount = repos.length - readyCount;
  const openPrCount = repos.reduce((sum, repo) => sum + (repo.open_pr_count || 0), 0);
  const mergeCount = repos.reduce((sum, repo) => sum + (repo.merge_count || 0), 0);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return repos.filter((repo) => {
      if (stateFilter === 'ready' && !repo.ready) return false;
      if (stateFilter === 'setup' && repo.ready) return false;
      if (!needle) return true;
      return `${repo.owner}/${repo.name} ${repo.base_branch}`.toLowerCase().includes(needle);
    });
  }, [repos, query, stateFilter]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Deploy intelligence - OpsTrellis</title>
      </Head>
      <div className="di-page di-page--catalog">
        <header className="di-page__head di-page__head--split">
          <div>
            <p className="di-kicker">Deploy intelligence</p>
            <h1 className="di-title">Repositories</h1>
            <p className="di-lede">
              Onboarded GitHub repos and their deploy risk. Open a row to review merges and pull requests.
            </p>
          </div>
          <Link href="/deploy-intelligence/onboard" className="btn btn-primary">
            Onboard
          </Link>
        </header>
        <DeliveryHubNav active="repos" />

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="k8s-summary-strip">
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Repos</span>
            <strong className="k8s-summary-card__value">{repos.length}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Ready</span>
            <strong className="k8s-summary-card__value">{readyCount}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Setup</span>
            <strong className="k8s-summary-card__value">{setupCount}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Open PRs</span>
            <strong className="k8s-summary-card__value">{openPrCount}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Merges</span>
            <strong className="k8s-summary-card__value">{mergeCount}</strong>
          </div>
        </div>

        <div className="di-toolbar">
          <label className="di-search">
            <span className="di-label">Find repository</span>
            <input
              className="di-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search owner or name"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="di-filters" role="group" aria-label="Repository state">
            {(
              [
                ['all', `All (${repos.length})`],
                ['ready', `Ready (${readyCount})`],
                ['setup', `Setup (${setupCount})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`di-filter${stateFilter === value ? ' is-active' : ''}`}
                onClick={() => setStateFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="di-list">
          {loading ? (
            <p className="di-empty">Loading repositories…</p>
          ) : repos.length === 0 ? (
            <div className="di-empty-panel">
              <h2 className="di-empty-panel__title">No repositories yet</h2>
              <p className="di-empty-panel__copy">
                Onboard a GitHub repository to start analyzing open and merged pull requests.
              </p>
              <Link href="/deploy-intelligence/onboard" className="btn btn-primary">
                Onboard
              </Link>
            </div>
          ) : visible.length === 0 ? (
            <p className="di-empty">No repositories match this filter.</p>
          ) : (
            <div className="table-scroll">
              <table className="templates-table k8s-data-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Base</th>
                    <th>Open PRs</th>
                    <th>Merges</th>
                    <th>Last merge</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((repo) => (
                    <tr key={`${repo.owner}/${repo.name}`}>
                      <td>
                        <Link
                          href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
                          className="k8s-link-cell"
                        >
                          <span className="k8s-link-cell__title">
                            {repo.owner}/{repo.name}
                          </span>
                          <span className="k8s-link-cell__meta">{repo.setup_summary || 'Open to review PRs and merges'}</span>
                        </Link>
                      </td>
                      <td>{repo.base_branch || 'main'}</td>
                      <td>{repo.open_pr_count}</td>
                      <td>{repo.merge_count}</td>
                      <td>{formatLastMerged(repo.last_merged_at)}</td>
                      <td>
                        <span className={`ig-chip ig-chip--${repo.ready ? 'low' : 'medium'}`}>
                          {repo.ready ? 'Ready' : 'Setup'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
