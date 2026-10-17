import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../../../components/DevOpsLayout';
import { useApiUrl } from '../../../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

interface TeamOption {
  id: number;
  name: string;
}

interface OnCallTeam {
  team_id: number;
  team_name: string;
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

function readTeams(data: { teams?: unknown; owner_teams?: unknown }): TeamOption[] {
  const raw = Array.isArray(data?.owner_teams) ? data.owner_teams : Array.isArray(data?.teams) ? data.teams : [];
  return raw
    .map((item) => {
      const row = item as { id?: number; name?: string };
      return { id: typeof row.id === 'number' ? row.id : 0, name: String(row.name || '').trim() };
    })
    .filter((item) => item.id > 0 && item.name);
}

export default function OnCallProjectTeamsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const raw = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const projectId = Number.parseInt(raw || '', 10);
  const [projectName, setProjectName] = useState('');
  const [teams, setTeams] = useState<OnCallTeam[]>([]);
  const [catalog, setCatalog] = useState<TeamOption[]>([]);
  const [teamId, setTeamId] = useState('');
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!router.isReady || !projectId) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    setLoading(true);
    setError('');
    Promise.all([
      fetch(`${apiUrl}/api/devops/projects/${projectId}`, { headers }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load project');
        return data.project || data;
      }),
      fetch(`${apiUrl}/api/oncall/project-teams?project_id=${projectId}`, { headers }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Teams on this call could not be loaded');
        return data;
      }),
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/project-options`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    ])
      .then(([project, onCall, mine, options]) => {
        setProjectName(String(project.name || '').trim());
        const rows = Array.isArray(onCall?.teams) ? onCall.teams : [];
        setTeams(rows.map((team: { team_id?: number; team_name?: string }) => ({
          team_id: team.team_id || 0,
          team_name: String(team.team_name || '').trim() || 'Unknown',
        })).filter((team: OnCallTeam) => team.team_id > 0));
        const byId = new Map<number, TeamOption>();
        [...readTeams(mine), ...readTeams(options)].forEach((team) => byId.set(team.id, team));
        setCatalog([...byId.values()].sort((left, right) => left.name.localeCompare(right.name)));
      })
      .catch((err) => {
        setTeams([]);
        setError(err instanceof Error ? err.message : 'Failed to load teams');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router.isReady]);

  const needle = query.trim().toLowerCase();
  const available = catalog.filter((team) => !teams.some((item) => item.team_id === team.id) && (!needle || team.name.toLowerCase().includes(needle)));
  const visibleTeams = teams.filter((team) => {
    if (teamFilter && String(team.team_id) !== teamFilter) return false;
    if (!needle) return true;
    return team.team_name.toLowerCase().includes(needle);
  });

  async function addTeam() {
    const token = localStorage.getItem(TOKEN_KEY);
    const id = Number(teamId);
    if (!token || !id) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/project-teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: projectId, team_id: id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The team could not be added.');
        return;
      }
      await router.push(`/on-call/project/${projectId}/team/${id}`);
    } catch {
      setError('The team could not be added.');
    } finally {
      setSaving(false);
    }
  }

  async function removeTeam(id: number) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !id) return;
    setSaving(true);
    setError('');
    setNote('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/project-teams`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: projectId, team_id: id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The team could not be removed.');
        return;
      }
      setTeams((current) => current.filter((team) => team.team_id !== id));
      setNote('Team removed from this project call.');
    } catch {
      setError('The team could not be removed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DevOpsLayout>
      <Head><title>{known(projectName)} on-call teams</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">On-call</span>
            <h1 className="portal-page__title">{known(projectName)}</h1>
            <p className="portal-page__subtitle">Add a team, then choose the people who rotate. Open a team to check more than one person.</p>
          </div>
          <Link href="/on-call/projects" className="btn btn-secondary">Back to projects</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        <section className="portal-surface">
          <div className="svc-filters">
            <label>
              Search
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Team" />
            </label>
            <label>
              Team
              <select className="input" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                <option value="">All teams</option>
                {teams.map((team) => <option key={team.team_id} value={team.team_id}>{known(team.team_name)}</option>)}
              </select>
            </label>
            {query || teamFilter ? (
              <div className="svc-filters__actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setTeamFilter(''); }}>Clear</button>
              </div>
            ) : null}
          </div>
          <div className="oncall-controls">
            <label>
              Add team
              <select className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                <option value="">{catalog.length ? 'Select a team' : 'No teams loaded'}</option>
                {available.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary" disabled={saving || !teamId} onClick={() => void addTeam()}>Add team</button>
          </div>
          {!catalog.length && !loading ? <p className="portal-surface__subtitle">The team list did not load. The teams API returned no teams for this sign-in.</p> : null}
          {loading ? <div className="empty-state">Loading teams...</div> : null}
          {!loading && !teams.length ? <div className="empty-state">No teams are on this project call yet.</div> : null}
          {!loading && teams.length && !visibleTeams.length ? <div className="empty-state">No teams match this filter.</div> : null}
          {!loading && visibleTeams.length ? (
            <ul className="svc-tree">
              {visibleTeams.map((team) => (
                <li key={team.team_id} className="svc-tree__row">
                  <Link className="svc-tree__folder" href={`/on-call/project/${projectId}/team/${team.team_id}`}>
                    <span>{known(team.team_name)}<small className="svc-tree__meta">Choose people</small></span>
                  </Link>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void removeTeam(team.team_id)}>Remove</button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
