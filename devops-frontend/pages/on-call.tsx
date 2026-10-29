import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { currentMonth, monthTitle, nextSevenDateKeys, shiftMonth } from '../lib/onCallMonth';
import { useWorkspaceScope } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';
const USER_KEY = 'devops_user';
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

interface TeamShift {
  team_id: number;
  team_name: string;
  user_id: number;
  name: string;
  backup_user_id?: number;
  backup_name?: string;
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
  if (!shift.user_id) return 'Coverage gap';
  if (shift.status === 'covered') return `${known(shift.name)} is covering for ${known(shift.from_name)}`;
  if (shift.status === 'pending') return `Waiting for ${known(shift.cover_name)}`;
  if (shift.backup_user_id) return `Primary ${known(shift.name)} · Backup ${known(shift.backup_name)}`;
  return `Primary ${known(shift.name)}`;
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
        {!row.shift.user_id ? (
          <span className="oncall-gap" role="status">Coverage gap. <Link href={`/on-call/project/${row.project.id}/team/${row.shift.team_id}`}>Assign people</Link></span>
        ) : shiftText(row.shift)}
        {open ? (
          <form className="oncall-ask" onSubmit={(event) => onSubmit(event, row)}>
            {others.length ? (
              <>
                <label>
                  Temporary override: who on {known(row.shift.team_name)} should take this day?
                  <select className="input" value={coverUserId} onChange={(event) => setCoverUserId(event.target.value)}>
                    <option value="">Select a person</option>
                    {others.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
                  </select>
                </label>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending...' : 'Send override'}</button>
              </>
            ) : <p>Add another person on this team before a temporary override can be requested.</p>}
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
            Temporary override
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
  const router = useRouter();
  const { scope } = useWorkspaceScope();
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
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week');
  const [criticalServices, setCriticalServices] = useState<{ id: number; service: string; team?: string; project_id?: number }[]>([]);

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
        const weekMonths = nextSevenDateKeys(todayKey(timezone)).map((key) => key.slice(0, 7));
        const monthsToLoad = Array.from(new Set([month, ...weekMonths]));
        const boards = await Promise.all(ids.map(async (project: { id: number; name: string; code: string }) => {
          const parts = await Promise.all(monthsToLoad.map(async (monthValue) => {
            const dayRes = await fetch(`${apiUrl}/api/oncall/days?project_id=${project.id}&month=${monthValue}&timezone=${encodeURIComponent(timezone)}`, { headers });
            const body = await dayRes.json().catch(() => ({}));
            if (!dayRes.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load the roster');
            return {
              days: Array.isArray(body.days) ? body.days as DutyDay[] : [],
              teams: Array.isArray(body.teams) ? body.teams : [],
            };
          }));
          const daysByDate = new Map<string, DutyDay>();
          parts.forEach((part) => {
            part.days.forEach((day) => {
              if (day.date) daysByDate.set(day.date, day);
            });
          });
          const rosters: RosterProject['rosters'] = {};
          (parts[0]?.teams || []).forEach((team: { team_id?: number; roster?: { user_id?: number; name?: string }[] }) => {
            const id = team.team_id || 0;
            if (!id) return;
            rosters[id] = (Array.isArray(team.roster) ? team.roster : [])
              .map((person) => ({ userId: person.user_id || 0, name: String(person.name || '').trim() || 'Unknown' }))
              .filter((person) => person.userId > 0);
          });
          return { ...project, days: [...daysByDate.values()], rosters } as RosterProject;
        }));
        setProjects(boards);
        const servicesRes = await fetch(`${apiUrl}/api/devops/services`, { headers });
        const servicesBody = servicesRes.ok ? await servicesRes.json().catch(() => ({})) : {};
        const catalog = Array.isArray(servicesBody?.services) ? servicesBody.services : [];
        setCriticalServices(catalog
          .filter((item: { criticality?: string }) => String(item.criticality || '').toLowerCase() === 'mission_critical')
          .map((item: { id?: number; service?: string; team?: string; project_id?: number }) => ({
            id: typeof item.id === 'number' ? item.id : 0,
            service: String(item.service || '').trim(),
            team: String(item.team || '').trim(),
            project_id: typeof item.project_id === 'number' ? item.project_id : undefined,
          }))
          .filter((item: { id: number; service: string }) => item.id > 0 && item.service));
      })
      .catch((err) => {
        setProjects([]);
        setCriticalServices([]);
        setError(err instanceof Error ? err.message : 'Failed to load on-call');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, month, refresh, timezone]);

  useEffect(() => {
    const key = todayKey(timezone);
    setSelectedDate(key.startsWith(month) ? key : `${month}-01`);
  }, [month, timezone]);

  const scopedProjects = useMemo(() => {
    if (!scope.projectId) return projects;
    return projects.filter((project) => String(project.id) === scope.projectId);
  }, [projects, scope.projectId]);
  const scopeProjectName = scopedProjects[0]?.name || scopedProjects[0]?.code || '';
  const hideProjectFilter = Boolean(scope.projectId) && scopedProjects.length <= 1;

  const teamNames = useMemo(() => {
    const names = new Set<string>();
    scopedProjects.forEach((project) => {
      project.days.forEach((day) => day.teams.forEach((shift) => {
        if (shift.team_name) names.add(shift.team_name);
      }));
    });
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [scopedProjects]);

  const needle = query.trim().toLowerCase();
  const matches = (project: RosterProject, shift: TeamShift) => {
    if (projectId && String(project.id) !== projectId) return false;
    if (team && shift.team_name !== team) return false;
    if (!needle) return true;
    return `${project.name} ${project.code} ${shift.team_name} ${shift.name}`.toLowerCase().includes(needle);
  };
  const rows = scopedProjects.flatMap((project) => project.days.flatMap((day) => (
    day.teams.filter((shift) => matches(project, shift)).map((shift) => ({ project, day, shift }))
  )));
  const todayRows = rows.filter((row) => row.day.today);
  const criticalGaps = criticalServices.filter((item) => {
    if (scope.projectId && item.project_id && String(item.project_id) !== scope.projectId) return false;
    const serviceTeam = (item.team || '').trim().toLowerCase();
    if (!serviceTeam) return false;
    return todayRows.some((row) => {
      if (item.project_id && row.project.id !== item.project_id) return false;
      const teamName = (row.shift.team_name || '').trim().toLowerCase();
      return teamName === serviceTeam && (!row.shift.user_id || !row.shift.backup_user_id);
    });
  });
  const pending = rows.filter((row) => row.shift.status === 'pending');
  const todayDate = todayKey(timezone);
  const weekDates = nextSevenDateKeys(todayDate);
  const weekEnd = weekDates[weekDates.length - 1] || todayDate;
  const weekRows = rows.filter((row) => row.day.date >= todayDate && row.day.date <= weekEnd);
  const upcomingGaps = weekRows.filter((row) => {
    if (!row.shift.user_id) return true;
    const teamName = (row.shift.team_name || '').trim().toLowerCase();
    const missionCritical = criticalServices.some((item) => {
      if (item.project_id && row.project.id !== item.project_id) return false;
      return (item.team || '').trim().toLowerCase() === teamName;
    });
    return missionCritical && !row.shift.backup_user_id;
  });
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

  const openHandover = async (row: RosterRow) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/handovers/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          team_id: row.shift.team_id,
          project_id: row.project.id,
          shift_date: row.day.date,
          timezone,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The handover could not be opened.');
        return;
      }
      const id = Number(data.handover?.id);
      if (id > 0) {
        await router.push(`/on-call/handovers/${id}`);
        return;
      }
      setError('The handover could not be opened.');
    } catch {
      setError('The handover could not be opened.');
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
  const selectedDay = selectedRows[0]?.day || scopedProjects.flatMap((project) => project.days).find((day) => day.date === selectedDate);
  const coverageAssignHref = (() => {
    const first = criticalGaps[0];
    if (!first) return '/on-call/onboard';
    const row = todayRows.find((item) => {
      if (first.project_id && item.project.id !== first.project_id) return false;
      return (item.shift.team_name || '').trim().toLowerCase() === (first.team || '').trim().toLowerCase() && (!item.shift.user_id || !item.shift.backup_user_id);
    });
    if (row) return `/on-call/project/${row.project.id}/team/${row.shift.team_id}`;
    if (first.project_id) return `/on-call/project/${first.project_id}`;
    return '/on-call/onboard';
  })();

  return (
    <DevOpsLayout>
      <Head><title>On-call</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">On-call</h1>
            <p className="portal-page__subtitle">Setup follows Project, then Teams, then People, then Review coverage.</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/on-call/handovers" className="btn btn-secondary">Handovers</Link>
            <Link href="/on-call/onboard" className="btn btn-secondary">Onboard project</Link>
            <Link href="/on-call/projects" className="btn btn-secondary">Projects</Link>
          </div>
        </div>
        {error ? (
          <div className="alert alert-error" role="alert">
            Failed to load. {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefresh((value) => value + 1)}>Retry</button>
          </div>
        ) : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        {!loading && criticalGaps.length ? (
          <section className="ops-notice" role="alert" aria-label="Mission-critical coverage gap">
            <div>
              <p>
                <strong>Mission-critical coverage gap</strong>
                {' '}
                {criticalGaps.length} service{criticalGaps.length === 1 ? '' : 's'} have no primary and backup on-call today:
                {' '}
                {criticalGaps.map((item, index) => (
                  <span key={item.id}>
                    {index > 0 ? ', ' : ''}
                    <Link href={`/services/${item.id}`}>{item.service}</Link>
                  </span>
                ))}
                .
              </p>
              <p>Assign a primary and a backup, then confirm the handover reminder and overdue minutes. Do not page anyone from this page.</p>
            </div>
            <Link href={coverageAssignHref} className="btn btn-primary">Assign coverage</Link>
          </section>
        ) : null}
        <section className="portal-surface">
          <div className="oncall-filters">
            <label>
              Search
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Project, team, or person" />
            </label>
            {hideProjectFilter ? null : (
              <label>
                {scope.projectId ? `Projects within ${scopeProjectName || 'this'} scope` : 'Project'}
                <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">All projects</option>
                  {scopedProjects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.name} (${project.code})` : known(project.name)}</option>)}
                </select>
              </label>
            )}
            <label>
              Team
              <select className="input" value={team} onChange={(event) => setTeam(event.target.value)}>
                <option value="">All teams</option>
                {teamNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="oncall-filters__month">
              View
              <span className="oncall-month">
                <button type="button" className={`btn btn-sm ${calendarView === 'week' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={calendarView === 'week'} onClick={() => setCalendarView('week')}>Next 7 days</button>
                <button type="button" className={`btn btn-sm ${calendarView === 'month' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={calendarView === 'month'} onClick={() => setCalendarView('month')}>Month</button>
              </span>
            </label>
            {calendarView === 'month' ? (
              <label className="oncall-filters__month">
                Month
                <span className="oncall-month">
                  <button type="button" className="oncall-month__step" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <strong>{monthTitle(month)}</strong>
                  <button type="button" className="oncall-month__step" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMonth(currentMonth(timezone)); setSelectedDate(todayDate); }}>Today</button>
                </span>
              </label>
            ) : (
              <div className="oncall-filters__actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMonth(currentMonth(timezone)); setSelectedDate(todayDate); }}>Today</button>
              </div>
            )}
            <label className="oncall-filters__zone">
              Timezone
              <select className="input" aria-label="Roster timezone" value={timezone} onChange={(event) => { setTimezone(event.target.value); setMonth(currentMonth(event.target.value)); }}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
            {query || projectId || team ? (
              <div className="oncall-filters__actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setProjectId(''); setTeam(''); }}>Clear</button>
              </div>
            ) : null}
          </div>
          <p className="access-hint oncall-filters__hint">
            {scope.projectId
              ? `Showing ${scopeProjectName || 'the selected project'}${scope.environment ? ` / ${scope.environment}` : ''}.`
              : 'Use Project and Team to narrow this roster.'}
          </p>
          <details className="onboard-advanced oncall-filters__hint">
            <summary>Workspace filter and timezone</summary>
            <p className="form-section__copy">
              {scope.projectId
                ? 'The workspace filter at the top limits this page to that project. A day starts at 00:00 in the timezone below. Today, month changes, and handover use that boundary.'
                : 'The workspace filter at the top limits this page. Project below further filters the roster you are looking at. A day starts at 00:00 in the timezone below. Today, month changes, and handover use that boundary.'}
            </p>
          </details>

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
            <section className="oncall-requests" aria-label="Temporary shift overrides">
              <strong>Temporary shift overrides</strong>
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
            <section aria-label="Upcoming gaps">
              <h2 className="portal-surface__title">Upcoming gaps</h2>
              {!upcomingGaps.length ? (
                <p className="access-hint">No coverage gaps in the next 7 days for this filter.</p>
              ) : (
                <ul className="request-timeline">
                  {upcomingGaps.map((row) => (
                    <li key={`${row.day.date}-${row.project.id}-${row.shift.team_id}`}>
                      {row.day.label} · {known(row.project.name)} · {known(row.shift.team_name)}
                      {' · '}
                      <Link href={`/on-call/project/${row.project.id}/team/${row.shift.team_id}`}>Assign coverage</Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {!loading ? (
            <section aria-label={calendarView === 'week' ? 'Next 7 days' : 'Monthly roster'}>
              <h2 className="portal-surface__title">{calendarView === 'week' ? 'Next 7 days' : 'Monthly roster'}</h2>
              <p className="portal-page__subtitle">
                {calendarView === 'week'
                  ? 'Each day lists who is on-call. Assign coverage from a gap before paging from an incident.'
                  : 'A name means that day is covered. An orange outline means uncovered. The selected day is listed below.'}
                {' '}{new Set(upcomingGaps.map((row) => row.day.date)).size} uncovered days in the next 7 days.
              </p>
              {calendarView === 'week' ? (
                weekDates.map((dateKey) => {
                  const dayRows = weekRows.filter((row) => row.day.date === dateKey);
                  const heading = dayRows[0]?.day.label || dateKey;
                  return (
                    <div key={dateKey} className="oncall-week-day">
                      <h3 className="portal-surface__title">{heading}{dateKey === todayDate ? ' · Today' : ''}</h3>
                      {!dayRows.length ? <p className="access-hint">No teams match this filter on this day.</p> : (
                        <div style={{ overflowX: 'auto' }}>
                          <table className="templates-table">
                            <thead>
                              <tr>
                                <th>Project</th>
                                <th>Team</th>
                                <th>On this day</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {dayRows.map((row) => (
                                <tr key={`${dateKey}-${row.project.id}-${row.shift.team_id}`}>
                                  <td>{known(row.project.name)}</td>
                                  <td>{known(row.shift.team_name)}</td>
                                  <td>
                                    {!row.shift.user_id ? (
                                      <span className="oncall-gap" role="status">Coverage gap. <Link href={`/on-call/project/${row.project.id}/team/${row.shift.team_id}`}>Assign people</Link></span>
                                    ) : shiftText(row.shift)}
                                  </td>
                                  <td>
                                    <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void openHandover(row)}>
                                      Open handover
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
              <>
              <div className="oncall-board" role="grid" aria-label={monthTitle(month)}>
                {WEEK_LETTERS.map((letter) => <span key={letter} className="oncall-board__dow">{letter}</span>)}
                {calendarCells(month).map((cell, index) => {
                  if (!cell) return <span key={`empty-${index}`} className="oncall-board__cell oncall-board__cell--empty" />;
                  const dayRows = rows.filter((row) => row.day.date === cell.date);
                  const names = dayRows.map((row) => known(row.shift.name)).filter((name) => name !== 'Unknown');
                  const weekend = index % 7 >= 5;
                  const gap = dayRows.some((row) => !row.shift.user_id);
                  const tone = names.length ? ` is-tone-${(cell.day % 4) + 1}` : '';
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      role="gridcell"
                      className={`oncall-board__cell${weekend ? ' is-weekend' : ''}${tone}${gap ? ' is-gap' : ''}${cell.date === todayDate ? ' is-today' : ''}${cell.date === selectedDate ? ' is-selected' : ''}`}
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
              {!selectedRows.length ? <div className="empty-state">No teams match this filter on the selected day.</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Team</th>
                        <th>On this day</th>
                        <th>Users</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRows.map((row) => {
                        const people = rosterFor(row.project, row.shift.team_id);
                        return (
                          <tr key={`${row.project.id}-${row.shift.team_id}`}>
                            <td>{known(row.project.name)}</td>
                            <td>{known(row.shift.team_name)}</td>
                            <td>
                              {!row.shift.user_id ? (
                                <span className="oncall-gap" role="status">Coverage gap. <Link href={`/on-call/project/${row.project.id}/team/${row.shift.team_id}`}>Assign people</Link></span>
                              ) : shiftText(row.shift)}
                            </td>
                            <td>
                              {people.length ? people.map((person) => person.name).join(', ') : 'No one on this team'}
                            </td>
                            <td>
                              <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void openHandover(row)}>
                                Open handover
                              </button>
                              {canRequest(row) ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    const open = ask?.where === 'day' && ask.date === row.day.date && ask.projectId === row.project.id && ask.teamId === row.shift.team_id;
                                    setAsk(open ? null : { date: row.day.date, projectId: row.project.id, teamId: row.shift.team_id, where: 'day' });
                                    setCoverUserId('');
                                    setError('');
                                  }}
                                >
                                  Temporary override
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {ask?.where === 'day' && selectedRows.some((row) => ask.date === row.day.date && ask.projectId === row.project.id && ask.teamId === row.shift.team_id) ? (
                    selectedRows.filter((row) => ask.date === row.day.date && ask.projectId === row.project.id && ask.teamId === row.shift.team_id).map((row) => (
                      <form key="ask-day" className="oncall-ask" onSubmit={(event) => sendRequest(event, row)}>
                        {rosterFor(row.project, row.shift.team_id).filter((person) => person.userId !== row.shift.user_id).length ? (
                          <>
                            <label>
                              Who on {known(row.shift.team_name)} should take this day?
                              <select className="input" value={coverUserId} onChange={(event) => setCoverUserId(event.target.value)}>
                                <option value="">Select a person</option>
                                {rosterFor(row.project, row.shift.team_id).filter((person) => person.userId !== row.shift.user_id).map((person) => (
                                  <option key={person.userId} value={person.userId}>{person.name}</option>
                                ))}
                              </select>
                            </label>
                            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending...' : 'Send request'}</button>
                          </>
                        ) : <p>Add another person on this team before someone else can take the day.</p>}
                      </form>
                    ))
                  ) : null}
                </div>
              )}
              </>
              )}
            </section>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
