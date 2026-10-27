import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '@infragate/ui';
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

function canManageRepos(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('devops_user');
    const user = raw ? (JSON.parse(raw) as { role?: string; devops_profile?: { is_manager?: boolean } }) : null;
    return user?.role === 'admin' || Boolean(user?.devops_profile?.is_manager);
  } catch {
    return false;
  }
}

export default function DeployIntelligenceIndexPage() {
  const apiUrl = useApiUrl();
  const confirm = useConfirm();
  const canManage = canManageRepos();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'ready' | 'setup'>('all');
  const [editingKey, setEditingKey] = useState('');
  const [draftOwner, setDraftOwner] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftBase, setDraftBase] = useState('main');
  const [savingKey, setSavingKey] = useState('');

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

  const repoKey = (repo: RepoSummary) => `${repo.owner}/${repo.name}`;

  const startEdit = (repo: RepoSummary) => {
    setEditingKey(repoKey(repo));
    setDraftOwner(repo.owner);
    setDraftName(repo.name);
    setDraftBase(repo.base_branch || 'main');
    setError('');
    setNotice('');
  };

  const saveEdit = async (repo: RepoSummary) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const key = repoKey(repo);
    setSavingKey(key);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/repos`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: repo.owner,
          name: repo.name,
          new_owner: draftOwner.trim(),
          new_name: draftName.trim(),
          base_branch: draftBase.trim() || 'main',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || (res.status === 404 ? 'Repository not found' : 'The catalog could not be updated'));
        return;
      }
      setEditingKey('');
      setNotice(data?.note || 'Catalog repository updated. The GitHub repository was not renamed or deleted.');
      await load();
    } catch {
      setError('The catalog could not be updated');
    } finally {
      setSavingKey('');
    }
  };

  const disconnectRepo = async (repo: RepoSummary) => {
    const ok = await confirm({
      title: 'Disconnect repository',
      message: `Disconnect ${repo.owner}/${repo.name} from OpsTrellis?`,
      detailLines: [
        'This removes the watch list entry for pipelines, open PRs, and merged PRs.',
        'The GitHub repository is not deleted.',
      ],
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const key = repoKey(repo);
    setSavingKey(key);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/repos`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: repo.owner, name: repo.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'The repository could not be disconnected');
        return;
      }
      setNotice(data?.note || 'Disconnected from OpsTrellis. The GitHub repository was not deleted.');
      await load();
    } catch {
      setError('The repository could not be disconnected');
    } finally {
      setSavingKey('');
    }
  };

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
              Watch onboarded GitHub repos for open PRs, merged PRs, and related pipelines. Disconnect removes the watch list entry only. GitHub is not deleted.
            </p>
          </div>
          <Link href="/deploy-intelligence/onboard" className="btn btn-primary">
            Onboard
          </Link>
        </header>
        <DeliveryHubNav active="repos" />

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

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
                    {canManage ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((repo) => {
                    const key = repoKey(repo);
                    const editing = editingKey === key;
                    const busy = savingKey === key;
                    return (
                    <tr key={key}>
                      <td>
                        {editing ? (
                          <form
                            className="portal-page__actions"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveEdit(repo);
                            }}
                          >
                            <label className="label" style={{ margin: 0 }}>
                              Owner
                              <input
                                className="input"
                                value={draftOwner}
                                onChange={(event) => setDraftOwner(event.target.value.replace(/\s+/g, ''))}
                                autoComplete="off"
                                disabled={busy}
                              />
                            </label>
                            <label className="label" style={{ margin: 0 }}>
                              Repository
                              <input
                                className="input"
                                value={draftName}
                                onChange={(event) => setDraftName(event.target.value.replace(/\s+/g, ''))}
                                autoComplete="off"
                                disabled={busy}
                              />
                            </label>
                          </form>
                        ) : (
                          <Link
                            href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
                            className="k8s-link-cell"
                          >
                            <span className="k8s-link-cell__title">
                              {repo.owner}/{repo.name}
                            </span>
                            <span className="k8s-link-cell__meta">{repo.setup_summary || 'Open to review PRs and merges'}</span>
                          </Link>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            className="input"
                            value={draftBase}
                            onChange={(event) => setDraftBase(event.target.value.replace(/\s+/g, ''))}
                            autoComplete="off"
                            disabled={busy}
                          />
                        ) : (
                          repo.base_branch || 'main'
                        )}
                      </td>
                      <td>{repo.open_pr_count}</td>
                      <td>{repo.merge_count}</td>
                      <td>{formatLastMerged(repo.last_merged_at)}</td>
                      <td>
                        <span className={`ig-chip ig-chip--${repo.ready ? 'low' : 'medium'}`}>
                          {repo.ready ? 'Ready' : 'Setup'}
                        </span>
                      </td>
                      {canManage ? (
                        <td>
                          <div className="portal-page__actions">
                            {editing ? (
                              <>
                                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !draftOwner.trim() || !draftName.trim()} onClick={() => void saveEdit(repo)}>
                                  {busy ? 'Saving…' : 'Save'}
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditingKey('')}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => startEdit(repo)}>
                                  Edit
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void disconnectRepo(repo)}>
                                  Disconnect
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
