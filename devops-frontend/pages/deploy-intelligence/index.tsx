import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
        <title>Deploy intelligence - DevOps</title>
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
          <Link href="/deploy-intelligence/onboard" className="di-cta">
            Onboard repository
          </Link>
        </header>

        {error ? <div className="alert alert-error">{error}</div> : null}

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
              <Link href="/deploy-intelligence/onboard" className="di-cta">
                Onboard repository
              </Link>
            </div>
          ) : visible.length === 0 ? (
            <p className="di-empty">No repositories match this filter.</p>
          ) : (
            <>
              <div className="di-table-head" aria-hidden>
                <span>Name</span>
                <span>Base</span>
                <span>Open PRs</span>
                <span>Merges</span>
                <span>Last merge</span>
                <span>State</span>
              </div>
              <ul className="di-rows">
                {visible.map((repo) => (
                  <li key={`${repo.owner}/${repo.name}`}>
                    <Link
                      href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
                      className="di-row di-row--catalog"
                    >
                      <span className="di-row__name">
                        {repo.owner}/{repo.name}
                      </span>
                      <span className="di-row__branch">{repo.base_branch || 'main'}</span>
                      <span className="di-row__stat">{repo.open_pr_count}</span>
                      <span className="di-row__stat">{repo.merge_count}</span>
                      <span className="di-row__stat">{formatLastMerged(repo.last_merged_at)}</span>
                      <span className={`di-row__status ${repo.ready ? 'is-ready' : 'is-setup'}`}>
                        {repo.ready ? 'Ready' : 'Setup'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
