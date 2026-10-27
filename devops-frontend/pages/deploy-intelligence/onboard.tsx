import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
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

function splitRepoInput(raw: string): { owner: string; name: string } | null {
  const value = raw.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '');
  const parts = value.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], name: parts[1] };
  }
  return null;
}

export default function DeployIntelligenceOnboardPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<GitOpsProjectOption[]>([]);
  const [onboardOwner, setOnboardOwner] = useState('');
  const [onboardName, setOnboardName] = useState('');
  const [onboardBase, setOnboardBase] = useState('main');
  const [onboardProjectId, setOnboardProjectId] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/github`;
  const canSubmit = onboardOwner.trim().length > 0 && onboardName.trim().length > 0 && !onboarding;

  const target = useMemo(() => {
    const owner = onboardOwner.trim();
    const name = onboardName.trim();
    const base = onboardBase.trim() || 'main';
    if (!owner && !name) return '';
    return `${owner || '…'}/${name || '…'} → ${base}`;
  }, [onboardOwner, onboardName, onboardBase]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/deploy-intelligence`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load projects');
        setProjects(Array.isArray(data?.projects) ? data.projects : []);
      })
      .catch((err: Error) => setError(err.message));
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
    const owner = onboardOwner.trim();
    const name = onboardName.trim();
    try {
      const res = await fetch(`${apiUrl}/api/devops/deploy-intelligence/repos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          name,
          base_branch: onboardBase.trim() || 'main',
          project_id: onboardProjectId ? Number(onboardProjectId) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || (res.status === 404 ? 'Repository not found' : 'Onboard failed'));
        return;
      }
      await router.push(`/deploy-intelligence/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
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
        <title>Connect repository - OpsTrellis</title>
      </Head>
      <div className="delivery-shell">
        <Link href="/deploy-intelligence" className="delivery-back">Repositories</Link>
        <header className="delivery-head">
          <div>
            <p className="delivery-kicker">Delivery</p>
            <h1 className="delivery-title">Connect a repository</h1>
            <p className="delivery-lede">
              The owner and name must already exist on GitHub. A missing repository is not added.
            </p>
          </div>
        </header>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="delivery-panel">
          <form className="delivery-form delivery-form--connect" onSubmit={onboard}>
            {projects.length > 0 ? (
              <label className="label">
                GitOps project
                <select
                  className="input"
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
            <div className="delivery-form__split">
              <label className="label">
                Owner
                <input
                  className="input"
                  value={onboardOwner}
                  onChange={(e) => applyOwnerChange(e.target.value)}
                  placeholder="acme-corp"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <label className="label">
                Repository
                <input
                  className="input"
                  value={onboardName}
                  onChange={(e) => setOnboardName(e.target.value.replace(/\s+/g, ''))}
                  placeholder="infra-live"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
            </div>
            <label className="label">
              Base branch
              <input
                className="input"
                value={onboardBase}
                onChange={(e) => setOnboardBase(e.target.value.replace(/\s+/g, ''))}
                placeholder="main"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="delivery-form__hint">{target || 'Paste owner/repo or a GitHub URL into Owner.'}</p>
            <div className="portal-page__actions">
              <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
                {onboarding ? 'Connecting…' : 'Connect repository'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void copyWebhook()}>
                {copied ? 'Webhook copied' : 'Copy webhook URL'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </DevOpsLayout>
  );
}
