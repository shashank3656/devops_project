import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { InspectorDrawer, useConfirm } from '@infragate/ui';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import {
  canManageDeliveryRepos,
  formatCI,
  formatReviewAge,
  formatRisk,
  formatWhen,
  githubAccessLabel,
  mergeTrackingLabel,
  type DeliveryCheck,
  type DeliveryCISummary,
} from '../../../lib/delivery';

const DEVOPS_TOKEN_KEY = 'devops_token';

type RepoSection = 'open' | 'merges' | 'settings';

interface GitHubFetchMeta {
  configured?: boolean;
  allowed?: boolean;
  ready?: boolean;
  error?: string;
  fetched_at?: string;
  listed?: number;
  total_open?: number;
}

interface RepoMeta {
  owner: string;
  name: string;
  base_branch: string;
  enabled: boolean;
  ready: boolean;
  merge_count: number;
  open_pr_count: number;
  webhook_path?: string;
  setup_summary?: string;
  github_access?: string;
  merge_tracking?: string;
  last_sync_at?: string;
}

interface DeployEvent {
  pr_number: number;
  title: string;
  author: string;
  base_branch: string;
  head_branch: string;
  score: number;
  risk_level: string;
  summary: string;
  pr_url: string;
  request_id?: number;
  commit_count?: number;
  file_count?: number;
  additions?: number;
  deletions?: number;
  merged_at?: string;
  impact?: {
    summary?: string;
    recommended_action?: string;
    files?: { path?: string; category?: string }[];
    blast_radius?: string[];
    stack?: string;
    factors?: { label?: string; detail?: string; severity?: string }[];
    analyzed_at?: string;
  };
  open_pr?: {
    is_draft?: boolean;
    age_days?: number;
    review_sla?: string;
    review_detail?: string;
    checks?: DeliveryCheck[];
    ci?: DeliveryCISummary;
    suggest_ticket?: boolean;
    suggest_ticket_reason?: string;
  };
  github_post?: {
    comment_posted?: boolean;
    check_posted?: boolean;
    error?: string;
    preview?: string;
  };
  change_brief?: {
    markdown?: string;
  };
}

export default function DeployIntelligenceRepoPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const confirm = useConfirm();
  const canManage = canManageDeliveryRepos();
  const owner = typeof router.query.owner === 'string' ? router.query.owner : '';
  const repo = typeof router.query.repo === 'string' ? router.query.repo : '';
  const [section, setSection] = useState<RepoSection>('open');
  const [events, setEvents] = useState<DeployEvent[]>([]);
  const [repoMeta, setRepoMeta] = useState<RepoMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<DeployEvent | null>(null);
  const [refreshPR, setRefreshPR] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [githubMeta, setGithubMeta] = useState<GitHubFetchMeta | null>(null);
  const [githubError, setGithubError] = useState('');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [suggestingTicket, setSuggestingTicket] = useState(false);
  const [ticketMessage, setTicketMessage] = useState('');
  const [query, setQuery] = useState('');
  const [draftOwner, setDraftOwner] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftBase, setDraftBase] = useState('main');
  const [saving, setSaving] = useState(false);

  const load = async (options?: { prNumber?: number; post?: boolean; keepSelection?: boolean; quiet?: boolean }) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !owner || !repo) return;
    if (!options?.quiet) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        owner,
        repo,
        limit: '30',
        section,
      });
      if (section === 'open') {
        params.set('fetch_github', '1');
        if (includeDrafts) params.set('include_drafts', '1');
      }
      if (options?.prNumber && options.prNumber > 0) {
        if (options.post) params.set('refresh_pr', String(options.prNumber));
        else params.set('pr_number', String(options.prNumber));
        if (options.quiet && !options.post) params.set('only', '1');
      }
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to load pull requests');
        return;
      }
      setRepoMeta((current) => data?.repo || current);
      const nextEvents: DeployEvent[] = Array.isArray(data?.events) ? data.events : [];
      if (options?.quiet && options.prNumber) {
        const match = nextEvents.find((item) => item.pr_number === options.prNumber);
        if (match) {
          setEvents((current) => {
            const exists = current.some((item) => item.pr_number === match.pr_number);
            return exists ? current.map((item) => (item.pr_number === match.pr_number ? match : item)) : [match, ...current];
          });
          setSelected(match);
        }
      } else {
        setEvents(nextEvents);
        if (options?.prNumber && options.prNumber > 0) {
          const match = nextEvents.find((item) => item.pr_number === options.prNumber);
          if (match) setSelected(match);
        } else if (!options?.keepSelection) {
          setSelected(null);
        }
      }
      if (data?.github) setGithubMeta(data.github as GitHubFetchMeta);
      setGithubError(typeof data?.github_error === 'string' ? data.github_error : '');
    } catch {
      setError('Failed to load pull requests');
    } finally {
      if (!options?.quiet) setLoading(false);
      setRefreshing(false);
      setPosting(false);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    const requested = router.query.section;
    if (requested === 'merges' || requested === 'settings' || requested === 'open') {
      setSection(requested);
    }
    if (router.query.edit === '1') {
      setSection('settings');
    }
  }, [router.isReady, router.query.section, router.query.edit]);

  useEffect(() => {
    if (!owner || !repo) return;
    setDraftOwner(owner);
    setDraftName(repo);
    setDraftBase(repoMeta?.base_branch || 'main');
  }, [owner, repo, repoMeta?.base_branch]);

  useEffect(() => {
    if (!router.isReady || !owner || !repo) return;
    const raw = router.query.pr;
    const prNumber = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
    void load({
      prNumber: section === 'open' && prNumber > 0 ? prNumber : undefined,
      keepSelection: prNumber > 0,
    });
  }, [apiUrl, router.isReady, owner, repo, section, includeDrafts, router.query.pr]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return events;
    return events.filter((item) => `${item.title} #${item.pr_number} ${item.author}`.toLowerCase().includes(needle));
  }, [events, query]);

  const access = githubAccessLabel(repoMeta?.github_access);
  const tracking = mergeTrackingLabel(repoMeta?.merge_tracking);
  const openCount = repoMeta?.open_pr_count ?? (section === 'open' ? events.length : 0);
  const mergeCount = repoMeta?.merge_count ?? (section === 'merges' ? events.length : 0);
  const tokenFailure = !loading && githubMeta != null && githubMeta.configured === false;
  const githubFailed = !loading && githubMeta != null && githubMeta.configured !== false && (githubMeta.allowed === false || Boolean(githubError));

  const reviewEvent = (item: DeployEvent) => {
    setSelected(item);
    setTicketMessage('');
    if (section === 'open') void load({ prNumber: item.pr_number, keepSelection: true, quiet: true });
  };

  const postGitHubComment = async (item: DeployEvent) => {
    setPosting(true);
    await load({ prNumber: item.pr_number, post: true, keepSelection: true });
  };

  const importMergedPR = async () => {
    const number = Number(refreshPR);
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!number || !token || !owner || !repo) return;
    setRefreshing(true);
    setError('');
    try {
      const params = new URLSearchParams({
        owner,
        repo,
        limit: '100',
        section: 'merges',
        refresh_pr: String(number),
      });
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'The merged PR could not be imported');
        return;
      }
      setSection('merges');
      setRepoMeta(data?.repo || null);
      const nextEvents: DeployEvent[] = Array.isArray(data?.events) ? data.events : [];
      setEvents(nextEvents);
      const match = nextEvents.find((item) => item.pr_number === number);
      if (match) setSelected(match);
    } catch {
      setError('The merged PR could not be imported');
    } finally {
      setRefreshing(false);
    }
  };

  const suggestTicket = async (prNumber: number, acknowledged = false) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSuggestingTicket(true);
    setTicketMessage('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/suggest-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, name: repo, pr_number: prNumber, acknowledged, reasons: [] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTicketMessage(typeof data?.error === 'string' ? data.error : 'The change request could not be created.');
        return;
      }
      setTicketMessage(typeof data?.message === 'string' ? data.message : 'Change request created.');
      await load({ prNumber, keepSelection: true });
    } catch {
      setTicketMessage('The change request could not be created.');
    } finally {
      setSuggestingTicket(false);
    }
  };

  const saveEdit = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/repos`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          name: repo,
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
      setNotice('Catalog entry updated. GitHub was not renamed.');
      await router.replace(`/deploy-intelligence/${encodeURIComponent(draftOwner)}/${encodeURIComponent(draftName)}?section=settings`);
    } catch {
      setError('The repository could not be updated');
    } finally {
      setSaving(false);
    }
  };

  const disconnectRepo = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const ok = await confirm({
      title: `Disconnect ${owner}/${repo}?`,
      message: 'Disconnect removes the watch list entry only. GitHub is not deleted.',
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/repos`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, name: repo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The repository could not be disconnected');
        return;
      }
      await router.push('/deploy-intelligence');
    } catch {
      setError('The repository could not be disconnected');
    } finally {
      setSaving(false);
    }
  };

  const risk = selected ? formatRisk(selected.score, selected.risk_level) : null;
  const checks = selected ? formatCI(selected.open_pr?.ci, selected.open_pr?.checks) : null;
  const commentPreview = selected?.change_brief?.markdown || selected?.github_post?.preview || selected?.summary || '';

  return (
    <DevOpsLayout>
      <Head>
        <title>{repo || 'Repository'} - OpsTrellis</title>
      </Head>
      <div className="delivery-shell">
        <Link href="/deploy-intelligence" className="delivery-back">Repositories</Link>
        <header className="delivery-head delivery-head--repo">
          <div>
            <p className="delivery-kicker">Delivery</p>
            <h1 className="delivery-title">{repo || 'Repository'}</h1>
            <p className="delivery-meta">
              {owner || 'Unknown'} · {repoMeta?.base_branch || 'main'} · {access.label} · {tracking.label}
            </p>
          </div>
          {canManage ? (
            <details className="delivery-menu delivery-menu--icon">
              <summary aria-label="Repository actions">⋯</summary>
              <div className="delivery-menu__panel">
                <button
                  type="button"
                  onClick={() => {
                    setDraftOwner(owner);
                    setDraftName(repo);
                    setDraftBase(repoMeta?.base_branch || 'main');
                    setSection('settings');
                    void router.replace(
                      `/deploy-intelligence/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?section=settings&edit=1`,
                      undefined,
                      { shallow: true },
                    );
                  }}
                >
                  Edit catalog
                </button>
                <button type="button" onClick={() => void disconnectRepo()}>Disconnect</button>
              </div>
            </details>
          ) : null}
        </header>

        <div className="delivery-subtabs" role="tablist" aria-label="Repository views">
          {(
            [
              ['open', `Open PRs (${openCount})`],
              ['merges', `Merged analyses (${mergeCount})`],
              ['settings', 'Settings'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`delivery-subtab${section === id ? ' is-active' : ''}`}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {tokenFailure ? (
          <div className="alert alert-error">GitHub access failed. Configure GITHUB_TOKEN on the API so pull requests can be listed.</div>
        ) : null}
        {githubFailed && !tokenFailure ? (
          <div className="alert alert-error">{githubError || 'GitHub access failed for this repository.'}</div>
        ) : null}

        {section !== 'settings' ? (
          <div className="delivery-toolbar delivery-toolbar--repo">
            <label className="delivery-search">
              <input
                className="delivery-search__input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find pull request"
                aria-label="Find pull request"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {section === 'open' ? (
              <label className="delivery-check">
                <input type="checkbox" checked={includeDrafts} onChange={(event) => setIncludeDrafts(event.target.checked)} />
                Include drafts
              </label>
            ) : (
              <details className="delivery-menu delivery-menu--action">
                <summary>Import merged PR</summary>
                <div className="delivery-menu__panel delivery-menu__panel--form">
                  <label className="label">
                    PR number
                    <input className="input" value={refreshPR} onChange={(event) => setRefreshPR(event.target.value.replace(/[^\d]/g, ''))} />
                  </label>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!refreshPR || refreshing} onClick={() => void importMergedPR()}>
                    {refreshing ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </details>
            )}
          </div>
        ) : null}

        {section === 'settings' ? (
          <section className="delivery-panel">
            <h2 className="delivery-panel__title">Connection</h2>
            <dl className="delivery-facts">
              <div>
                <dt>GitHub access</dt>
                <dd><span className={`delivery-status delivery-status--${access.tone}`}>{access.label}</span></dd>
              </div>
              <div>
                <dt>Merge tracking</dt>
                <dd><span className={`delivery-status delivery-status--${tracking.tone}`}>{tracking.label}</span></dd>
              </div>
              <div>
                <dt>Last sync</dt>
                <dd>{formatWhen(repoMeta?.last_sync_at || githubMeta?.fetched_at)}</dd>
              </div>
              <div>
                <dt>Webhook</dt>
                <dd><code>{repoMeta?.webhook_path || '/api/webhooks/github'}</code></dd>
              </div>
            </dl>
            {repoMeta?.merge_tracking !== 'configured' ? (
              <div className="delivery-empty-panel">
                <h2>Complete merge tracking</h2>
                <p>
                  Open PRs can load from GitHub without this step. Add a GitOps project so merges into {repoMeta?.base_branch || 'main'} are captured automatically.
                </p>
                <div className="portal-page__actions">
                  <Link href="/gitops-projects" className="btn btn-primary">Open GitOps projects</Link>
                  <Link href="/operations/webhooks" className="btn btn-secondary">Webhook settings</Link>
                </div>
              </div>
            ) : (
              <p className="delivery-empty">Merges into {repoMeta?.base_branch || 'main'} are captured automatically.</p>
            )}
            {canManage ? (
              <form
                className="delivery-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveEdit();
                }}
              >
                <h2 className="delivery-panel__title">Catalog</h2>
                <p className="delivery-lede">Updates the OpsTrellis watch list only. GitHub is not renamed.</p>
                <label className="label">
                  Owner
                  <input className="input" value={draftOwner} onChange={(event) => setDraftOwner(event.target.value.replace(/\s+/g, ''))} autoComplete="off" />
                </label>
                <label className="label">
                  Repository
                  <input className="input" value={draftName} onChange={(event) => setDraftName(event.target.value.replace(/\s+/g, ''))} autoComplete="off" />
                </label>
                <label className="label">
                  Base branch
                  <input className="input" value={draftBase} onChange={(event) => setDraftBase(event.target.value.replace(/\s+/g, ''))} autoComplete="off" />
                </label>
                <div className="portal-page__actions">
                  <button type="submit" className="btn btn-primary" disabled={saving || !draftOwner.trim() || !draftName.trim()}>
                    {saving ? 'Saving…' : 'Save catalog'}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        ) : loading ? (
          <p className="delivery-empty">Loading pull requests…</p>
        ) : visible.length === 0 ? (
          <div className="delivery-empty-panel">
            <h2>{section === 'open' ? 'No open pull requests' : 'No merged analyses yet'}</h2>
            <p>
              {section === 'open'
                ? 'GitHub returned no open PRs for this repository and filter.'
                : 'Merged analyses appear after a production merge is tracked, or after you import a merged PR.'}
            </p>
          </div>
        ) : (
          <section className="delivery-panel">
            <div className="table-scroll">
              <table className="delivery-table">
                <thead>
                  <tr>
                    <th>Pull request</th>
                    <th>Risk</th>
                    <th>{section === 'open' ? 'CI checks' : 'Merged'}</th>
                    <th>{section === 'open' ? 'Review age' : 'Branch'}</th>
                    <th>Change request</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const itemRisk = formatRisk(item.score, item.risk_level);
                    const itemCI = formatCI(item.open_pr?.ci, item.open_pr?.checks);
                    const age = formatReviewAge(item.open_pr?.age_days, item.open_pr?.review_sla);
                    return (
                      <tr key={item.pr_number}>
                        <td>
                          <button type="button" className="delivery-pr-link" onClick={() => reviewEvent(item)}>
                            <span className="delivery-pr-link__title">{item.title || `Pull request #${item.pr_number}`}</span>
                            <span className="delivery-pr-link__meta">#{item.pr_number} · {item.author || 'Unknown'}</span>
                          </button>
                        </td>
                        <td>
                          <span className={`delivery-status delivery-status--${itemRisk.band}`} title={`${itemRisk.scale}. ${itemRisk.note}`}>
                            {itemRisk.label}
                          </span>
                        </td>
                        <td>
                          {section === 'open' ? (
                            <span className={`delivery-status delivery-status--${itemCI.tone}`}>{itemCI.label}</span>
                          ) : (
                            <span className="delivery-status delivery-status--unknown">{formatWhen(item.merged_at)}</span>
                          )}
                        </td>
                        <td>
                          {section === 'open' ? (
                            <>
                              <span>{age.label}</span>
                              {age.overdue ? <span className="delivery-status delivery-status--failed">Overdue</span> : null}
                            </>
                          ) : (
                            <span>{item.head_branch || '—'}</span>
                          )}
                        </td>
                        <td>
                          {item.request_id ? (
                            <Link href={`/changes/${item.request_id}`}>CHG linked</Link>
                          ) : (
                            <span className="delivery-status delivery-status--unknown">Not linked</span>
                          )}
                        </td>
                        <td>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => reviewEvent(item)}>
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <InspectorDrawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        wide
        resetKey={selected?.pr_number}
        eyebrow="Pull request review"
        title={selected ? `#${selected.pr_number} ${selected.title}` : 'Pull request'}
        subtitle={selected ? `${selected.author || 'Unknown'} · ${selected.head_branch || 'branch'} → ${selected.base_branch || 'base'}` : ''}
        footer={selected ? (
          <div className="delivery-drawer-actions">
            {selected.pr_url ? (
              <a className="btn btn-secondary" href={selected.pr_url} target="_blank" rel="noreferrer">Open on GitHub</a>
            ) : null}
            {section === 'open' ? (
              <button type="button" className="btn btn-primary" disabled={posting} onClick={() => void postGitHubComment(selected)}>
                {posting ? 'Posting…' : 'Post GitHub comment'}
              </button>
            ) : null}
          </div>
        ) : null}
      >
        {selected && risk && checks ? (
          <div className="delivery-drawer">
            <section>
              <h3>Summary</h3>
              <p>{selected.impact?.summary || selected.summary || 'No summary yet.'}</p>
              <p className="delivery-table__hint">{risk.note} {selected.impact?.recommended_action || ''}</p>
            </section>
            <section>
              <h3>Risk evidence</h3>
              <p><strong>{risk.label}</strong> · {risk.scale}</p>
              {(selected.impact?.files || []).length ? (
                <ul>
                  {(selected.impact?.files || []).slice(0, 8).map((file) => (
                    <li key={file.path}>{file.path}{file.category ? ` · ${file.category}` : ''}</li>
                  ))}
                </ul>
              ) : (
                <p>No file evidence stored yet.</p>
              )}
              {selected.impact?.analyzed_at ? <p className="delivery-table__hint">Analyzed {formatWhen(selected.impact.analyzed_at)}</p> : null}
            </section>
            <section>
              <h3>Checks</h3>
              <p><span className={`delivery-status delivery-status--${checks.tone}`}>{checks.label}</span></p>
              {(selected.open_pr?.checks || []).length ? (
                <ul>
                  {(selected.open_pr?.checks || []).map((check) => {
                    const status = check.status === 'ok' ? 'passed' : (check.status || 'unknown');
                    return (
                      <li key={check.key || check.label}>
                        {check.label}: {status}{check.detail ? ` — ${check.detail}` : ''}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>No GitHub checks on this commit.</p>
              )}
              {selected.open_pr?.review_detail ? <p>{selected.open_pr.review_detail}</p> : null}
            </section>
            <section>
              <h3>Change request</h3>
              {selected.request_id ? (
                <p><Link href={`/changes/${selected.request_id}`}>Open linked change</Link></p>
              ) : (
                <div>
                  <p>Not linked. A low risk score does not approve a release.</p>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={suggestingTicket} onClick={() => void suggestTicket(selected.pr_number)}>
                    {suggestingTicket ? 'Creating…' : 'Create change request'}
                  </button>
                  {ticketMessage ? <p>{ticketMessage}</p> : null}
                </div>
              )}
            </section>
            <section>
              <h3>Technical details</h3>
              <p>
                {selected.commit_count || 0} commits · {selected.file_count || 0} files · +{selected.additions || 0} / −{selected.deletions || 0}
              </p>
              <p>Head: {selected.head_branch || 'Unknown'}</p>
              {selected.impact?.stack ? <p>Detected stack: {selected.impact.stack}</p> : null}
            </section>
            <section>
              <h3>Preview GitHub comment</h3>
              <pre className="delivery-preview">{commentPreview || 'No comment preview yet.'}</pre>
              {selected.github_post?.error ? <p className="delivery-table__hint">{selected.github_post.error}</p> : null}
            </section>
          </div>
        ) : null}
      </InspectorDrawer>
    </DevOpsLayout>
  );
}
