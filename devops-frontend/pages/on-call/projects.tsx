import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

interface ProjectRow {
  id: number;
  name: string;
  code: string;
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

export default function OnCallProjectsPage() {
  const apiUrl = useApiUrl();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load projects');
        const list = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(list.map((item: { id?: number; name?: string; code?: string }) => ({
          id: typeof item.id === 'number' ? item.id : 0,
          name: String(item.name || '').trim(),
          code: String(item.code || '').trim(),
        })).filter((item: ProjectRow) => item.id > 0));
      })
      .catch((err) => {
        setProjects([]);
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      })
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const needle = query.trim().toLowerCase();
  const visible = projects.filter((project) => !needle || `${project.name} ${project.code}`.toLowerCase().includes(needle));

  return (
    <DevOpsLayout>
      <Head><title>On-call projects</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">On-call</span>
            <h1 className="portal-page__title">Projects</h1>
            <p className="portal-page__subtitle">Add or remove the teams on a project, then choose who rotates on each team.</p>
          </div>
          <Link href="/on-call" className="btn btn-secondary">Back to on-call</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <div className="svc-filters">
            <label>
              Search
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Project" />
            </label>
          </div>
          {loading ? <div className="empty-state">Loading projects...</div> : null}
          {!loading && !visible.length ? <div className="empty-state">{query ? 'No projects match this search.' : 'No projects are visible for this scope.'}</div> : null}
          {!loading && visible.length ? (
            <ul className="svc-tree">
              {visible.map((project) => (
                <li key={project.id} className="svc-tree__row">
                  <span className="svc-tree__folder">
                    <span>{project.code ? `${known(project.name)} (${project.code})` : known(project.name)}</span>
                  </span>
                  <Link href={`/on-call/project/${project.id}`} className="btn btn-secondary btn-sm">Teams</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
