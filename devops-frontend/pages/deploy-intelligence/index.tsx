import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Deploy</span>
            <h1 className="portal-page__title">Repository onboarding</h1>
            <p className="portal-page__subtitle">
              Register a GitHub repository first, then open it to analyze merged and open pull requests—commit volume, diff size, sensitive paths, InfraGate request links, branch protection for{' '}
              <code>infragate/plan-review</code> and <code>infragate/policy</code>, and weekly deploy frequency from merge history.
            </p>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="portal-surface" style={{ marginBottom: 24 }}>
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Onboard</span>
              <h2 className="portal-surface__title">Add a repository</h2>
              <p className="portal-surface__subtitle">
                Managers can register repos beyond the default <code>GITHUB_OWNER/GITHUB_REPO</code>. Point GitHub <code>pull_request</code> webhooks to{' '}
                <code>/api/webhooks/github</code>.
              </p>
            </div>
          </div>
          <form className="portal-toolbar" onSubmit={onboard}>
            <label className="portal-toolbar__item">
              <span className="credential-audit-label">Owner</span>
              <input className="input" value={onboardOwner} onChange={(e) => setOnboardOwner(e.target.value)} placeholder="acme-corp" required />
            </label>
            <label className="portal-toolbar__item">
              <span className="credential-audit-label">Repository</span>
              <input className="input" value={onboardName} onChange={(e) => setOnboardName(e.target.value)} placeholder="infra-live" required />
            </label>
            <label className="portal-toolbar__item">
              <span className="credential-audit-label">Production base branch</span>
              <input className="input" value={onboardBase} onChange={(e) => setOnboardBase(e.target.value)} placeholder="main" />
            </label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={onboarding}>
              {onboarding ? 'Onboarding…' : 'Onboard repo'}
            </button>
          </form>
        </section>

        {loading ? (
          <div className="portal-surface">
            <div className="empty-state">Loading onboarded repositories…</div>
          </div>
        ) : (
          <div className="portal-detail-grid">
            {repos.map((repo) => (
              <Link
                key={`${repo.owner}/${repo.name}`}
                href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
                className="portal-detail-card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span className="portal-surface__eyebrow">{repo.ready ? 'Ready' : 'Setup needed'}</span>
                <strong className="portal-detail-card__value">
                  {repo.owner}/{repo.name}
                </strong>
                <p className="portal-surface__subtitle">{repo.setup_summary}</p>
                <div className="portal-pill-row" style={{ marginTop: 12 }}>
                  <span className="portal-pill">{repo.merge_count} merges</span>
                  <span className="portal-pill">{repo.open_pr_count} open PRs</span>
                  <span className="portal-pill">{repo.high_risk_30d} high risk (30d)</span>
                </div>
              </Link>
            ))}
            {repos.length === 0 ? (
              <div className="portal-surface">
                <p className="portal-surface__subtitle">No repositories registered yet. Onboard one above or configure GitHub env vars on the API.</p>
              </div>
            ) : null}
          </div>
        )}

        {future.length > 0 ? (
          <section className="portal-surface" style={{ marginTop: 24 }}>
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Roadmap</span>
                <h2 className="portal-surface__title">Planned inside each repo</h2>
              </div>
            </div>
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
