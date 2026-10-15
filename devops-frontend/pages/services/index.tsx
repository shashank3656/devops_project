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
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [openEnvs, setOpenEnvs] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const [ownerTeamId, setOwnerTeamId] = useState('');

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

  const folders = useMemo(() => {
    const sourceProjects = projectFilter ? projects.filter((project) => String(project.id) === projectFilter) : projects;
    const sourceServices = filtering ? matches : items;
    return buildFolders(sourceProjects, sourceServices)
      .map((project) => ({
        ...project,
        environments: filtering
          ? project.environments.filter((env) => env.services.length > 0 && (!environmentFilter || env.name.toLowerCase() === environmentFilter.toLowerCase()))
          : project.environments.filter((env) => !environmentFilter || env.name.toLowerCase() === environmentFilter.toLowerCase()),
      }))
      .filter((project) => !filtering || project.environments.length > 0);
  }, [environmentFilter, filtering, items, matches, projectFilter, projects]);

  const toggle = (store: Record<string, boolean>, key: string, setStore: (next: Record<string, boolean>) => void) => {
    setStore({ ...store, [key]: !store[key] });
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    const first = matches[0];
    if (query.trim() && first) void router.push(`/services/${first.id}`);
  };

  const clearFilters = () => {
    setQuery('');
    setProjectFilter('');
    setEnvironmentFilter('');
    setOwnerTeamId('');
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Services - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Services</span>
            <h1 className="portal-page__title">Services</h1>
            <p className="portal-page__subtitle">
              Open a project, then an environment, then the services that live there.
            </p>
          </div>
          <Link href="/services/new" className="btn btn-primary">Add service</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <form onSubmit={search}>
          <div className="svc-filters">
            <label>
              Search
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Service, repo, or owner team" />
            </label>
            <label>
              Project
              <select className="input" value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setEnvironmentFilter(''); }}>
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name || project.code || 'Unknown'}</option>
                ))}
              </select>
            </label>
            <label>
              Environment
              <select className="input" value={environmentFilter} onChange={(event) => setEnvironmentFilter(event.target.value)}>
                <option value="">All environments</option>
                {environmentOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Owner team
              <select className="input" value={ownerTeamId} onChange={(event) => setOwnerTeamId(event.target.value)}>
                <option value="">{teams.length ? 'All owner teams' : 'No teams'}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <div className="svc-filters__actions">
              <button type="submit" className="btn btn-primary">Search</button>
              {filtering ? (
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear</button>
              ) : null}
            </div>
          </div>
          </form>
          {query.trim() ? (
            <ul className="svc-search">
              {matches.length ? matches.map((item) => (
                <li key={item.id}>
                  <Link href={`/services/${item.id}`}>
                    <strong>{item.service || 'Unknown'}</strong>
                    <span>{label(item.project_name || '')} · {label(item.environment)} · {label(item.team || '')}</span>
                  </Link>
                </li>
              )) : <li>No services match this search.</li>}
            </ul>
          ) : null}
          {loading ? <div className="empty-state">Loading services...</div> : null}
          {!loading && !folders.length ? <div className="empty-state">{filtering ? 'No services match these filters.' : 'No projects or services are visible for this scope.'}</div> : null}
          {folders.length ? (
            <ul className="svc-tree">
              {folders.map((project) => {
                const projectOpen = filtering || Boolean(openProjects[project.key]);
                const serviceCount = project.environments.reduce((sum, env) => sum + env.services.length, 0);
                return (
                  <li key={project.key}>
                    <button
                      type="button"
                      className="svc-tree__folder"
                      aria-expanded={projectOpen}
                      onClick={() => toggle(openProjects, project.key, setOpenProjects)}
                    >
                      <span>{projectOpen ? '▾' : '▸'} {project.name}</span>
                      <small>{project.environments.length} {project.environments.length === 1 ? 'environment' : 'environments'} · {serviceCount} {serviceCount === 1 ? 'service' : 'services'}</small>
                    </button>
                    {projectOpen ? (
                      <ul className="svc-tree svc-tree--nested">
                        {project.environments.length ? project.environments.map((env) => {
                          const envKey = `${project.key}:${env.name}`;
                          const envOpen = filtering || Boolean(openEnvs[envKey]);
                          const addHref = project.id
                            ? `/services/new?project_id=${project.id}&environment=${encodeURIComponent(env.name)}`
                            : '/services/new';
                          return (
                            <li key={envKey}>
                              <button
                                type="button"
                                className="svc-tree__folder svc-tree__folder--env"
                                aria-expanded={envOpen}
                                onClick={() => toggle(openEnvs, envKey, setOpenEnvs)}
                              >
                                <span>{envOpen ? '▾' : '▸'} {env.name}</span>
                                <small>{env.services.length} {env.services.length === 1 ? 'service' : 'services'}</small>
                              </button>
                              {envOpen ? (
                                env.services.length ? (
                                  <>
                                    <div className="svc-tree__head">
                                      <span>Service</span>
                                      <span>Repo</span>
                                      <span>Owner team</span>
                                    </div>
                                    <ul className="svc-tree__services">
                                      {env.services.map((item) => (
                                        <li key={item.id}>
                                          <Link href={`/services/${item.id}`} className="svc-tree__service">
                                            <strong>{item.service || 'Unknown'}</strong>
                                            <span>{item.repo || 'Unknown'}</span>
                                            <span>{label(item.team || '')}</span>
                                          </Link>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                ) : (
                                  <div className="svc-tree__empty">
                                    <span>No services in this environment.</span>
                                    {project.id ? <Link href={addHref}>Add service</Link> : null}
                                  </div>
                                )
                              ) : null}
                            </li>
                          );
                        }) : <li className="svc-tree__empty">No environments on this project.</li>}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
