import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { currentMonth, monthTitle, shiftMonth, type OnCallPerson } from '../../../lib/onCallMonth';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
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

interface TeamRoster {
  team_id: number;
  team_name: string;
  roster: OnCallPerson[];
}

const WEEK_LETTERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function calendarCells(monthValue: string): Array<number | null> {
  const [yearText, monthText] = monthValue.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  if (!year || !monthIndex) return [];
  const first = new Date(Date.UTC(year, monthIndex - 1, 1, 12)).getUTCDay();
  const lead = (first + 6) % 7;
  const count = new Date(Date.UTC(year, monthIndex, 0, 12)).getUTCDate();
  const cells: Array<number | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= count; day += 1) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return cells;
}

function todayKey(timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
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

export default function OnCallProjectPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const raw = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const projectId = Number.parseInt(raw || '', 10);
  const monthQuery = Array.isArray(router.query.month) ? router.query.month[0] : router.query.month;
  const zoneQuery = Array.isArray(router.query.timezone) ? router.query.timezone[0] : router.query.timezone;
  const timezone = TIMEZONES.includes(zoneQuery || '') ? zoneQuery || 'Asia/Kolkata' : 'Asia/Kolkata';
  const month = monthQuery && /^\d{4}-\d{2}$/.test(monthQuery) ? monthQuery : currentMonth(timezone);
  const [projectName, setProjectName] = useState('');
  const [rosters, setRosters] = useState<TeamRoster[]>([]);
  const [days, setDays] = useState<DutyDay[]>([]);
  const [onCallOn, setOnCallOn] = useState(false);
  const [me, setMe] = useState(0);
  const [isManager, setIsManager] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [focusDate, setFocusDate] = useState('');
  const calendarRef = useRef<HTMLDivElement>(null);
  const [ask, setAsk] = useState<{ date: string; teamId: number } | null>(null);
  const [coverUserId, setCoverUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!calendarOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!calendarRef.current?.contains(event.target as Node)) setCalendarOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCalendarOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [calendarOpen]);

  useEffect(() => {
    if (!focusDate || loading) return;
    document.getElementById(`oncall-day-${focusDate}`)?.scrollIntoView({ block: 'center' });
  }, [days, focusDate, loading]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DEVOPS_USER_KEY);
      const parsed = stored ? JSON.parse(stored) as { id?: number; devops_profile?: { is_manager?: boolean } } : null;
      if (typeof parsed?.id === 'number') setMe(parsed.id);
      setIsManager(Boolean(parsed?.devops_profile?.is_manager));
    } catch {
      setIsManager(false);
    }
  }, []);

  useEffect(() => {
    if (!router.isReady || !projectId) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    setLoading(true);
    setError('');
    Promise.all([
      fetch(`${apiUrl}/api/devops/projects/${projectId}`, { headers }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load project');
        return data.project || data;
      }),
      fetch(`${apiUrl}/api/devops/me`, { headers }).then(async (res) => (res.ok ? res.json() : null)),
      fetch(`${apiUrl}/api/oncall/flags`, { headers }).then(async (res) => (res.ok ? res.json() : null)),
      fetch(`${apiUrl}/api/oncall/days?project_id=${projectId}&month=${month}&timezone=${encodeURIComponent(timezone)}`, { headers }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load on-call');
        return data;
      }),
    ])
      .then(([project, meBody, flagsBody, duty]) => {
        setProjectName(String(project.name || '').trim());
        const meId = typeof meBody?.id === 'number' ? meBody.id : typeof meBody?.user?.id === 'number' ? meBody.user.id : 0;
        if (meId) setMe(meId);
        if (meBody?.devops_profile?.is_manager || meBody?.user?.devops_profile?.is_manager) setIsManager(true);
        const flags = Array.isArray(flagsBody?.flags) ? flagsBody.flags : [];
        const flag = flags.find((item: { project_id?: number }) => item.project_id === projectId);
        setOnCallOn(Boolean(flag?.enabled));
        const teamRows = Array.isArray(duty?.teams) ? duty.teams : [];
        setRosters(teamRows.map((team: { team_id?: number; team_name?: string; roster?: { user_id?: number; name?: string }[] }) => ({
          team_id: typeof team.team_id === 'number' ? team.team_id : 0,
          team_name: String(team.team_name || '').trim() || 'Unknown',
          roster: (Array.isArray(team.roster) ? team.roster : [])
            .map((person) => ({ userId: person.user_id || 0, name: String(person.name || '').trim() || 'Unknown' }))
            .filter((person: OnCallPerson) => person.userId > 0),
        })).filter((team: TeamRoster) => team.team_id > 0));
        const loadedDays = Array.isArray(duty?.days) ? duty.days : [];
        setDays(loadedDays.map((day: DutyDay) => ({
          date: String(day.date || ''),
          label: String(day.label || ''),
          weekday: String(day.weekday || ''),
          today: Boolean(day.today),
          teams: Array.isArray(day.teams) ? day.teams : [],
        })));
        if (!teamRows.length) setError('This project has no team.');
      })
      .catch((err) => {
        setDays([]);
        setRosters([]);
        setError(err instanceof Error ? err.message : 'Failed to load on-call');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, month, projectId, refresh, router.isReady, timezone]);

  const today = days.find((day) => day.today);
  const openView = (next: { month?: string; timezone?: string }) => {
    setAsk(null);
    void router.push({
      pathname: `/on-call/project/${projectId}`,
      query: { month: next.month || month, timezone: next.timezone || timezone },
    });
  };
  const rosterFor = (teamId: number) => rosters.find((team) => team.team_id === teamId)?.roster || [];
  const others = (shift: TeamShift) => rosterFor(shift.team_id).filter((person) => person.userId !== shift.user_id);
  const pending = days.flatMap((day) => day.teams.filter((shift) => shift.status === 'pending').map((shift) => ({ day, shift })));
  const canRequest = (day: DutyDay, shift: TeamShift) => shift.user_id > 0 && day.date >= todayDate && shift.status !== 'pending' && (isManager || (me > 0 && me === shift.user_id));
  const todayDate = todayKey(timezone);
  const reload = () => setRefresh((value) => value + 1);

  const sendRequest = async (day: DutyDay, shift: TeamShift) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
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
        body: JSON.stringify({ project_id: projectId, team_id: shift.team_id, date: day.date, cover_user_id: cover, timezone }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' && data.error !== '404 page not found' ? data.error : 'The cover request could not be saved.');
        return;
      }
      setAsk(null);
      setCoverUserId('');
      setNote('Request sent. The day changes after that person approves.');
      reload();
    } catch {
      setError('The cover request could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const decide = async (requestId: number, decision: 'approve' | 'decline') => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
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
        setError(typeof data?.error === 'string' && data.error !== '404 page not found' ? data.error : 'The decision could not be saved.');
        return;
      }
      setNote(decision === 'approve' ? 'Approved. This day now shows the covering person.' : 'Declined. The original person stays on this day.');
      reload();
    } catch {
      setError('The decision could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setOnCallOn(enabled);
    const response = await fetch(`${apiUrl}/api/oncall/flags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ project_id: projectId, enabled }),
    });
    if (!response.ok) {
      setOnCallOn(!enabled);
      setError('On-call for this project could not be updated.');
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>{known(projectName)} on-call</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">On-call</span>
            <h1 className="portal-page__title">{known(projectName)}</h1>
            <p className="portal-page__subtitle">Each team rotates one person per day in {timezone}. A cover stays on that team and changes the day only after approval.</p>
          </div>
          <Link href="/on-call" className="btn btn-secondary">Back to on-call</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        <section className="portal-surface">
          <nav className="svc-crumb" aria-label="Location">
            <Link href="/on-call">On-call</Link>
            <span aria-hidden="true">/</span>
            <span>{known(projectName)}</span>
          </nav>
          <div className="oncall-controls">
            <div className="month-cal" ref={calendarRef}>
              <span className="month-cal__label">Month</span>
              <button
                type="button"
                className="month-cal__trigger"
                aria-expanded={calendarOpen}
                aria-haspopup="dialog"
                onClick={() => setCalendarOpen((open) => !open)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M1.5 6.5h13M5 1.5v2.5M11 1.5v2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                {monthTitle(month)}
              </button>
              {calendarOpen ? (
                <div className="month-cal__pop" role="dialog" aria-label="Choose a month">
                  <div className="month-cal__head">
                    <button type="button" className="month-cal__nav" aria-label="Previous month" onClick={() => openView({ month: shiftMonth(month, -1) })}>‹</button>
                    <strong>{monthTitle(month)}</strong>
                    <button type="button" className="month-cal__nav" aria-label="Next month" onClick={() => openView({ month: shiftMonth(month, 1) })}>›</button>
                  </div>
                  <div className="month-cal__grid">
                    {WEEK_LETTERS.map((letter) => <span key={letter} className="month-cal__dow">{letter}</span>)}
                    {calendarCells(month).map((day, index) => day ? (
                      <button
                        key={`${month}-${day}`}
                        type="button"
                        className={`month-cal__day${todayDate === `${month}-${String(day).padStart(2, '0')}` ? ' is-today' : ''}`}
                        onClick={() => {
                          setFocusDate(`${month}-${String(day).padStart(2, '0')}`);
                          setCalendarOpen(false);
                        }}
                      >
                        {day}
                      </button>
                    ) : <span key={`empty-${index}`} />)}
                  </div>
                </div>
              ) : null}
            </div>
            <label>
              Timezone
              <select className="input" value={timezone} onChange={(event) => openView({ timezone: event.target.value })}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
            {isManager ? (
              <label className="catalog-editor__toggle-label">
                <input type="checkbox" checked={onCallOn} onChange={(event) => setEnabled(event.target.checked)} />
                <span>On-call is on for this project</span>
              </label>
            ) : null}
          </div>
          {loading ? <div className="empty-state">Loading this month...</div> : null}
          {!loading && today ? (
            <div className="oncall-today">
              <span>
                <strong>Today · {today.label}</strong>
                <span className="oncall-today__teams">
                  {today.teams.map((shift) => (
                    <small key={shift.team_id}>{known(shift.team_name)} · {shiftText(shift)}</small>
                  ))}
                </span>
              </span>
            </div>
          ) : null}
          {!loading ? (
            <section className="oncall-requests" aria-label="Cover requests">
              <strong>Requests</strong>
              <p>The person on a team asks someone on that same team to take the day. The day changes only after that person approves.</p>
              {!pending.length ? <p>No requests are waiting for approval.</p> : null}
              {pending.map(({ day, shift }) => (
                <div key={`${day.date}-${shift.team_id}`} className="oncall-requests__row">
                  <span>{day.label} · {known(shift.team_name)} · {known(shift.from_name)} asked {known(shift.cover_name)}</span>
                  {me > 0 && me === shift.cover_user_id ? (
                    <span>
                      <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => decide(shift.request_id || 0, 'approve')}>Approve</button>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => decide(shift.request_id || 0, 'decline')}>Decline</button>
                    </span>
                  ) : (
                    <span>Waiting for {known(shift.cover_name)}</span>
                  )}
                </div>
              ))}
            </section>
          ) : null}
          {!loading && rosters.some((team) => team.roster.length < 2) ? (
            <p className="portal-surface__subtitle">A team with fewer than two people on its rotation cannot hand a day to someone else. Add people on the <Link href="/team">team page</Link>.</p>
          ) : null}
          {!loading && !error && !days.length ? <div className="empty-state">No on-call days for this month.</div> : null}
          {!loading && days.length ? (
            <ul className="svc-tree">
              {days.map((day) => (
                <li key={day.date} id={`oncall-day-${day.date}`}>
                  <div className={`svc-tree__folder${day.today ? ' is-current' : ''}`}>
                    <span>
                      {day.label}
                      <small className="svc-tree__meta">{day.weekday}</small>
                    </span>
                  </div>
                  <div className="oncall-shifts">
                    {day.teams.map((shift) => {
                      const open = ask?.date === day.date && ask.teamId === shift.team_id;
                      return (
                        <div key={shift.team_id}>
                          <div className="oncall-shift">
                            <span>
                              <strong>{known(shift.team_name)}</strong>
                              <small>{shiftText(shift)}</small>
                            </span>
                            <span>
                              {canRequest(day, shift) ? (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAsk(open ? null : { date: day.date, teamId: shift.team_id }); setCoverUserId(''); setError(''); }}>
                                  Request change
                                </button>
                              ) : null}
                              {shift.status === 'pending' && me > 0 && me === shift.cover_user_id ? (
                                <>
                                  <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => decide(shift.request_id || 0, 'approve')}>Approve</button>
                                  <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => decide(shift.request_id || 0, 'decline')}>Decline</button>
                                </>
                              ) : null}
                            </span>
                          </div>
                          {open ? (
                            <form className="oncall-ask" onSubmit={(event) => { event.preventDefault(); void sendRequest(day, shift); }}>
                              {others(shift).length ? (
                                <>
                                  <label>
                                    Who on {known(shift.team_name)} should approve this day?
                                    <select className="input" value={coverUserId} onChange={(event) => setCoverUserId(event.target.value)}>
                                      <option value="">Select a person</option>
                                      {others(shift).map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
                                    </select>
                                  </label>
                                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending...' : 'Send request'}</button>
                                </>
                              ) : (
                                <p>Add another person to {known(shift.team_name)} on the <Link href="/team">team page</Link> before this request can be sent.</p>
                              )}
                            </form>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
