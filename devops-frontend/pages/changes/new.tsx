import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export default function NewChangeRequestPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [previewNumber, setPreviewNumber] = useState('');
  const [title, setTitle] = useState('');
  const [changeType, setChangeType] = useState('standard');
  const [environment, setEnvironment] = useState('dev');
  const [projectId, setProjectId] = useState('');
  const [service, setService] = useState('');
  const [repo, setRepo] = useState('');
  const [sha, setSha] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [filesText, setFilesText] = useState('');
  const [incidentNumber, setIncidentNumber] = useState('');
  const [watchMinutes, setWatchMinutes] = useState('120');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const files = useMemo(
    () => filesText.split('\n').map((line) => line.trim()).filter(Boolean),
    [filesText],
  );

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiUrl}/api/devops/changes?mode=preview`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([projectRes, previewRes]) => {
        if (projectRes.status === 401 || projectRes.status === 403 || previewRes.status === 401 || previewRes.status === 403) {
          clearSessionAndRedirect();
          return;
        }
        const projectData = asRecord(await projectRes.json().catch(() => ({})));
        const previewData = asRecord(await previewRes.json().catch(() => ({})));
        const list = Array.isArray(projectData.projects) ? projectData.projects : [];
        setProjects(
          list
            .map((item) => {
              const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
              return {
                id: typeof row.id === 'number' ? row.id : 0,
                name: typeof row.name === 'string' ? row.name : '',
                code: typeof row.code === 'string' ? row.code : '',
              };
            })
            .filter((item) => item.id > 0),
        );
        const number = getString(previewData.change_number);
        if (number) setPreviewNumber(number);
      })
      .catch(() => setError('Failed to load change form options'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (changeType === 'emergency' && !incidentNumber.trim()) {
      setError('Emergency changes must link an incident number');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/changes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          change_type: changeType,
          environment,
          project_id: projectId ? Number(projectId) : 0,
          service: service.trim(),
          repo: repo.trim(),
          sha: sha.trim(),
          pr_number: prNumber ? Number(prNumber) : 0,
          pr_url: prUrl.trim(),
          summary: summary.trim(),
          files,
          incident_number: incidentNumber.trim(),
          watch_minutes: Number(watchMinutes) || 120,
          status: 'new',
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to create change request'));
      }
      const change = data.change && typeof data.change === 'object' ? (data.change as Record<string, unknown>) : {};
      const id = typeof change.id === 'number' ? change.id : 0;
      await router.push(id > 0 ? `/changes/${id}` : '/changes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create change request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Create change request - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Change request</span>
            <h1 className="portal-page__title">Create change request</h1>
            <p className="portal-page__subtitle">
              Use this form for planned or emergency deploys that are not coming from CI. Pipelines can still record the same object later.
            </p>
          </div>
          <Link href="/changes" className="btn btn-secondary">
            Back to changes
          </Link>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">New change</span>
              <h2 className="portal-surface__title">Change details</h2>
              <p className="portal-surface__subtitle">
                Reference: <strong>{previewNumber || 'Generated on save'}</strong>
              </p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading change form...</div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <div className="portal-form-grid">
                <label className="label">
                  Title
                  <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Deploy payments-api timeout change" required />
                </label>
                <label className="label">
                  Type
                  <select className="input" value={changeType} onChange={(event) => setChangeType(event.target.value)}>
                    <option value="standard">Standard</option>
                    <option value="normal">Normal (CAB on prod)</option>
                    <option value="emergency">Emergency</option>
                  </select>
                </label>
                <label className="label">
                  Environment
                  <select className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
                    <option value="dev">dev</option>
                    <option value="uat">uat</option>
                    <option value="prod">prod</option>
                  </select>
                </label>
                <label className="label">
                  Project
                  <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                    <option value="">No project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Service
                  <input className="input" value={service} onChange={(event) => setService(event.target.value)} placeholder="payments-api" />
                </label>
                <label className="label">
                  Repo
                  <input className="input" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="acme/payments-api" />
                </label>
                <label className="label">
                  SHA
                  <input className="input" value={sha} onChange={(event) => setSha(event.target.value)} placeholder="Optional. A unique id is generated if empty." />
                </label>
                <label className="label">
                  Pull request
                  <input className="input" value={prNumber} onChange={(event) => setPrNumber(event.target.value)} placeholder="1842" />
                </label>
                <label className="label">
                  Pull request URL
                  <input className="input" value={prUrl} onChange={(event) => setPrUrl(event.target.value)} placeholder="https://github.com/acme/payments-api/pull/1842" />
                </label>
                <label className="label">
                  Watch minutes
                  <input className="input" type="number" min={15} value={watchMinutes} onChange={(event) => setWatchMinutes(event.target.value)} />
                </label>
                {changeType === 'emergency' ? (
                  <label className="label">
                    Linked incident
                    <input className="input" value={incidentNumber} onChange={(event) => setIncidentNumber(event.target.value)} placeholder="INC0000123" required />
                  </label>
                ) : null}
              </div>
              <label className="label">
                Summary
                <textarea className="input" rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is changing and why this window is safe." />
              </label>
              <label className="label">
                Files
                <textarea className="input" rows={4} value={filesText} onChange={(event) => setFilesText(event.target.value)} placeholder={'cmd/api/main.go\nhelm/payments/values.yaml'} />
              </label>
              <div className="portal-form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>
                  {saving ? 'Creating...' : 'Create change request'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
