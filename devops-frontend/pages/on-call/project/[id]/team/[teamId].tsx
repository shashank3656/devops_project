import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../../../../components/DevOpsLayout';
import { useApiUrl } from '../../../../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

interface Person {
  userId: number;
  name: string;
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) return {};
  return asRecord(await res.json().catch(() => ({})));
}

function readPeople(rows: unknown, nameKey: 'name' | 'username'): Person[] {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((item) => {
      const row = item as { user_id?: number; name?: string; username?: string };
      const name = nameKey === 'username' ? row.username : row.name;
      return { userId: row.user_id || 0, name: String(name || '').trim() || 'Unknown' };
    })
    .filter((person) => person.userId > 0);
}

export default function OnCallTeamUsersPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const projectRaw = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const teamRaw = Array.isArray(router.query.teamId) ? router.query.teamId[0] : router.query.teamId;
  const projectId = Number.parseInt(projectRaw || '', 10);
  const teamId = Number.parseInt(teamRaw || '', 10);
  const [projectName, setProjectName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!router.isReady || !projectId || !teamId) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    setLoading(true);
    setError('');
    Promise.all([
      fetch(`${apiUrl}/api/devops/projects/${projectId}`, { headers }).then(readJson).catch((): Record<string, unknown> => ({})),
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then(readJson).catch((): Record<string, unknown> => ({})),
      fetch(`${apiUrl}/api/devops/project-options`, { headers }).then(readJson).catch((): Record<string, unknown> => ({})),
      fetch(`${apiUrl}/api/oncall/team-members?team_id=${teamId}`, { headers }).then(async (res) => ({ ok: res.ok, body: await readJson(res) })),
      fetch(`${apiUrl}/api/oncall/roster?team_id=${teamId}`, { headers }).then(async (res) => ({ ok: res.ok, body: await readJson(res) })),
    ])
      .then(async ([projectBody, mine, options, membersResult, rosterResult]) => {
        const project = asRecord(projectBody.project);
        const projectRecord = Object.keys(project).length ? project : projectBody;
        setProjectName(known(typeof projectRecord.name === 'string' ? projectRecord.name : ''));
        const catalog = [
          ...(Array.isArray(mine.teams) ? mine.teams : []),
          ...(Array.isArray(options.owner_teams) ? options.owner_teams : []),
        ];
        const match = catalog.map((item) => asRecord(item)).find((item) => item.id === teamId);
        setTeamName(known(typeof match?.name === 'string' ? match.name : ''));
        let members = membersResult.ok ? readPeople(membersResult.body.members, 'name') : [];
        if (!members.length) {
          const fallback = await fetch(`${apiUrl}/api/devops/teams/${teamId}/members`, { headers });
          const body = await readJson(fallback);
          if (fallback.ok) members = readPeople(body.members, 'username');
        }
        const roster = rosterResult.ok ? readPeople(rosterResult.body.users, 'name') : [];
        setPeople(members);
        const memberIds = new Set(members.map((person) => person.userId));
        setSelected(roster.map((person) => person.userId).filter((id) => memberIds.has(id)));
      })
      .catch(() => setError('People for this team could not be loaded.'))
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router.isReady, teamId]);

  function toggle(userId: number) {
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    if (!selected.length) {
      setError('Choose at least one person.');
      return;
    }
    setSaving(true);
    setError('');
    setNote('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/roster?team_id=${teamId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ team_id: teamId, user_ids: selected }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The rotation could not be saved.');
        return;
      }
      setNote('Saved. The checked people rotate one day at a time.');
    } catch {
      setError('The rotation could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DevOpsLayout>
      <Head><title>{known(teamName)} on-call people</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">{known(projectName)}</span>
            <h1 className="portal-page__title">{known(teamName)}</h1>
            <p className="portal-page__subtitle">Check every person who should rotate on this team. More than one can be selected.</p>
          </div>
          <Link href={`/on-call/project/${projectId}`} className="btn btn-secondary">Back to teams</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading people...</div> : null}
          {!loading && !people.length ? <div className="empty-state">This team has no members yet.</div> : null}
          {!loading && people.length ? (
            <form onSubmit={(event) => void save(event)}>
              <div className="catalog-editor__choice-row">
                {people.map((person) => (
                  <label key={person.userId} className="catalog-editor__toggle-label">
                    <input type="checkbox" checked={selected.includes(person.userId)} onChange={() => toggle(person.userId)} />
                    <span>{known(person.name)}</span>
                  </label>
                ))}
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 16 }}>{saving ? 'Saving...' : 'Save people'}</button>
            </form>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
