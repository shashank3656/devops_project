import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CopyButton, InspectorDrawer } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import { rememberService } from '../../lib/recentServices';
import { ServiceClassBadge } from '../../components/SreServiceWorkspace';
import { SERVICE_CLASSES } from '../../lib/sreMonitoring';
import { serviceDetailHref } from '../../lib/scopeHref';
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
  criticality?: string;
  open_critical?: number;
  open_warning?: number;
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

interface OwnerTeam {
  id: number;
  name: string;
  slug: string;
}

interface ProjectFolder {
  key: string;
  id: number;
  name: string;
  count: number;
  services: ServiceRow[];
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
    byId.set(project.id, {
      key: `project-${project.id}`,
      id: project.id,
      name: project.name || project.code || 'Unknown',
      count: 0,
      services: [],
    });
  });

  services.forEach((service) => {
    const projectId = service.project_id && service.project_id > 0 ? service.project_id : 0;
    let folder = projectId ? byId.get(projectId) : undefined;
    if (!folder) {
      const name = label(service.project_name || '');
      const key = `loose-${name.toLowerCase()}`;
      folder = loose.get(key) || { key, id: 0, name, count: 0, services: [] };
      loose.set(key, folder);
    }
    folder.services.push(service);
    folder.count += 1;
  });

  return [...byId.values(), ...loose.values()];
}

export default function ServiceInventoryPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ServiceRow[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [summary, setSummary] = useState<Array<{ project_id: number; project_name: string; count: number }>>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<OwnerTeam[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [ownerTeamId, setOwnerTeamId] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [servicePage, setServicePage] = useState(0);
  const [preview, setPreview] = useState<ServiceRow | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);
  const [incompleteCount, setIncompleteCount] = useState<number | null>(null);
  const projectFilter = router.isReady ? firstQuery(router.query.project_id) : '';
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
  }, [projectFilter, ownerTeamId, query]);
  useEffect(() => {
    if (!router.isReady || !filtersReady) return;
    const next = new URLSearchParams();
    if (projectFilter) next.set('project_id', projectFilter);
    if (query.trim()) next.set('q', query.trim());
    if (ownerTeamId) next.set('team', ownerTeamId);
    const current = new URLSearchParams();
    ['project_id', 'q', 'team'].forEach((key) => {
      const value = firstQuery(router.query[key]);
      if (value) current.set(key, value);
    });
    if (next.toString() === current.toString()) return;
    const queryObject = Object.fromEntries(next.entries());
    void router.replace({ pathname: '/services', query: queryObject }, undefined, { shallow: true });
  }, [filtersReady, ownerTeamId, projectFilter, query, router]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !filtersReady) return;
    setLoading(true);
    const headers = { Authorization: `Bearer ${token}` };
    const listing = Boolean(query.trim() || projectFilter || ownerTeamId);
    const params = new URLSearchParams();
    params.set('monitored', '1');
    if (listing) {
      params.set('limit', '50');
      params.set('offset', String(servicePage * 50));
      if (projectFilter) params.set('project_id', projectFilter);
      if (query.trim()) params.set('q', query.trim());
      if (ownerTeamQuery) params.set('team', ownerTeamQuery);
    } else {
      params.set('view', 'summary');
    }
    Promise.all([
      fetch(`${apiUrl}/api/devops/services?${params}`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => res.json().catch(() => ({}))),
      loadOwnerTeams(apiUrl, token),
    ])
      .then(([servicesData, projectsData, ownerTeams]) => {
        if (servicesData?.error && !Array.isArray(servicesData.services)) {
          setError(servicesData.error || 'Failed to load service inventory');
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
          setIncompleteCount(nextItems.filter((item) => !(item.repo || '').trim() || !label(item.team || '').trim() || label(item.team || '') === 'Unknown').length);
        } else {
          setIncompleteCount(null);
        }
        const list = Array.isArray(projectsData?.projects) ? projectsData.projects : [];
        setProjects(
          list
            .map((item: { id?: number; name?: string; code?: string }) => ({
              id: typeof item.id === 'number' ? item.id : 0,
              name: item.name || '',
              code: item.code || '',
            }))
            .filter((item: ProjectOption) => item.id > 0),
        );
        setTeams(ownerTeams);
      })
      .catch(() => setError('Failed to load service inventory'))
      .finally(() => setLoading(false));
  }, [apiUrl, filtersReady, ownerTeamId, ownerTeamQuery, projectFilter, query, servicePage]);

  const filtering = Boolean(query.trim() || ownerTeamId || classFilter);
  const setupLabel = loading || error || incompleteCount === null
    ? 'Unknown'
    : String(incompleteCount);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (projectFilter && String(item.project_id || 0) !== projectFilter) return false;
      if (ownerTeamId && !teamMatches(item.team || '', selectedTeam)) return false;
      if (classFilter && (item.criticality || 'unclassified') !== classFilter) return false;
      if (!needle) return true;
      const haystack = [item.service, item.repo, item.team, item.project_name].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [classFilter, items, ownerTeamId, projectFilter, query, selectedTeam]);

  const catalog = useMemo(() => {
    if (!query.trim() && summary.length) {
      return summary.map((row) => ({
        key: `project-${row.project_id || 0}`,
        id: row.project_id || 0,
        name: label(row.project_name || ''),
        count: row.count,
        services: [] as ServiceRow[],
      }));
    }
    return buildFolders(projects, items);
  }, [items, projects, query, summary]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const first = matches[0];
    if (query.trim() && first) void router.push(serviceDetailHref(first.id, router.query));
  };

  const clearFilters = () => {
    setQuery('');
    setOwnerTeamId('');
    setClassFilter('');
  };

  const currentProject = catalog.find((project) => projectFilter && String(project.id) === projectFilter) || null;
  const visibleProjects = (ownerTeamId
    ? catalog.filter((project) => project.services.some((service) => teamMatches(service.team || '', selectedTeam)))
    : catalog
  ).filter((project) => project.id > 0);
  const visibleServices = (currentProject?.services.length ? currentProject.services : items).filter((service) => (
    (!projectFilter || String(service.project_id || 0) === projectFilter)
    && (!ownerTeamId || teamMatches(service.team || '', selectedTeam))
    && (!classFilter || (service.criticality || 'unclassified') === classFilter)
  ));
  const servicePageSize = 50;
  const showingList = Boolean(query.trim() || projectFilter || ownerTeamId);
  const serviceTotal = pageTotal || (query.trim() ? matches.length : visibleServices.length);
  const servicePageCount = Math.max(1, Math.ceil(serviceTotal / servicePageSize));
  const servicePageSafe = Math.min(servicePage, servicePageCount - 1);
  const pagedServices = visibleServices;
  const matchTotal = pageTotal || matches.length;
  const matchPageCount = Math.max(1, Math.ceil(matchTotal / servicePageSize));
  const matchPageSafe = Math.min(servicePage, matchPageCount - 1);
  const pagedMatches = matches;
  const addHref = projectFilter ? `/services/new?project_id=${projectFilter}` : '/services/new';
  const openFindings = items.reduce((sum, item) => sum + (item.open_critical || 0) + (item.open_warning || 0), 0);

  return (
    <DevOpsLayout>
      <Head>
        <title>Service inventory - OpsTrellis</title>
      </Head>
      <div className="ops-frame">
        <header className="ops-frame__head">
          <div>
            <h1>{currentProject ? currentProject.name : 'Service inventory'}</h1>
            <p className="portal-page__subtitle">Production services. Observability, findings, and configuration stay on the service.</p>
          </div>
          <Link href={addHref} className="btn btn-primary">Add service</Link>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="ops-minis" aria-label="Service inventory summary">
          <article className="ops-mini ops-mini--mint">
            <span>Registered services</span>
            <strong>{loading || error ? 'Unknown' : (pageTotal || matches.length || visibleProjects.reduce((sum, project) => sum + (project.count || project.services.length), 0))}</strong>
            <small>{currentProject ? currentProject.name : 'All visible projects'}</small>
          </article>
          <article className="ops-mini ops-mini--lilac">
            <span>Needs setup</span>
            <strong>{setupLabel}</strong>
            <small>Owner and repository missing</small>
          </article>
          <article className="ops-mini ops-mini--blue">
            <span>Monitored environment</span>
            <strong>Production</strong>
            <small>{showingList && !loading && !error ? `${openFindings} open findings on this page` : 'Findings open on each service'}</small>
          </article>
        </section>
        <form className="portal-surface" onSubmit={search}>
          <div className="svc-filters">
            <label>
              Search services
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or repository" />
            </label>
            <label>
              Criticality
              <select className="input" value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                <option value="">All classes</option>
                {SERVICE_CLASSES.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
            </label>
            <label>
              Service owner team
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
        {projectFilter ? (
          <nav className="svc-crumb" aria-label="Location">
            <Link href="/services">Service inventory</Link>
            {currentProject ? (
              <>
                <span aria-hidden="true">/</span>
                <span>{currentProject.name}</span>
              </>
            ) : null}
          </nav>
        ) : null}
        {loading ? <div className="empty-state">Loading service inventory...</div> : null}
        {!loading && query.trim() ? (
          <>
          <ul className="svc-tree">
            {matches.length ? pagedMatches.map((item) => (
              <li key={item.id}>
                <button type="button" className="svc-tree__service" onClick={() => setPreview(item)}>
                  <strong title={item.service}>{item.service || 'Unknown'}</strong>
                  <span>Project: {label(item.project_name || '')}</span>
                  <span>{label(item.team || '') === 'Unknown' ? 'Owner not assigned' : label(item.team || '')} · <ServiceClassBadge value={item.criticality} /></span>
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
                const serviceCount = project.count || project.services.length;
                return (
                  <li key={project.key}>
                    <Link className="svc-tree__folder" href={`/services?project_id=${project.id}`}>
                      <span>{project.name}</span>
                      <small>{serviceCount} {serviceCount === 1 ? 'production service' : 'production services'}</small>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <div className="empty-state">No projects are visible for this scope.</div>
        ) : null}
        {!loading && !query.trim() && currentProject ? (
          visibleServices.length ? (
            <>
            <ul className="svc-tree svc-tree__services">
              {pagedServices.map((item) => (
                <li key={item.id}>
                  <button type="button" className="svc-tree__service" onClick={() => setPreview(item)}>
                    <strong title={item.service}>{item.service || 'Unknown'}</strong>
                    <span>{(item.repo || '').trim() || 'Repository not connected'}</span>
                    <span>{label(item.team || '') === 'Unknown' ? 'Owner not assigned' : label(item.team || '')} · <ServiceClassBadge value={item.criticality} />{(item.open_critical || item.open_warning) ? ` · ${item.open_critical || 0} critical / ${item.open_warning || 0} warning` : ''}</span>
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
              <span>No production services in this project.</span>
              {currentProject.id ? <Link href={addHref}>Add service</Link> : null}
            </div>
          )
        ) : null}
        <InspectorDrawer
          open={Boolean(preview)}
          onClose={() => setPreview(null)}
          resetKey={preview?.id}
          label="Service preview"
          eyebrow="Service inventory"
          title={preview?.service || 'Service'}
          subtitle={preview ? [preview.project_name || 'Project unknown', 'Production'].join(' · ') : undefined}
          headerActions={preview ? <CopyButton value={preview.service} label="service name" /> : null}
          footer={preview ? (
            <div className="portal-page__actions">
              <Link className="btn btn-secondary" href={`${serviceDetailHref(preview.id, router.query)}&tab=findings`}>
                {(preview.open_critical || preview.open_warning) ? 'Open findings' : 'View findings'}
              </Link>
              <Link
                className="btn btn-secondary"
                href={`${serviceDetailHref(preview.id, router.query)}&tab=observability`}
              >
                Open observability
              </Link>
              <Link
                className="btn btn-primary"
                href={serviceDetailHref(preview.id, router.query)}
                onClick={() => rememberService({ id: preview.id, name: preview.service, project: preview.project_name, environment: preview.environment })}
              >
                Open service
              </Link>
            </div>
          ) : null}
        >
          {preview ? (
            <div className="portal-stack">
              <p>Project: {preview.project_name || 'Unknown'}</p>
              <p>Monitored environment: Production</p>
              <p>Repository: {(preview.repo || '').trim() || 'Not connected'}</p>
              <p>Owner: {label(preview.team || '') === 'Unknown' ? 'Unassigned' : label(preview.team || '')}</p>
              <p>Class: <ServiceClassBadge value={preview.criticality} /> <span className="form-section__copy">Class is not a health indicator.</span></p>
              <p>Open findings: {(preview.open_critical || 0) + (preview.open_warning || 0) ? `${preview.open_critical || 0} critical / ${preview.open_warning || 0} warning` : 'None recorded. That is not proof of health if monitors have not been evaluated.'}</p>
            </div>
          ) : null}
        </InspectorDrawer>
      </div>
    </DevOpsLayout>
  );
}
