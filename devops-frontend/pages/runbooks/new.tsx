import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
  services: ProjectServiceOption[];
}

interface ProjectServiceOption {
  cloud: string;
  service: string;
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
  return value.map((project) => {
    const item = project && typeof project === 'object' ? (project as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      name: typeof item.name === 'string' ? item.name : 'Unknown',
      code: typeof item.code === 'string' ? item.code : 'n/a',
      services: Array.isArray(item.services)
        ? item.services
            .map((service) => {
              const value = service && typeof service === 'object' ? (service as Record<string, unknown>) : {};
              return {
                cloud: typeof value.cloud === 'string' ? value.cloud : '',
                service: typeof value.service === 'string' ? value.service : '',
              };
            })
            .filter((service) => service.service)
        : [],
    };
  });
}

function normalizeRunbooks(value: unknown): Runbook[] {
  if (!Array.isArray(value)) return [];
  return value.map((runbook) => {
    const item = runbook && typeof runbook === 'object' ? (runbook as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      project_id: typeof item.project_id === 'number' ? item.project_id : 0,
      service: typeof item.service === 'string' ? item.service : '',
      title: typeof item.title === 'string' ? item.title : '',
      content: typeof item.content === 'string' ? item.content : '',
      link_url: typeof item.link_url === 'string' ? item.link_url : '',
    };
  });
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export default function NewRunbookPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [projectId, setProjectId] = useState('');
  const [service, setService] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const availableEditorServices = useMemo(() => {
    const project = projects.find((item) => String(item.id) === projectId);
    const values = new Set<string>();
    project?.services.forEach((entry) => {
      const nextValue = entry.service.trim();
      if (nextValue) values.add(nextValue);
    });
    runbooks
      .filter((runbook) => String(runbook.project_id) === projectId)
      .forEach((runbook) => {
        const nextValue = runbook.service.trim();
        if (nextValue) values.add(nextValue);
      });
    if (service.trim()) values.add(service.trim());
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [projectId, projects, runbooks, service]);

  const selectedProject = useMemo(
    () => projects.find((item) => String(item.id) === projectId) ?? null,
    [projectId, projects],
  );

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
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to load runbook options'));
      }
      setProjects(normalizeProjects(data.projects));
      setRunbooks(normalizeRunbooks(data.runbooks));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runbook options');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiUrl]);

  useEffect(() => {
    if (!projectId) {
      setService('');
      return;
    }
    if (!service) return;
    if (availableEditorServices.includes(service)) return;
    setService('');
  }, [availableEditorServices, projectId, service]);

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
      const response = await fetch(`${apiUrl}/api/devops/runbooks`, {
        method: 'POST',
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
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to save runbook'));
      }
      setNotice('Runbook created.');
      setProjectId('');
      setService('');
      setTitle('');
      setContent('');
      setLinkUrl('');
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save runbook');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Create Runbook - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Runbook Editor</span>
            <h1 className="portal-page__title">Create runbook</h1>
            <p className="portal-page__subtitle">
              Add a runbook on its own page so the library stays focused on browsing and reuse.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/runbooks" className="btn btn-secondary">
              Back to runbooks
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">New runbook</span>
              <h2 className="portal-surface__title">Runbook details</h2>
              <p className="portal-surface__subtitle">
                Choose the project and service first, then capture the operational steps and supporting link in one clean editor.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading runbook options...</div>
          ) : (
            <div className="catalog-editor__form">
              <div className="portal-form-grid catalog-editor__field-grid">
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
                  <select
                    className="input"
                    value={service}
                    onChange={(event) => setService(event.target.value)}
                    disabled={!projectId}
                  >
                    <option value="">{projectId ? 'Select service' : 'Select project first'}</option>
                    {availableEditorServices.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  {projectId && availableEditorServices.length === 0 ? (
                    <span className="catalog-editor__field-help">
                      {selectedProject
                        ? `No catalog services were found for ${selectedProject.name} yet.`
                        : 'No catalog services were found for this project yet.'}
                    </span>
                  ) : null}
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
              <label className="label catalog-editor__field-block">
                Runbook content
                <textarea className="input" rows={8} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Step-by-step runbook notes..." />
              </label>
              <div className="portal-form-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !projectId || !service.trim() || !title.trim()}
                  onClick={() => void submit()}
                >
                  {saving ? 'Saving...' : 'Create runbook'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
