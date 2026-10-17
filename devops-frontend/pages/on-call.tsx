import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { currentMonth, monthTitle, shiftMonth } from '../lib/onCallMonth';

const TOKEN_KEY = 'devops_token';
const USER_KEY = 'devops_user';
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

interface TeamShift {
  team_id: number;
  team_name: string;
  user_id: number;
  name: string;
  status: string;
  request_id?: number;
  cover_user_id?: number;
  cover_name?: string;
  from_name?: string;
}

interface DutyDay {
  date: string;
  label: string;
  weekday: string;
  today: boolean;
  teams: TeamShift[];
}

interface RosterProject {
  id: number;
  name: string;
  code: string;
  days: DutyDay[];
  rosters: Record<number, { userId: number; name: string }[]>;
}

interface RosterRow {
  project: RosterProject;
  day: DutyDay;
  shift: TeamShift;
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

function shiftText(shift: TeamShift): string {
  if (!shift.user_id) return 'No one is on this rotation';
  if (shift.status === 'covered') return `${known(shift.name)} is covering for ${known(shift.from_name)}`;
  if (shift.status === 'pending') return `Waiting for ${known(shift.cover_name)}`;
  return known(shift.name);
}

const WEEK_LETTERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function calendarCells(monthValue: string): Array<{ day: number; date: string } | null> {
  const [yearText, monthText] = monthValue.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  if (!year || !monthIndex) return [];
  const first = new Date(Date.UTC(year, monthIndex - 1, 1, 12)).getUTCDay();
  const lead = (first + 6) % 7;
  const count = new Date(Date.UTC(year, monthIndex, 0, 12)).getUTCDate();
  const cells: Array<{ day: number; date: string } | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push({ day, date: `${monthValue}-${String(day).padStart(2, '0')}` });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

function CoverRow({
  row,
  where,
  ask,
  setAsk,
  coverUserId,
  setCoverUserId,
  setError,
  others,
  canAsk,
  saving,
  onSubmit,
}: {
  row: RosterRow;
  where: 'today' | 'day';
  ask: { date: string; projectId: number; teamId: number; where: 'today' | 'day' } | null;
  setAsk: (value: { date: string; projectId: number; teamId: number; where: 'today' | 'day' } | null) => void;
  coverUserId: string;
  setCoverUserId: (value: string) => void;
  setError: (value: string) => void;
  others: { userId: number; name: string }[];
  canAsk: boolean;
  saving: boolean;
  onSubmit: (event: FormEvent, row: RosterRow) => void;
}) {
  const open = ask?.where === where && ask.date === row.day.date && ask.projectId === row.project.id && ask.teamId === row.shift.team_id;
  return (
    <tr>
      <td>{known(row.project.name)}</td>
      <td>{known(row.shift.team_name)}</td>
      <td>
        {shiftText(row.shift)}
        {open ? (
          <form className="oncall-ask" onSubmit={(event) => onSubmit(event, row)}>
            {others.length ? (
              <>
                <label>
                  Who on {known(row.shift.team_name)} should take this day?
                  <select className="input" value={coverUserId} onChange={(event) => setCoverUserId(event.target.value)}>
                    <option value="">Select a person</option>
                    {others.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
                  </select>
                </label>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending...' : 'Send request'}</button>
              </>
            ) : <p>Add another person on this team before someone else can take the day.</p>}
          </form>
        ) : null}
      </td>
      <td>
        {canAsk ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setAsk(open ? null : { date: row.day.date, projectId: row.project.id, teamId: row.shift.team_id, where });
              setCoverUserId('');
              setError('');
            }}
          >
            Ask someone
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function todayKey(timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function OnCallPage() {
  const apiUrl = useApiUrl();
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [month, setMonth] = useState(currentMonth('Asia/Kolkata'));
  const [projects, setProjects] = useState<RosterProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [team, setTeam] = useState('');
  const [me, setMe] = useState(0);
  const [isManager, setIsManager] = useState(false);
  const [ask, setAsk] = useState<{ date: string; projectId: number; teamId: number; where: 'today' | 'day' } | null>(null);
  const [coverUserId, setCoverUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      const parsed = stored ? JSON.parse(stored) as { id?: number; devops_profile?: { is_manager?: boolean } } : null;
      if (typeof parsed?.id === 'number') setMe(parsed.id);
      setIsManager(Boolean(parsed?.devops_profile?.is_manager));
    } catch {
      setIsManager(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/devops/projects`, { headers })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load projects');
        const list = Array.isArray(data?.projects) ? data.projects : [];
        const ids = list
          .map((item: { id?: number; name?: string; code?: string }) => ({
            id: typeof item.id === 'number' ? item.id : 0,
            name: String(item.name || '').trim(),
            code: String(item.code || '').trim(),
          }))
          .filter((item: { id: number }) => item.id > 0);
        const boards = await Promise.all(ids.map(async (project: { id: number; name: string; code: string }) => {
          const dayRes = await fetch(`${apiUrl}/api/oncall/days?project_id=${project.id}&month=${month}&timezone=${encodeURIComponent(timezone)}`, { headers });
          const body = await dayRes.json().catch(() => ({}));
          if (!dayRes.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load the roster');
          const days = Array.isArray(body.days) ? body.days : [];
          const rosters: RosterProject['rosters'] = {};
          const teamViews = Array.isArray(body.teams) ? body.teams : [];
          teamViews.forEach((team: { team_id?: number; roster?: { user_id?: number; name?: string }[] }) => {
            const id = team.team_id || 0;
            if (!id) return;
            rosters[id] = (Array.isArray(team.roster) ? team.roster : [])
              .map((person) => ({ userId: person.user_id || 0, name: String(person.name || '').trim() || 'Unknown' }))
              .filter((person) => person.userId > 0);
          });
          return { ...project, days, rosters } as RosterProject;
        }));
        setProjects(boards);
      })
      .catch((err) => {
        setProjects([]);
        setError(err instanceof Error ? err.message : 'Failed to load on-call');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, month, refresh, timezone]);

  useEffect(() => {
    const key = todayKey(timezone);
    setSelectedDate(key.startsWith(month) ? key : `${month}-01`);
  }, [month, timezone]);

  const teamNames = useMemo(() => {
    const names = new Set<string>();
    projects.forEach((project) => {
      project.days.forEach((day) => day.teams.forEach((shift) => {
        if (shift.team_name) names.add(shift.team_name);
      }));
    });
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [projects]);

  const needle = query.trim().toLowerCase();
  const matches = (project: RosterProject, shift: TeamShift) => {
    if (projectId && String(project.id) !== projectId) return false;
    if (team && shift.team_name !== team) return false;
    if (!needle) return true;
    return `${project.name} ${project.code} ${shift.team_name} ${shift.name}`.toLowerCase().includes(needle);
  };
  const rows = projects.flatMap((project) => project.days.flatMap((day) => (
    day.teams.filter((shift) => matches(project, shift)).map((shift) => ({ project, day, shift }))
  )));
  const todayRows = rows.filter((row) => row.day.today);
  const pending = rows.filter((row) => row.shift.status === 'pending');
  const todayDate = todayKey(timezone);
  const canRequest = (row: RosterRow) => row.shift.user_id > 0 && row.day.date >= todayDate && row.shift.status !== 'pending' && (isManager || (me > 0 && me === row.shift.user_id));
  const rosterFor = (project: RosterProject, teamId: number) => project.rosters[teamId] || [];

  const sendRequest = async (event: FormEvent, row: RosterRow) => {
    event.preventDefault();
    const token = localStorage.getItem(TOKEN_KEY);
    const cover = Number(coverUserId);
    if (!token || !cover) {
      setError('Choose the person who can cover this day.');
      return;
    }
    setSaving(true);
    setNote('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/covers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          project_id: row.project.id,
          team_id: row.shift.team_id,
          date: row.day.date,
          cover_user_id: cover,
          timezone,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The cover request could not be saved.');
        return;
      }
      setAsk(null);
      setCoverUserId('');
      setNote('Request sent. The day changes after that person approves.');
      setRefresh((value) => value + 1);
    } catch {
      setError('The cover request could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const decide = async (requestId: number, decision: 'approve' | 'decline') => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !requestId) return;
    setSaving(true);
    setNote('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/covers/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: requestId, decision }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The decision could not be saved.');
        return;
      }
      setNote(decision === 'approve' ? 'Approved. This day now shows the covering person.' : 'Declined. The original person stays on this day.');
      setRefresh((value) => value + 1);
    } catch {
      setError('The decision could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const selectedRows = rows.filter((row) => row.day.date === selectedDate);
  const selectedDay = selectedRows[0]?.day || projects.flatMap((project) => project.days).find((day) => day.date === selectedDate);

  return (
    <DevOpsLayout>
      <Head><title>On-call</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">On-call</h1>
            <p className="portal-page__subtitle">Today is the list. The calendar is the monthly roster. Projects is where teams and people are added or removed.</p>
          </div>
          <Link href="/on-call/projects" className="btn btn-primary">Projects</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        <section className="portal-surface">
          <div className="svc-filters">
            <label>
              Search
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Project, team, or person" />
            </label>
            <label>
              Project
              <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">All projects</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.name} (${project.code})` : known(project.name)}</option>)}
              </select>
            </label>
            <label>
              Team
              <select className="input" value={team} onChange={(event) => setTeam(event.target.value)}>
                <option value="">All teams</option>
                {teamNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label>
              Month
              <span className="oncall-month">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, -1))}>Previous</button>
                <strong>{monthTitle(month)}</strong>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, 1))}>Next</button>
              </span>
            </label>
            <label>
              Timezone
              <select className="input" value={timezone} onChange={(event) => { setTimezone(event.target.value); setMonth(currentMonth(event.target.value)); }}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
            {query || projectId || team ? (
              <div className="svc-filters__actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setProjectId(''); setTeam(''); }}>Clear</button>
              </div>
            ) : null}
          </div>

          {loading ? <div className="empty-state">Loading on-call...</div> : null}

          {!loading ? (
            <section aria-label="Today">
              <h2 className="portal-surface__title">Today</h2>
              {!todayRows.length ? <div className="empty-state">No one matches this filter today.</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Team</th>
                        <th>Person</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayRows.map((row) => (
                        <CoverRow
                          key={`${row.project.id}-${row.shift.team_id}`}
                          row={row}
                          where="today"
                          ask={ask}
                          setAsk={setAsk}
                          coverUserId={coverUserId}
                          setCoverUserId={setCoverUserId}
                          setError={setError}
                          others={rosterFor(row.project, row.shift.team_id).filter((person) => person.userId !== row.shift.user_id)}
                          canAsk={canRequest(row)}
                          saving={saving}
                          onSubmit={sendRequest}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {!loading && pending.length ? (
            <section className="oncall-requests" aria-label="Cover requests">
              <strong>Requests</strong>
              {pending.map((row) => (
                <div key={`${row.day.date}-${row.project.id}-${row.shift.team_id}`} className="oncall-requests__row">
                  <span>{row.day.label} · {known(row.project.name)} · {known(row.shift.team_name)} · {known(row.shift.from_name)} asked {known(row.shift.cover_name)}</span>
                  {me > 0 && me === row.shift.cover_user_id ? (
                    <span>
                      <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void decide(row.shift.request_id || 0, 'approve')}>Approve</button>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => void decide(row.shift.request_id || 0, 'decline')}>Decline</button>
                    </span>
                  ) : <span>Waiting for {known(row.shift.cover_name)}</span>}
                </div>
              ))}
            </section>
          ) : null}

          {!loading ? (
            <section aria-label="Monthly roster">
              <h2 className="portal-surface__title">Monthly roster</h2>
              <div className="oncall-board" role="grid" aria-label={monthTitle(month)}>
                {WEEK_LETTERS.map((letter) => <span key={letter} className="oncall-board__dow">{letter}</span>)}
                {calendarCells(month).map((cell, index) => {
                  if (!cell) return <span key={`empty-${index}`} className="oncall-board__cell oncall-board__cell--empty" />;
                  const dayRows = rows.filter((row) => row.day.date === cell.date);
                  const names = dayRows.map((row) => known(row.shift.name)).filter((name) => name !== 'Unknown');
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      role="gridcell"
                      className={`oncall-board__cell${cell.date === todayDate ? ' is-today' : ''}${cell.date === selectedDate ? ' is-selected' : ''}`}
                      onClick={() => { setSelectedDate(cell.date); setAsk(null); }}
                    >
                      <span className="oncall-board__num">{cell.day}</span>
                      {names.slice(0, 2).map((name, nameIndex) => <span key={`${cell.date}-${nameIndex}`} className="oncall-board__name">{name}</span>)}
                      {names.length > 2 ? <span className="oncall-board__name">+{names.length - 2}</span> : null}
                    </button>
                  );
                })}
              </div>
              <h2 className="portal-surface__title">{selectedDay ? selectedDay.label : 'Selected day'}</h2>
              {!selectedRows.length ? <div className="empty-state">No one matches this filter on the selected day.</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Team</th>
                        <th>Person</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRows.map((row) => (
                        <CoverRow
                          key={`${row.project.id}-${row.shift.team_id}`}
                          row={row}
                          where="day"
                          ask={ask}
                          setAsk={setAsk}
                          coverUserId={coverUserId}
                          setCoverUserId={setCoverUserId}
                          setError={setError}
                          others={rosterFor(row.project, row.shift.team_id).filter((person) => person.userId !== row.shift.user_id)}
                          canAsk={canRequest(row)}
                          saving={saving}
                          onSubmit={sendRequest}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
