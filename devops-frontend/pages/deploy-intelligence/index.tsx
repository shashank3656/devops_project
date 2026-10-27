import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '@infragate/ui';
import DeliveryHubNav from '../../components/DeliveryHubNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  canManageDeliveryRepos,
  formatWhen,
  githubAccessLabel,
  mergeTrackingLabel,
} from '../../lib/delivery';

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
  last_sync_at?: string;
  setup_summary: string;
  github_access?: string;
  merge_tracking?: string;
  needs_attention?: boolean;
}

function repoKey(repo: RepoSummary) {
  return `${repo.owner}/${repo.name}`;
}

export default function DeployIntelligenceIndexPage() {
  const apiUrl = useApiUrl();
  const confirm = useConfirm();
  const canManage = canManageDeliveryRepos();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'connected' | 'attention'>('all');
  const [editingKey, setEditingKey] = useState('');
  const [draftOwner, setDraftOwner] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftBase, setDraftBase] = useState('main');
  const [savingKey, setSavingKey] = useState('');
  const [openMenu, setOpenMenu] = useState('');

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

  const startEdit = (repo: RepoSummary) => {
    setOpenMenu('');
    setEditingKey(repoKey(repo));
    setDraftOwner(repo.owner);
    setDraftName(repo.name);
    setDraftBase(repo.base_branch || 'main');
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
          next_owner: draftOwner,
          next_name: draftName,
          base_branch: draftBase,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The repository could not be updated');
        return;
      }
      setEditingKey('');
      setNotice('Catalog entry updated. GitHub was not renamed.');
      await load();
    } catch {
      setError('The repository could not be updated');
    } finally {
      setSavingKey('');
    }
  };

  const disconnectRepo = async (repo: RepoSummary) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const ok = await confirm({
      title: `Disconnect ${repo.owner}/${repo.name}?`,
      message: 'Disconnect removes the watch list entry only. GitHub is not deleted.',
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
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
        setError(typeof data?.error === 'string' ? data.error : 'The repository could not be disconnected');
        return;
      }
      setNotice('Repository disconnected from the watch list.');
      await load();
    } catch {
      setError('The repository could not be disconnected');
    } finally {
      setSavingKey('');
    }
  };

  const connectedCount = repos.filter((repo) => repo.github_access === 'connected').length;
  const reviewCount = repos.reduce((sum, repo) => sum + (repo.open_pr_count || 0), 0);
  const attentionCount = repos.filter((repo) => repo.needs_attention || repo.merge_tracking !== 'configured' || repo.github_access !== 'connected').length;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return repos.filter((repo) => {
      const attention = repo.needs_attention || repo.merge_tracking !== 'configured' || repo.github_access !== 'connected';
      if (stateFilter === 'connected' && repo.github_access !== 'connected') return false;
      if (stateFilter === 'attention' && !attention) return false;
      if (!needle) return true;
      return `${repo.owner}/${repo.name} ${repo.base_branch}`.toLowerCase().includes(needle);
    });
  }, [repos, query, stateFilter]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Repositories - OpsTrellis</title>
      </Head>
      <div className="delivery-shell">
        <header className="delivery-head">
          <div>
            <p className="delivery-kicker">Delivery</p>
            <h1 className="delivery-title">Repositories</h1>
            <p className="delivery-lede">Review code changes, track checks and follow delivery outcomes.</p>
          </div>
          <Link href="/deploy-intelligence/onboard" className="btn btn-primary">
            Connect repository
          </Link>
        </header>
        <DeliveryHubNav active="repos" />

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <div className="delivery-stats" role="group" aria-label="Delivery summary">
          <article className="delivery-stat">
            <span className="delivery-stat__label">Connected repositories</span>
            <strong className="delivery-stat__value">{loading ? '—' : connectedCount}</strong>
            <p className="delivery-stat__hint">GitHub listed pull requests successfully.</p>
          </article>
          <article className="delivery-stat">
            <span className="delivery-stat__label">PRs needing review</span>
            <strong className="delivery-stat__value">{loading ? '—' : reviewCount}</strong>
            <p className="delivery-stat__hint">Open pull requests on connected repositories.</p>
          </article>
          <article className="delivery-stat">
            <span className="delivery-stat__label">Connections needing attention</span>
            <strong className="delivery-stat__value">{loading ? '—' : attentionCount}</strong>
            <p className="delivery-stat__hint">GitHub failed, paused, or merge tracking is not configured.</p>
          </article>
        </div>

        <div className="delivery-toolbar">
          <label className="delivery-search">
            <span className="delivery-search__label">Find repository</span>
            <input
              className="delivery-search__input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Owner or name"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="delivery-filters" role="group" aria-label="Repository state">
            {(
              [
                ['all', `All (${repos.length})`],
                ['connected', `Connected (${connectedCount})`],
                ['attention', `Needs attention (${attentionCount})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`delivery-filter${stateFilter === value ? ' is-active' : ''}`}
                onClick={() => setStateFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="delivery-panel">
          {loading ? (
            <p className="delivery-empty">Loading repositories…</p>
          ) : repos.length === 0 ? (
            <div className="delivery-empty-panel">
              <h2>No repositories yet</h2>
              <p>Connect a GitHub repository that already exists. Open PRs can load before merge tracking is configured.</p>
              <Link href="/deploy-intelligence/onboard" className="btn btn-primary">Connect repository</Link>
            </div>
          ) : visible.length === 0 ? (
            <p className="delivery-empty">No repositories match this filter.</p>
          ) : (
            <div className="table-scroll">
              <table className="delivery-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Access</th>
                    <th>Merge tracking</th>
                    <th>Open PRs</th>
                    <th>Last sync</th>
                    {canManage ? <th className="delivery-table__actions"> </th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((repo) => {
                    const key = repoKey(repo);
                    const editing = editingKey === key;
                    const busy = savingKey === key;
                    const access = githubAccessLabel(repo.github_access);
                    const tracking = mergeTrackingLabel(repo.merge_tracking);
                    const needsSetup = repo.merge_tracking !== 'configured';
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
                                <input className="input" value={draftOwner} onChange={(event) => setDraftOwner(event.target.value.replace(/\s+/g, ''))} autoComplete="off" disabled={busy} />
                              </label>
                              <label className="label" style={{ margin: 0 }}>
                                Repository
                                <input className="input" value={draftName} onChange={(event) => setDraftName(event.target.value.replace(/\s+/g, ''))} autoComplete="off" disabled={busy} />
                              </label>
                              <label className="label" style={{ margin: 0 }}>
                                Base
                                <input className="input" value={draftBase} onChange={(event) => setDraftBase(event.target.value.replace(/\s+/g, ''))} autoComplete="off" disabled={busy} />
                              </label>
                              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !draftOwner.trim() || !draftName.trim()}>
                                {busy ? 'Saving…' : 'Save'}
                              </button>
                              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditingKey('')}>
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <Link
                              href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
                              className="delivery-repo-link"
                            >
                              <span className="delivery-repo-link__name">{repo.name}</span>
                              <span className="delivery-repo-link__meta">{repo.owner} · {repo.base_branch || 'main'}</span>
                            </Link>
                          )}
                        </td>
                        <td>
                          <span className={`delivery-status delivery-status--${access.tone}`}>{access.label}</span>
                        </td>
                        <td>
                          {needsSetup ? (
                            <div className="delivery-setup">
                              <span className={`delivery-status delivery-status--${tracking.tone}`}>Merge tracking not configured</span>
                              <Link
                                href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}?section=settings`}
                                className="delivery-setup__action"
                              >
                                Complete setup
                              </Link>
                            </div>
                          ) : (
                            <span className={`delivery-status delivery-status--${tracking.tone}`}>{tracking.label}</span>
                          )}
                        </td>
                        <td>{repo.open_pr_count}</td>
                        <td>{formatWhen(repo.last_sync_at || repo.last_merged_at)}</td>
                        {canManage && !editing ? (
                          <td className="delivery-table__actions">
                            <details
                              className="delivery-menu"
                              open={openMenu === key}
                              onToggle={(event) => setOpenMenu((event.target as HTMLDetailsElement).open ? key : '')}
                            >
                              <summary aria-label={`Actions for ${repo.name}`}>⋯</summary>
                              <div className="delivery-menu__panel">
                                <button type="button" disabled={busy} onClick={() => startEdit(repo)}>Edit catalog</button>
                                {needsSetup ? (
                                  <Link href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}?section=settings`}>
                                    Complete setup
                                  </Link>
                                ) : null}
                                <button type="button" disabled={busy} onClick={() => void disconnectRepo(repo)}>Disconnect</button>
                              </div>
                            </details>
                          </td>
                        ) : canManage ? <td /> : null}
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
