import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

interface TeamOption {
  id: number;
  name: string;
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readTeams(data: Record<string, unknown>): TeamOption[] {
  const raw = Array.isArray(data.owner_teams) ? data.owner_teams : Array.isArray(data.teams) ? data.teams : [];
  return raw
    .map((item) => {
      const row = asRecord(item);
      return { id: typeof row.id === 'number' ? row.id : 0, name: String(row.name || '').trim() };
    })
    .filter((item) => item.id > 0 && item.name);
}

export default function OnboardOnCallProjectPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then(async (res) => {
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load projects');
        return data;
      }),
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/project-options`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    ])
      .then(([projectBody, mine, options]) => {
        const list = Array.isArray(projectBody.projects) ? projectBody.projects : [];
        setProjects(list.map((item) => {
          const row = asRecord(item);
          return {
            id: typeof row.id === 'number' ? row.id : 0,
            name: String(row.name || '').trim(),
            code: String(row.code || '').trim(),
          };
        }).filter((item) => item.id > 0));
        const byId = new Map<number, TeamOption>();
        [...readTeams(asRecord(mine)), ...readTeams(asRecord(options))].forEach((team) => byId.set(team.id, team));
        setTeams([...byId.values()].sort((left, right) => left.name.localeCompare(right.name)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the form'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  useEffect(() => {
    if (!router.isReady) return;
    const queryProject = Array.isArray(router.query.project_id) ? router.query.project_id[0] : router.query.project_id;
    if (queryProject) setProjectId(queryProject);
  }, [router.isReady, router.query.project_id]);

  const needle = query.trim().toLowerCase();
  const visibleTeams = useMemo(
    () => teams.filter((team) => !needle || team.name.toLowerCase().includes(needle)),
    [teams, needle],
  );

  function toggle(id: number) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const token = localStorage.getItem(TOKEN_KEY);
    const id = Number(projectId);
    if (!token || !id || !selected.length) {
      setError('Choose a project and at least one team.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (const teamId of selected) {
        const response = await fetch(`${apiUrl}/api/oncall/project-teams`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ project_id: id, team_id: teamId }),
        });
        const data = asRecord(await response.json().catch(() => ({})));
        if (!response.ok) {
          setError(typeof data.error === 'string' ? data.error : 'The teams could not be saved.');
          return;
        }
      }
      const firstTeam = selected[0];
      await router.push(selected.length === 1 ? `/on-call/project/${id}/team/${firstTeam}` : `/on-call/project/${id}`);
    } catch {
      setError('The teams could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DevOpsLayout>
      <Head><title>Onboard project - On-call</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">On-call</span>
            <h1 className="portal-page__title">Onboard project</h1>
            <p className="portal-page__subtitle">Project, then teams, then people, then review coverage on On-call. This step chooses the teams.</p>
          </div>
          <Link href="/on-call" className="btn btn-secondary">Back to on-call</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading projects and teams...</div> : (
          <form className="portal-surface" onSubmit={(event) => void submit(event)}>
            <label className="label">
              Project
              <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.code ? `${known(project.name)} (${project.code})` : known(project.name)}</option>
                ))}
              </select>
            </label>
            <div className="svc-filters" style={{ marginTop: 16 }}>
              <label>
                Search teams
                <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Team" />
              </label>
              {query ? (
                <div className="svc-filters__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setQuery('')}>Clear</button>
                </div>
              ) : null}
            </div>
            {!teams.length ? <div className="empty-state">No teams are available for this sign-in.</div> : null}
            {teams.length && !visibleTeams.length ? <div className="empty-state">No teams match this search.</div> : null}
            {visibleTeams.length ? (
              <ul className="svc-tree">
                {visibleTeams.map((team) => (
                  <li key={team.id} className="svc-tree__row">
                    <label className="svc-tree__folder" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input type="checkbox" checked={selected.includes(team.id)} onChange={() => toggle(team.id)} />
                      <span>{known(team.name)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving || !projectId || !selected.length}>
                {saving ? 'Saving...' : 'Save teams'}
              </button>
            </div>
          </form>
        )}
      </div>
    </DevOpsLayout>
  );
}
