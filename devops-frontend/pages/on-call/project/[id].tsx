import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

interface Person {
  userId: number;
  name: string;
}

interface ManagedTeam {
  team_id: number;
  team_name: string;
  roster: Person[];
  members: Person[];
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

function readPeople(rows: unknown): Person[] {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((item) => {
      const row = item as { user_id?: number; name?: string };
      return { userId: row.user_id || 0, name: String(row.name || '').trim() || 'Unknown' };
    })
    .filter((person) => person.userId > 0);
}

export default function OnCallProjectTeamsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const raw = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const projectId = Number.parseInt(raw || '', 10);
  const [projectName, setProjectName] = useState('');
  const [teams, setTeams] = useState<ManagedTeam[]>([]);
  const [choices, setChoices] = useState<Person[]>([]);
  const [teamId, setTeamId] = useState('');
  const [memberChoice, setMemberChoice] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [refresh, setRefresh] = useState(0);

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
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Teams could not be loaded');
        return data;
      }),
    ])
      .then(async ([project, body]) => {
        setProjectName(String(project.name || '').trim());
        const onCall = Array.isArray(body.teams) ? body.teams : [];
        const catalog = Array.isArray(body.choices) ? body.choices : [];
        setChoices(catalog.map((item: { team_id?: number; team_name?: string }) => ({
          userId: item.team_id || 0,
          name: String(item.team_name || '').trim() || 'Unknown',
        })).filter((item: Person) => item.userId > 0));
        const loaded = await Promise.all(onCall.map(async (team: { team_id?: number; team_name?: string }) => {
          const id = team.team_id || 0;
          const [rosterRes, memberRes] = await Promise.all([
            fetch(`${apiUrl}/api/oncall/roster?team_id=${id}`, { headers }),
            fetch(`${apiUrl}/api/oncall/team-members?team_id=${id}`, { headers }),
          ]);
          const rosterBody = await rosterRes.json().catch(() => ({}));
          const memberBody = await memberRes.json().catch(() => ({}));
          return {
            team_id: id,
            team_name: String(team.team_name || '').trim() || 'Unknown',
            roster: rosterRes.ok ? readPeople(rosterBody.users) : [],
            members: memberRes.ok ? readPeople(memberBody.members) : [],
          };
        }));
        setTeams(loaded.filter((team) => team.team_id > 0));
      })
      .catch((err) => {
        setTeams([]);
        setError(err instanceof Error ? err.message : 'Failed to load teams');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, refresh, router.isReady]);

  const available = choices.filter((choice) => !teams.some((team) => team.team_id === choice.userId));

  async function changeTeam(method: 'POST' | 'DELETE', id: number) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !id) return;
    setSaving(true);
    setError('');
    setNote('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/project-teams`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: projectId, team_id: id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The team could not be updated.');
        return;
      }
      setTeamId('');
      setNote(method === 'POST' ? 'Team added to this project call.' : 'Team removed from this project call.');
      setRefresh((value) => value + 1);
    } catch {
      setError('The team could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  async function saveRoster(team: ManagedTeam, userIds: number[]) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    if (!userIds.length) {
      setError('A rotation needs at least one person. Remove the team if no one should be on this call.');
      return;
    }
    setSaving(true);
    setError('');
    setNote('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/roster?team_id=${team.team_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ team_id: team.team_id, user_ids: userIds }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The rotation could not be saved.');
        return;
      }
      setNote('Rotation saved. These people cover one day at a time.');
      setRefresh((value) => value + 1);
    } catch {
      setError('The rotation could not be saved.');
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
            <p className="portal-page__subtitle">Add or remove teams on this call. Inside a team, add or remove the people who rotate.</p>
          </div>
          <Link href="/on-call/projects" className="btn btn-secondary">Back to projects</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        <section className="portal-surface">
          <div className="oncall-controls">
            <label>
              Add team
              <select className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                <option value="">Select a team</option>
                {available.map((team) => <option key={team.userId} value={team.userId}>{team.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary" disabled={saving || !teamId} onClick={() => void changeTeam('POST', Number(teamId))}>Add team</button>
          </div>
          {loading ? <div className="empty-state">Loading teams...</div> : null}
          {!loading && !teams.length ? <div className="empty-state">No teams are on this project call yet.</div> : null}
          {!loading && teams.map((team) => {
            const onRoster = new Set(team.roster.map((person) => person.userId));
            const remaining = team.members.filter((person) => !onRoster.has(person.userId));
            return (
              <section key={team.team_id} className="oncall-requests">
                <div className="oncall-shift">
                  <strong>{known(team.team_name)}</strong>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void changeTeam('DELETE', team.team_id)}>Remove team</button>
                </div>
                {!team.roster.length ? <p>No one is on this rotation yet.</p> : (
                  <ul className="svc-tree">
                    {team.roster.map((person) => (
                      <li key={person.userId} className="oncall-shift">
                        <span>{known(person.name)}</span>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void saveRoster(team, team.roster.filter((item) => item.userId !== person.userId).map((item) => item.userId))}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="oncall-controls">
                  <label>
                    Add person
                    <select className="input" value={memberChoice[team.team_id] || ''} onChange={(event) => setMemberChoice((current) => ({ ...current, [team.team_id]: event.target.value }))}>
                      <option value="">Select a person</option>
                      {remaining.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving || !memberChoice[team.team_id]}
                    onClick={() => void saveRoster(team, [...team.roster.map((person) => person.userId), Number(memberChoice[team.team_id])])}
                  >
                    Add person
                  </button>
                </div>
                {!remaining.length && team.members.length ? <p className="portal-surface__subtitle">Everyone on this team is already in the rotation.</p> : null}
                {!team.members.length ? <p className="portal-surface__subtitle">This team has no members yet. Add them on the team page before they can join the rotation.</p> : null}
              </section>
            );
          })}
        </section>
      </div>
    </DevOpsLayout>
  );
}
