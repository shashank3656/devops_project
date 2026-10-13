import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

export default function CatalogOnboardingPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState('dev');
  const [team, setTeam] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        const list = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(
          list
            .map((item: { id?: number; name?: string; code?: string }) => ({
              id: typeof item.id === 'number' ? item.id : 0,
              name: item.name || '',
              code: item.code || '',
            }))
            .filter((item: ProjectOption) => item.id > 0),
        );
      })
      .catch(() => undefined);
  }, [apiUrl]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/catalog/services`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: Number(projectId),
          name: name.trim(),
          environments: [environment.trim()],
          teams: [team.trim()],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404) throw new Error('That project is outside your catalog scope.');
      if (!response.ok) throw new Error(data?.error || 'Failed to onboard service');
      const id = data?.service?.id;
      if (!id) throw new Error('Catalog did not return a service id');
      await router.push(`/catalog/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to onboard service');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Onboard service - Catalog</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Catalog</span>
            <h1 className="portal-page__title">Onboard service</h1>
            <p className="portal-page__subtitle">
              A service keeps its id. Set the project, environment, and owner team before linking repos or resources.
            </p>
          </div>
          <Link href="/catalog" className="btn btn-secondary">Back to catalog</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <form className="portal-form-grid" onSubmit={(event) => void submit(event)}>
            <label className="label">
              Service name
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="payments" required />
            </label>
            <label className="label">
              Project
              <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Environment
              <input className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} required />
            </label>
            <label className="label">
              Owner team
              <input className="input" value={team} onChange={(event) => setTeam(event.target.value)} placeholder="payments" required />
            </label>
            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create service'}</button>
            </div>
          </form>
        </section>
      </div>
    </DevOpsLayout>
  );
}
