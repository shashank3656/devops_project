import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, EmptyState, useConfirm, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';
import { expireSession } from '../lib/sessionExpiry';

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
  expireSession();
}

function normalizeQueryValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim() : '';
}

export default function DevOpsRunbooksPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const confirm = useConfirm();
  const [activePanel, setActivePanel] = useState<'editor' | null>(null);
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
  const [diagnosticRunbookID, setDiagnosticRunbookID] = useState('');
  const [diagnosticEnvironment, setDiagnosticEnvironment] = useState('dev');
  const [diagnosticLog, setDiagnosticLog] = useState<string[]>([]);
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);

  const selectedProjectRunbooks = useMemo(() => {
    return runbooks.filter((runbook) => {
      if (libraryProjectId && String(runbook.project_id) !== libraryProjectId) return false;
      if (libraryService && runbook.service.trim().toLowerCase() !== libraryService.trim().toLowerCase()) return false;
      return true;
    });
  }, [libraryProjectId, libraryService, runbooks]);

  const hasLibraryFilters = Boolean(libraryProjectId || libraryService);

  const runbookColumns: DataTableColumn<Runbook>[] = useMemo(
    () => [
      {
        id: 'project',
        header: 'Project',
        cell: (runbook) => {
          const project = projects.find((item) => item.id === runbook.project_id);
          return project ? `${project.name} (${project.code})` : runbook.project_id;
        },
      },
      { id: 'service', header: 'Service', cell: (runbook) => runbook.service || 'General' },
      {
        id: 'title',
        header: 'Title',
        cell: (runbook) => <span className="ig-cell-title">{runbook.title}</span>,
      },
      {
        id: 'link',
        header: 'Link',
        cell: (runbook) =>
          runbook.link_url ? (
            <a href={runbook.link_url} target="_blank" rel="noreferrer">
              Open link
            </a>
          ) : (
            'Inline only'
          ),
      },
      {
        id: 'actions',
        header: 'Action',
        className: 'ig-cell-actions',
        cell: (runbook) => (
          <div className="runbooks__action-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void router.push(`/runbooks/${runbook.id}/edit`)}
            >
              Edit
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void removeRunbook(runbook.id)}>
              Delete
            </button>
          </div>
        ),
      },
    ],
    [projects, router],
  );

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

  const availableLibraryServices = useMemo(() => {
    const values = new Set<string>();
    const scopedProjectId = libraryProjectId;
    projects.forEach((project) => {
      if (scopedProjectId && String(project.id) !== scopedProjectId) return;
      project.services.forEach((entry) => {
        const nextValue = entry.service.trim();
        if (nextValue) values.add(nextValue);
      });
    });
    runbooks.forEach((runbook) => {
      if (scopedProjectId && String(runbook.project_id) !== scopedProjectId) return;
      const nextValue = runbook.service.trim();
      if (nextValue) values.add(nextValue);
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [libraryProjectId, projects, runbooks]);

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
        throw new Error(getString(data.error, 'Failed to load runbooks'));
      }
      setProjects(normalizeProjects(data.projects));
      setRunbooks(normalizeRunbooks(data.runbooks));
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
    setActivePanel(null);
  };

  const openCreatePanel = () => {
    setEditingId(null);
    setProjectId('');
    setService('');
    setTitle('');
    setContent('');
    setLinkUrl('');
    setError('');
    setNotice('');
    setActivePanel('editor');
  };

  useEffect(() => {
    if (!projectId) {
      if (!editingId) setService('');
      return;
    }
    if (!service) return;
    if (availableEditorServices.includes(service)) return;
    setService('');
  }, [availableEditorServices, editingId, projectId, service]);

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
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to save runbook'));
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
    const ok = await confirm({ title: 'Delete runbook', message: 'Delete this runbook?', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
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

  async function runDiagnostic() {
    const runbook = selectedProjectRunbooks.find((item) => String(item.id) === diagnosticRunbookID);
    if (!runbook || !runbook.service.trim()) {
      setError('Choose a runbook that already has a service.');
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      expireSession();
      return;
    }
    setDiagnosticRunning(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/runbooks/diagnostic`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'diagnostic',
          runbook_id: runbook.id,
          project_id: runbook.project_id,
          service: runbook.service,
          environment: diagnosticEnvironment,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'The diagnostic was not recorded.');
        return;
      }
      setDiagnosticLog(Array.isArray(body?.log) ? body.log.map((line: unknown) => String(line)) : ['The diagnostic returned no log.']);
    } catch {
      setError('The diagnostic could not be reached.');
    } finally {
      setDiagnosticRunning(false);
    }
  }

  return (
    <DevOpsLayout>
      <Head>
        <title>Project Runbooks - OpsTrellis</title>
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
          <div className="portal-page__actions">
            <button type="button" className="btn btn-primary" onClick={() => void router.push('/runbooks/new')}>
              Create runbook
            </button>
          </div>
        </div>

        <section className="portal-surface">
          <h2 className="portal-surface__title">Read-only diagnostic</h2>
          <p className="access-hint">This check reads the latest recorded change for the runbook service and environment. It does not restart or scale anything.</p>
          <div className="portal-form-grid">
            <label className="label">Runbook
              <select className="input" value={diagnosticRunbookID} onChange={(event) => setDiagnosticRunbookID(event.target.value)}>
                <option value="">Choose a runbook</option>
                {selectedProjectRunbooks.map((runbook) => (
                  <option key={runbook.id} value={runbook.id}>{runbook.title} · {runbook.service || 'General'}</option>
                ))}
              </select>
            </label>
            <label className="label">Environment
              <select className="input" value={diagnosticEnvironment} onChange={(event) => setDiagnosticEnvironment(event.target.value)}>
                <option value="dev">dev</option>
                <option value="uat">uat</option>
                <option value="prod">prod</option>
              </select>
            </label>
          </div>
          <button type="button" className="btn btn-primary" disabled={diagnosticRunning || !diagnosticRunbookID} onClick={() => void runDiagnostic()}>
            {diagnosticRunning ? 'Checking…' : 'Run read-only diagnostic'}
          </button>
          {diagnosticLog.length > 0 ? (
            <ul className="request-timeline">
              {diagnosticLog.map((line) => <li key={line}><span>{line}</span></li>)}
            </ul>
          ) : null}
        </section>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {hasLibraryFilters ? (
          <div className="alert alert-info runbooks__scope-alert">
            <div className="runbooks__scope-row">
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
              <span className="portal-surface__eyebrow">Library</span>
              <h2 className="portal-surface__title">Available runbooks</h2>
              <p className="portal-surface__subtitle">
                Create and edit now open on dedicated pages so the library stays focused on browsing and cleanup.
              </p>
            </div>
          </div>
          <div className="portal-form-grid runbooks__filters">
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
              <select className="input" value={libraryService} onChange={(event) => setLibraryService(event.target.value)}>
                <option value="">All services</option>
                {availableLibraryServices.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ig-legacy-table">
            <DataTable<Runbook>
              label="Project runbooks"
              columns={runbookColumns}
              rows={selectedProjectRunbooks}
              rowKey={(runbook) => runbook.id}
              loading={loading}
              onRowOpen={(runbook) => void router.push(`/runbooks/${runbook.id}/edit`)}
              empty={
                <EmptyState
                  title={hasLibraryFilters ? 'No runbooks match filters' : 'No runbooks yet'}
                  body={
                    hasLibraryFilters
                      ? 'Try clearing the project or service filter.'
                      : 'Create a runbook to attach recovery steps to a project service.'
                  }
                />
              }
            />
          </div>
        </section>
      </div>
    </DevOpsLayout>
  );
}
