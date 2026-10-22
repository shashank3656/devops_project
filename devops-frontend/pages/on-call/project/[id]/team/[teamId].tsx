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

interface ScheduleDay {
  day: string;
  name: string;
  user_id: number;
}

interface SchedulePreview {
  id: number;
  timezone: string;
  days: ScheduleDay[];
}

function dayLabel(day: string): string {
  const text = day.trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Day';
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
  const [query, setQuery] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [schedule, setSchedule] = useState<SchedulePreview | null>(null);

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
        try {
          const scheduleRes = await fetch(`${apiUrl}/api/oncall/schedules`, { headers });
          const scheduleBody = await readJson(scheduleRes);
          const rows = Array.isArray(scheduleBody.schedules) ? scheduleBody.schedules : [];
          const found = rows.map((item) => asRecord(item)).find((item) => Number(item.team_id) === teamId && Number(item.project_id) === projectId);
          if (!found) {
            setSchedule(null);
            return;
          }
          const days = Array.isArray(found.days) ? found.days : [];
          setSchedule({
            id: Number(found.id) || 0,
            timezone: typeof found.timezone === 'string' && found.timezone ? found.timezone : 'Unknown',
            days: days.map((item) => {
              const day = asRecord(item);
              return {
                day: typeof day.day === 'string' ? day.day : '',
                name: typeof day.name === 'string' ? day.name : '',
                user_id: Number(day.user_id) || 0,
              };
            }),
          });
        } catch {
          setSchedule(null);
        }
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
      <Head><title>{loading ? 'Loading team…' : `${known(teamName)} on-call people`}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">{loading ? 'Loading project…' : known(projectName)}</span>
            <h1 className="portal-page__title">{loading ? 'Loading team…' : known(teamName)}</h1>
            <p className="portal-page__subtitle">Choose who rotates. Shift timing, handover, and rotation order are in the weekly schedule on this page.</p>
          </div>
          <Link href={`/on-call/project/${projectId}`} className="btn btn-secondary">Back to teams</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        <section className="portal-surface" aria-label="Weekly schedule">
          <h2 className="portal-surface__title">Shift timing and rotation order</h2>
          <p className="portal-page__subtitle">Monday through Sunday is the order. The timezone is when each day starts. Handover for one day is requested on the On-call roster.</p>
          {schedule ? (
            <>
              <p className="access-hint">Timezone: {schedule.timezone}</p>
              <ul>
                {schedule.days.map((day) => (
                  <li key={day.day}>{dayLabel(day.day)}: {day.user_id ? known(day.name) : 'Uncovered'}</li>
                ))}
              </ul>
              <Link href={schedule.id ? `/on-call/${schedule.id}` : `/on-call/new?project_id=${projectId}&team_id=${teamId}`} className="btn btn-secondary">Edit schedule</Link>
            </>
          ) : (
            <>
              <p className="access-hint">No weekly schedule yet.</p>
              <Link href={`/on-call/new?project_id=${projectId}&team_id=${teamId}`} className="btn btn-secondary">Set shift timing and rotation order</Link>
            </>
          )}
        </section>
        <section className="portal-surface">
          <div className="svc-filters">
            <label>
              Search
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Person" />
            </label>
            <label>
              People
              <select className="input" value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}>
                <option value="">All people</option>
                <option value="selected">Selected</option>
                <option value="unselected">Not selected</option>
              </select>
            </label>
            {query || personFilter ? (
              <div className="svc-filters__actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setPersonFilter(''); }}>Clear</button>
              </div>
            ) : null}
          </div>
          {loading ? <div className="empty-state">Loading people...</div> : null}
          {!loading && !people.length ? <div className="empty-state">This team has no members yet.</div> : null}
          {!loading && people.length ? (
            <form onSubmit={(event) => void save(event)}>
              <div className="catalog-editor__choice-row">
                {people.filter((person) => {
                  const needle = query.trim().toLowerCase();
                  if (personFilter === 'selected' && !selected.includes(person.userId)) return false;
                  if (personFilter === 'unselected' && selected.includes(person.userId)) return false;
                  return !needle || person.name.toLowerCase().includes(needle);
                }).map((person) => (
                  <label key={person.userId} className="catalog-editor__toggle-label">
                    <input type="checkbox" checked={selected.includes(person.userId)} onChange={() => toggle(person.userId)} />
                    <span>{known(person.name)}</span>
                  </label>
                ))}
              </div>
              {!people.some((person) => {
                const needle = query.trim().toLowerCase();
                if (personFilter === 'selected' && !selected.includes(person.userId)) return false;
                if (personFilter === 'unselected' && selected.includes(person.userId)) return false;
                return !needle || person.name.toLowerCase().includes(needle);
              }) ? <p className="portal-surface__subtitle">No people match this filter.</p> : null}
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 16 }}>{saving ? 'Saving...' : 'Save people'}</button>
            </form>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
