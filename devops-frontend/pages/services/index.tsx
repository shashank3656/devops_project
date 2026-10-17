import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
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
      environments: names.map((name) => ({ name, services: [] })),
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
      env = { name: envName, services: [] };
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
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<OwnerTeam[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [ownerTeamId, setOwnerTeamId] = useState('');
  const projectFilter = router.isReady ? firstQuery(router.query.project_id) : '';
  const environmentFilter = router.isReady ? firstQuery(router.query.environment) : '';

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}/api/devops/services`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => res.json().catch(() => ({}))),
      loadOwnerTeams(apiUrl, token),
    ])
      .then(([servicesData, projectsData, ownerTeams]) => {
        if (servicesData?.error && !Array.isArray(servicesData.services)) {
          setError(servicesData.error || 'Failed to load services');
          return;
        }
        setItems(Array.isArray(servicesData.services) ? servicesData.services : []);
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
  }, [apiUrl]);

  const selectedTeam = teams.find((team) => String(team.id) === ownerTeamId);
  const filtering = Boolean(query.trim() || projectFilter || environmentFilter || ownerTeamId);

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

  const catalog = useMemo(() => buildFolders(projects, items), [items, projects]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const first = matches[0];
    if (query.trim() && first) void router.push(`/services/${first.id}`);
  };

  const clearFilters = () => {
    setQuery('');
    setOwnerTeamId('');
    void router.push('/services');
  };

  const currentProject = catalog.find((project) => projectFilter && String(project.id) === projectFilter) || null;
  const currentEnv = currentProject?.environments.find((env) => environmentFilter && env.name.toLowerCase() === environmentFilter.toLowerCase()) || null;
  const visibleProjects = (ownerTeamId
    ? catalog.filter((project) => project.environments.some((env) => env.services.some((service) => teamMatches(service.team || '', selectedTeam))))
    : catalog
  ).filter((project) => project.id > 0);
  const visibleServices = (currentEnv?.services || []).filter((service) => !ownerTeamId || teamMatches(service.team || '', selectedTeam));
  const needsSetup = matches.filter((item) => !item.repo.trim() || !label(item.team || '').trim() || label(item.team || '') === 'Unknown');
  const addHref = projectFilter
    ? `/services/new?project_id=${projectFilter}${environmentFilter ? `&environment=${encodeURIComponent(environmentFilter)}` : ''}`
    : '/services/new';

  return (
    <DevOpsLayout>
      <Head>
        <title>Services - DevOps</title>
      </Head>
      <div className="ops-frame">
        <header className="ops-frame__head">
          <div>
            <p className="ops-kicker">Service catalogue</p>
            <h1>{currentEnv ? currentEnv.name : currentProject ? currentProject.name : 'Services'}</h1>
            <p>Open a project, then an environment, then the services inside it.</p>
          </div>
          <Link href={addHref} className="btn btn-primary">Add service</Link>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="ops-minis" aria-label="Service summary">
          <article className="ops-mini ops-mini--mint">
            <span>Registered services</span>
            <strong>{loading || error ? 'Unknown' : matches.length}</strong>
            <small>{currentProject ? currentProject.name : 'All visible projects'}</small>
          </article>
          <article className="ops-mini ops-mini--lilac">
            <span>Needs setup</span>
            <strong>{loading || error ? 'Unknown' : needsSetup.length}</strong>
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
          <ul className="svc-tree">
            {matches.length ? matches.map((item) => (
              <li key={item.id}>
                <Link className="svc-tree__service" href={`/services/${item.id}`}>
                  <strong>{item.service || 'Unknown'}</strong>
                  <span>{label(item.project_name || '')} · {label(item.environment)}</span>
                  <span>{label(item.team || '')}</span>
                </Link>
              </li>
            )) : <li className="svc-tree__empty">No services match this search.</li>}
          </ul>
        ) : null}
        {!loading && !query.trim() && !projectFilter ? (
          visibleProjects.length ? (
            <ul className="svc-tree">
              {visibleProjects.map((project) => {
                const serviceCount = project.environments.reduce((sum, env) => sum + env.services.length, 0);
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
                    <small>{env.services.length} {env.services.length === 1 ? 'service' : 'services'}</small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="empty-state">No environments on this project.</div>
        ) : null}
        {!loading && !query.trim() && currentProject && currentEnv ? (
          visibleServices.length ? (
            <ul className="svc-tree svc-tree__services">
              {visibleServices.map((item) => (
                <li key={item.id}>
                  <Link className="svc-tree__service" href={`/services/${item.id}`}>
                    <strong>{item.service || 'Unknown'}</strong>
                    <span>{item.repo.trim() || 'Repository not connected'}</span>
                    <span>{label(item.team || '') === 'Unknown' ? 'Owner not assigned' : label(item.team || '')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="svc-tree__empty">
              <span>No services in this environment.</span>
              {currentProject.id ? <Link href={addHref}>Add service</Link> : null}
            </div>
          )
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
