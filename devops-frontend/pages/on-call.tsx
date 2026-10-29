import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  addCalendarDays,
  currentMonth,
  formatCompactDay,
  formatDateList,
  formatDateRange,
  monthTitle,
  nextDateKeys,
  nextSevenDateKeys,
  shiftMonth,
  weekdayShort,
} from '../lib/onCallMonth';
import { InspectorDrawer, useWorkspaceScope } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';
const USER_KEY = 'devops_user';
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
const WEEK_LETTERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const SHIFT_HOURS = '00:00–24:00';
const FORECAST_DAYS = [7, 14, 30] as const;
type ForecastDays = (typeof FORECAST_DAYS)[number];

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

interface CriticalService {
  id: number;
  service: string;
  team?: string;
  project_id?: number;
}

type CoverageKind = 'covered' | 'primary' | 'backup' | 'none';
type CalendarView = 'week' | 'month';
type PanelState = { date: string; projectId?: number; teamId?: number };

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

function todayKey(timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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

function teamIsCritical(services: CriticalService[], projectId: number, teamName: string): boolean {
  const name = teamName.trim().toLowerCase();
  if (!name) return false;
  return services.some((item) => {
    if (item.project_id && item.project_id !== projectId) return false;
    return (item.team || '').trim().toLowerCase() === name;
  });
}

function coverageOf(shift: TeamShift | undefined, missionCritical: boolean): CoverageKind {
  if (!shift) return 'none';
  if (!shift.user_id) return 'primary';
  if (missionCritical && !shift.backup_user_id) return 'backup';
  return 'covered';
}

function coverageLabel(kind: CoverageKind): string {
  if (kind === 'primary') return 'Primary missing';
  if (kind === 'backup') return 'Backup missing';
  if (kind === 'covered') return 'Covered';
  return 'No shift required';
}

function isCoverageGap(kind: CoverageKind): boolean {
  return kind === 'primary' || kind === 'backup';
}

function rowKey(row: RosterRow): string {
  return `${row.day.date}-${row.project.id}-${row.shift.team_id}`;
}

export default function OnCallPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const { scope } = useWorkspaceScope();
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [periodStart, setPeriodStart] = useState(() => todayKey('Asia/Kolkata'));
  const [month, setMonth] = useState(currentMonth('Asia/Kolkata'));
  const [projects, setProjects] = useState<RosterProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [projectId, setProjectId] = useState('');
  const [team, setTeam] = useState('');
  const [me, setMe] = useState(0);
  const [isManager, setIsManager] = useState(false);
  const [coverUserId, setCoverUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [criticalServices, setCriticalServices] = useState<CriticalService[]>([]);
  const [forecastDays, setForecastDays] = useState<ForecastDays>(7);

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
        const monthsToLoad = Array.from(new Set([
          month,
          ...nextSevenDateKeys(periodStart).map((key) => key.slice(0, 7)),
          ...nextDateKeys(todayKey(timezone), 30).map((key) => key.slice(0, 7)),
        ]));
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
          (parts[0]?.teams || []).forEach((item: { team_id?: number; roster?: { user_id?: number; name?: string }[] }) => {
            const id = item.team_id || 0;
            if (!id) return;
            rosters[id] = (Array.isArray(item.roster) ? item.roster : [])
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
  }, [apiUrl, month, periodStart, refresh, timezone]);

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

  const matches = (project: RosterProject, shift: TeamShift) => {
    if (projectId && String(project.id) !== projectId) return false;
    if (team && shift.team_name !== team) return false;
    return true;
  };
  const rows = scopedProjects.flatMap((project) => project.days.flatMap((day) => (
    day.teams.filter((shift) => matches(project, shift)).map((shift) => ({ project, day, shift }))
  )));
  const kindOf = (row: RosterRow) => coverageOf(row.shift, teamIsCritical(criticalServices, row.project.id, row.shift.team_name));

  const todayDate = todayKey(timezone);
  const todayRows = rows.filter((row) => row.day.date === todayDate);
  const weekDates = nextSevenDateKeys(periodStart);
  const weekEnd = weekDates[weekDates.length - 1] || periodStart;
  const lookaheadDates = nextDateKeys(todayDate, forecastDays);
  const lookaheadEnd = lookaheadDates[lookaheadDates.length - 1] || todayDate;
  const weekRows = rows.filter((row) => row.day.date >= periodStart && row.day.date <= weekEnd);
  const upcomingRows = rows.filter((row) => row.day.date >= todayDate && row.day.date <= lookaheadEnd);
  const upcomingGaps = upcomingRows.filter((row) => isCoverageGap(kindOf(row)));
  const affectedDates = new Set(upcomingGaps.map((row) => row.day.date));
  const teamDaysWithoutCoverage = upcomingGaps.filter((row) => kindOf(row) === 'primary').length;
  const uncoveredShifts = upcomingGaps.length;

  const criticalWithoutPrimary = criticalServices.filter((item) => {
    if (scope.projectId && item.project_id && String(item.project_id) !== scope.projectId) return false;
    const serviceTeam = (item.team || '').trim().toLowerCase();
    if (!serviceTeam) return false;
    return todayRows.some((row) => {
      if (item.project_id && row.project.id !== item.project_id) return false;
      const teamName = (row.shift.team_name || '').trim().toLowerCase();
      return teamName === serviceTeam && !row.shift.user_id;
    });
  });
  const pending = rows.filter((row) => row.shift.status === 'pending');
  const teamsToday = new Map<string, RosterRow>();
  todayRows.forEach((row) => teamsToday.set(`${row.project.id}-${row.shift.team_id}`, row));
  const teamsCoveredNow = [...teamsToday.values()].filter((row) => kindOf(row) === 'covered').length;

  const gapGroups = useMemo(() => {
    const grouped = new Map<string, { row: RosterRow; dates: string[]; kinds: Set<CoverageKind> }>();
    upcomingGaps.forEach((row) => {
      const key = `${row.project.id}-${row.shift.team_id}`;
      const current = grouped.get(key);
      const kind = coverageOf(row.shift, teamIsCritical(criticalServices, row.project.id, row.shift.team_name));
      if (current) {
        current.dates.push(row.day.date);
        current.kinds.add(kind);
        return;
      }
      grouped.set(key, { row, dates: [row.day.date], kinds: new Set([kind]) });
    });
    return [...grouped.values()].map((item) => ({
      ...item,
      dates: [...new Set(item.dates)].sort(),
      label: item.kinds.has('primary') ? 'Primary missing' : 'Backup missing',
    }));
  }, [upcomingGaps, criticalServices]);

  const overlapGroups = useMemo(() => {
    const byPerson = new Map<string, RosterRow[]>();
    upcomingRows.forEach((row) => {
      if (!row.shift.user_id) return;
      const key = `${row.day.date}-${row.shift.user_id}`;
      const current = byPerson.get(key) || [];
      current.push(row);
      byPerson.set(key, current);
    });
    return [...byPerson.values()]
      .map((list) => {
        const unique = new Map<string, RosterRow>();
        list.forEach((row) => unique.set(`${row.project.id}-${row.shift.team_id}`, row));
        return [...unique.values()];
      })
      .filter((list) => list.length > 1)
      .map((list) => ({
        date: list[0].day.date,
        name: known(list[0].shift.name),
        teams: list.map((row) => ({
          project: known(row.project.name),
          team: known(row.shift.team_name),
          href: `/on-call/project/${row.project.id}/team/${row.shift.team_id}`,
        })),
      }))
      .sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name));
  }, [upcomingRows]);

  const scheduleTeams = useMemo(() => {
    const order: { key: string; project: RosterProject; teamId: number; teamName: string }[] = [];
    const seen = new Set<string>();
    weekRows.forEach((row) => {
      const key = `${row.project.id}-${row.shift.team_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      order.push({ key, project: row.project, teamId: row.shift.team_id, teamName: row.shift.team_name });
    });
    return order;
  }, [weekRows]);

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

  const goToday = () => {
    const current = todayKey(timezone);
    setPeriodStart(current);
    setMonth(currentMonth(timezone));
    setCalendarView('week');
  };

  const shiftPeriod = (delta: number) => {
    if (calendarView === 'month') {
      const next = shiftMonth(month, delta);
      setMonth(next);
      setPeriodStart(`${next}-01`);
      return;
    }
    setPeriodStart(addCalendarDays(periodStart, delta * 7));
  };

  const panelRows = panel
    ? rows.filter((row) => {
      if (row.day.date !== panel.date) return false;
      if (panel.projectId && row.project.id !== panel.projectId) return false;
      if (panel.teamId && row.shift.team_id !== panel.teamId) return false;
      return true;
    })
    : [];
  const panelRow = panelRows.length === 1 ? panelRows[0] : null;
  const manageHref = scheduleTeams.length === 1
    ? `/on-call/project/${scheduleTeams[0].project.id}/team/${scheduleTeams[0].teamId}`
    : '/on-call/projects';
  const rangeLabel = calendarView === 'month' ? monthTitle(month) : formatDateRange(periodStart, weekEnd);
  const countCopy = `${affectedDates.size} affected date${affectedDates.size === 1 ? '' : 's'} · ${teamDaysWithoutCoverage} team-day${teamDaysWithoutCoverage === 1 ? '' : 's'} without coverage`;
  const shiftCopy = uncoveredShifts !== teamDaysWithoutCoverage
    ? `${countCopy} · ${uncoveredShifts} uncovered shift${uncoveredShifts === 1 ? '' : 's'}`
    : countCopy;

  const openCell = (row: RosterRow | undefined, date: string) => {
    if (row) setPanel({ date, projectId: row.project.id, teamId: row.shift.team_id });
    else setPanel({ date });
  };

  const renderShiftBody = (row: RosterRow) => {
    const kind = kindOf(row);
    const people = rosterFor(row.project, row.shift.team_id);
    const others = people.filter((person) => person.userId !== row.shift.user_id);
    return (
      <article key={rowKey(row)} className="oncall-shift-detail">
        <p className="oncall-shift-detail__meta">
          {!hideProjectFilter ? `${known(row.project.name)} · ` : ''}
          {known(row.shift.team_name)} · {row.day.label} · {SHIFT_HOURS} {timezone}
        </p>
        <span className={`oncall-badge oncall-badge--${kind}`}>{coverageLabel(kind)}</span>
        <p>{row.shift.user_id ? `Primary ${known(row.shift.name)}` : 'Primary missing'}</p>
        <p>{row.shift.backup_user_id ? `Backup ${known(row.shift.backup_name)}` : teamIsCritical(criticalServices, row.project.id, row.shift.team_name) ? 'Backup missing' : 'Backup not required'}</p>
        {row.shift.status === 'covered' ? <p>{known(row.shift.name)} is covering for {known(row.shift.from_name)}.</p> : null}
        {row.shift.status === 'pending' ? <p>Waiting for {known(row.shift.cover_name)} to accept a temporary override.</p> : null}
        {kind === 'primary' ? (
          <p>Assign people on this team before paging from an incident.</p>
        ) : (
          <p>Handover reminder and overdue minutes are set on the team schedule. Do not page anyone from this page.</p>
        )}
        <div className="portal-page__actions">
          {kind === 'primary' ? <Link className="btn btn-primary" href={`/on-call/project/${row.project.id}/team/${row.shift.team_id}`}>Assign people</Link> : null}
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void openHandover(row)}>Open handover</button>
          <Link className="btn btn-secondary" href={`/on-call/project/${row.project.id}/team/${row.shift.team_id}`}>Manage schedule</Link>
        </div>
        {canRequest(row) ? (
          <form className="oncall-ask" onSubmit={(event) => sendRequest(event, row)}>
            {others.length ? (
              <>
                <label>
                  Temporary override
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
      </article>
    );
  };

  const renderCell = (row: RosterRow | undefined, date: string) => {
    const kind = coverageOf(row?.shift, row ? teamIsCritical(criticalServices, row.project.id, row.shift.team_name) : false);
    const selected = panel?.date === date && panel.projectId === row?.project.id && panel.teamId === row?.shift.team_id;
    return (
      <button
        type="button"
        className={`oncall-grid__cell${date === todayDate ? ' is-today' : ''}${selected ? ' is-selected' : ''}`}
        onClick={() => openCell(row, date)}
        aria-label={`${row ? known(row.shift.team_name) : 'Shift'} ${formatCompactDay(date)} ${coverageLabel(kind)}`}
      >
        {row?.shift.user_id ? <span className="oncall-grid__name">{known(row.shift.name)}</span> : null}
        {row?.shift.backup_user_id ? <span className="oncall-grid__backup">{known(row.shift.backup_name)}</span> : null}
        <span className="oncall-grid__hours">{SHIFT_HOURS}</span>
        <span className={`oncall-badge oncall-badge--${kind}`}>{coverageLabel(kind)}</span>
      </button>
    );
  };

  return (
    <DevOpsLayout>
      <Head><title>On-call</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">On-call</h1>
            <p className="portal-page__subtitle">Coverage, schedules and handovers.</p>
          </div>
          <div className="portal-page__actions">
            <Link href={manageHref} className="btn btn-primary">Manage schedule</Link>
            <Link href="/on-call/handovers" className="btn btn-secondary">Handovers</Link>
            <details className="oncall-setup">
              <summary>Setup</summary>
              <div className="oncall-setup__menu">
                <Link href="/on-call/onboard">Onboard project</Link>
                <Link href="/on-call/projects">Projects</Link>
              </div>
            </details>
          </div>
        </div>
        {error ? (
          <div className="alert alert-error" role="alert">
            Failed to load. {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefresh((value) => value + 1)}>Retry</button>
          </div>
        ) : null}
        {note ? <div className="alert alert-success">{note}</div> : null}

        <section className="portal-stat-grid portal-stat-grid--three" aria-label="On-call summary">
          <button type="button" className="portal-stat-card" onClick={goToday}>
            <span className="portal-stat-card__label">Teams covered now</span>
            <span className="portal-stat-card__value">{loading ? '…' : `${teamsCoveredNow}/${teamsToday.size || 0}`}</span>
            <p className="portal-stat-card__copy">Primary and required backup in place today.</p>
          </button>
          <button
            type="button"
            className="portal-stat-card"
            onClick={() => {
              document.getElementById('oncall-gaps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              setCalendarView('week');
              setPeriodStart(todayDate);
            }}
          >
            <span className="portal-stat-card__label">Services without primary coverage</span>
            <span className="portal-stat-card__value">{loading ? '…' : criticalWithoutPrimary.length}</span>
            <p className="portal-stat-card__copy">Mission-critical services with no primary today.</p>
          </button>
          <button
            type="button"
            className="portal-stat-card"
            onClick={() => {
              document.getElementById('oncall-gaps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              setCalendarView('week');
              setPeriodStart(todayDate);
            }}
          >
            <span className="portal-stat-card__label">Upcoming gaps · {forecastDays} days</span>
            <span className="portal-stat-card__value">{loading ? '…' : affectedDates.size}</span>
            <p className="portal-stat-card__copy">{shiftCopy}</p>
          </button>
        </section>

        {!loading && criticalWithoutPrimary.length ? (
          <section className="ops-notice" role="alert" aria-label="Coverage warning">
            <p>
              {criticalWithoutPrimary.length} mission-critical service{criticalWithoutPrimary.length === 1 ? '' : 's'} need coverage today.
            </p>
            <a className="btn btn-primary" href="#oncall-gaps">Review gaps</a>
          </section>
        ) : null}

        {!loading ? (
          <section id="oncall-gaps" className="oncall-forecast" aria-label="Coverage forecast">
            <div className="oncall-forecast__head">
              <div>
                <strong>Coverage forecast</strong>
                <p>Uncovered shifts, missing backups, and overlapping assignments. Do not page from this page.</p>
              </div>
              <div className="oncall-forecast__horizons" role="group" aria-label="Forecast horizon">
                {FORECAST_DAYS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`btn btn-sm ${forecastDays === days ? 'btn-primary' : 'btn-secondary'}`}
                    aria-pressed={forecastDays === days}
                    onClick={() => setForecastDays(days)}
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </div>
            <div className="oncall-gap-groups">
              {gapGroups.map((group) => (
                <div key={`${group.row.project.id}-${group.row.shift.team_id}`} className="oncall-gap-groups__row">
                  <div>
                    <strong>{known(group.row.shift.team_name)}</strong>
                    <span>
                      {hideProjectFilter ? '' : `${known(group.row.project.name)} · `}
                      {formatDateList(group.dates)} · {group.label}
                    </span>
                  </div>
                  <Link className="btn btn-secondary btn-sm" href={`/on-call/project/${group.row.project.id}/team/${group.row.shift.team_id}`}>Assign coverage</Link>
                </div>
              ))}
              {overlapGroups.map((group) => (
                <div key={`${group.date}-${group.name}`} className="oncall-gap-groups__row">
                  <div>
                    <strong>{group.name}</strong>
                    <span>
                      {formatCompactDay(group.date)} · Overlapping assignment · {group.teams.map((item) => hideProjectFilter ? item.team : `${item.project} · ${item.team}`).join(', ')}
                    </span>
                  </div>
                  <Link className="btn btn-secondary btn-sm" href={group.teams[0]?.href || '/on-call/projects'}>Review schedule</Link>
                </div>
              ))}
              {!gapGroups.length && !overlapGroups.length ? (
                <p className="access-hint">No uncovered shifts, missing backups, or overlapping assignments in the next {forecastDays} days.</p>
              ) : null}
            </div>
          </section>
        ) : <div id="oncall-gaps" />}

        {!loading && pending.length ? (
          <section className="oncall-requests" aria-label="Temporary shift overrides">
            <strong>Temporary shift overrides</strong>
            {pending.map((row) => (
              <div key={rowKey(row)} className="oncall-requests__row">
                <span>{row.day.label} · {hideProjectFilter ? '' : `${known(row.project.name)} · `}{known(row.shift.team_name)} · {known(row.shift.from_name)} asked {known(row.shift.cover_name)}</span>
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

        <section className="portal-surface oncall-roster">
          <div className="oncall-toolbar">
            {hideProjectFilter ? null : (
              <label>
                Project
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
            <div className="oncall-toolbar__view" role="group" aria-label="Schedule period">
              <button
                type="button"
                className={`btn btn-sm ${calendarView === 'week' ? 'btn-primary' : 'btn-secondary'}`}
                aria-label="Week"
                aria-pressed={calendarView === 'week'}
                onClick={() => setCalendarView('week')}
              >
                Week
              </button>
              <button
                type="button"
                className={`btn btn-sm ${calendarView === 'month' ? 'btn-primary' : 'btn-secondary'}`}
                aria-label="Month"
                aria-pressed={calendarView === 'month'}
                onClick={() => {
                  setCalendarView('month');
                  setMonth(periodStart.slice(0, 7) || currentMonth(timezone));
                }}
              >
                Month
              </button>
            </div>
            <div className="oncall-toolbar__period">
              <button type="button" className="oncall-month__step" aria-label={calendarView === 'month' ? 'Previous month' : 'Previous week'} onClick={() => shiftPeriod(-1)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <p className="oncall-toolbar__range" aria-live="polite">{rangeLabel}</p>
              <button type="button" className="oncall-month__step" aria-label={calendarView === 'month' ? 'Next month' : 'Next week'} onClick={() => shiftPeriod(1)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={goToday}>Today</button>
            </div>
            <label className="oncall-filters__zone">
              Timezone
              <select className="input" aria-label="Roster timezone" value={timezone} onChange={(event) => { setTimezone(event.target.value); setMonth(currentMonth(event.target.value)); }}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
            <details className="oncall-help">
              <summary aria-label="Workspace filter and timezone help">?</summary>
              <p>
                {scope.projectId
                  ? 'The workspace filter at the top limits this page to that project. A day starts at 00:00 in the timezone. Today, week changes, and handover use that boundary.'
                  : 'The workspace filter at the top limits this page. Project below further filters the roster. A day starts at 00:00 in the timezone. Today, week changes, and handover use that boundary.'}
              </p>
            </details>
          </div>

          {loading ? <div className="empty-state">Loading on-call...</div> : null}

          {!loading && calendarView === 'week' ? (
            <>
              <div className="oncall-grid" role="grid" aria-label={`Weekly schedule ${rangeLabel}`}>
                <div className="oncall-grid__corner" />
                {weekDates.map((date) => (
                  <div key={date} className={`oncall-grid__head${date === todayDate ? ' is-today' : ''}`}>
                    <span>{weekdayShort(date)}</span>
                    <strong>{Number(date.slice(-2))}</strong>
                  </div>
                ))}
                {scheduleTeams.map((item) => (
                  <div key={item.key} className="oncall-grid__row" role="row">
                    <div className="oncall-grid__team">
                      <strong>{known(item.teamName)}</strong>
                      {hideProjectFilter ? null : <span>{known(item.project.name)}</span>}
                    </div>
                    {weekDates.map((date) => {
                      const row = weekRows.find((itemRow) => itemRow.project.id === item.project.id && itemRow.shift.team_id === item.teamId && itemRow.day.date === date);
                      return <div key={`${item.key}-${date}`} role="gridcell">{renderCell(row, date)}</div>;
                    })}
                  </div>
                ))}
              </div>
              {!scheduleTeams.length ? <div className="empty-state">No teams match this filter in this week.</div> : null}
              <div className="oncall-agenda" aria-label="Weekly agenda">
                {weekDates.map((date) => {
                  const dayRows = weekRows.filter((row) => row.day.date === date);
                  return (
                    <section key={date} className={`oncall-agenda__day${date === todayDate ? ' is-today' : ''}`}>
                      <h3>{formatCompactDay(date)}{date === todayDate ? ' · Today' : ''}</h3>
                      {!dayRows.length ? <p className="access-hint">No teams match this filter on this day.</p> : dayRows.map((row) => (
                        <button key={rowKey(row)} type="button" className="oncall-agenda__row" onClick={() => openCell(row, date)}>
                          <span>{hideProjectFilter ? known(row.shift.team_name) : `${known(row.project.name)} · ${known(row.shift.team_name)}`}</span>
                          <span className={`oncall-badge oncall-badge--${kindOf(row)}`}>{coverageLabel(kindOf(row))}</span>
                        </button>
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          ) : null}

          {!loading && calendarView === 'month' ? (
            <>
              <div className="oncall-month-grid" role="grid" aria-label={monthTitle(month)}>
                {WEEK_LETTERS.map((letter) => <span key={letter} className="oncall-month-grid__dow">{letter}</span>)}
                {calendarCells(month).map((cell, index) => {
                  if (!cell) return <span key={`empty-${index}`} className="oncall-month-grid__cell is-empty" />;
                  const dayRows = rows.filter((row) => row.day.date === cell.date);
                  const kinds = dayRows.map((row) => kindOf(row));
                  const kind: CoverageKind = kinds.includes('primary') ? 'primary' : kinds.includes('backup') ? 'backup' : kinds.includes('covered') ? 'covered' : 'none';
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      className={`oncall-month-grid__cell${cell.date === todayDate ? ' is-today' : ''}${panel?.date === cell.date ? ' is-selected' : ''}`}
                      onClick={() => setPanel({ date: cell.date })}
                      aria-label={`${formatCompactDay(cell.date)} ${coverageLabel(kind)}`}
                    >
                      <span className="oncall-month-grid__num">{cell.day}</span>
                      <span className={`oncall-badge oncall-badge--${kind}`}>{coverageLabel(kind)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="oncall-agenda" aria-label="Monthly agenda">
                {calendarCells(month).filter((cell): cell is { day: number; date: string } => Boolean(cell)).map((cell) => {
                  const dayRows = rows.filter((row) => row.day.date === cell.date);
                  return (
                    <section key={cell.date} className={`oncall-agenda__day${cell.date === todayDate ? ' is-today' : ''}`}>
                      <h3>{formatCompactDay(cell.date)}{cell.date === todayDate ? ' · Today' : ''}</h3>
                      {!dayRows.length ? <p className="access-hint">No teams match this filter on this day.</p> : dayRows.map((row) => (
                        <button key={rowKey(row)} type="button" className="oncall-agenda__row" onClick={() => openCell(row, cell.date)}>
                          <span>{hideProjectFilter ? known(row.shift.team_name) : `${known(row.project.name)} · ${known(row.shift.team_name)}`}</span>
                          <span className={`oncall-badge oncall-badge--${kindOf(row)}`}>{coverageLabel(kindOf(row))}</span>
                        </button>
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>
      </div>
      <InspectorDrawer
        open={Boolean(panel)}
        onClose={() => { setPanel(null); setCoverUserId(''); }}
        resetKey={panel ? `${panel.date}-${panel.projectId || 0}-${panel.teamId || 0}` : ''}
        label="Shift details"
        eyebrow="On-call"
        title={panelRow ? known(panelRow.shift.team_name) : panel ? formatCompactDay(panel.date) : 'Shift'}
        subtitle={panelRow ? `${panelRow.day.label} · ${SHIFT_HOURS} ${timezone}` : panel ? timezone : undefined}
      >
        {panelRows.length ? panelRows.map((row) => renderShiftBody(row)) : <p>No teams match this filter on the selected day.</p>}
      </InspectorDrawer>
    </DevOpsLayout>
  );
}
