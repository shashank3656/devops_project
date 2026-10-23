import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import Service360 from '../../components/Service360';
import SreServiceWorkspace, { ServiceClassBadge } from '../../components/SreServiceWorkspace';
import { buildPortalApiUrl, parsePortalNumericId, portalFetch } from '@infragate/ui';
import { useApiUrl } from '../../context/ApiUrlContext';
import { SERVICE_CLASSES, monitoredEnvironmentName } from '../../lib/sreMonitoring';
import { serviceCatalogueBackHref, serviceTicketHref } from '../../lib/scopeHref';
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
  criticality?: string;
  support_team?: string;
  escalation_route?: string;
  runbook_url?: string;
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  environments: string[];
  owner_team?: string;
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

function assigned(value?: string): string {
  return (value || '').trim();
}

function IdentityField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sre-meta__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function IdentityValue({ value, empty }: { value?: string; empty: string }) {
  const text = assigned(value);
  return text ? <>{text}</> : <span className="sre-meta__empty">{empty}</span>;
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
  const [sessionToken, setSessionToken] = useState('');
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
  const [criticality, setCriticality] = useState('unclassified');
  const [supportTeam, setSupportTeam] = useState('');
  const [escalationRoute, setEscalationRoute] = useState('');
  const [runbookURL, setRunbookURL] = useState('');
  const [editFocus, setEditFocus] = useState('');
  useUnsavedChanges(editing && Boolean(item) && (
    service !== (item?.service || '')
    || repo !== (item?.repo || '')
    || environment !== (item?.environment || '')
    || team !== (item?.team || '')
    || grafanaUID !== (item?.grafana_uid || '')
    || dashboardURL !== (item?.dashboard_url || '')
    || metricsURL !== (item?.metrics_url || '')
    || promql !== (item?.promql || '')
    || criticality !== (item?.criticality || 'unclassified')
    || supportTeam !== (item?.support_team || '')
    || escalationRoute !== (item?.escalation_route || '')
    || runbookURL !== (item?.runbook_url || '')
    || projectId !== (item?.project_id ? String(item.project_id) : '')
  ));
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEVOPS_USER_KEY);
      const parsed = raw ? (JSON.parse(raw) as { role?: string; devops_profile?: { is_manager?: boolean } }) : null;
      setIsManager(Boolean(parsed?.devops_profile?.is_manager) || parsed?.role === 'admin');
    } catch {
      setIsManager(false);
    }
  }, []);

  useEffect(() => {
    if (!resourceId) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSessionToken(token);
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
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${apiUrl}/api/devops/projects`, { headers })
      .then((res) => (res.ok ? res.json() : {}))
      .then((projectsData: { projects?: unknown }) => {
        const list = Array.isArray(projectsData?.projects) ? projectsData.projects : [];
        setProjects(
          list
            .map((entry: { id?: number; name?: string; code?: string; environments?: string[]; owner_team?: string }) => ({
              id: typeof entry.id === 'number' ? entry.id : 0,
              name: entry.name || '',
              code: entry.code || '',
              environments: Array.isArray(entry.environments) ? entry.environments.map((value) => String(value)).filter(Boolean) : [],
              owner_team: entry.owner_team || '',
            }))
            .filter((entry: ProjectOption) => entry.id > 0),
        );
      })
      .catch(() => undefined);
  }, [apiUrl]);

  useEffect(() => {
    if (!editing) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/project-options`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    ]).then(([mine, options]: [{ teams?: unknown; owner_teams?: unknown }, { teams?: unknown; owner_teams?: unknown }]) => {
      const byId = new Map<number, OwnerTeam>();
      [...readTeams(mine), ...readTeams(options)].forEach((entry) => byId.set(entry.id, entry));
      setTeams([...byId.values()].sort((left, right) => left.name.localeCompare(right.name)));
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

  const startEdit = (focus = '') => {
    if (!item) return;
    setEditFocus(focus);
    if (!editing) {
      setService(item.service || '');
      setRepo(item.repo || '');
      setProjectId(item.project_id ? String(item.project_id) : '');
      setEnvironment(item.environment || '');
      setTeam(item.team || '');
      setGrafanaUID(item.grafana_uid || '');
      setDashboardURL(item.dashboard_url || '');
      setMetricsURL(item.metrics_url || '');
      setPromql(item.promql || '');
      setCriticality(item.criticality || 'unclassified');
      setSupportTeam(item.support_team || '');
      setEscalationRoute(item.escalation_route || '');
      setRunbookURL(item.runbook_url || '');
      setError('');
      setNotice('');
      setEditing(true);
    }
    const query = { ...router.query, tab: 'configuration' };
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  useEffect(() => {
    if (!editing || !editFocus) return;
    const fieldId = editFocus === 'monitoring'
      ? 'service-dashboard'
      : editFocus === 'repo'
        ? 'service-repo'
        : editFocus === 'support'
          ? 'service-support'
          : editFocus === 'escalation'
            ? 'service-escalation'
            : editFocus === 'runbook'
              ? 'service-runbook'
              : editFocus === 'class'
                ? 'service-criticality'
                : 'service-team';
    const field = document.getElementById(fieldId);
    field?.focus();
  }, [editFocus, editing]);

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
          environment: environment.trim() || monitoredEnvironmentName(projectEnvs),
          grafana_uid: grafanaUID.trim(),
          promql: promql.trim(),
          dashboard_url: dashboardURL.trim(),
          metrics_url: metricsURL.trim(),
          team: team.trim(),
          criticality,
          support_team: supportTeam.trim(),
          escalation_route: escalationRoute.trim(),
          runbook_url: runbookURL.trim(),
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
            <span className="portal-page__eyebrow">Service inventory</span>
            <h1 className="portal-page__title">{editing ? 'Edit service' : known(item?.service)}</h1>
            {item && !editing ? (
              <p className="portal-page__subtitle sre-service-kicker">
                <ServiceClassBadge value={item.criticality} />
                <span>{assigned(item.team) || 'Owner not assigned'}</span>
                <span>Production</span>
              </p>
            ) : null}
          </div>
          <div className="portal-page__actions">
            {isManager && item && !editing ? (
              <button type="button" className="btn btn-primary" onClick={() => startEdit()}>Edit</button>
            ) : null}
            {isManager && item && editing ? (
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel edit</button>
            ) : null}
            <Link href={serviceCatalogueBackHref(router.query, item || undefined)} className="btn btn-secondary">Back to inventory</Link>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert">{notice}</div> : null}
        {item ? (
          <>
            {editing ? (
              <p className="ops-note"><strong>Editing service identity</strong><span>Overview, observability, and findings stay open. Save or cancel in Configuration.</span></p>
            ) : null}
            {(!(item.repo || '').trim() || !(item.team || '').trim() || !(item.dashboard_url || item.grafana_uid || item.metrics_url || item.promql)) ? (
              <p className="ops-note ops-note--warn"><strong>Setup incomplete</strong><span>Repository, service owner team, or monitoring is still missing. Missing telemetry stays Unknown.</span></p>
            ) : null}
            {sessionToken ? (
              <SreServiceWorkspace
                apiUrl={apiUrl}
                token={sessionToken}
                serviceId={item.id}
                serviceName={item.service}
                projectId={item.project_id}
                environment={item.environment}
                evidenceUrl={item.dashboard_url || item.metrics_url}
                isManager={isManager}
                configurationLead={(
                  <section className="portal-surface">
                    <div className="portal-surface__header">
                      <div>
                        <h2 className="portal-surface__title">General and ownership</h2>
                        <p className="portal-surface__subtitle">Class, support, escalation, and runbook are identity. They are not a health signal.</p>
                      </div>
                      {isManager && !editing ? <button type="button" className="btn btn-secondary" onClick={() => startEdit()}>Edit identity</button> : null}
                    </div>
                    {editing ? (
                      <form onSubmit={(event) => void save(event)}>
                        <p className="form-req-note"><span aria-hidden="true">*</span> Required</p>
                        <fieldset className="form-section">
                          <legend className="form-section__title">Basics</legend>
                          <div className="portal-form-grid">
                            <label className="label">Service<span className="form-req" aria-hidden="true"> *</span><input className="input" value={service} onChange={(event) => setService(event.target.value)} required /></label>
                            <label className="label">Repo <span className="onboard-optional">Optional</span><input id="service-repo" className="input" value={repo} onChange={(event) => setRepo(event.target.value)} /></label>
                            <label className="label">
                              Project
                              <select className="input" value={projectId} onChange={(event) => {
                                setProjectId(event.target.value);
                                const selected = projects.find((project) => String(project.id) === event.target.value);
                                setEnvironment(monitoredEnvironmentName(selected?.environments || projectEnvs));
                              }}>
                                <option value="">No project</option>
                                {projects.map((project) => (
                                  <option key={project.id} value={project.id}>{project.name || project.code || 'Unknown'}</option>
                                ))}
                              </select>
                            </label>
                            <label className="label">
                              Monitored environment
                              <input className="input" value="Production" readOnly />
                            </label>
                            <label className="label">
                              Criticality
                              <select id="service-criticality" className="input" value={criticality} onChange={(event) => setCriticality(event.target.value)}>
                                {SERVICE_CLASSES.map((entry) => (
                                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                                ))}
                              </select>
                            </label>
                            <label className="label">
                              Service owner team
                              <select id="service-team" className="input" value={team} onChange={(event) => setTeam(event.target.value)} disabled={teams.length === 0}>
                                <option value="">{teams.length ? 'Select a service owner team' : 'No teams'}</option>
                                {teams.map((entry) => (
                                  <option key={entry.id} value={entry.name}>{entry.name}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </fieldset>
                        <fieldset className="form-section">
                          <legend className="form-section__title">Support and response</legend>
                          <div className="portal-form-grid">
                            <label className="label">Support team <span className="onboard-optional">Optional</span><input id="service-support" className="input" value={supportTeam} onChange={(event) => setSupportTeam(event.target.value)} /></label>
                            <label className="label">Escalation route <span className="onboard-optional">Optional</span><input id="service-escalation" className="input" value={escalationRoute} onChange={(event) => setEscalationRoute(event.target.value)} /></label>
                            <label className="label">Runbook URL <span className="onboard-optional">Optional</span><input id="service-runbook" className="input" value={runbookURL} onChange={(event) => setRunbookURL(event.target.value)} /></label>
                          </div>
                        </fieldset>
                        <details className="onboard-advanced" open={editFocus === 'monitoring' || Boolean(grafanaUID || dashboardURL || metricsURL || promql) || undefined}>
                          <summary>Monitoring evidence <span className="onboard-optional">Optional</span></summary>
                          <p className="form-section__copy">A dashboard URL is evidence, not an executable query. Health stays Unknown until a monitor is evaluated.</p>
                          <div className="portal-form-grid">
                            <label className="label">Grafana UID<input className="input" value={grafanaUID} onChange={(event) => setGrafanaUID(event.target.value)} /></label>
                            <label className="label">Dashboard URL<input id="service-dashboard" className="input" value={dashboardURL} onChange={(event) => setDashboardURL(event.target.value)} /></label>
                            <label className="label">Metrics JSON URL<input className="input" value={metricsURL} onChange={(event) => setMetricsURL(event.target.value)} /></label>
                            <label className="label">PromQL<textarea className="input" rows={3} value={promql} onChange={(event) => setPromql(event.target.value)} /></label>
                          </div>
                        </details>
                        <div className="portal-form-actions">
                          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
                          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <dl className="sre-meta">
                          <IdentityField label="Monitored environment">Production</IdentityField>
                          <IdentityField label="Criticality"><ServiceClassBadge value={item.criticality} /></IdentityField>
                          <IdentityField label="Service owner team"><IdentityValue value={item.team} empty="Not assigned" /></IdentityField>
                          <IdentityField label="Support team"><IdentityValue value={item.support_team} empty="Not assigned" /></IdentityField>
                          <IdentityField label="Escalation route"><IdentityValue value={item.escalation_route} empty="Not assigned" /></IdentityField>
                          <IdentityField label="Runbook">
                            {assigned(item.runbook_url) ? <a href={item.runbook_url} target="_blank" rel="noreferrer">{item.runbook_url}</a> : <span className="sre-meta__empty">Not linked</span>}
                          </IdentityField>
                          <IdentityField label="Repository"><IdentityValue value={item.repo} empty="Not connected" /></IdentityField>
                          <IdentityField label="Project"><IdentityValue value={item.project_name} empty="Not assigned" /></IdentityField>
                        </dl>
                        {!isManager ? <p className="form-section__copy">You can view identity. Editing needs a manager role.</p> : null}
                      </>
                    )}
                  </section>
                )}
                overview={(
                  <>
                    <section className="portal-surface">
                      <div className="portal-surface__header">
                        <div>
                          <h2 className="portal-surface__title">Ownership and source</h2>
                          <p className="portal-surface__subtitle">Identity for this production service. Class is not a health indicator.</p>
                        </div>
                        {isManager ? <button type="button" className="btn btn-secondary" onClick={() => startEdit()}>Edit identity</button> : null}
                      </div>
                      <dl className="sre-meta">
                        <IdentityField label="Project"><IdentityValue value={item.project_name} empty="Not assigned" /></IdentityField>
                        <IdentityField label="Monitored environment">Production</IdentityField>
                        <IdentityField label="Criticality"><ServiceClassBadge value={item.criticality} /></IdentityField>
                        <IdentityField label="Service owner team"><IdentityValue value={item.team} empty="Not assigned" /></IdentityField>
                        <IdentityField label="Support team"><IdentityValue value={item.support_team} empty="Not assigned" /></IdentityField>
                        <IdentityField label="Escalation route"><IdentityValue value={item.escalation_route} empty="Not assigned" /></IdentityField>
                        <IdentityField label="Runbook">
                          {assigned(item.runbook_url) ? <a href={item.runbook_url} target="_blank" rel="noreferrer">{item.runbook_url}</a> : <span className="sre-meta__empty">Not linked</span>}
                        </IdentityField>
                        <IdentityField label="Repository"><IdentityValue value={item.repo} empty="Not connected" /></IdentityField>
                      </dl>
                    </section>
                    <section className="portal-surface">
                      <div className="portal-surface__header">
                        <div>
                          <h2 className="portal-surface__title">Dashboard evidence</h2>
                          <p className="portal-surface__subtitle">A dashboard URL is evidence, not an executable query. Health stays Unknown until a monitor is evaluated.</p>
                        </div>
                        {isManager ? (
                          <button type="button" className="btn btn-secondary" onClick={() => startEdit('monitoring')}>{item.dashboard_url || item.grafana_uid || item.metrics_url || item.promql ? 'Edit dashboard' : 'Link dashboard'}</button>
                        ) : null}
                      </div>
                      {item.dashboard_url ? <a href={item.dashboard_url} target="_blank" rel="noreferrer">Open dashboard</a> : <p className="sre-meta__empty">Grafana {known(item.grafana_uid)}</p>}
                    </section>
                    <section className="portal-surface">
                      <div className="portal-surface__header">
                        <div>
                          <h2 className="portal-surface__title">Related work</h2>
                          <p className="portal-surface__subtitle">Resources, changes, incidents, and access for this production service.</p>
                        </div>
                      </div>
                      <Service360
                        apiUrl={apiUrl}
                        token={sessionToken}
                        serviceName={item.service}
                        projectId={item.project_id}
                        environment={item.environment}
                        ownerTeam={item.team}
                        repo={item.repo}
                        overview={(
                          <div className="portal-page__actions">
                            <Link href={serviceTicketHref('/changes/new', item)} className="btn btn-primary">Create change</Link>
                            <Link href={serviceTicketHref('/incidents/new', item)} className="btn btn-secondary">Report incident</Link>
                          </div>
                        )}
                      />
                    </section>
                  </>
                )}
              />
            ) : <p className="ops-note">Sign in to open observability, findings, and configuration.</p>}
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
