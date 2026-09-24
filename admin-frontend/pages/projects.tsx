import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@infragate/ui';
import AdminLayout from '../components/AdminLayout';
import { asRecord, getString } from '../lib/payload';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  description: string;
  status: string;
  onboarding_stage?: string;
  ready_for_requests?: boolean;
  service_count?: number;
  team_count?: number;
  owner_team?: string;
  environments: string[];
  clouds: string[];
}

function stageTone(stage?: string): string {
  switch (stage) {
    case 'ready':
      return 'low';
    case 'configured':
    case 'team_mapped':
      return 'medium';
    case 'inactive':
    case 'archived':
      return 'muted';
    default:
      return 'info';
  }
}

const projectColumns: DataTableColumn<ProjectOption>[] = [
  {
    id: 'project',
    header: 'Project',
    cell: (project) => (
      <div className="ig-cell-stack">
        <span className="ig-cell-title">{project.name}</span>
        <span className="ig-cell-meta">
          <span className="ig-mono">{project.code}</span> · {project.owner_team || 'No owner team'}
        </span>
      </div>
    ),
  },
  {
    id: 'stage',
    header: 'Stage',
    cell: (project) => (
      <div className="ig-cell-stack">
        <span className={`ig-chip ig-chip--${stageTone(project.onboarding_stage)}`}>
          {(project.onboarding_stage || 'configured').replace(/_/g, ' ')}
        </span>
        {project.status !== 'active' ? <span className="ig-cell-meta">{project.status}</span> : null}
      </div>
    ),
  },
  {
    id: 'targets',
    header: 'Environments & clouds',
    cell: (project) => (
      <span className="ig-cell-chips">
        {project.environments.map((env) => (
          <span key={env} className="ig-chip">{env}</span>
        ))}
        {project.clouds.map((cloud) => (
          <span key={cloud} className="ig-chip ig-chip--muted">{cloud}</span>
        ))}
      </span>
    ),
  },
  {
    id: 'services',
    header: 'Services',
    align: 'right',
    cell: (project) => <span className="ig-mono">{project.service_count ?? 0}</span>,
  },
  {
    id: 'teams',
    header: 'Teams',
    align: 'right',
    cell: (project) => <span className="ig-mono">{project.team_count ?? 0}</span>,
  },
  {
    id: 'open',
    header: <span className="ig-sr-only">Open</span>,
    align: 'right',
    cell: (project) => (
      <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">
        View
      </Link>
    ),
  },
];

export default function AdminProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'archived'>('all');
  const [stageFilter, setStageFilter] = useState<'all' | 'ready' | 'configured' | 'inactive' | 'archived'>('all');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }

    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/admin/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(data.error, 'Failed to load projects'));
        }
        setProjects(Array.isArray(data.projects) ? (data.projects as ProjectOption[]) : []);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const haystack = `${project.name} ${project.code} ${project.owner_team || ''}`.toLowerCase();
      const matchesSearch = !search.trim() || haystack.includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const matchesStage = stageFilter === 'all' || (project.onboarding_stage || 'configured') === stageFilter;
      return matchesSearch && matchesStatus && matchesStage;
    });
  }, [projects, search, statusFilter, stageFilter]);

  const summary = useMemo(() => ({
    total: projects.length,
    ready: projects.filter((project) => project.ready_for_requests).length,
    active: projects.filter((project) => project.status === 'active').length,
    needsSetup: projects.filter((project) => !project.ready_for_requests && project.status === 'active').length,
  }), [projects]);

  const exportProjects = async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setExporting(true);
    try {
      const response = await fetch(`${apiUrl}/api/admin/projects?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        const data = asRecord(await response.json().catch(() => ({})));
        throw new Error(getString(data.error, 'Failed to export projects'));
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'admin-projects.csv';
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export projects');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Projects - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Project Governance</span>
              <h1 className="portal-page__title">Projects</h1>
              <p className="portal-page__subtitle">
                Review every DevOps-managed project catalog, its lifecycle stage, and how ready it is for user request traffic.
              </p>
            </div>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-secondary" onClick={() => void exportProjects()} disabled={exporting}>
                {exporting ? 'Exporting...' : 'Export CSV'}
              </button>
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <>
              <section className="portal-stat-grid" aria-busy={loading || undefined}>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Projects</span>
                  <span className="portal-stat-card__value">{summary.total}</span>
                  <p className="portal-stat-card__copy">All project catalogs currently visible to admin oversight.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Ready</span>
                  <span className="portal-stat-card__value">{summary.ready}</span>
                  <p className="portal-stat-card__copy">Projects that are fully ready for user requests.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Active</span>
                  <span className="portal-stat-card__value">{summary.active}</span>
                  <p className="portal-stat-card__copy">Projects currently open for request traffic.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Needs setup</span>
                  <span className="portal-stat-card__value">{summary.needsSetup}</span>
                  <p className="portal-stat-card__copy">Active projects missing team access or final request readiness.</p>
                </article>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Catalog</span>
                    <h2 className="portal-surface__title">Project inventory</h2>
                    <p className="portal-surface__subtitle">Search by project name/code and inspect lifecycle before drilling into details.</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  <input
                    type="search"
                    aria-label="Search projects"
                    className="input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search project, code, or owner team"
                    style={{ maxWidth: 300 }}
                  />
                  <select className="select" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                  <select className="select" aria-label="Filter by stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)}>
                    <option value="all">All stages</option>
                    <option value="ready">Ready</option>
                    <option value="configured">Configured</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <DataTable<ProjectOption>
                  label="Project inventory"
                  columns={projectColumns}
                  rows={filteredProjects}
                  rowKey={(project) => project.id}
                  loading={loading}
                  skeletonRows={6}
                  onRowOpen={(project) => router.push(`/projects/${project.id}`)}
                  empty={
                    <div className="ig-table-empty">
                      <strong>{projects.length === 0 ? 'No projects yet' : 'No projects match these filters'}</strong>
                      {projects.length > 0 ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setSearch('');
                            setStatusFilter('all');
                            setStageFilter('all');
                          }}
                        >
                          Clear filters
                        </button>
                      ) : (
                        <p>DevOps creates project catalogs; they appear here once onboarded.</p>
                      )}
                    </div>
                  }
                />
              </section>
          </>
        </div>
      </AdminLayout>
    </>
  );
}
