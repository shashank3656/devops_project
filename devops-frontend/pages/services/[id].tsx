import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { buildPortalApiUrl, parsePortalNumericId, portalFetch } from '@infragate/ui';
import { useApiUrl } from '../../context/ApiUrlContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { rememberService } from '../../lib/recentServices';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ServiceDetail {
  id: number;
  service: string;
  repo: string;
  environment: string;
  grafana_uid?: string;
  promql?: string;
  dashboard_url?: string;
  metrics_url?: string;
  team?: string;
  project_id?: number;
  project_name?: string;
}

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

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
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

export default function ServiceDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<ServiceDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<OwnerTeam[]>([]);
  const [projectEnvs, setProjectEnvs] = useState<string[]>([]);
  const [service, setService] = useState('');
  const [repo, setRepo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [team, setTeam] = useState('');
  const [grafanaUID, setGrafanaUID] = useState('');
  const [dashboardURL, setDashboardURL] = useState('');
  const [metricsURL, setMetricsURL] = useState('');
  const [promql, setPromql] = useState('');
  useUnsavedChanges(editing && Boolean(item) && (
    service !== (item?.service || '')
    || repo !== (item?.repo || '')
    || environment !== (item?.environment || '')
    || team !== (item?.team || '')
    || grafanaUID !== (item?.grafana_uid || '')
    || dashboardURL !== (item?.dashboard_url || '')
    || metricsURL !== (item?.metrics_url || '')
    || promql !== (item?.promql || '')
    || projectId !== (item?.project_id ? String(item.project_id) : '')
  ));
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEVOPS_USER_KEY);
      const parsed = raw ? (JSON.parse(raw) as { devops_profile?: { is_manager?: boolean } }) : null;
      setIsManager(Boolean(parsed?.devops_profile?.is_manager));
    } catch {
      setIsManager(false);
    }
  }, []);

  useEffect(() => {
    if (!resourceId) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${resourceId}`), { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load service');
          return;
        }
        const service = data.service || null;
        setItem(service);
        if (service && typeof service.id === 'number') {
          rememberService({
            id: service.id,
            name: String(service.service || service.name || 'Service'),
            project: String(service.project_name || ''),
            environment: String(service.environment || ''),
          });
        }
      })
      .catch(() => setError('Failed to load service'));
  }, [apiUrl, resourceId]);

  useEffect(() => {
    if (!editing) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/project-options`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    ]).then(([mine, options, projectsData]: [{ teams?: unknown; owner_teams?: unknown }, { teams?: unknown; owner_teams?: unknown }, { projects?: unknown }]) => {
      const byId = new Map<number, OwnerTeam>();
      [...readTeams(mine), ...readTeams(options)].forEach((entry) => byId.set(entry.id, entry));
      setTeams([...byId.values()].sort((left, right) => left.name.localeCompare(right.name)));
      const list = Array.isArray(projectsData?.projects) ? projectsData.projects : [];
      setProjects(
        list
          .map((entry: { id?: number; name?: string; code?: string; environments?: string[] }) => ({
            id: typeof entry.id === 'number' ? entry.id : 0,
            name: entry.name || '',
            code: entry.code || '',
            environments: Array.isArray(entry.environments) ? entry.environments.map((value) => String(value)).filter(Boolean) : [],
          }))
          .filter((entry: ProjectOption) => entry.id > 0),
      );
    }).catch(() => undefined);
  }, [apiUrl, editing]);

  useEffect(() => {
    if (!editing || !projectId) {
      setProjectEnvs([]);
      return;
    }
    const selected = projects.find((project) => String(project.id) === projectId);
    const fromProject = selected?.environments || [];
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
        setProjectEnvs(names.length ? names : fromProject);
      })
      .catch(() => setProjectEnvs(fromProject));
  }, [apiUrl, editing, projectId, projects]);

  const startEdit = () => {
    if (!item) return;
    setService(item.service || '');
    setRepo(item.repo || '');
    setProjectId(item.project_id ? String(item.project_id) : '');
    setEnvironment(item.environment || '');
    setTeam(item.team || '');
    setGrafanaUID(item.grafana_uid || '');
    setDashboardURL(item.dashboard_url || '');
    setMetricsURL(item.metrics_url || '');
    setPromql(item.promql || '');
    setError('');
    setNotice('');
    setEditing(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !resourceId) return;
    if (!service.trim()) {
      setError('Service name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(buildPortalApiUrl(apiUrl, `/api/devops/services/${resourceId}`), {
        method: 'PATCH',
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
      if (!response.ok) throw new Error(data?.error || 'Failed to update service');
      setItem(data.service || item);
      setEditing(false);
      setNotice('Service updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update service');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.service || 'Service'} - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Services</span>
            <h1 className="portal-page__title">{editing ? 'Edit service' : known(item?.service)}</h1>
          </div>
          <div className="portal-page__actions">
            {isManager && item && !editing ? (
              <button type="button" className="btn btn-primary" onClick={startEdit}>Edit</button>
            ) : null}
            <Link href="/services" className="btn btn-secondary">Back to services</Link>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert">{notice}</div> : null}
        {item && !editing ? (
          <>
            {(!item.repo.trim() || !(item.team || '').trim()) ? (
              <p className="ops-note"><strong>Setup incomplete</strong><span>Repository and owner team are not configured. Monitoring status is unknown.</span></p>
            ) : null}
            <div className="ops-catalogue">
              <section className="ops-service">
                <h2>Ownership & source</h2>
                <dl>
                  <dt>Project</dt><dd>{known(item.project_name)}</dd>
                  <dt>Environment</dt><dd>{known(item.environment)}</dd>
                  <dt>Owner team</dt><dd>{(item.team || '').trim() ? item.team : 'Not assigned'}</dd>
                  <dt>Repository</dt><dd>{item.repo.trim() ? item.repo : 'Not connected'}</dd>
                </dl>
              </section>
              <section className="ops-service">
                <h2>Monitoring is not connected</h2>
                <p>Connect a dashboard or metric source to see health. Missing telemetry is not a healthy result.</p>
                {item.dashboard_url ? <a href={item.dashboard_url} target="_blank" rel="noreferrer">Open dashboard</a> : <span>Grafana {known(item.grafana_uid)}</span>}
              </section>
            </div>
            <section className="ops-caught">
              <h2>No related work yet</h2>
              <p>Changes and incidents for this service will appear here.</p>
              <div className="portal-page__actions">
                <Link href="/changes/new" className="btn btn-primary">Create change</Link>
                <Link href="/incidents/new" className="btn btn-secondary">Report incident</Link>
              </div>
            </section>
          </>
        ) : null}
        {editing ? (
          <section className="portal-surface">
            <form onSubmit={(event) => void save(event)}>
              <p className="form-req-note"><span aria-hidden="true">*</span> Required</p>
              <fieldset className="form-section">
                <legend className="form-section__title">Basics</legend>
                <div className="portal-form-grid">
              <label className="label">Service<span className="form-req" aria-hidden="true"> *</span><input className="input" value={service} onChange={(event) => setService(event.target.value)} required /></label>
              <label className="label">Repo <span className="onboard-optional">Optional</span><input className="input" value={repo} onChange={(event) => setRepo(event.target.value)} /></label>
              <label className="label">
                Project
                <select className="input" value={projectId} onChange={(event) => { setProjectId(event.target.value); setEnvironment(''); }}>
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name || project.code || 'Unknown'}</option>
                  ))}
                </select>
              </label>
              <label className="label">
                Environment
                <select className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} disabled={!projectId || projectEnvs.length === 0}>
                  <option value="">{projectId ? (projectEnvs.length ? 'Select an environment' : 'No environments on this project') : 'Select a project first'}</option>
                  {projectEnvs.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="label">
                Owner team
                <select className="input" value={team} onChange={(event) => setTeam(event.target.value)} disabled={teams.length === 0}>
                  <option value="">{teams.length ? 'Select an owner team' : 'No teams'}</option>
                  {teams.map((entry) => (
                    <option key={entry.id} value={entry.name}>{entry.name}</option>
                  ))}
                </select>
              </label>
                </div>
              </fieldset>
              <details className="onboard-advanced" open={Boolean(grafanaUID || dashboardURL || metricsURL || promql) || undefined}>
                <summary>Monitoring <span className="onboard-optional">Optional</span></summary>
                <p className="form-section__copy">Without these links, health on this service stays Unknown.</p>
                <div className="portal-form-grid">
              <label className="label">Grafana UID<input className="input" value={grafanaUID} onChange={(event) => setGrafanaUID(event.target.value)} /></label>
              <label className="label">Dashboard URL<input className="input" value={dashboardURL} onChange={(event) => setDashboardURL(event.target.value)} /></label>
              <label className="label">Metrics JSON URL<input className="input" value={metricsURL} onChange={(event) => setMetricsURL(event.target.value)} /></label>
              <label className="label">PromQL<textarea className="input" rows={3} value={promql} onChange={(event) => setPromql(event.target.value)} /></label>
                </div>
              </details>
              <div className="portal-form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
