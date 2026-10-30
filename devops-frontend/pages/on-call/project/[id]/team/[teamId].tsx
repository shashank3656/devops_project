import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../../../../components/DevOpsLayout';
import { useApiUrl } from '../../../../../context/ApiUrlContext';
import { formatLongDay, onCallRotationHref, timezoneCompactLabel, weekdayLong } from '../../../../../lib/onCallMonth';

const TOKEN_KEY = 'devops_token';

interface Person {
  userId: number;
  name: string;
}

interface ScheduleDay {
  day: string;
  name: string;
  user_id: number;
  backup_name?: string;
  backup_user_id?: number;
}

interface SchedulePreview {
  id: number;
  timezone: string;
  days: ScheduleDay[];
  remindMinutes: number;
  escalateMinutes: number;
  reassignIncidents: boolean;
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
  const focusDate = typeof router.query.date === 'string' ? router.query.date : '';
  const focusTimezone = typeof router.query.timezone === 'string' ? router.query.timezone : '';
  const focusWeekday = focusDate ? weekdayLong(focusDate) : '';
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
  const [missionCritical, setMissionCritical] = useState(false);

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
        setMissionCritical(Boolean(rosterResult.body.mission_critical));
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
            remindMinutes: Number(found.handover_remind_minutes) || 30,
            escalateMinutes: Number(found.handover_escalate_minutes) || 15,
            reassignIncidents: Boolean(found.reassign_incidents_on_ack),
            days: days.map((item) => {
              const day = asRecord(item);
              return {
                day: typeof day.day === 'string' ? day.day : '',
                name: typeof day.name === 'string' ? day.name : '',
                user_id: Number(day.user_id) || 0,
                backup_name: typeof day.backup_name === 'string' ? day.backup_name : '',
                backup_user_id: Number(day.backup_user_id) || 0,
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
    if (missionCritical && selected.length < 2) {
      setError('Mission-critical teams need a primary and a different backup.');
      return;
    }
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
      setNote(missionCritical
        ? 'Saved. The first checked person is primary; the second is backup. Confirm the weekly schedule still has a different backup for every day.'
        : 'Saved. The checked people rotate one day at a time.');
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
            <p className="portal-page__subtitle">{missionCritical
              ? 'This team covers a mission-critical service. Choose a primary and a backup. Shift timing, handover reminder, and overdue minutes are in the weekly schedule on this page.'
              : 'Choose who rotates. Shift timing, handover, and rotation order are in the weekly schedule on this page.'}</p>
            {focusDate && schedule ? (
              <p className="access-hint">
                Assign this shift for {formatLongDay(focusDate)}
                {focusTimezone ? ` · ${timezoneCompactLabel(focusTimezone)}` : ''}.
                The highlighted day is the weekday you opened.
              </p>
            ) : null}
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
              <p className="access-hint">Timezone: {schedule.timezone}. Handover reminder {schedule.remindMinutes} minutes before shift end, overdue after {schedule.escalateMinutes} minutes. {schedule.reassignIncidents ? 'Acknowledgement reassigns open incidents to the incoming person. Status is not changed to Fixed.' : 'Acknowledgement leaves incident assignment unchanged unless the incoming person opts in on that handover.'}</p>
              <ul>
                {schedule.days.map((day) => (
                  <li key={day.day} className={focusWeekday && day.day.toLowerCase() === focusWeekday ? 'oncall-focus-day' : undefined}>
                    {dayLabel(day.day)}: {day.user_id ? `Primary ${known(day.name)}` : 'No primary'}{day.backup_user_id ? ` · Backup ${known(day.backup_name)}` : missionCritical ? ' · No backup' : ''}
                  </li>
                ))}
              </ul>
              {focusDate ? (
                <>
                  <Link
                    href={onCallRotationHref(projectId, teamId, { scheduleId: schedule.id, date: focusDate, timezone: focusTimezone || schedule.timezone, intent: 'assign' })}
                    className="btn btn-primary"
                  >
                    Assign this shift
                  </Link>
                  {' '}
                </>
              ) : null}
              <Link
                href={onCallRotationHref(projectId, teamId, { scheduleId: schedule.id, date: focusDate, timezone: focusTimezone || schedule.timezone, intent: 'recurring' })}
                className={focusDate ? 'btn btn-secondary' : 'btn btn-primary'}
              >
                {focusDate ? 'Edit recurring rotation' : 'Create recurring rotation'}
              </Link>
            </>
          ) : (
            <>
              <p className="access-hint">{focusDate ? `Create a schedule before assigning coverage for ${formatLongDay(focusDate)}. Saving the weekly rotation is what covers that date.` : 'No weekly schedule yet. A recurring rotation is required before a selected date can stay covered.'}</p>
              <Link
                href={onCallRotationHref(projectId, teamId, { date: focusDate, timezone: focusTimezone, intent: 'recurring' })}
                className="btn btn-primary"
              >
                Create recurring rotation
              </Link>
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
          {!loading && !people.length ? (
            <div className="empty-state" role="status">
              <p>This team has no members yet. Add people before a rotation can be assigned.</p>
              <Link href="/team" className="btn btn-primary">Add team members</Link>
            </div>
          ) : null}
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
                    <span>{known(person.name)}{selected[0] === person.userId ? ' · Primary' : selected[1] === person.userId ? ' · Backup' : ''}</span>
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
