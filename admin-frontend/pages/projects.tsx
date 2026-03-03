import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../components/AdminLayout';

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

function stageTone(stage?: string): { background: string; color: string } {
  switch (stage) {
    case 'ready':
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
    case 'configured':
    case 'team_mapped':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    case 'inactive':
    case 'archived':
      return { background: 'rgba(148, 163, 184, 0.14)', color: 'var(--color-text-muted)' };
    default:
      return { background: 'var(--color-primary-light)', color: 'var(--color-primary)' };
  }
}

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
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load projects');
        }
        setProjects(Array.isArray(data.projects) ? data.projects : []);
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
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to export projects');
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

          {loading ? (
            <div className="portal-surface"><div className="empty-state">Loading projects...</div></div>
          ) : (
            <>
              <section className="portal-stat-grid">
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
                    className="input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search project, code, or owner team"
                    style={{ maxWidth: 300 }}
                  />
                  <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                  <select className="select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)}>
                    <option value="all">All stages</option>
                    <option value="ready">Ready</option>
                    <option value="configured">Configured</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                {filteredProjects.length === 0 ? (
                  <div className="empty-state">No projects match the current filters.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="templates-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Owner team</th>
                          <th>Status</th>
                          <th>Stage</th>
                          <th>Environments</th>
                          <th>Clouds</th>
                          <th>Services</th>
                          <th>Teams</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProjects.map((project) => {
                          const stageStyle = stageTone(project.onboarding_stage);
                          return (
                            <tr key={project.id}>
                              <td>
                                <strong>{project.name}</strong>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{project.code}</div>
                              </td>
                              <td>{project.owner_team || 'Not set'}</td>
                              <td>{project.status}</td>
                              <td>
                                <span style={{ ...stageStyle, padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                                  {project.onboarding_stage || 'configured'}
                                </span>
                              </td>
                              <td>{project.environments.join(', ')}</td>
                              <td>{project.clouds.join(', ')}</td>
                              <td>{project.service_count ?? 0}</td>
                              <td>{project.team_count ?? 0}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">View</Link>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
