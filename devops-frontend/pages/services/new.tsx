import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { saveSubmissionResult } from '../../lib/submissionResult';
import { useEffect, useRef, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { scopeListHref } from '../../lib/scopeHref';
import { forgetAttempt, outcomeForFailedSubmit, rememberAttempt } from '../../lib/submitAttempt';

const SERVICE_ATTEMPT_KEY = 'opstrellis-service-attempt';
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
  const submitLock = useRef(false);
  const saveIntent = useRef<'draft' | 'active'>('active');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const { allowLeave } = useUnsavedChanges(dirty);

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
    if (!projectId && saveIntent.current !== 'draft') {
      setError('Choose a project to create an active service, or save a draft.');
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    setSaving(true);
    setError('');
    const payload = {
      service: service.trim(),
      repo: repo.trim(),
      environment: environment.trim(),
      grafana_uid: grafanaUID.trim(),
      promql: promql.trim(),
      dashboard_url: dashboardURL.trim(),
      metrics_url: metricsURL.trim(),
      team: team.trim(),
      project_id: projectId ? Number(projectId) : undefined,
    };
    try {
      const response = await fetch(`${apiUrl}/api/devops/services`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': rememberAttempt(SERVICE_ATTEMPT_KEY, JSON.stringify(payload)),
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const outcome = outcomeForFailedSubmit(response.status, typeof data?.error === 'string' ? data.error : '');
        if (!outcome.keepAttempt) forgetAttempt(SERVICE_ATTEMPT_KEY);
        throw new Error(outcome.message);
      }
      forgetAttempt(SERVICE_ATTEMPT_KEY);
      const saved = data?.service && typeof data.service === 'object' ? data.service as { id?: number; service?: string } : {};
      allowLeave();
      saveSubmissionResult({
        kind: 'Service',
        id: saved.service || service.trim(),
        status: saveIntent.current === 'draft' ? 'incomplete draft' : 'active',
        next: saved.id ? `Open service #${saved.id} to confirm the owner and monitoring links. Health stays Unknown until those links exist.` : 'Confirm the owner and monitoring links. Health stays Unknown until those links exist.',
        href: saved.id ? `/services/${saved.id}` : scopeListHref('/services', router.query),
      });
      await router.push(scopeListHref('/services', router.query));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save service';
      setError(message === 'Failed to fetch' ? outcomeForFailedSubmit(0, '').message : message);
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Add service - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Service</span>
            <h1 className="portal-page__title">Add service</h1>
            <p className="portal-page__subtitle">
              Name the service and the project it belongs to. Health stays Unknown until monitoring links exist.
            </p>
          </div>
          <Link href={scopeListHref('/services', router.query)} className="btn btn-secondary">Back to services</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <form onSubmit={(event) => void submit(event)} onChange={() => setDirty(true)}>
            <p className="form-req-note"><span aria-hidden="true">*</span> Required</p>
            <fieldset className="form-section">
              <legend className="form-section__title">Basics</legend>
              <p className="form-section__copy">An active service needs a project. Without one, Save draft keeps it incomplete. Service owner team stays optional and is separate from the project team.</p>
              <div className="portal-form-grid">
                <label className="label">
                  Service<span className="form-req" aria-hidden="true"> *</span>
                  <input className="input" value={service} onChange={(e) => setService(e.target.value)} placeholder="payments-api" required />
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
                  Service owner team
                  <select className="input" value={team} onChange={(e) => setTeam(e.target.value)} disabled={teams.length === 0}>
                    <option value="">{teams.length ? 'Select an owner team' : 'No teams'}</option>
                    {teams.map((item) => (
                      <option key={item.id} value={item.name}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Repo <span className="onboard-optional">Optional</span>
                  <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="acme/payments-api" />
                </label>
              </div>
            </fieldset>
            <details className="onboard-advanced" open={Boolean(grafanaUID || dashboardURL || metricsURL || promql) || undefined}>
              <summary>Monitoring <span className="onboard-optional">Optional</span></summary>
              <p className="form-section__copy">Link dashboards and metrics so the service page can show live health. Without them, health shows as Unknown.</p>
              <div className="portal-form-grid">
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
              </div>
            </details>
            <div className="portal-form-actions">
              <p className="access-hint">
                {projectId
                  ? 'Create active service saves this service on the selected project.'
                  : 'Save draft keeps this service incomplete until a project is chosen.'}
              </p>
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={saving || Boolean(projectId) || !service.trim()}
                title={projectId ? 'A project is selected, so this save creates an active service.' : 'Save an incomplete draft'}
                onClick={() => { saveIntent.current = 'draft'; }}
              >
                {saving && saveIntent.current === 'draft' ? 'Saving...' : 'Save draft'}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !projectId || !service.trim()}
                title={projectId ? 'Create an active service' : 'Choose a project to create an active service.'}
                onClick={() => { saveIntent.current = 'active'; }}
              >
                {saving && saveIntent.current === 'active' ? 'Saving...' : 'Create active service'}
              </button>
              <Link href="/services" className="btn btn-secondary">Cancel</Link>
            </div>
          </form>
        </section>
      </div>
    </DevOpsLayout>
  );
}
