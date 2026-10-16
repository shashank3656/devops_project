import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProjectRow {
  id: number;
  name: string;
  code: string;
  team: string;
  teamId: number;
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

export default function OnCallPage() {
  const apiUrl = useApiUrl();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [team, setTeam] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load projects');
        const list = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(
            list
            .map((item: { id?: number; name?: string; code?: string; owner_team?: string; owner_team_id?: number; team_access?: { team_name?: string; team_id?: number }[] }) => {
              const access = Array.isArray(item.team_access) ? item.team_access : [];
              const accessName = access.map((team) => String(team.team_name || '').trim()).filter(Boolean).join(', ');
              const accessId = typeof access[0]?.team_id === 'number' ? access[0].team_id : 0;
              return {
                id: typeof item.id === 'number' ? item.id : 0,
                name: String(item.name || '').trim(),
                code: String(item.code || '').trim(),
                team: String(item.owner_team || '').trim() || accessName,
                teamId: typeof item.owner_team_id === 'number' && item.owner_team_id > 0 ? item.owner_team_id : accessId,
              };
            })
            .filter((item: ProjectRow) => item.id > 0),
        );
      })
      .catch((err) => {
        setProjects([]);
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      })
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const teams = useMemo(() => {
    const names = new Set<string>();
    projects.forEach((project) => {
      if (project.team) names.add(project.team);
    });
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [projects]);
  const needle = query.trim().toLowerCase();
  const visible = projects.filter((project) => {
    if (team && project.team !== team) return false;
    if (!needle) return true;
    return `${project.name} ${project.code} ${project.team}`.toLowerCase().includes(needle);
  });

  return (
    <DevOpsLayout>
      <Head><title>On-call</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">On-call</h1>
            <p className="portal-page__subtitle">One person each day. Check a project to see the month, or hand a day to someone else.</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <ol className="oncall-steps">
          <li><strong>1. Project</strong><span>Turn on on-call when the project is created.</span></li>
          <li><strong>2. Team</strong><span>On the team, choose the people who rotate.</span></li>
          <li><strong>3. Day</strong><span>If that person is unavailable, they name someone else. That person approves, and the day updates.</span></li>
        </ol>
        <section className="portal-surface">
          <div className="svc-filters">
            <label>
              Search
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Project or team" />
            </label>
            <label>
              Team
              <select className="input" value={team} onChange={(event) => setTeam(event.target.value)}>
                <option value="">All teams</option>
                {teams.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            {query || team ? (
              <div className="svc-filters__actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setTeam(''); }}>Clear</button>
              </div>
            ) : null}
          </div>
          {loading ? <div className="empty-state">Loading on-call...</div> : null}
          {!loading && !error && !visible.length ? <div className="empty-state">{query || team ? 'No projects match these filters.' : 'No projects are visible for this scope.'}</div> : null}
          {!loading && visible.length ? (
            <ul className="svc-tree">
              {visible.map((project) => (
                <li key={project.id} className="svc-tree__row">
                  <Link className="svc-tree__folder" href={`/on-call/project/${project.id}`}>
                    <span>
                      {project.code ? `${known(project.name)} (${project.code})` : known(project.name)}
                      <small className="svc-tree__meta">{known(project.team)}</small>
                    </span>
                  </Link>
                  <Link href={`/on-call/project/${project.id}`} className="btn btn-secondary btn-sm">Check</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
