import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  environments: string[];
}

interface OwnerTeam {
  id: number;
  name: string;
  slug: string;
}

function readTeams(data: { teams?: unknown; owner_teams?: unknown }): OwnerTeam[] {
  const raw = Array.isArray(data?.owner_teams) ? data.owner_teams : Array.isArray(data?.teams) ? data.teams : [];
  return raw
    .map((item) => {
      const row = item as { id?: number; name?: string; slug?: string };
      return {
        id: typeof row.id === 'number' ? row.id : 0,
        name: String(row.name || '').trim(),
        slug: String(row.slug || '').trim(),
      };
    })
    .filter((item) => item.id > 0 && item.name);
}

export default function NewServiceMapPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [service, setService] = useState('');
  const [repo, setRepo] = useState('');
  const [environment, setEnvironment] = useState('');
  const [projectEnvs, setProjectEnvs] = useState<string[]>([]);
  const [grafanaUID, setGrafanaUID] = useState('');
  const [promql, setPromql] = useState('');
  const [dashboardURL, setDashboardURL] = useState('');
  const [metricsURL, setMetricsURL] = useState('');
  const [team, setTeam] = useState('');
  const [teams, setTeams] = useState<OwnerTeam[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/project-options`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    ])
      .then(([mine, options]) => {
        const byId = new Map<number, OwnerTeam>();
        [...readTeams(mine), ...readTeams(options)].forEach((item) => byId.set(item.id, item));
        setTeams([...byId.values()].sort((left, right) => left.name.localeCompare(right.name)));
      })
      .catch(() => setTeams([]));
    fetch(`${apiUrl}/api/devops/projects`, { headers })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        const list = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(
          list
            .map((item: { id?: number; name?: string; code?: string; environments?: string[] }) => ({
              id: typeof item.id === 'number' ? item.id : 0,
              name: item.name || '',
              code: item.code || '',
              environments: Array.isArray(item.environments) ? item.environments.map((value) => String(value)).filter(Boolean) : [],
            }))
            .filter((item: ProjectOption) => item.id > 0),
        );
      })
      .catch(() => undefined);
  }, [apiUrl]);

  useEffect(() => {
    if (!router.isReady) return;
    const queryProject = Array.isArray(router.query.project_id) ? router.query.project_id[0] : router.query.project_id;
    const queryEnv = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment;
    if (queryProject) setProjectId(queryProject);
    if (queryEnv) setEnvironment(queryEnv);
  }, [router.isReady, router.query.environment, router.query.project_id]);

  useEffect(() => {
    const selected = projects.find((project) => String(project.id) === projectId);
    const fromProject = selected?.environments || [];
    if (!projectId) {
      setProjectEnvs([]);
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      setProjectEnvs(fromProject);
      return;
    }
    const params = new URLSearchParams({ project_id: projectId });
    fetch(`${apiUrl}/api/devops/environment-catalog?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const names = Array.isArray(data?.environments)
          ? data.environments.map((row: { name?: string }) => String(row?.name || '').trim()).filter(Boolean)
          : [];
        const next = names.length ? names : fromProject;
        setProjectEnvs(next);
        setEnvironment((current) => (next.includes(current) ? current : next[0] || ''));
      })
      .catch(() => {
        setProjectEnvs(fromProject);
        setEnvironment((current) => (fromProject.includes(current) ? current : fromProject[0] || ''));
      });
  }, [apiUrl, projectId, projects]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    if (!service.trim()) {
      setError('Service name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/services`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: service.trim(),
          repo: repo.trim(),
          environment: environment.trim(),
          grafana_uid: grafanaUID.trim(),
          promql: promql.trim(),
          dashboard_url: dashboardURL.trim(),
          metrics_url: metricsURL.trim(),
          team: team.trim(),
          project_id: projectId ? Number(projectId) : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to save service');
      await router.push('/services');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save service');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Add service - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Changes</span>
            <h1 className="portal-page__title">Add service</h1>
            <p className="portal-page__subtitle">
              Services created here appear in the Change request dropdown. Map a repo and project so a change can resolve ownership without asking for environment.
            </p>
          </div>
          <Link href="/services" className="btn btn-secondary">Back to services</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <form className="portal-form-grid" onSubmit={(event) => void submit(event)}>
            <label className="label">
              Service
              <input className="input" value={service} onChange={(e) => setService(e.target.value)} placeholder="payments-api" required />
            </label>
            <label className="label">
              Repo
              <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="acme/payments-api" />
            </label>
            <label className="label">
              Project
              <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setEnvironment(''); }}>
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Environment
              <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value)} disabled={!projectId || projectEnvs.length === 0} required={Boolean(projectId)}>
                <option value="">{projectId ? (projectEnvs.length ? 'Select an environment' : 'No environments on this project') : 'Select a project first'}</option>
                {projectEnvs.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="label">
              Owner team
              <select className="input" value={team} onChange={(e) => setTeam(e.target.value)} disabled={teams.length === 0}>
                <option value="">{teams.length ? 'Select an owner team' : 'No teams'}</option>
                {teams.map((item) => (
                  <option key={item.id} value={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="label">
              Grafana UID
              <input className="input" value={grafanaUID} onChange={(e) => setGrafanaUID(e.target.value)} />
            </label>
            <label className="label">
              Dashboard URL
              <input className="input" value={dashboardURL} onChange={(e) => setDashboardURL(e.target.value)} />
            </label>
            <label className="label">
              Metrics JSON URL
              <input className="input" value={metricsURL} onChange={(e) => setMetricsURL(e.target.value)} placeholder="https://metrics.example/payments.json" />
            </label>
            <label className="label">
              PromQL
              <textarea className="input" rows={3} value={promql} onChange={(e) => setPromql(e.target.value)} />
            </label>
            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save service'}</button>
            </div>
          </form>
        </section>
      </div>
    </DevOpsLayout>
  );
}
