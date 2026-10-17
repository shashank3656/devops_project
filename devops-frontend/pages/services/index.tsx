import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CopyButton, InspectorDrawer } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import { rememberService } from '../../lib/recentServices';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ServiceRow {
  id: number;
  project_id?: number;
  service: string;
  repo: string;
  environment: string;
  grafana_uid?: string;
  team?: string;
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

interface EnvFolder {
  name: string;
  count: number;
  services: ServiceRow[];
}

interface ProjectFolder {
  key: string;
  id: number;
  name: string;
  environments: EnvFolder[];
}

function label(value: string): string {
  const text = value.trim();
  return text || 'Unknown';
}

function firstQuery(value: string | string[] | undefined): string {
  const text = Array.isArray(value) ? value[0] : value;
  return (text || '').trim();
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

async function loadOwnerTeams(apiUrl: string, token: string): Promise<OwnerTeam[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const [mine, options] = await Promise.all([
    fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    fetch(`${apiUrl}/api/devops/project-options`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
  ]);
  const byId = new Map<number, OwnerTeam>();
  [...readTeams(mine), ...readTeams(options)].forEach((team) => byId.set(team.id, team));
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function teamMatches(serviceTeam: string, team: OwnerTeam | undefined): boolean {
  if (!team) return true;
  const current = serviceTeam.trim().toLowerCase();
  return current === team.name.toLowerCase() || (team.slug !== '' && current === team.slug.toLowerCase());
}

function buildFolders(projects: ProjectOption[], services: ServiceRow[]): ProjectFolder[] {
  const byId = new Map<number, ProjectFolder>();
  const loose = new Map<string, ProjectFolder>();

  projects.forEach((project) => {
    const names = project.environments.map((item) => item.trim()).filter(Boolean);
    byId.set(project.id, {
      key: `project-${project.id}`,
      id: project.id,
      name: project.name || project.code || 'Unknown',
      environments: names.map((name) => ({ name, count: 0, services: [] })),
    });
  });

  services.forEach((service) => {
    const projectId = service.project_id && service.project_id > 0 ? service.project_id : 0;
    let folder = projectId ? byId.get(projectId) : undefined;
    if (!folder) {
      const name = label(service.project_name || '');
      const key = `loose-${name.toLowerCase()}`;
      folder = loose.get(key) || { key, id: 0, name, environments: [] };
      loose.set(key, folder);
    }
    const envName = label(service.environment);
    let env = folder.environments.find((item) => item.name.toLowerCase() === envName.toLowerCase());
    if (!env) {
      env = { name: envName, count: 0, services: [] };
      folder.environments.push(env);
    }
    env.services.push(service);
  });

  return [...byId.values(), ...loose.values()];
}

export default function ServiceMapPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ServiceRow[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [summary, setSummary] = useState<Array<{ project_id: number; project_name: string; environment: string; count: number }>>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<OwnerTeam[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [ownerTeamId, setOwnerTeamId] = useState('');
  const [servicePage, setServicePage] = useState(0);
  const [preview, setPreview] = useState<ServiceRow | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);
  const [incompleteCount, setIncompleteCount] = useState<number | null>(null);
  const projectFilter = router.isReady ? firstQuery(router.query.project_id) : '';
  const environmentFilter = router.isReady ? firstQuery(router.query.environment) : '';
  useEffect(() => {
    if (!router.isReady || filtersReady) return;
    setQuery(firstQuery(router.query.q));
    setOwnerTeamId(firstQuery(router.query.team));
    setFiltersReady(true);
  }, [filtersReady, router.isReady, router.query.q, router.query.team]);
  const selectedTeam = teams.find((team) => String(team.id) === ownerTeamId);
  const ownerTeamQuery = [selectedTeam?.name, selectedTeam?.slug].map((value) => (value || '').trim()).filter(Boolean).join('|');
  useEffect(() => {
    setServicePage(0);
  }, [projectFilter, environmentFilter, ownerTeamId, query]);
  useEffect(() => {
    if (!router.isReady || !filtersReady) return;
    const next = new URLSearchParams();
    if (projectFilter) next.set('project_id', projectFilter);
    if (environmentFilter) next.set('environment', environmentFilter);
    if (query.trim()) next.set('q', query.trim());
    if (ownerTeamId) next.set('team', ownerTeamId);
    const current = new URLSearchParams();
    ['project_id', 'environment', 'q', 'team'].forEach((key) => {
      const value = firstQuery(router.query[key]);
      if (value) current.set(key, value);
    });
    if (next.toString() === current.toString()) return;
    const queryObject = Object.fromEntries(next.entries());
    void router.replace({ pathname: '/services', query: queryObject }, undefined, { shallow: true });
  }, [environmentFilter, filtersReady, ownerTeamId, projectFilter, query, router]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !filtersReady) return;
    setLoading(true);
    const headers = { Authorization: `Bearer ${token}` };
    const listing = Boolean(query.trim() || environmentFilter || ownerTeamId);
    const params = new URLSearchParams();
    if (listing) {
      params.set('limit', '50');
      params.set('offset', String(servicePage * 50));
      if (projectFilter) params.set('project_id', projectFilter);
      if (environmentFilter) params.set('environment', environmentFilter);
      if (query.trim()) params.set('q', query.trim());
      const teamQuery = ownerTeamQuery;
      if (teamQuery) params.set('team', teamQuery);
    } else {
      params.set('view', 'summary');
      if (projectFilter) params.set('project_id', projectFilter);
    }
    Promise.all([
      fetch(`${apiUrl}/api/devops/services?${params}`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => res.json().catch(() => ({}))),
      loadOwnerTeams(apiUrl, token),
    ])
      .then(([servicesData, projectsData, ownerTeams]) => {
        if (servicesData?.error && !Array.isArray(servicesData.services)) {
          setError(servicesData.error || 'Failed to load services');
          return;
        }
        const nextItems = Array.isArray(servicesData.services) ? servicesData.services as ServiceRow[] : [];
        const nextTotal = typeof servicesData.total === 'number' ? servicesData.total : 0;
        setItems(nextItems);
        setPageTotal(nextTotal);
        setSummary(Array.isArray(servicesData.folders) ? servicesData.folders : []);
        if (typeof servicesData.incomplete === 'number') {
          setIncompleteCount(servicesData.incomplete);
        } else if (nextItems.length >= nextTotal) {
          setIncompleteCount(nextItems.filter((item) => !item.repo.trim() || !label(item.team || '').trim() || label(item.team || '') === 'Unknown').length);
        } else {
          setIncompleteCount(null);
        }
        const list = Array.isArray(projectsData?.projects) ? projectsData.projects : [];
        setProjects(
          list
            .map((item: { id?: number; name?: string; code?: string; environments?: string[] }) => ({
              id: typeof item.id === 'number' ? item.id : 0,
              name: item.name || '',
              code: item.code || '',
              environments: Array.isArray(item.environments) ? item.environments.map((value) => String(value)) : [],
            }))
            .filter((item: ProjectOption) => item.id > 0),
        );
        setTeams(ownerTeams);
      })
      .catch(() => setError('Failed to load services'))
      .finally(() => setLoading(false));
  }, [apiUrl, environmentFilter, filtersReady, ownerTeamId, ownerTeamQuery, projectFilter, query, servicePage]);

  const filtering = Boolean(query.trim() || ownerTeamId);
  const setupLabel = loading || error || incompleteCount === null
    ? 'Unknown'
    : String(incompleteCount);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (projectFilter && String(item.project_id || 0) !== projectFilter) return false;
      if (environmentFilter && label(item.environment).toLowerCase() !== environmentFilter.toLowerCase()) return false;
      if (ownerTeamId && !teamMatches(item.team || '', selectedTeam)) return false;
      if (!needle) return true;
      const haystack = [item.service, item.repo, item.team, item.project_name, item.environment].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [environmentFilter, items, ownerTeamId, projectFilter, query, selectedTeam]);

  const environmentOptions = useMemo(() => {
    const names = new Set<string>();
    const source = projectFilter ? projects.filter((project) => String(project.id) === projectFilter) : projects;
    source.forEach((project) => project.environments.forEach((name) => {
      const text = name.trim();
      if (text) names.add(text);
    }));
    items.forEach((item) => {
      if (projectFilter && String(item.project_id || 0) !== projectFilter) return;
      const text = item.environment.trim();
      if (text) names.add(text);
    });
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [items, projectFilter, projects]);

  const catalog = useMemo(() => {
    if (!query.trim() && summary.length) {
      const byId = new Map<number, ProjectFolder>();
      summary.forEach((row) => {
        const id = row.project_id || 0;
        let folder = byId.get(id);
        if (!folder) {
          folder = { key: `project-${id}`, id, name: label(row.project_name || ''), environments: [] };
          byId.set(id, folder);
        }
        folder.environments.push({ name: label(row.environment), count: row.count, services: [] });
      });
      return [...byId.values()];
    }
    return buildFolders(projects, items);
  }, [items, projects, query, summary]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const first = matches[0];
    if (query.trim() && first) void router.push(`/services/${first.id}`);
  };

  const clearFilters = () => {
    setQuery('');
    setOwnerTeamId('');
  };

  const currentProject = catalog.find((project) => projectFilter && String(project.id) === projectFilter) || null;
  const currentEnv = currentProject?.environments.find((env) => environmentFilter && env.name.toLowerCase() === environmentFilter.toLowerCase()) || null;
  const visibleProjects = (ownerTeamId
    ? catalog.filter((project) => project.environments.some((env) => env.services.some((service) => teamMatches(service.team || '', selectedTeam))))
    : catalog
  ).filter((project) => project.id > 0);
  const visibleServices = (currentEnv?.services || []).filter((service) => !ownerTeamId || teamMatches(service.team || '', selectedTeam));
  const servicePageSize = 50;
  const serviceTotal = pageTotal || visibleServices.length;
  const servicePageCount = Math.max(1, Math.ceil(serviceTotal / servicePageSize));
  const servicePageSafe = Math.min(servicePage, servicePageCount - 1);
  const pagedServices = visibleServices;
  const matchTotal = pageTotal || matches.length;
  const matchPageCount = Math.max(1, Math.ceil(matchTotal / servicePageSize));
  const matchPageSafe = Math.min(servicePage, matchPageCount - 1);
  const pagedMatches = matches;
  const addHref = projectFilter
    ? `/services/new?project_id=${projectFilter}${environmentFilter ? `&environment=${encodeURIComponent(environmentFilter)}` : ''}`
    : '/services/new';

  return (
    <DevOpsLayout>
      <Head>
        <title>Services - OpsTrellis</title>
      </Head>
      <div className="ops-frame">
        <header className="ops-frame__head">
          <div>
            <h1>{currentEnv ? currentEnv.name : currentProject ? currentProject.name : 'Services'}</h1>
          </div>
          <Link href={addHref} className="btn btn-primary">Add service</Link>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="ops-minis" aria-label="Service summary">
          <article className="ops-mini ops-mini--mint">
            <span>Registered services</span>
            <strong>{loading || error ? 'Unknown' : (pageTotal || matches.length)}</strong>
            <small>{currentProject ? currentProject.name : 'All visible projects'}</small>
          </article>
          <article className="ops-mini ops-mini--lilac">
            <span>Needs setup</span>
            <strong>{setupLabel}</strong>
            <small>Owner and repository missing</small>
          </article>
          <article className="ops-mini ops-mini--blue">
            <span>Environments</span>
            <strong>{loading || error ? 'Unknown' : environmentOptions.length}</strong>
            <small>{environmentOptions.join(' · ') || 'None listed'}</small>
          </article>
        </section>
        <form className="portal-surface" onSubmit={search}>
          <div className="svc-filters">
            <label>
              Search services
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or repository" />
            </label>
            <label>
              Owner team
              <select className="input" value={ownerTeamId} onChange={(event) => setOwnerTeamId(event.target.value)}>
                <option value="">{teams.length ? 'All teams' : 'No teams'}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
          </div>
          {filtering ? <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear</button> : null}
        </form>
        {projectFilter || environmentFilter ? (
          <nav className="svc-crumb" aria-label="Location">
            <Link href="/services">Projects</Link>
            {currentProject ? (
              <>
                <span aria-hidden="true">/</span>
                {environmentFilter ? (
                  <Link href={`/services?project_id=${currentProject.id}`}>{currentProject.name}</Link>
                ) : (
                  <span>{currentProject.name}</span>
                )}
              </>
            ) : null}
            {currentEnv ? (
              <>
                <span aria-hidden="true">/</span>
                <span>{currentEnv.name}</span>
              </>
            ) : null}
          </nav>
        ) : null}
        {loading ? <div className="empty-state">Loading services...</div> : null}
        {!loading && query.trim() ? (
          <>
          <ul className="svc-tree">
            {matches.length ? pagedMatches.map((item) => (
              <li key={item.id}>
                <button type="button" className="svc-tree__service" onClick={() => setPreview(item)}>
                  <strong title={item.service}>{item.service || 'Unknown'}</strong>
                  <span>Project: {label(item.project_name || '')} · Environment: {label(item.environment)}</span>
                  <span>{label(item.team || '')}</span>
                </button>
              </li>
            )) : <li className="svc-tree__empty">No services match this search.</li>}
          </ul>
          {matchTotal > servicePageSize ? (
            <div className="ig-table-pager">
              <span>Showing {matchPageSafe * servicePageSize + 1}–{Math.min(matchTotal, matchPageSafe * servicePageSize + pagedMatches.length)} of {matchTotal}</span>
              <div className="ig-table-pager__actions">
                <button type="button" className="btn btn-secondary btn-sm" disabled={matchPageSafe === 0} onClick={() => setServicePage(matchPageSafe - 1)}>Previous</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={matchPageSafe >= matchPageCount - 1} onClick={() => setServicePage(matchPageSafe + 1)}>Next</button>
              </div>
            </div>
          ) : null}
          </>
        ) : null}
        {!loading && !query.trim() && !projectFilter ? (
          visibleProjects.length ? (
            <ul className="svc-tree">
              {visibleProjects.map((project) => {
                const serviceCount = project.environments.reduce((sum, env) => sum + (env.count || env.services.length), 0);
                return (
                  <li key={project.key}>
                    <Link className="svc-tree__folder" href={`/services?project_id=${project.id}`}>
                      <span>{project.name}</span>
                      <small>{project.environments.length} {project.environments.length === 1 ? 'environment' : 'environments'} · {serviceCount} {serviceCount === 1 ? 'service' : 'services'}</small>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <div className="empty-state">No projects are visible for this scope.</div>
        ) : null}
        {!loading && !query.trim() && currentProject && !environmentFilter ? (
          currentProject.environments.length ? (
            <ul className="svc-tree">
              {currentProject.environments.map((env) => (
                <li key={env.name}>
                  <Link className="svc-tree__folder" href={`/services?project_id=${currentProject.id}&environment=${encodeURIComponent(env.name)}`}>
                    <span>{env.name}</span>
                    <small>{(env.count || env.services.length)} {(env.count || env.services.length) === 1 ? 'service' : 'services'}</small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="empty-state">No environments on this project.</div>
        ) : null}
        {!loading && !query.trim() && currentProject && currentEnv ? (
          visibleServices.length ? (
            <>
            <ul className="svc-tree svc-tree__services">
              {pagedServices.map((item) => (
                <li key={item.id}>
                  <button type="button" className="svc-tree__service" onClick={() => setPreview(item)}>
                    <strong title={item.service}>{item.service || 'Unknown'}</strong>
                    <span>{item.repo.trim() || 'Repository not connected'}</span>
                    <span>{label(item.team || '') === 'Unknown' ? 'Owner not assigned' : label(item.team || '')}</span>
                  </button>
                </li>
              ))}
            </ul>
            {serviceTotal > servicePageSize ? (
              <div className="ig-table-pager">
                <span>Showing {servicePageSafe * servicePageSize + 1}–{Math.min(serviceTotal, servicePageSafe * servicePageSize + pagedServices.length)} of {serviceTotal}</span>
                <div className="ig-table-pager__actions">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={servicePageSafe === 0} onClick={() => setServicePage(servicePageSafe - 1)}>Previous</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={servicePageSafe >= servicePageCount - 1} onClick={() => setServicePage(servicePageSafe + 1)}>Next</button>
                </div>
              </div>
            ) : null}
            </>
          ) : (
            <div className="svc-tree__empty">
              <span>No services in this environment.</span>
              {currentProject.id ? <Link href={addHref}>Add service</Link> : null}
            </div>
          )
        ) : null}
        <InspectorDrawer
          open={Boolean(preview)}
          onClose={() => setPreview(null)}
          resetKey={preview?.id}
          label="Service preview"
          eyebrow="Service"
          title={preview?.service || 'Service'}
          subtitle={preview ? [preview.project_name || 'Project unknown', preview.environment || 'Environment unknown'].join(' · ') : undefined}
          headerActions={preview ? <CopyButton value={preview.service} label="service name" /> : null}
          footer={preview ? (
            <Link
              className="btn btn-primary"
              href={`/services/${preview.id}`}
              onClick={() => rememberService({ id: preview.id, name: preview.service, project: preview.project_name, environment: preview.environment })}
            >
              Open service
            </Link>
          ) : null}
        >
          {preview ? (
            <div className="portal-stack">
              <p>Project: {preview.project_name || 'Unknown'}</p>
              <p>Environment: {preview.environment || 'Unknown'}</p>
              <p>Repository: {preview.repo.trim() || 'Not connected'}</p>
              <p>Owner: {label(preview.team || '') === 'Unknown' ? 'Unassigned' : label(preview.team || '')}</p>
            </div>
          ) : null}
        </InspectorDrawer>
      </div>
    </DevOpsLayout>
  );
}
