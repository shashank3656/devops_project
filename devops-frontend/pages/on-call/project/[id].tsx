import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { currentMonth, monthDays, monthTitle, shiftMonth, type OnCallPerson } from '../../../lib/onCallMonth';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

interface TeamOption {
  id: number;
  name: string;
}

interface DutyDay {
  date: string;
  label: string;
  weekday: string;
  user_id: number;
  name: string;
  today: boolean;
  status: string;
  request_id?: number;
  cover_user_id?: number;
  cover_name?: string;
  from_name?: string;
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

function readMembers(data: { members?: unknown }): OnCallPerson[] {
  const raw = Array.isArray(data?.members) ? data.members : [];
  return raw
    .map((item) => {
      const row = item as { user_id?: number; name?: string; username?: string };
      return { userId: typeof row.user_id === 'number' ? row.user_id : 0, name: String(row.name || row.username || '').trim() };
    })
    .filter((item) => item.userId > 0 && item.name);
}

async function loadMembers(apiUrl: string, teamId: number, headers: HeadersInit): Promise<OnCallPerson[] | null> {
  const primary = await fetch(`${apiUrl}/api/oncall/team-members?team_id=${teamId}`, { headers });
  if (primary.ok) return readMembers(await primary.json().catch(() => ({})));
  const fallback = await fetch(`${apiUrl}/api/devops/teams/${teamId}/members`, { headers });
  if (!fallback.ok) return null;
  return readMembers(await fallback.json().catch(() => ({})));
}

export default function OnCallProjectPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const raw = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const projectId = Number.parseInt(raw || '', 10);
  const monthQuery = Array.isArray(router.query.month) ? router.query.month[0] : router.query.month;
  const zoneQuery = Array.isArray(router.query.timezone) ? router.query.timezone[0] : router.query.timezone;
  const teamQuery = Array.isArray(router.query.team_id) ? router.query.team_id[0] : router.query.team_id;
  const timezone = TIMEZONES.includes(zoneQuery || '') ? zoneQuery || 'Asia/Kolkata' : 'Asia/Kolkata';
  const month = monthQuery && /^\d{4}-\d{2}$/.test(monthQuery) ? monthQuery : currentMonth(timezone);
  const [projectName, setProjectName] = useState('');
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamId, setTeamId] = useState(0);
  const [people, setPeople] = useState<OnCallPerson[]>([]);
  const [coverPeople, setCoverPeople] = useState<OnCallPerson[]>([]);
  const [days, setDays] = useState<DutyDay[]>([]);
  const [usingRoster, setUsingRoster] = useState(false);
  const [onCallOn, setOnCallOn] = useState(false);
  const [me, setMe] = useState(0);
  const [isManager, setIsManager] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [focusDate, setFocusDate] = useState('');
  const calendarRef = useRef<HTMLDivElement>(null);
  const [askDate, setAskDate] = useState('');
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
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then(async (res) => (res.ok ? res.json() : { teams: [] })),
      fetch(`${apiUrl}/api/devops/me`, { headers }).then(async (res) => (res.ok ? res.json() : null)),
      fetch(`${apiUrl}/api/oncall/flags`, { headers }).then(async (res) => (res.ok ? res.json() : null)),
    ])
      .then(async ([project, mine, meBody, flagsBody]) => {
        setProjectName(String(project.name || '').trim());
        const meId = typeof meBody?.id === 'number' ? meBody.id : typeof meBody?.user?.id === 'number' ? meBody.user.id : 0;
        if (meId) setMe(meId);
        if (meBody?.devops_profile?.is_manager || meBody?.user?.devops_profile?.is_manager) setIsManager(true);
        const flags = Array.isArray(flagsBody?.flags) ? flagsBody.flags : [];
        const flag = flags.find((item: { project_id?: number }) => item.project_id === projectId);
        setOnCallOn(Boolean(flag?.enabled));
        const collected: TeamOption[] = [];
        const add = (id: number, name: string) => {
          if (id > 0 && !collected.some((team) => team.id === id)) collected.push({ id, name: name.trim() || 'Unknown' });
        };
        add(typeof project.owner_team_id === 'number' ? project.owner_team_id : 0, String(project.owner_team || ''));
        const access = Array.isArray(project.team_access) ? project.team_access : [];
        access.forEach((team: { team_id?: number; team_name?: string }) => add(typeof team.team_id === 'number' ? team.team_id : 0, String(team.team_name || '')));
        const myTeams = Array.isArray(mine?.teams) ? mine.teams : [];
        myTeams.forEach((team: { id?: number; name?: string }) => add(typeof team.id === 'number' ? team.id : 0, String(team.name || '')));
        setTeams(collected);
        const requested = Number.parseInt(teamQuery || '', 10);
        const explicit = collected.find((team) => team.id === requested);
        const ordered = explicit ? [explicit] : collected;
        let chosen = explicit?.id || 0;
        let roster: OnCallPerson[] = [];
        let members: OnCallPerson[] = [];
        let savedRoster = false;
        const pool = new Map<number, OnCallPerson>();
        for (const team of collected) {
          const rosterRes = await fetch(`${apiUrl}/api/oncall/roster?team_id=${team.id}`, { headers });
          let teamRoster: OnCallPerson[] = [];
          if (rosterRes.ok) {
            const body = await rosterRes.json().catch(() => ({}));
            const users = Array.isArray(body.users) ? body.users : [];
            teamRoster = users
              .map((item: { user_id?: number; name?: string }) => ({ userId: item.user_id || 0, name: String(item.name || '').trim() }))
              .filter((item: OnCallPerson) => item.userId > 0);
          }
          const loaded = await loadMembers(apiUrl, team.id, headers);
          (loaded || teamRoster).forEach((person) => pool.set(person.userId, person));
          const useThis = explicit ? team.id === explicit.id : !chosen && (teamRoster.length > 0 || (loaded && loaded.length > 0));
          if (useThis) {
            chosen = team.id;
            roster = teamRoster;
            members = loaded || [];
            savedRoster = teamRoster.length > 0;
          }
        }
        const selected = chosen || explicit?.id || collected[0]?.id || 0;
        setTeamId(selected);
        setUsingRoster(savedRoster);
        const source = savedRoster ? roster : members;
        setPeople(source);
        setCoverPeople(pool.size ? [...pool.values()] : source);
        if (!selected) {
          setDays([]);
          setError('This project has no team.');
          return;
        }
        if (!source.length) {
          setDays([]);
          setError(members.length === 0 && !savedRoster ? 'Team members could not be loaded.' : 'No one is on this team.');
          return;
        }
        const dayRes = await fetch(`${apiUrl}/api/oncall/days?project_id=${projectId}&team_id=${selected}&month=${month}&timezone=${encodeURIComponent(timezone)}`, { headers });
        if (dayRes.ok) {
          const body = await dayRes.json().catch(() => ({}));
          setDays(Array.isArray(body.days) ? body.days : []);
          if (Array.isArray(body.roster) && body.roster.length) {
            setPeople(body.roster.map((item: { user_id?: number; name?: string }) => ({ userId: item.user_id || 0, name: String(item.name || '').trim() || 'Unknown' })).filter((item: OnCallPerson) => item.userId > 0));
            setUsingRoster(true);
          }
          return;
        }
        setDays(monthDays(month, timezone, source).map((day) => ({
          date: day.date,
          label: day.label,
          weekday: day.weekday,
          user_id: day.userId,
          name: day.name,
          today: day.today,
          status: 'scheduled',
        })));
      })
      .catch((err) => {
        setDays([]);
        setError(err instanceof Error ? err.message : 'Failed to load on-call');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, month, projectId, refresh, router.isReady, teamQuery, timezone]);

  const teamName = teams.find((team) => team.id === teamId)?.name || '';
  const today = days.find((day) => day.today);
  const openView = (next: { month?: string; timezone?: string; teamId?: number }) => {
    setAskDate('');
    void router.push({
      pathname: `/on-call/project/${projectId}`,
      query: {
        month: next.month || month,
        timezone: next.timezone || timezone,
        ...(next.teamId || teamId ? { team_id: String(next.teamId || teamId) } : {}),
      },
    });
  };
  const others = (day: DutyDay) => coverPeople.filter((person) => person.userId !== day.user_id);
  const pending = days.filter((day) => day.status === 'pending');
  const canRequest = (day: DutyDay) => day.date >= todayDate && day.status !== 'pending' && (isManager || (me > 0 && me === day.user_id));
  const todayDate = todayKey(timezone);
  const reload = () => setRefresh((value) => value + 1);

  const sendRequest = async (day: DutyDay) => {
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
        body: JSON.stringify({ project_id: projectId, team_id: teamId, date: day.date, cover_user_id: cover, timezone }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' && data.error !== '404 page not found' ? data.error : 'The cover request could not be saved.');
        return;
      }
      setAskDate('');
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
            <p className="portal-page__subtitle">{known(teamName)} rotates one person per day in {timezone}. A day changes only after the covering person approves.</p>
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
              Team
              <select className="input" value={teamId || ''} onChange={(event) => openView({ teamId: Number(event.target.value) })}>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
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
                <small className="svc-tree__meta">{today.status === 'covered' ? `${today.name} is covering for ${known(today.from_name)}` : today.name}</small>
              </span>
              {today.status === 'pending' && me > 0 && me === today.cover_user_id ? (
                <span>
                  <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => decide(today.request_id || 0, 'approve')}>Approve</button>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => decide(today.request_id || 0, 'decline')}>Decline</button>
                </span>
              ) : canRequest(today) ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { setAskDate(today.date); setCoverUserId(''); setError(''); }}>Request change</button>
              ) : (
                <span>{today.status === 'pending' ? `Waiting for ${known(today.cover_name)} to approve` : 'Checked for today'}</span>
              )}
            </div>
          ) : null}
          {!loading ? (
            <section className="oncall-requests" aria-label="Cover requests">
              <strong>Requests</strong>
              <p>The person on the day asks someone else to take it. That person approves or declines. The day changes only after approval.</p>
              {!pending.length ? <p>No requests are waiting for approval.</p> : null}
              {pending.map((day) => (
                <div key={day.date} className="oncall-requests__row">
                  <span>{day.label} · {known(day.from_name)} asked {known(day.cover_name)}</span>
                  {me > 0 && me === day.cover_user_id ? (
                    <span>
                      <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => decide(day.request_id || 0, 'approve')}>Approve</button>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => decide(day.request_id || 0, 'decline')}>Decline</button>
                    </span>
                  ) : (
                    <span>Waiting for {known(day.cover_name)}</span>
                  )}
                </div>
              ))}
            </section>
          ) : null}
          {!loading && coverPeople.length < 2 ? (
            <p className="portal-surface__subtitle">Only one person can be loaded, so a request has no one to approve it yet. Add another person on the <Link href="/team">team page</Link>.</p>
          ) : null}
          {!loading && people.length > 1 && !usingRoster ? (
            <p className="portal-surface__subtitle">This list uses everyone who could be loaded. Save the on-call set on the <Link href="/team">team page</Link> to choose who rotates.</p>
          ) : null}
          {!loading && !error && !days.length ? <div className="empty-state">No on-call days for this month.</div> : null}
          {!loading && days.length ? (
            <ul className="svc-tree">
              {days.map((day) => {
                const showAsk = canRequest(day);
                return (
                  <li key={day.date} id={`oncall-day-${day.date}`}>
                    <div className={`svc-tree__folder${day.today ? ' is-current' : ''}`}>
                      <span>
                        {day.label}
                        <small className="svc-tree__meta">{day.weekday}{day.status === 'covered' ? ` · covering for ${known(day.from_name)}` : ''}</small>
                      </span>
                      <span>
                        {day.status === 'pending' ? `Waiting for ${known(day.cover_name)}` : day.name}
                        {showAsk ? (
                          <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} onClick={() => { setAskDate(askDate === day.date ? '' : day.date); setCoverUserId(''); setError(''); }}>
                            Request change
                          </button>
                        ) : null}
                        {day.status === 'pending' && me > 0 && me === day.cover_user_id ? (
                          <>
                            <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => decide(day.request_id || 0, 'approve')}>Approve</button>
                            <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => decide(day.request_id || 0, 'decline')}>Decline</button>
                          </>
                        ) : null}
                      </span>
                    </div>
                    {askDate === day.date ? (
                      <form className="oncall-ask" onSubmit={(event) => { event.preventDefault(); void sendRequest(day); }}>
                        {others(day).length ? (
                          <>
                            <label>
                              Who should approve this day?
                              <select className="input" value={coverUserId} onChange={(event) => setCoverUserId(event.target.value)}>
                                <option value="">Select a person</option>
                                {others(day).map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
                              </select>
                            </label>
                            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending...' : 'Send request'}</button>
                          </>
                        ) : (
                          <p>Add another person on the <Link href="/team">team page</Link> before this request can be sent.</p>
                        )}
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
