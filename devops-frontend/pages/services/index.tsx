import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, formatOperationalTime, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import { rememberService } from '../../lib/recentServices';
import { ServiceClassBadge } from '../../components/SreServiceWorkspace';
import { SERVICE_CLASSES, inventoryServicesPath, scheduleModeCopy } from '../../lib/sreMonitoring';
import { serviceDetailHref, serviceTicketHref } from '../../lib/scopeHref';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ServiceRow {
  id: number;
  project_id?: number;
  service: string;
  repo: string;
  environment: string;
  team?: string;
  project_name?: string;
  criticality?: string;
  open_critical?: number;
  open_warning?: number;
  last_evaluated_at?: string;
  schedule_minutes?: number;
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

function needsSetup(item: ServiceRow): boolean {
  return !(item.repo || '').trim() || label(item.team || '') === 'Unknown';
}

function openFindingCount(item: ServiceRow): number {
  return (item.open_critical || 0) + (item.open_warning || 0);
}

export default function ServiceInventoryPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ServiceRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<OwnerTeam[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [ownerTeamId, setOwnerTeamId] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [findingsFilter, setFindingsFilter] = useState('');
  const [filtersReady, setFiltersReady] = useState(false);
  const projectFilter = router.isReady ? firstQuery(router.query.project_id) : '';

  useEffect(() => {
    if (!router.isReady || filtersReady) return;
    setQuery(firstQuery(router.query.q));
    setOwnerTeamId(firstQuery(router.query.team));
    setClassFilter(firstQuery(router.query.class));
    setFindingsFilter(firstQuery(router.query.findings));
    setFiltersReady(true);
  }, [filtersReady, router.isReady, router.query.class, router.query.findings, router.query.q, router.query.team]);

  const selectedTeam = teams.find((team) => String(team.id) === ownerTeamId);

  useEffect(() => {
    if (!router.isReady || !filtersReady) return;
    const next = new URLSearchParams();
    if (projectFilter) next.set('project_id', projectFilter);
    if (query.trim()) next.set('q', query.trim());
    if (ownerTeamId) next.set('team', ownerTeamId);
    if (classFilter) next.set('class', classFilter);
    if (findingsFilter) next.set('findings', findingsFilter);
    const current = new URLSearchParams();
    ['project_id', 'q', 'team', 'class', 'findings'].forEach((key) => {
      const value = firstQuery(router.query[key]);
      if (value) current.set(key, value);
    });
    if (next.toString() === current.toString()) return;
    void router.replace({ pathname: '/services', query: Object.fromEntries(next.entries()) }, undefined, { shallow: true });
  }, [classFilter, filtersReady, findingsFilter, ownerTeamId, projectFilter, query, router]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !filtersReady) return;
    setLoading(true);
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}${inventoryServicesPath()}`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => res.json().catch(() => ({}))),
      loadOwnerTeams(apiUrl, token),
    ])
      .then(([servicesData, projectsData, ownerTeams]) => {
        if (servicesData?.error && !Array.isArray(servicesData.services)) {
          setError(servicesData.error || 'Failed to load service inventory');
          return;
        }
        setItems(Array.isArray(servicesData.services) ? servicesData.services as ServiceRow[] : []);
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
  }, [apiUrl, filtersReady]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (projectFilter && String(item.project_id || 0) !== projectFilter) return false;
      if (ownerTeamId && !teamMatches(item.team || '', selectedTeam)) return false;
      if (classFilter && (item.criticality || 'unclassified') !== classFilter) return false;
      if (findingsFilter === 'open' && openFindingCount(item) === 0) return false;
      if (findingsFilter === 'critical' && !(item.open_critical || 0)) return false;
      if (findingsFilter === 'none' && openFindingCount(item) > 0) return false;
      if (!needle) return true;
      return [item.service, item.repo, item.team, item.project_name].join(' ').toLowerCase().includes(needle);
    });
  }, [classFilter, findingsFilter, items, ownerTeamId, projectFilter, query, selectedTeam]);

  const filtering = Boolean(query.trim() || projectFilter || ownerTeamId || classFilter || findingsFilter);
  const incompleteCount = items.filter(needsSetup).length;
  const openFindings = items.reduce((sum, item) => sum + openFindingCount(item), 0);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const first = rows[0];
    if (query.trim() && first) void router.push(serviceDetailHref(first.id, router.query));
  };

  const clearFilters = () => {
    setQuery('');
    setOwnerTeamId('');
    setClassFilter('');
    setFindingsFilter('');
    if (projectFilter) void router.replace({ pathname: '/services' }, undefined, { shallow: true });
  };

  const setProjectFilter = (value: string) => {
    const next = new URLSearchParams();
    if (value) next.set('project_id', value);
    if (query.trim()) next.set('q', query.trim());
    if (ownerTeamId) next.set('team', ownerTeamId);
    if (classFilter) next.set('class', classFilter);
    if (findingsFilter) next.set('findings', findingsFilter);
    void router.replace({ pathname: '/services', query: Object.fromEntries(next.entries()) }, undefined, { shallow: true });
  };

  const columns: DataTableColumn<ServiceRow>[] = useMemo(() => [
    {
      id: 'service',
      header: 'Service',
      cell: (item) => (
        <div className="ig-cell-stack">
          <span className="ig-cell-title">{item.service || 'Unknown'}</span>
          <span className="ig-cell-meta">{(item.repo || '').trim() || 'Repository not connected'}</span>
        </div>
      ),
    },
    {
      id: 'project',
      header: 'Project',
      cell: (item) => label(item.project_name || ''),
    },
    {
      id: 'owner',
      header: 'Owner team',
      cell: (item) => (label(item.team || '') === 'Unknown' ? 'Not assigned' : label(item.team || '')),
    },
    {
      id: 'class',
      header: 'Class',
      cell: (item) => <ServiceClassBadge value={item.criticality} />,
    },
    {
      id: 'findings',
      header: 'Findings',
      cell: (item) => (
        openFindingCount(item)
          ? `${item.open_critical || 0} critical / ${item.open_warning || 0} warning`
          : 'None recorded'
      ),
    },
    {
      id: 'evaluation',
      header: 'Last evaluation',
      cell: (item) => (
        <div className="ig-cell-stack">
          <span className="ig-cell-title">{item.last_evaluated_at ? formatOperationalTime(item.last_evaluated_at) : 'Unknown'}</span>
          <span className="ig-cell-meta">{scheduleModeCopy(item.schedule_minutes)}</span>
        </div>
      ),
    },
    {
      id: 'tickets',
      header: 'Tickets',
      className: 'ig-cell-actions',
      cell: (item) => (
        <div className="runbooks__action-row">
          <Link className="btn btn-secondary btn-sm" href={serviceTicketHref('/changes/new', item)}>Change</Link>
          <Link className="btn btn-secondary btn-sm" href={serviceTicketHref('/incidents/new', item)}>Incident</Link>
        </div>
      ),
    },
  ], []);

  return (
    <DevOpsLayout>
      <Head>
        <title>Service inventory - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Services</span>
            <h1 className="portal-page__title">Service inventory</h1>
            <p className="portal-page__subtitle">Production services. Observability and findings stay on the service. Change and incident forms use this same list.</p>
          </div>
          <Link href={projectFilter ? `/services/new?project_id=${projectFilter}` : '/services/new'} className="btn btn-primary">Add service</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="ops-minis" aria-label="Service inventory summary">
          <article className="ops-mini ops-mini--mint">
            <span>Registered services</span>
            <strong>{loading || error ? 'Unknown' : items.length}</strong>
            <small>Production inventory</small>
          </article>
          <article className="ops-mini ops-mini--lilac">
            <span>Needs setup</span>
            <strong>{loading || error ? 'Unknown' : incompleteCount}</strong>
            <small>Owner and repository missing</small>
          </article>
          <article className="ops-mini ops-mini--blue">
            <span>Open findings</span>
            <strong>{loading || error ? 'Unknown' : openFindings}</strong>
            <small>Critical and warning on this inventory</small>
          </article>
        </section>
        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <h2 className="portal-surface__title">Production catalogue</h2>
              <p className="portal-surface__subtitle">Open a row for observability, findings, and configuration. Change and incident forms use this same list.</p>
            </div>
          </div>
          <form className="svc-filters svc-filters--inventory" onSubmit={search}>
            <label>
              Search
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, repository, or team" />
            </label>
            <label>
              Project
              <select className="input" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name || project.code}</option>
                ))}
              </select>
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
              Owner team
              <select className="input" value={ownerTeamId} onChange={(event) => setOwnerTeamId(event.target.value)}>
                <option value="">{teams.length ? 'All teams' : 'No teams'}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <label>
              Findings
              <select className="input" value={findingsFilter} onChange={(event) => setFindingsFilter(event.target.value)}>
                <option value="">All</option>
                <option value="open">Open findings</option>
                <option value="critical">Critical</option>
                <option value="none">None recorded</option>
              </select>
            </label>
            {filtering ? <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear</button> : <span />}
          </form>
          <div className="ig-legacy-table">
            <DataTable<ServiceRow>
              label="Service inventory"
              columns={columns}
              rows={rows}
              rowKey={(item) => item.id}
              loading={loading}
              onRowOpen={(item) => {
                rememberService({
                  id: item.id,
                  name: item.service,
                  project: item.project_name,
                  environment: item.environment,
                });
                void router.push(serviceDetailHref(item.id, router.query));
              }}
              empty={
                <EmptyState
                  title={filtering ? 'No services match these filters' : 'No production services yet'}
                  body={filtering ? 'Clear filters to see the full inventory.' : 'Add a service to this inventory. Change and incident requests pick from this list.'}
                />
              }
            />
          </div>
        </section>
      </div>
    </DevOpsLayout>
  );
}
