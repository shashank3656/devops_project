import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from './DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { currentMonth, formatLongDay, onCallTeamHref, shiftMonth, timezoneCompactLabel, weekdayLong } from '../lib/onCallMonth';
import { previewKindLabel, previewRotation, previewSummary, type OccupiedShift } from '../lib/onCallPreview';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

interface TeamOption {
  id: number;
  name: string;
}

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

interface Member {
  user_id: number;
  name: string;
}

function known(value: string | undefined): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

function dayLabel(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function readTeams(data: { teams?: unknown; owner_teams?: unknown }): TeamOption[] {
  const raw = Array.isArray(data?.owner_teams) ? data.owner_teams : Array.isArray(data?.teams) ? data.teams : [];
  return raw
    .map((item) => {
      const row = item as { id?: number; name?: string };
      return { id: typeof row.id === 'number' ? row.id : 0, name: String(row.name || '').trim() };
    })
    .filter((item) => item.id > 0 && item.name);
}

export default function OnCallScheduleForm({ scheduleId }: { scheduleId: number }) {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [timezones, setTimezones] = useState<string[]>(TIMEZONES);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersNote, setMembersNote] = useState('Select a team first');
  const [membersReady, setMembersReady] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [remindMinutes, setRemindMinutes] = useState('30');
  const [escalateMinutes, setEscalateMinutes] = useState('15');
  const [reassignIncidents, setReassignIncidents] = useState(false);
  const [days, setDays] = useState<Record<string, string>>({});
  const [backupDays, setBackupDays] = useState<Record<string, string>>({});
  const [missionCritical, setMissionCritical] = useState(false);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(scheduleId > 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingId, setExistingId] = useState(0);
  const [isManager, setIsManager] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [occupied, setOccupied] = useState<OccupiedShift[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEVOPS_USER_KEY);
      const parsed = raw ? (JSON.parse(raw) as { role?: string; devops_profile?: { is_manager?: boolean } }) : null;
      setIsManager(Boolean(parsed?.devops_profile?.is_manager) || String(parsed?.role || '').toLowerCase() === 'admin');
    } catch {
      setIsManager(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/project-options`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/oncall/schedules`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    ]).then(([mine, options, projectData, scheduleData]: [{ teams?: unknown; owner_teams?: unknown }, { teams?: unknown; owner_teams?: unknown }, { projects?: unknown }, { timezones?: unknown }]) => {
      const byId = new Map<number, TeamOption>();
      [...readTeams(mine), ...readTeams(options)].forEach((team) => byId.set(team.id, team));
      setTeams([...byId.values()].sort((left, right) => left.name.localeCompare(right.name)));
      const list = Array.isArray(projectData?.projects) ? projectData.projects : [];
      setProjects(
        list
          .map((item: { id?: number; name?: string; code?: string }) => ({
            id: typeof item.id === 'number' ? item.id : 0,
            name: String(item.name || ''),
            code: String(item.code || ''),
          }))
          .filter((item: ProjectOption) => item.id > 0),
      );
      const zones = Array.isArray(scheduleData?.timezones) ? scheduleData.timezones.map((zone: unknown) => String(zone)).filter(Boolean) : [];
      if (zones.length) setTimezones(zones);
    }).catch(() => undefined);
  }, [apiUrl]);

  useEffect(() => {
    if (!router.isReady || scheduleId > 0) return;
    const project = Array.isArray(router.query.project_id) ? router.query.project_id[0] : router.query.project_id;
    const team = Array.isArray(router.query.team_id) ? router.query.team_id[0] : router.query.team_id;
    const zone = Array.isArray(router.query.timezone) ? router.query.timezone[0] : router.query.timezone;
    if (project) setProjectId(String(project));
    if (team) setTeamId(String(team));
    if (zone) setTimezone(String(zone));
  }, [router.isReady, router.query.project_id, router.query.team_id, router.query.timezone, scheduleId]);

  useEffect(() => {
    if (!scheduleId) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/oncall/schedules/${scheduleId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load rotation');
        const schedule = data.schedule || {};
        setTeamId(schedule.team_id ? String(schedule.team_id) : '');
        setProjectId(schedule.project_id ? String(schedule.project_id) : '');
        const zone = typeof router.query.timezone === 'string' && router.query.timezone ? router.query.timezone : schedule.timezone;
        setTimezone(zone || 'Asia/Kolkata');
        setRemindMinutes(String(schedule.handover_remind_minutes || 30));
        setEscalateMinutes(String(schedule.handover_escalate_minutes || 15));
        setReassignIncidents(Boolean(schedule.reassign_incidents_on_ack));
        setToday(String(schedule.today || ''));
        const next: Record<string, string> = {};
        const nextBackup: Record<string, string> = {};
        (Array.isArray(schedule.days) ? schedule.days : []).forEach((day: { day?: string; user_id?: number; backup_user_id?: number }) => {
          if (day.day) {
            next[day.day] = day.user_id ? String(day.user_id) : '';
            nextBackup[day.day] = day.backup_user_id ? String(day.backup_user_id) : '';
          }
        });
        setDays(next);
        setBackupDays(nextBackup);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load rotation'))
      .finally(() => setLoading(false));
  }, [apiUrl, router.query.timezone, scheduleId]);

  useEffect(() => {
    if (!teamId) {
      setMembers([]);
      setMembersNote('Select a team first');
      setMembersReady(true);
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setMembersReady(false);
    const params = new URLSearchParams({ team_id: teamId });
    fetch(`${apiUrl}/api/oncall/team-members?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('members');
        const list = Array.isArray(data?.members) ? data.members : [];
        const next = list
          .map((item: { user_id?: number; name?: string; username?: string }) => ({
            user_id: typeof item.user_id === 'number' ? item.user_id : 0,
            name: String(item.name || item.username || '').trim(),
          }))
          .filter((item: Member) => item.user_id > 0);
        if (next.length) {
          setMembers(next);
          setMembersNote('Unassigned');
          setMembersReady(true);
          return;
        }
        const fallback = await fetch(`${apiUrl}/api/devops/teams/${teamId}/members`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await fallback.json().catch(() => ({}));
        const rows = fallback.ok && Array.isArray(body?.members) ? body.members : [];
        const recovered = rows
          .map((item: { user_id?: number; name?: string; username?: string }) => ({
            user_id: typeof item.user_id === 'number' ? item.user_id : 0,
            name: String(item.name || item.username || '').trim(),
          }))
          .filter((item: Member) => item.user_id > 0);
        setMembers(recovered);
        setMembersNote(recovered.length ? 'Unassigned' : 'No one on this team');
        setMembersReady(true);
      })
      .catch(() => {
        setMembers([]);
        setMembersNote('Team members could not be loaded.');
        setMembersReady(true);
      });
    fetch(`${apiUrl}/api/oncall/roster?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        setMissionCritical(Boolean(data?.mission_critical));
      })
      .catch(() => setMissionCritical(false));
  }, [apiUrl, teamId]);

  useEffect(() => {
    setPreviewing(false);
  }, [days, backupDays, teamId, projectId, timezone, missionCritical]);

  useEffect(() => {
    if (!previewing || !projectId) {
      setOccupied([]);
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const month = currentMonth(timezone);
    const months = [month, shiftMonth(month, 1)];
    Promise.all(months.map((value) => fetch(`${apiUrl}/api/oncall/days?project_id=${projectId}&month=${value}&timezone=${encodeURIComponent(timezone)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (res) => (res.ok ? res.json() as { days?: unknown } : { days: [] })).catch(() => ({ days: [] })))).then((payloads) => {
      const next: OccupiedShift[] = [];
      payloads.forEach((data) => {
        const rows = Array.isArray(data.days) ? data.days : [];
        rows.forEach((day: { date?: string; teams?: { team_id?: number; user_id?: number; backup_user_id?: number; team_name?: string }[] }) => {
          (Array.isArray(day.teams) ? day.teams : []).forEach((shift) => {
            if (Number(shift.team_id) === Number(teamId)) return;
            if (shift.user_id) next.push({ date: String(day.date || ''), userId: Number(shift.user_id), team: String(shift.team_name || '') });
            if (shift.backup_user_id) next.push({ date: String(day.date || ''), userId: Number(shift.backup_user_id), team: String(shift.team_name || '') });
          });
        });
      });
      setOccupied(next);
    }).catch(() => setOccupied([]));
  }, [apiUrl, previewing, projectId, teamId, timezone]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    if (!teamId || !projectId || !timezone) {
      setError('Choose a team, a project, and a timezone.');
      return;
    }
    if (!previewing) {
      setPreviewing(true);
      return;
    }
    const payloadDays: Record<string, number> = {};
    const payloadBackup: Record<string, number> = {};
    WEEKDAYS.forEach((day) => {
      payloadDays[day] = days[day] ? Number(days[day]) : 0;
      payloadBackup[day] = backupDays[day] ? Number(backupDays[day]) : 0;
    });
    if (missionCritical && WEEKDAYS.some((day) => !payloadDays[day] || !payloadBackup[day] || payloadDays[day] === payloadBackup[day])) {
      setError('Mission-critical teams need a primary and a different backup for every day.');
      return;
    }
    setSaving(true);
    setError('');
    setExistingId(0);
    try {
      const response = await fetch(scheduleId ? `${apiUrl}/api/oncall/schedules/${scheduleId}` : `${apiUrl}/api/oncall/schedules`, {
        method: scheduleId ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: Number(teamId),
          project_id: Number(projectId),
          timezone,
          handover_remind_minutes: Number(remindMinutes) || 30,
          handover_escalate_minutes: Number(escalateMinutes) || 15,
          reassign_incidents_on_ack: reassignIncidents,
          days: payloadDays,
          backup_days: payloadBackup,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (typeof data?.schedule_id === 'number' && data.schedule_id > 0) setExistingId(data.schedule_id);
        throw new Error(data?.error || 'Failed to save rotation');
      }
      const nextId = data?.schedule?.id || scheduleId;
      await router.push(nextId ? `/on-call/${nextId}` : '/on-call');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rotation');
    } finally {
      setSaving(false);
    }
  };

  const focusDate = typeof router.query.date === 'string' ? router.query.date : '';
  const focusWeekday = focusDate ? weekdayLong(focusDate) : '';
  const intent = typeof router.query.intent === 'string' ? router.query.intent : '';
  const assigningShift = intent === 'assign' && Boolean(focusDate);
  const title = scheduleId ? 'Edit rotation' : assigningShift ? 'Assign this shift' : 'Create recurring rotation';
  const membersHref = projectId && teamId ? onCallTeamHref(Number(projectId), Number(teamId), focusDate, timezone) : '/team';
  const canAssign = isManager;
  const needsPeople = Boolean(teamId) && membersReady && !members.length;
  const assignmentReady = canAssign && (!teamId || membersReady) && !needsPeople;
  const fromDate = focusDate || new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const previewDays = useMemo(() => previewRotation({
    fromDate,
    days,
    backupDays,
    members,
    missionCritical,
    occupied,
  }), [backupDays, days, fromDate, members, missionCritical, occupied]);

  return (
    <DevOpsLayout>
      <Head><title>{title}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">On-call</span>
            <h1 className="portal-page__title">{title}</h1>
            <p className="portal-page__subtitle">{missionCritical
              ? 'Choose a primary and a different backup for every day.'
              : assigningShift
                ? `Assign coverage for ${formatLongDay(focusDate)}. Saving writes the weekly rotation, so this weekday stays covered after that date too.`
                : 'Create the Monday–Sunday rotation first. A specific date stays uncovered until this weekly schedule exists.'}</p>
            {focusDate ? (
              <p className="access-hint">
                {assigningShift ? 'Assign this shift' : 'Create recurring rotation'} for {formatLongDay(focusDate)}
                {timezone ? ` · ${timezoneCompactLabel(timezone)}` : ''}.
                A recurring weekly schedule is required for that date to stay covered.
              </p>
            ) : null}
            <details className="onboard-advanced">
              <summary>Handover and escalation</summary>
              <p className="form-section__copy">The timezone is when each day starts. Handover reminder, overdue minutes, and incident reassignment on acknowledgement are per team. Reassignment does not mark incidents Fixed. Do not page anyone from this page.</p>
            </details>
          </div>
          <Link href="/on-call" className="btn btn-secondary">Back to on-call</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {existingId ? <p><Link href={`/on-call/${existingId}`}>Open the existing rotation</Link></p> : null}
        {loading ? <div className="empty-state">Loading rotation...</div> : (
          <section className="portal-surface">
            {needsPeople ? (
              <div className="empty-state" role="status">
                <p>Add team members before this rotation can be assigned. There is no one eligible for primary or backup.</p>
                <Link href={membersHref} className="btn btn-primary">Add team members</Link>
              </div>
            ) : null}
            <form onSubmit={(event) => void save(event)}>
              <div className="svc-filters">
                <label>
                  Team
                  <select className="input" value={teamId} onChange={(event) => { setTeamId(event.target.value); setDays({}); }} required>
                    <option value="">{teams.length ? 'Select a team' : 'No teams'}</option>
                    {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </label>
                <label>
                  Project
                  <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
                    <option value="">Select a project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.code ? `${project.name} (${project.code})` : known(project.name)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Timezone
                  <select className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)} required>
                    {timezones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                  </select>
                </label>
                <label>
                  Remind before shift end (minutes)
                  <input className="input" type="number" min={5} max={120} value={remindMinutes} onChange={(event) => setRemindMinutes(event.target.value)} />
                </label>
                <label>
                  Escalate after shift end (minutes)
                  <input className="input" type="number" min={5} max={120} value={escalateMinutes} onChange={(event) => setEscalateMinutes(event.target.value)} />
                </label>
              </div>
              <p className="access-hint">Default is 30 minutes before shift end for the outgoing draft, then 15 minutes after for acknowledgement overdue.</p>
              <label className="catalog-editor__toggle-label">
                <input type="checkbox" checked={reassignIncidents} onChange={(event) => setReassignIncidents(event.target.checked)} />
                <span>On acknowledgement, reassign open incidents on the handover to the incoming person. Status is not changed to Fixed.</span>
              </label>
              <ul className="svc-tree">
                {WEEKDAYS.map((day) => (
                  <li key={day} className={`svc-tree__row${focusWeekday === day ? ' oncall-focus-day' : ''}`}>
                    <span className="svc-tree__folder">
                      <span>
                        {dayLabel(day)}
                        {today === day ? <small className="svc-tree__meta">Today</small> : null}
                        {focusWeekday === day ? <small className="svc-tree__meta">Opened shift</small> : null}
                      </span>
                    </span>
                    {assignmentReady ? (
                      <>
                        <select
                          id={`oncall-day-${day}`}
                          className="input"
                          aria-label={`${dayLabel(day)} primary`}
                          value={days[day] || ''}
                          disabled={!teamId}
                          onChange={(event) => setDays((current) => ({ ...current, [day]: event.target.value }))}
                        >
                          <option value="">{missionCritical ? 'Primary' : membersNote}</option>
                          {members.map((member) => (
                            <option key={member.user_id} value={member.user_id}>{known(member.name)}</option>
                          ))}
                        </select>
                        <select
                          className="input"
                          aria-label={`${dayLabel(day)} backup`}
                          value={backupDays[day] || ''}
                          disabled={!teamId}
                          onChange={(event) => setBackupDays((current) => ({ ...current, [day]: event.target.value }))}
                        >
                          <option value="">{missionCritical ? 'Backup' : 'No backup'}</option>
                          {members.filter((member) => String(member.user_id) !== (days[day] || '')).map((member) => (
                            <option key={member.user_id} value={member.user_id}>{known(member.name)}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <small>
                        {days[day] ? `Primary ${known(members.find((member) => String(member.user_id) === days[day])?.name)}` : 'Uncovered'}
                        {backupDays[day] ? ` · Backup ${known(members.find((member) => String(member.user_id) === backupDays[day])?.name)}` : ''}
                        {needsPeople ? ' · Add team members first' : canAssign ? '' : ' · A manager assigns coverage'}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
              {assignmentReady && previewing ? (
                <section className="oncall-preview" aria-label="Schedule preview">
                  <h2 className="portal-surface__title">Preview next 30 days</h2>
                  <p className="access-hint">{previewSummary(previewDays)}. Uncovered, overlapping, and missing backups are listed before this rotation is published. Cover requests do not rewrite the weekly rotation.</p>
                  <ul className="oncall-preview__list">
                    {previewDays.filter((item) => item.kinds.some((kind) => kind !== 'covered')).map((item) => (
                      <li key={item.date}>
                        <strong>{item.label}</strong>
                        {' · '}
                        {item.kinds.map(previewKindLabel).join(', ')}
                        {item.primaryName ? ` · Primary ${item.primaryName}` : ' · No primary'}
                        {item.backupName ? ` · Backup ${item.backupName}` : ''}
                      </li>
                    ))}
                  </ul>
                  {!previewDays.some((item) => item.kinds.some((kind) => kind !== 'covered')) ? (
                    <p className="access-hint">No uncovered periods, overlapping shifts, or missing backups in the next 30 days.</p>
                  ) : null}
                </section>
              ) : null}
              {assignmentReady ? (
                <div className="portal-form-actions">
                  {previewing ? (
                    <button type="button" className="btn btn-secondary" onClick={() => setPreviewing(false)}>Edit rotation</button>
                  ) : null}
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Publishing...' : previewing ? 'Publish rotation' : 'Preview next 30 days'}
                  </button>
                </div>
              ) : null}
              {!canAssign ? <p className="access-hint">A DevOps manager assigns primary and backup. This page stays read-only.</p> : null}
            </form>
          </section>
        )}
      </div>
    </DevOpsLayout>
  );
}
