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
  webhook_path: string;
}

export default function DeployIntelligenceIndexPage() {
  const apiUrl = useApiUrl();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onboardOwner, setOnboardOwner] = useState('');
  const [onboardName, setOnboardName] = useState('');
  const [onboardBase, setOnboardBase] = useState('main');
  const [onboarding, setOnboarding] = useState(false);

  const repoPreview = useMemo(() => {
    const owner = onboardOwner.trim() || 'owner';
    const name = onboardName.trim() || 'repository';
    const base = onboardBase.trim() || 'main';
    return { owner, name, base, slug: `${owner}/${name}` };
  }, [onboardOwner, onboardName, onboardBase]);

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
      setFuture(Array.isArray(data?.future_capabilities) ? data.future_capabilities : []);
    } catch {
      setError('Failed to load repositories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl]);

  const onboard = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setOnboarding(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/repos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: onboardOwner.trim(),
          name: onboardName.trim(),
          base_branch: onboardBase.trim() || 'main',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Onboard failed');
        return;
      }
      setOnboardOwner('');
      setOnboardName('');
      await load();
    } catch {
      setError('Onboard failed');
    } finally {
      setOnboarding(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Deploy intelligence - DevOps</title>
      </Head>
      <div className="portal-page deploy-intel-page">
        <div className="portal-page__header deploy-intel-page__header">
          <div>
            <span className="portal-page__eyebrow">Deploy intelligence</span>
            <h1 className="portal-page__title">Repository onboarding</h1>
            <p className="portal-page__subtitle deploy-intel-page__lede">
              Connect a GitHub repo once, then analyze open and merged pull requests with risk scoring, CI checks, and
              InfraGate ticket links.
            </p>
            <div className="deploy-intel-page__chips" aria-label="Capabilities">
              <span className="deploy-intel-chip">Open & merged PRs</span>
              <span className="deploy-intel-chip">Branch protection</span>
              <span className="deploy-intel-chip">Deploy frequency</span>
              <span className="deploy-intel-chip">High-risk alerts</span>
            </div>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="deploy-intel-onboard">
          <section className="deploy-intel-onboard__card portal-surface">
            <div className="deploy-intel-onboard__card-head">
              <div>
                <span className="portal-surface__eyebrow">Step 1</span>
                <h2 className="portal-surface__title">Register a repository</h2>
                <p className="portal-surface__subtitle">
                  Use any GitHub org or repo your API token can read. Default env repos still work via{' '}
                  <code>GITHUB_OWNER</code> / <code>GITHUB_REPO</code>.
                </p>
              </div>
              <div className="deploy-intel-onboard__preview" aria-live="polite">
                <span className="deploy-intel-onboard__preview-label">Target</span>
                <strong>{repoPreview.slug}</strong>
                <span className="deploy-intel-onboard__preview-meta">base → {repoPreview.base}</span>
              </div>
            </div>

            <form className="deploy-intel-onboard__form" onSubmit={onboard}>
              <div className="deploy-intel-field-grid">
                <label className="deploy-intel-field">
                  <span className="deploy-intel-field__label">GitHub owner</span>
                  <input
                    className="input deploy-intel-field__input"
                    value={onboardOwner}
                    onChange={(e) => setOnboardOwner(e.target.value)}
                    placeholder="acme-corp"
                    autoComplete="off"
                    required
                  />
                  <span className="deploy-intel-field__hint">Organization or username</span>
                </label>
                <label className="deploy-intel-field">
                  <span className="deploy-intel-field__label">Repository name</span>
                  <input
                    className="input deploy-intel-field__input"
                    value={onboardName}
                    onChange={(e) => setOnboardName(e.target.value)}
                    placeholder="infra-live"
                    autoComplete="off"
                    required
                  />
                  <span className="deploy-intel-field__hint">Without the owner prefix</span>
                </label>
                <label className="deploy-intel-field deploy-intel-field--wide">
                  <span className="deploy-intel-field__label">Production base branch</span>
                  <input
                    className="input deploy-intel-field__input"
                    value={onboardBase}
                    onChange={(e) => setOnboardBase(e.target.value)}
                    placeholder="main"
                    autoComplete="off"
                  />
                  <span className="deploy-intel-field__hint">Used for merge history and production-bound open PR filter</span>
                </label>
              </div>
              <div className="deploy-intel-onboard__actions">
                <button type="submit" className="btn btn-primary" disabled={onboarding}>
                  {onboarding ? 'Onboarding…' : 'Onboard repository'}
                </button>
              </div>
            </form>
          </section>

          <aside className="deploy-intel-onboard__aside">
            <div className="deploy-intel-onboard__aside-card portal-surface">
              <span className="portal-surface__eyebrow">Step 2</span>
              <h3 className="deploy-intel-onboard__aside-title">GitHub webhook</h3>
              <p className="portal-surface__subtitle">
                Add a <code>pull_request</code> webhook on the repo so merges into your base branch are captured
                automatically.
              </p>
              <div className="deploy-intel-onboard__endpoint">
                <span className="deploy-intel-onboard__endpoint-label">POST URL</span>
                <code className="deploy-intel-onboard__endpoint-value">{apiUrl.replace(/\/$/, '')}/api/webhooks/github</code>
              </div>
            </div>
            <div className="deploy-intel-onboard__aside-card portal-surface">
              <span className="portal-surface__eyebrow">After onboard</span>
              <ul className="deploy-intel-onboard__checklist">
                <li>Fetch open PRs live from GitHub</li>
                <li>Score risk from commits, files, and paths</li>
                <li>Verify <code>infragate/plan-review</code> &amp; <code>infragate/policy</code></li>
                <li>Create InfraGate tickets from high-risk PRs</li>
              </ul>
            </div>
          </aside>
        </div>

        <section className="deploy-intel-repos">
          <div className="deploy-intel-repos__head">
            <div>
              <span className="portal-surface__eyebrow">Your repos</span>
              <h2 className="portal-surface__title">Onboarded repositories</h2>
            </div>
            {!loading ? <span className="deploy-intel-repos__count">{repos.length} registered</span> : null}
          </div>

          {loading ? (
            <div className="portal-surface deploy-intel-repos__loading">
              <div className="empty-state">Loading onboarded repositories…</div>
            </div>
          ) : repos.length === 0 ? (
            <div className="portal-surface deploy-intel-repos__empty">
              <p className="deploy-intel-repos__empty-title">No repositories yet</p>
              <p className="portal-surface__subtitle">
                Complete Step 1 above, or configure <code>GITHUB_TOKEN</code> and default repo env vars on the API.
              </p>
            </div>
          ) : (
            <div className="portal-detail-grid">
              {repos.map((repo) => (
                <Link
                  key={`${repo.owner}/${repo.name}`}
                  href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
                  className="portal-detail-card deploy-intel-repo-card"
                >
                  <div className="deploy-intel-repo-card__top">
                    <span className={`ig-chip ig-chip--${repo.ready ? 'ok' : 'medium'}`}>{repo.ready ? 'Ready' : 'Setup'}</span>
                    {repo.open_pr_count > 0 ? (
                      <span className="deploy-intel-repo-card__open">{repo.open_pr_count} open</span>
                    ) : null}
                  </div>
                  <strong className="portal-detail-card__value">
                    {repo.owner}/{repo.name}
                  </strong>
                  <p className="portal-surface__subtitle">{repo.setup_summary}</p>
                  <div className="portal-pill-row deploy-intel-repo-card__stats">
                    <span className="portal-pill">{repo.merge_count} merges</span>
                    <span className="portal-pill">{repo.high_risk_30d} high risk (30d)</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {future.length > 0 ? (
          <section className="portal-surface deploy-intel-roadmap">
            <span className="portal-surface__eyebrow">Roadmap</span>
            <h2 className="portal-surface__title">Coming to each repo</h2>
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
    </DevOpsLayout>
  );
}
