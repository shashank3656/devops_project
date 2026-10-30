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
  onCallTeamHref,
  shiftMonth,
  timezoneAbbrev,
  timezoneCompactLabel,
  weekdayShort,
} from '../lib/onCallMonth';
import { InspectorDrawer, SavedViews, useSavedFilterViews, useWorkspaceScope } from '@infragate/ui';
import { OPERATIONS_SCOPE, OPERATIONS_STORAGE_KEY, OPERATIONS_VIEW_PRESETS, asOperationalView, type OperationalView } from '../lib/operationalViews';

const TOKEN_KEY = 'devops_token';
const USER_KEY = 'devops_user';
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
const WEEK_LETTERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
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
  cover_end_date?: string;
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

interface CatalogService {
  id: number;
  service: string;
  team?: string;
  project_id?: number;
  criticality?: string;
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

function teamIsCritical(services: CatalogService[], projectId: number, teamName: string): boolean {
  const name = teamName.trim().toLowerCase();
  if (!name) return false;
  return services.some((item) => {
    if (String(item.criticality || '').toLowerCase() !== 'mission_critical') return false;
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
  if (kind === 'primary') return 'Unassigned';
  if (kind === 'backup') return 'Backup unassigned';
  if (kind === 'covered') return 'Covered';
  return 'No shift required';
}

function isCoverageGap(kind: CoverageKind): boolean {
  return kind === 'primary' || kind === 'backup';
}

function rowKey(row: RosterRow): string {
  return `${row.day.date}-${row.project.id}-${row.shift.team_id}`;
}

function assignCoverageHref(projectId: number, teamId: number, date: string, timezone: string): string {
  return onCallTeamHref(projectId, teamId, date, timezone);
}

function WarningIcon() {
  return (
    <svg className="oncall-warn-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.6 14.6 14H1.4L8 1.6Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.2v3.4M8 11.6h.01" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
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
  const [mineOnly, setMineOnly] = useState(false);
  const [me, setMe] = useState(0);
  const [isManager, setIsManager] = useState(false);
  const [coverUserId, setCoverUserId] = useState('');
  const [coverUntilDate, setCoverUntilDate] = useState('');
  const [coverHistory, setCoverHistory] = useState<{ id: number; cover_date: string; cover_end_date: string; from_name: string; to_name: string; status: string; created_at: string }[]>([]);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  const [forecastDays, setForecastDays] = useState<ForecastDays>(7);
  const [gapsOpen, setGapsOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      const parsed = stored ? JSON.parse(stored) as { id?: number; role?: string; devops_profile?: { is_manager?: boolean } } : null;
      if (typeof parsed?.id === 'number') setMe(parsed.id);
      setIsManager(Boolean(parsed?.devops_profile?.is_manager) || String(parsed?.role || '').toLowerCase() === 'admin');
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
        setCatalogServices(catalog
          .map((item: { id?: number; service?: string; team?: string; project_id?: number; criticality?: string }) => ({
            id: typeof item.id === 'number' ? item.id : 0,
            service: String(item.service || '').trim(),
            team: String(item.team || '').trim(),
            project_id: typeof item.project_id === 'number' ? item.project_id : undefined,
            criticality: String(item.criticality || '').trim(),
          }))
          .filter((item: CatalogService) => item.id > 0 && item.service));
      })
      .catch((err) => {
        setProjects([]);
        setCatalogServices([]);
        setError(err instanceof Error ? err.message : 'Failed to load on-call');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, month, periodStart, refresh, timezone]);

  const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  const { remoteViews, ready: savedViewsReady, saveRemote, deleteRemote } = useSavedFilterViews<OperationalView>({
    apiUrl,
    token,
    scope: OPERATIONS_SCOPE,
    storageKey: OPERATIONS_STORAGE_KEY,
    portal: 'devops',
  });

  useEffect(() => {
    if (!panel?.projectId || !panel?.teamId) {
      setCoverHistory([]);
      return;
    }
    const auth = localStorage.getItem(TOKEN_KEY);
    if (!auth) return;
    fetch(`${apiUrl}/api/oncall/covers?project_id=${panel.projectId}&team_id=${panel.teamId}`, {
      headers: { Authorization: `Bearer ${auth}` },
    })
      .then(async (res) => (res.ok ? res.json() : { covers: [] }))
      .then((data: { covers?: unknown }) => setCoverHistory(Array.isArray(data?.covers) ? data.covers as typeof coverHistory : []))
      .catch(() => setCoverHistory([]));
  }, [apiUrl, panel?.projectId, panel?.teamId, refresh]);

  useEffect(() => {
    const date = panel?.date || '';
    if (!date) return;
    setCoverUntilDate((current) => (current && current >= date ? current : date));
  }, [panel?.date]);

  const scopedProjects = useMemo(() => {
    if (!scope.projectId) return projects;
    return projects.filter((project) => String(project.id) === scope.projectId);
  }, [projects, scope.projectId]);
  const hideProjectFilter = Boolean(scope.projectId) && scopedProjects.length <= 1;
  const criticalServices = catalogServices.filter((item) => String(item.criticality || '').toLowerCase() === 'mission_critical');

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
    if (team === 'mine') {
      const onTeam = (project.rosters[shift.team_id] || []).some((person) => person.userId === me);
      if (!onTeam && !(me > 0 && (shift.user_id === me || shift.backup_user_id === me || shift.cover_user_id === me))) return false;
    } else if (team && shift.team_name !== team) return false;
    return true;
  };
  const isMine = (shift: TeamShift) => me > 0 && (shift.user_id === me || shift.backup_user_id === me || shift.cover_user_id === me);
  const scopedRows = scopedProjects.flatMap((project) => project.days.flatMap((day) => (
    day.teams.filter((shift) => matches(project, shift)).map((shift) => ({ project, day, shift }))
  )));
  const assignedRows = mineOnly ? scopedRows.filter((row) => isMine(row.shift)) : scopedRows;
  const kindOf = (row: RosterRow) => coverageOf(row.shift, teamIsCritical(catalogServices, row.project.id, row.shift.team_name));
  const rows = unassignedOnly ? assignedRows.filter((row) => kindOf(row) === 'primary') : assignedRows;

  const todayDate = todayKey(timezone);
  const todayRows = scopedRows.filter((row) => row.day.date === todayDate);
  const weekDates = nextSevenDateKeys(periodStart);
  const weekEnd = weekDates[weekDates.length - 1] || periodStart;
  const lookaheadDates = nextDateKeys(todayDate, forecastDays);
  const lookaheadEnd = lookaheadDates[lookaheadDates.length - 1] || todayDate;
  const weekRows = rows.filter((row) => row.day.date >= periodStart && row.day.date <= weekEnd);
  const upcomingRows = scopedRows.filter((row) => row.day.date >= todayDate && row.day.date <= lookaheadEnd);
  const myUpcomingRows = upcomingRows.filter((row) => isMine(row.shift));
  const upcomingGaps = upcomingRows.filter((row) => isCoverageGap(kindOf(row)));
  const affectedDates = new Set(upcomingGaps.map((row) => row.day.date));
  const teamDaysWithoutCoverage = upcomingGaps.filter((row) => kindOf(row) === 'primary').length;

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
  const pending = scopedRows.filter((row) => row.shift.status === 'pending');
  const teamsToday = new Map<string, RosterRow>();
  todayRows.forEach((row) => teamsToday.set(`${row.project.id}-${row.shift.team_id}`, row));
  const teamsCoveredNow = [...teamsToday.values()].filter((row) => kindOf(row) === 'covered').length;

  const gapGroups = useMemo(() => {
    const grouped = new Map<string, { row: RosterRow; dates: string[]; kinds: Set<CoverageKind> }>();
    upcomingGaps.forEach((row) => {
      const key = `${row.project.id}-${row.shift.team_id}`;
      const current = grouped.get(key);
      const kind = coverageOf(row.shift, teamIsCritical(catalogServices, row.project.id, row.shift.team_name));
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
      label: item.kinds.has('primary') ? 'Unassigned' : 'Backup unassigned',
    }));
  }, [upcomingGaps, catalogServices]);

  const overlapGroups = useMemo(() => {
    const byPerson = new Map<string, { name: string; rows: RosterRow[] }>();
    const add = (row: RosterRow, userId: number, name: string) => {
      if (!userId) return;
      const key = `${row.day.date}-${userId}`;
      const current = byPerson.get(key) || { name: known(name), rows: [] };
      current.rows.push(row);
      if (current.name === 'Unknown' && known(name) !== 'Unknown') current.name = known(name);
      byPerson.set(key, current);
    };
    upcomingRows.forEach((row) => {
      add(row, row.shift.user_id, row.shift.name);
      add(row, row.shift.backup_user_id || 0, row.shift.backup_name || '');
    });
    return [...byPerson.values()]
      .map((item) => {
        const unique = new Map<string, RosterRow>();
        item.rows.forEach((row) => unique.set(`${row.project.id}-${row.shift.team_id}`, row));
        return { name: item.name, list: [...unique.values()] };
      })
      .filter((item) => item.list.length > 1)
      .map((item) => ({
        date: item.list[0].day.date,
        name: item.name,
        teams: item.list.map((row) => ({
          project: known(row.project.name),
          team: known(row.shift.team_name),
          href: assignCoverageHref(row.project.id, row.shift.team_id, row.day.date, timezone),
        })),
      }))
      .sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name));
  }, [upcomingRows, timezone]);

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

  const myNextHandover = useMemo(() => {
    if (me <= 0) return '';
    const mine = myUpcomingRows
      .filter((row) => row.shift.user_id === me)
      .sort((left, right) => left.day.date.localeCompare(right.day.date));
    if (!mine.length) return 'No upcoming handover';
    const handoff = addCalendarDays(mine[0].day.date, 1);
    return `Next handover ${formatCompactDay(handoff)} 00:00 ${timezoneAbbrev(timezone)}`;
  }, [me, myUpcomingRows, timezone]);

  const canRequest = (row: RosterRow) => row.shift.user_id > 0 && row.day.date >= todayDate && row.shift.status !== 'pending' && (isManager || (me > 0 && me === row.shift.user_id));
  const rosterFor = (project: RosterProject, teamId: number) => project.rosters[teamId] || [];
  const servicesFor = (row: RosterRow) => catalogServices.filter((item) => {
    if (item.project_id && item.project_id !== row.project.id) return false;
    return (item.team || '').trim().toLowerCase() === (row.shift.team_name || '').trim().toLowerCase();
  });

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
          until_date: coverUntilDate && coverUntilDate >= row.day.date ? coverUntilDate : row.day.date,
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
      setNote('Request sent. The covering person must accept. The original weekly rotation is not rewritten.');
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
      setNote(decision === 'approve' ? 'Approved. This interval now shows the covering person. The original rotation is unchanged.' : 'Declined. The original person stays on this interval.');
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

  const reviewGaps = () => {
    setGapsOpen(true);
    setCalendarView('week');
    setPeriodStart(todayDate);
    window.requestAnimationFrame(() => {
      document.getElementById('oncall-gaps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
    ? assignCoverageHref(scheduleTeams[0].project.id, scheduleTeams[0].teamId, todayDate, timezone)
    : '/on-call/projects';
  const rangeLabel = calendarView === 'month' ? monthTitle(month) : formatDateRange(periodStart, weekEnd);
  const scoreCopy = `${affectedDates.size} dates · ${teamDaysWithoutCoverage} team-days`;
  const zoneLabel = timezoneCompactLabel(timezone);
  let gapsSummary = 'Coverage gaps';
  if (gapGroups.length) gapsSummary += ` · ${gapGroups.length} team${gapGroups.length === 1 ? '' : 's'}`;
  if (overlapGroups.length) gapsSummary += ` · ${overlapGroups.length} overlapping`;
  if (!gapGroups.length && !overlapGroups.length) gapsSummary += ' · 0 teams';

  const openCell = (row: RosterRow | undefined, date: string) => {
    if (row) setPanel({ date, projectId: row.project.id, teamId: row.shift.team_id });
    else setPanel({ date });
  };

  const renderShiftBody = (row: RosterRow, showTeam: boolean) => {
    const kind = kindOf(row);
    const people = rosterFor(row.project, row.shift.team_id);
    const others = people.filter((person) => person.userId !== row.shift.user_id);
    const needsBackup = teamIsCritical(catalogServices, row.project.id, row.shift.team_name);
    const affected = servicesFor(row);
    const assignHref = assignCoverageHref(row.project.id, row.shift.team_id, row.day.date, timezone);
    return (
      <article key={rowKey(row)} className="oncall-shift-detail">
        {showTeam ? (
          <p className="oncall-shift-detail__team">
            {hideProjectFilter ? known(row.shift.team_name) : `${known(row.project.name)} · ${known(row.shift.team_name)}`}
          </p>
        ) : null}
        <div className="oncall-shift-role">
          <span>Primary</span>
          <strong>{row.shift.user_id ? known(row.shift.name) : 'Unassigned'}</strong>
        </div>
        <div className="oncall-shift-role">
          <span>Backup</span>
          <strong>
            {row.shift.backup_user_id
              ? known(row.shift.backup_name)
              : needsBackup ? 'Unassigned' : 'Not required'}
          </strong>
        </div>
        <p className="oncall-shift-detail__hours">24-hour coverage · {zoneLabel}</p>
        {row.shift.status === 'covered' ? <p>{known(row.shift.name)} is covering for {known(row.shift.from_name)}. The original weekly rotation is unchanged.</p> : null}
        {row.shift.status === 'pending' ? <p>Waiting for {known(row.shift.cover_name)} to accept a temporary override{row.shift.cover_end_date && row.shift.cover_end_date !== row.day.date ? ` through ${formatCompactDay(row.shift.cover_end_date)}` : ''}.</p> : null}
        <div className="oncall-shift-services">
          <span>Affected services</span>
          {affected.length ? (
            <ul>
              {affected.map((item) => (
                <li key={item.id}>
                  {item.service}
                  {String(item.criticality || '').toLowerCase() === 'mission_critical' ? ' · Mission-critical' : ''}
                </li>
              ))}
            </ul>
          ) : <p>No services mapped to this team.</p>}
        </div>
        {kind === 'primary' ? <p>Assign coverage to enable incident escalation.</p> : null}
        <div className="portal-page__actions">
          <Link className="btn btn-primary" href={assignHref}>Assign coverage</Link>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void openHandover(row)}>Open handover</button>
        </div>
        {canRequest(row) ? (
          <form className="oncall-ask" onSubmit={(event) => sendRequest(event, row)}>
            {others.length ? (
              <>
                <div className="oncall-ask__interval">
                  <label>
                    Cover from
                    <input className="input" type="date" value={row.day.date} readOnly />
                  </label>
                  <label>
                    Cover until
                    <input className="input" type="date" min={row.day.date} value={coverUntilDate || row.day.date} onChange={(event) => setCoverUntilDate(event.target.value)} />
                  </label>
                </div>
                <label>
                  Temporary override
                  <select className="input" value={coverUserId} onChange={(event) => setCoverUserId(event.target.value)}>
                    <option value="">Select a person</option>
                    {others.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
                  </select>
                </label>
                <p className="access-hint">Acceptance overlays this interval only. The published weekly rotation stays as it is.</p>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending...' : 'Send override'}</button>
              </>
            ) : <p>Add another person on this team before a temporary override can be requested.</p>}
          </form>
        ) : null}
        {coverHistory.length ? (
          <div className="oncall-shift-services">
            <span>Change history</span>
            <ul>
              {coverHistory.slice(0, 12).map((item) => (
                <li key={item.id}>
                  {formatCompactDay(item.cover_date)}
                  {item.cover_end_date && item.cover_end_date !== item.cover_date ? ` – ${formatCompactDay(item.cover_end_date)}` : ''}
                  {' · '}
                  {known(item.from_name)} → {known(item.to_name)} · {item.status}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
    );
  };

  const renderCell = (row: RosterRow | undefined, date: string) => {
    const kind = coverageOf(row?.shift, row ? teamIsCritical(catalogServices, row.project.id, row.shift.team_name) : false);
    const selected = panel?.date === date && panel.projectId === row?.project.id && panel.teamId === row?.shift.team_id;
    return (
      <button
        type="button"
        className={`oncall-grid__cell${date === todayDate ? ' is-today' : ''}${selected ? ' is-selected' : ''}${kind === 'primary' ? ' is-unassigned' : ''}`}
        onClick={() => openCell(row, date)}
        aria-label={`${row ? known(row.shift.team_name) : 'Shift'} ${formatCompactDay(date)} ${coverageLabel(kind)}. Open to assign coverage.`}
      >
        {kind === 'primary' ? (
          <span className="oncall-grid__unassigned"><WarningIcon />Unassigned</span>
        ) : null}
        {row?.shift.user_id ? <span className="oncall-grid__name">{known(row.shift.name)}</span> : null}
        {row?.shift.backup_user_id ? <span className="oncall-grid__backup">{known(row.shift.backup_name)}</span> : null}
        {kind === 'backup' ? <span className="oncall-badge oncall-badge--backup">Backup</span> : null}
      </button>
    );
  };

  return (
    <DevOpsLayout>
      <Head><title>On-call</title></Head>
      <div className="portal-page oncall-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">On-call</h1>
          </div>
          <div className="portal-page__actions">
            <Link href={manageHref} className="btn btn-primary">Manage schedule</Link>
            <Link href="/on-call/handovers" className="btn btn-secondary">Handovers</Link>
          </div>
        </div>
        {error ? (
          <div className="alert alert-error" role="alert">
            Failed to load. {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefresh((value) => value + 1)}>Retry</button>
          </div>
        ) : null}
        {note ? <div className="alert alert-success">{note}</div> : null}

        <SavedViews<OperationalView>
          storageKey={OPERATIONS_STORAGE_KEY}
          current={{ team, environment: '', mine: mineOnly ? '1' : '', unassigned: unassignedOnly ? '1' : '' }}
          onApply={(next) => {
            const view = asOperationalView(next);
            setTeam(view.team);
            setMineOnly(view.mine === '1' || view.team === 'mine');
            setUnassignedOnly(view.unassigned === '1');
          }}
          presets={OPERATIONS_VIEW_PRESETS}
          canSave={Boolean(team || mineOnly || unassignedOnly)}
          serverViews={savedViewsReady ? remoteViews : undefined}
          onServerSave={saveRemote}
          onServerDelete={deleteRemote}
        />

        <section className="portal-stat-grid portal-stat-grid--three oncall-summary" aria-label="On-call summary">
          <button type="button" className="portal-stat-card" onClick={goToday}>
            <span className="portal-stat-card__label">Teams covered</span>
            <span className="portal-stat-card__value">{loading ? '…' : `${teamsCoveredNow}/${teamsToday.size || 0}`}</span>
            <p className="portal-stat-card__copy">Primary and backup in place today</p>
          </button>
          <button type="button" className="portal-stat-card" onClick={reviewGaps} aria-label="Review gaps. Critical services uncovered">
            <span className="portal-stat-card__label">Critical services uncovered</span>
            <span className="portal-stat-card__value">{loading ? '…' : criticalWithoutPrimary.length}</span>
            <p className="portal-stat-card__copy">Review gaps</p>
          </button>
          <button type="button" className="portal-stat-card" onClick={reviewGaps} aria-label={`Review gaps. Upcoming gaps ${loading ? '' : scoreCopy}`}>
            <span className="portal-stat-card__label">Upcoming gaps</span>
            <span className="portal-stat-card__value">{loading ? '…' : affectedDates.size}</span>
            <p className="portal-stat-card__copy">{loading ? 'Review gaps' : `Review gaps · ${scoreCopy}`}</p>
          </button>
        </section>

        <section className="portal-surface oncall-roster">
          <div className="oncall-toolbar">
            {hideProjectFilter ? null : (
              <label className="oncall-toolbar__grow">
                Project
                <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">All projects</option>
                  {scopedProjects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.name} (${project.code})` : known(project.name)}</option>)}
                </select>
              </label>
            )}
            <label className="oncall-toolbar__grow">
              Team
              <select className="input" value={team} onChange={(event) => setTeam(event.target.value)}>
                <option value="">All teams</option>
                {me > 0 ? <option value="mine">My team</option> : null}
                {teamNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            {me > 0 ? (
              <button
                type="button"
                className={`btn btn-sm ${mineOnly ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={mineOnly}
                onClick={() => setMineOnly((value) => !value)}
              >
                My shifts
              </button>
            ) : null}
            <button
              type="button"
              className={`btn btn-sm ${unassignedOnly ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={unassignedOnly}
              onClick={() => setUnassignedOnly((value) => !value)}
            >
              Unassigned
            </button>
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
              <span className="oncall-toolbar__range" aria-live="polite">{rangeLabel}</span>
              <button type="button" className="oncall-month__step" aria-label={calendarView === 'month' ? 'Next month' : 'Next week'} onClick={() => shiftPeriod(1)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={goToday}>Today</button>
            <label className="oncall-tz">
              <span className="ig-sr-only">Timezone</span>
              <select className="input" aria-label="Roster timezone" title={timezone} value={timezone} onChange={(event) => { setTimezone(event.target.value); setMonth(currentMonth(event.target.value)); }}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{timezoneCompactLabel(zone)}</option>)}
              </select>
            </label>
            <details className="oncall-help">
              <summary aria-label="On-call help">?</summary>
              <div className="oncall-help__panel">
                <p>
                  {scope.projectId
                    ? 'The workspace filter at the top limits this page to that project. A day starts at 00:00 in the timezone. Today, week changes, and handover use that boundary.'
                    : 'The workspace filter at the top limits this page. Project below further filters the roster. A day starts at 00:00 in the timezone. Today, week changes, and handover use that boundary.'}
                  {' '}Do not page from this page. Assign coverage to enable incident escalation.
                </p>
                <div className="oncall-help__links">
                  <Link href="/on-call/onboard">Onboard project</Link>
                  <Link href="/on-call/projects">Projects</Link>
                </div>
              </div>
            </details>
          </div>
          {mineOnly && me > 0 ? <p className="oncall-mine-hint">{myNextHandover}</p> : null}

          {!loading && pending.length ? (
            <div className="oncall-requests" aria-label="Temporary shift overrides">
              <strong>Temporary shift overrides</strong>
              {pending.map((row) => (
                <div key={rowKey(row)} className="oncall-requests__row">
                  <span>
                    {row.day.label}
                    {row.shift.cover_end_date && row.shift.cover_end_date !== row.day.date ? ` – ${formatCompactDay(row.shift.cover_end_date)}` : ''}
                    {' · '}
                    {hideProjectFilter ? '' : `${known(row.project.name)} · `}
                    {known(row.shift.team_name)} · {known(row.shift.from_name)} asked {known(row.shift.cover_name)}
                  </span>
                  {me > 0 && me === row.shift.cover_user_id ? (
                    <span>
                      <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void decide(row.shift.request_id || 0, 'approve')}>Approve</button>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => void decide(row.shift.request_id || 0, 'decline')}>Decline</button>
                    </span>
                  ) : <span>Waiting for {known(row.shift.cover_name)}</span>}
                </div>
              ))}
            </div>
          ) : null}

          {loading ? <div className="empty-state">Loading on-call...</div> : null}

          {!loading && calendarView === 'week' ? (
            <>
              <div className="oncall-grid" role="grid" aria-label={`Weekly schedule ${rangeLabel}`}>
                <div className="oncall-grid__corner" />
                {weekDates.map((date) => (
                  <div key={date} className={`oncall-grid__head${date === todayDate ? ' is-today' : ''}`}>
                    <span>{weekdayShort(date)}</span>
                    <strong>{Number(date.slice(-2))}</strong>
                    {date === todayDate ? <span className="oncall-today-badge">Today</span> : null}
                  </div>
                ))}
                {scheduleTeams.map((item) => (
                  <div key={item.key} className="oncall-grid__row" role="row">
                    <div className="oncall-grid__team">
                      <strong>{known(item.teamName)}</strong>
                      {hideProjectFilter ? null : <span>{known(item.project.name)}</span>}
                      <span className="oncall-grid__hours-note">24-hour coverage</span>
                    </div>
                    {weekDates.map((date) => {
                      const row = weekRows.find((itemRow) => itemRow.project.id === item.project.id && itemRow.shift.team_id === item.teamId && itemRow.day.date === date);
                      return <div key={`${item.key}-${date}`} role="gridcell">{renderCell(row, date)}</div>;
                    })}
                  </div>
                ))}
              </div>
              {!scheduleTeams.length ? <div className="empty-state">{mineOnly ? 'No shifts assigned to you in this week.' : 'No teams match this filter in this week.'}</div> : null}
              <div className="oncall-agenda" aria-label="Weekly agenda">
                {weekDates.map((date) => {
                  const dayRows = weekRows.filter((row) => row.day.date === date);
                  return (
                    <section key={date} className={`oncall-agenda__day${date === todayDate ? ' is-today' : ''}`}>
                      <h3>{formatCompactDay(date)}{date === todayDate ? ' · Today' : ''}</h3>
                      {!dayRows.length ? <p className="access-hint">No teams match this filter on this day.</p> : dayRows.map((row) => (
                        <button key={rowKey(row)} type="button" className="oncall-agenda__row" onClick={() => openCell(row, date)}>
                          <span>{hideProjectFilter ? known(row.shift.team_name) : `${known(row.project.name)} · ${known(row.shift.team_name)}`}</span>
                          {kindOf(row) === 'primary' ? <span className="oncall-grid__unassigned"><WarningIcon />Unassigned</span> : kindOf(row) === 'backup' ? <span className="oncall-badge oncall-badge--backup">Backup</span> : <span className="oncall-grid__name">{known(row.shift.name)}</span>}
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
                      aria-label={`${formatCompactDay(cell.date)} ${coverageLabel(kind)}. Open to assign coverage.`}
                    >
                      <span className="oncall-month-grid__num">{cell.day}</span>
                      {cell.date === todayDate ? <span className="oncall-today-badge">Today</span> : null}
                      {kind === 'primary' ? <span className="oncall-grid__unassigned"><WarningIcon />Unassigned</span> : null}
                      {kind === 'backup' ? <span className="oncall-badge oncall-badge--backup">Backup</span> : null}
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
                          {kindOf(row) === 'primary' ? <span className="oncall-grid__unassigned"><WarningIcon />Unassigned</span> : kindOf(row) === 'backup' ? <span className="oncall-badge oncall-badge--backup">Backup</span> : <span className="oncall-grid__name">{known(row.shift.name)}</span>}
                        </button>
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>

        {!loading ? (
          <details
            id="oncall-gaps"
            className="oncall-gaps"
            open={gapsOpen}
            onToggle={(event) => setGapsOpen((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>{gapsSummary}</summary>
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
                  <Link className="btn btn-secondary btn-sm" href={assignCoverageHref(group.row.project.id, group.row.shift.team_id, group.dates[0], timezone)}>Assign coverage</Link>
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
                  <Link className="btn btn-secondary btn-sm" href={group.teams[0]?.href || '/on-call/projects'}>Assign coverage</Link>
                </div>
              ))}
              {!gapGroups.length && !overlapGroups.length ? (
                <p className="access-hint">No uncovered shifts, missing backups, or overlapping assignments in the next {forecastDays} days.</p>
              ) : null}
            </div>
          </details>
        ) : <div id="oncall-gaps" />}
      </div>
      <InspectorDrawer
        open={Boolean(panel)}
        onClose={() => { setPanel(null); setCoverUserId(''); setCoverUntilDate(''); }}
        resetKey={panel ? `${panel.date}-${panel.projectId || 0}-${panel.teamId || 0}` : ''}
        label="Shift details"
        eyebrow="On-call"
        title={panelRow ? known(panelRow.shift.team_name) : panel ? formatCompactDay(panel.date) : 'Shift'}
        subtitle={panelRow ? `${panelRow.day.label} · 24-hour coverage` : panel ? formatCompactDay(panel.date) : undefined}
      >
        {panelRows.length ? panelRows.map((row) => renderShiftBody(row, panelRows.length > 1)) : <p>No teams match this filter on the selected day.</p>}
      </InspectorDrawer>
    </DevOpsLayout>
  );
}
