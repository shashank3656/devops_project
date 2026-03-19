import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

interface Runbook {
  id: number;
  project_id: number;
  service: string;
  title: string;
  content: string;
  link_url: string;
}

function normalizeProjects(value: unknown): ProjectOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((project) => ({
    id: typeof project?.id === 'number' ? project.id : 0,
    name: typeof project?.name === 'string' ? project.name : 'Unknown',
    code: typeof project?.code === 'string' ? project.code : 'n/a',
  }));
}

function normalizeRunbooks(value: unknown): Runbook[] {
  if (!Array.isArray(value)) return [];
  return value.map((runbook) => ({
    id: typeof runbook?.id === 'number' ? runbook.id : 0,
    project_id: typeof runbook?.project_id === 'number' ? runbook.project_id : 0,
    service: typeof runbook?.service === 'string' ? runbook.service : '',
    title: typeof runbook?.title === 'string' ? runbook.title : '',
    content: typeof runbook?.content === 'string' ? runbook.content : '',
    link_url: typeof runbook?.link_url === 'string' ? runbook.link_url : '',
  }));
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

function normalizeQueryValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim() : '';
}

export default function DevOpsRunbooksPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [projectId, setProjectId] = useState('');
  const [libraryProjectId, setLibraryProjectId] = useState('');
  const [libraryService, setLibraryService] = useState('');
  const [service, setService] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedProjectRunbooks = useMemo(() => {
    return runbooks.filter((runbook) => {
      if (libraryProjectId && String(runbook.project_id) !== libraryProjectId) return false;
      if (libraryService && runbook.service.trim().toLowerCase() !== libraryService.trim().toLowerCase()) return false;
      return true;
    });
  }, [libraryProjectId, libraryService, runbooks]);

  const hasLibraryFilters = Boolean(libraryProjectId || libraryService);

  const loadData = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/runbooks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load runbooks');
      }
      setProjects(normalizeProjects(data?.projects));
      setRunbooks(normalizeRunbooks(data?.runbooks));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runbooks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiUrl]);

  useEffect(() => {
    if (!router.isReady) return;
    setLibraryProjectId(normalizeQueryValue(router.query.project_id));
    setLibraryService(normalizeQueryValue(router.query.service));
  }, [router.isReady, router.query.project_id, router.query.service]);

  const resetForm = () => {
    setEditingId(null);
    setProjectId('');
    setService('');
    setTitle('');
    setContent('');
    setLinkUrl('');
  };

  const submit = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        editingId ? `${apiUrl}/api/devops/runbooks/${editingId}` : `${apiUrl}/api/devops/runbooks`,
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            project_id: Number(projectId),
            service,
            title,
            content,
            link_url: linkUrl,
          }),
        },
      );
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save runbook');
      }
      setNotice(editingId ? 'Runbook updated.' : 'Runbook created.');
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save runbook');
    } finally {
      setSaving(false);
    }
  };

  const removeRunbook = async (id: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!window.confirm('Delete this runbook?')) return;
    try {
      const response = await fetch(`${apiUrl}/api/devops/runbooks/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to delete runbook');
      }
      setNotice('Runbook deleted.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete runbook');
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Project Runbooks - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations Control</span>
            <h1 className="portal-page__title">Project Runbooks</h1>
            <p className="portal-page__subtitle">
              Attach repeatable recovery and delivery instructions to project services so tickets and projects have a standard operating guide.
            </p>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {hasLibraryFilters ? (
          <div className="alert alert-info">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                Showing runbooks
                {libraryProjectId ? ` for project #${libraryProjectId}` : ''}
                {libraryService ? ` for ${libraryService}` : ''}.
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setLibraryProjectId('');
                  setLibraryService('');
                  void router.push('/runbooks');
                }}
              >
                Clear filters
              </button>
            </div>
          </div>
        ) : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Runbook Editor</span>
              <h2 className="portal-surface__title">{editingId ? 'Update runbook' : 'Add runbook'}</h2>
            </div>
          </div>
          <div className="portal-form-grid">
            <label className="label">
              Project
              <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                ))}
              </select>
            </label>
            <label className="label">
              Service
              <input className="input" value={service} onChange={(event) => setService(event.target.value)} placeholder="eks, rds, networking" />
            </label>
            <label className="label">
              Title
              <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Production rollback" />
            </label>
            <label className="label">
              Reference link
              <input className="input" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://internal/wiki/runbook" />
            </label>
          </div>
          <label className="label">
            Runbook content
            <textarea className="input" rows={8} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Step-by-step runbook notes..." />
          </label>
          <div className="portal-form-actions">
            <button type="button" className="btn btn-primary" disabled={saving || !projectId || !title.trim()} onClick={() => void submit()}>
              {saving ? 'Saving...' : editingId ? 'Update runbook' : 'Create runbook'}
            </button>
            {editingId ? (
              <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancel edit</button>
            ) : null}
          </div>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Library</span>
              <h2 className="portal-surface__title">Available runbooks</h2>
            </div>
          </div>
          <div className="portal-form-grid" style={{ marginBottom: 16 }}>
            <label className="label">
              Filter by project
              <select className="input" value={libraryProjectId} onChange={(event) => setLibraryProjectId(event.target.value)}>
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                ))}
              </select>
            </label>
            <label className="label">
              Filter by service
              <input
                className="input"
                value={libraryService}
                onChange={(event) => setLibraryService(event.target.value)}
                placeholder="eks, rds, networking"
              />
            </label>
          </div>
          {loading ? (
            <div className="empty-state">Loading runbooks...</div>
          ) : selectedProjectRunbooks.length === 0 ? (
            <div className="empty-state">
              {hasLibraryFilters ? 'No runbooks match the current filters.' : 'No runbooks yet.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Service</th>
                    <th>Title</th>
                    <th>Link</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProjectRunbooks.map((runbook) => {
                    const project = projects.find((item) => item.id === runbook.project_id);
                    return (
                      <tr key={runbook.id}>
                        <td>{project ? `${project.name} (${project.code})` : runbook.project_id}</td>
                        <td>{runbook.service || 'General'}</td>
                        <td>{runbook.title}</td>
                        <td>{runbook.link_url ? <a href={runbook.link_url} target="_blank" rel="noreferrer">Open link</a> : 'Inline only'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setEditingId(runbook.id);
                                setProjectId(String(runbook.project_id));
                                setService(runbook.service);
                                setTitle(runbook.title);
                                setContent(runbook.content);
                                setLinkUrl(runbook.link_url);
                              }}
                            >
                              Edit
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void removeRunbook(runbook.id)}>
                              Delete
                            </button>
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
      </div>
    </DevOpsLayout>
  );
}
