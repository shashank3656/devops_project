import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface GitOpsProjectOption {
  id: number;
  name: string;
  slug?: string;
  github_owner?: string;
  github_repo?: string;
  base_branch?: string;
}

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

function splitRepoInput(raw: string): { owner: string; name: string } | null {
  const value = raw.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '');
  const parts = value.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], name: parts[1] };
  }
  return null;
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
  const [onboardProjectId, setOnboardProjectId] = useState('');
  const [projects, setProjects] = useState<GitOpsProjectOption[]>([]);
  const [onboarding, setOnboarding] = useState(false);
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/github`;
  const canSubmit = onboardOwner.trim().length > 0 && onboardName.trim().length > 0 && !onboarding;

  const target = useMemo(() => {
    const owner = onboardOwner.trim();
    const name = onboardName.trim();
    const base = onboardBase.trim() || 'main';
    if (!owner && !name) return '';
    return `${owner || '…'}/${name || '…'} → ${base}`;
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
      setProjects(Array.isArray(data?.projects) ? data.projects : []);
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

  const applyOwnerChange = (value: string) => {
    const split = splitRepoInput(value);
    if (split) {
      setOnboardOwner(split.owner);
      setOnboardName(split.name);
      return;
    }
    setOnboardOwner(value.replace(/\s+/g, ''));
  };

  const onboard = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !canSubmit) return;
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
          project_id: onboardProjectId ? Number(onboardProjectId) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Onboard failed');
        return;
      }
      setOnboardOwner('');
      setOnboardName('');
      setOnboardBase('main');
      setOnboardProjectId('');
      await load();
    } catch {
      setError('Onboard failed');
    } finally {
      setOnboarding(false);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Deploy intelligence - DevOps</title>
      </Head>
      <div className="di-page">
        <header className="di-page__head">
          <p className="di-kicker">Deploy intelligence</p>
          <h1 className="di-title">Connect a GitHub repository</h1>
          <p className="di-lede">
            Connect a repo, then see what each PR changes and why it is risky. InfraGate also posts that brief on the
            GitHub PR.
          </p>
        </header>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <form className="di-form" onSubmit={onboard}>
          {projects.length > 0 ? (
            <label className="di-project">
              <span className="di-label">GitOps project</span>
              <select
                className="di-input"
                value={onboardProjectId}
                onChange={(e) => {
                  const next = e.target.value;
                  setOnboardProjectId(next);
                  const project = projects.find((item) => String(item.id) === next);
                  if (!project) return;
                  if (project.github_owner) setOnboardOwner(project.github_owner);
                  if (project.github_repo) setOnboardName(project.github_repo);
                  if (project.base_branch) setOnboardBase(project.base_branch);
                }}
              >
                <option value="">Optional — pick a project to fill owner/repo</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.github_owner && project.github_repo
                      ? ` · ${project.github_owner}/${project.github_repo}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="di-form__row">
            <div className="di-path" role="group" aria-label="GitHub repository">
              <label className="di-path__part">
                <span className="di-label">Owner</span>
                <input
                  className="di-input"
                  value={onboardOwner}
                  onChange={(e) => applyOwnerChange(e.target.value)}
                  placeholder="acme-corp"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <span className="di-path__slash" aria-hidden>
                /
              </span>
              <label className="di-path__part">
                <span className="di-label">Repository</span>
                <input
                  className="di-input"
                  value={onboardName}
                  onChange={(e) => setOnboardName(e.target.value.replace(/\s+/g, ''))}
                  placeholder="infra-live"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
            </div>

            <label className="di-branch">
              <span className="di-label">Base branch</span>
              <input
                className="di-input"
                value={onboardBase}
                onChange={(e) => setOnboardBase(e.target.value.replace(/\s+/g, ''))}
                placeholder="main"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <button type="submit" className="di-submit" disabled={!canSubmit}>
              {onboarding ? 'Connecting…' : 'Connect'}
            </button>
          </div>

          <div className="di-form__meta">
            <p className="di-target">{target || 'Paste owner/repo or a GitHub URL into Owner.'}</p>
            <button type="button" className="di-copy" onClick={copyWebhook}>
              {copied ? 'Webhook copied' : 'Copy webhook URL'}
            </button>
          </div>
        </form>

        <section className="di-list">
          <div className="di-list__head">
            <h2 className="di-list__title">Repositories</h2>
            {!loading ? <span className="di-list__count">{repos.length}</span> : null}
          </div>

          {loading ? (
            <p className="di-empty">Loading repositories…</p>
          ) : repos.length === 0 ? (
            <p className="di-empty">None connected yet. Use the form above.</p>
          ) : (
            <ul className="di-rows">
              {repos.map((repo) => (
                <li key={`${repo.owner}/${repo.name}`}>
                  <Link
                    href={`/deploy-intelligence/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`}
                    className="di-row"
                  >
                    <span className="di-row__name">
                      {repo.owner}/{repo.name}
                    </span>
                    <span className="di-row__branch">{repo.base_branch || 'main'}</span>
                    <span className="di-row__stat">{repo.open_pr_count} open</span>
                    <span className="di-row__stat">{repo.merge_count} merges</span>
                    <span className={`di-row__status ${repo.ready ? 'is-ready' : 'is-setup'}`}>
                      {repo.ready ? 'Ready' : 'Setup'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {future.length > 0 ? (
          <p className="di-roadmap">
            Next: {future.map((item) => item.replace(/_/g, ' ')).join(' · ')}
          </p>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
