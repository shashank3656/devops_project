import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from './DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

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
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [days, setDays] = useState<Record<string, string>>({});
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(scheduleId > 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingId, setExistingId] = useState(0);
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEVOPS_USER_KEY);
      const parsed = raw ? (JSON.parse(raw) as { devops_profile?: { is_manager?: boolean } }) : null;
      setIsManager(Boolean(parsed?.devops_profile?.is_manager));
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
    if (project) setProjectId(String(project));
    if (team) setTeamId(String(team));
  }, [router.isReady, router.query.project_id, router.query.team_id, scheduleId]);

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
        setTimezone(schedule.timezone || 'Asia/Kolkata');
        setToday(String(schedule.today || ''));
        const next: Record<string, string> = {};
        (Array.isArray(schedule.days) ? schedule.days : []).forEach((day: { day?: string; user_id?: number }) => {
          if (day.day) next[day.day] = day.user_id ? String(day.user_id) : '';
        });
        setDays(next);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load rotation'))
      .finally(() => setLoading(false));
  }, [apiUrl, scheduleId]);

  useEffect(() => {
    if (!teamId) {
      setMembers([]);
      setMembersNote('Select a team first');
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const params = new URLSearchParams({ team_id: teamId });
    fetch(`${apiUrl}/api/oncall/team-members?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('members');
        const list = Array.isArray(data?.members) ? data.members : [];
        const next = list
          .map((item: { user_id?: number; name?: string }) => ({
            user_id: typeof item.user_id === 'number' ? item.user_id : 0,
            name: String(item.name || '').trim(),
          }))
          .filter((item: Member) => item.user_id > 0);
        setMembers(next);
        setMembersNote(next.length ? 'Unassigned' : 'No one on this team');
      })
      .catch(() => {
        setMembers([]);
        setMembersNote('Team members could not be loaded.');
      });
  }, [apiUrl, teamId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    if (!teamId || !projectId || !timezone) {
      setError('Choose a team, a project, and a timezone.');
      return;
    }
    setSaving(true);
    setError('');
    setExistingId(0);
    const payloadDays: Record<string, number> = {};
    WEEKDAYS.forEach((day) => {
      payloadDays[day] = days[day] ? Number(days[day]) : 0;
    });
    try {
      const response = await fetch(scheduleId ? `${apiUrl}/api/oncall/schedules/${scheduleId}` : `${apiUrl}/api/oncall/schedules`, {
        method: scheduleId ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: Number(teamId),
          project_id: Number(projectId),
          timezone,
          days: payloadDays,
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

  const title = scheduleId ? 'Edit rotation' : 'New rotation';

  return (
    <DevOpsLayout>
      <Head><title>{title}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">On-call</span>
            <h1 className="portal-page__title">{title}</h1>
            <p className="portal-page__subtitle">Monday through Sunday is the rotation order. The timezone is when each day starts. Leave a day empty for a coverage gap. Handover for a single day is requested on the On-call roster.</p>
          </div>
          <Link href="/on-call" className="btn btn-secondary">Back to on-call</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {existingId ? <p><Link href={`/on-call/${existingId}`}>Open the existing rotation</Link></p> : null}
        {loading ? <div className="empty-state">Loading rotation...</div> : (
          <section className="portal-surface">
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
              </div>
              <ul className="svc-tree">
                {WEEKDAYS.map((day) => (
                  <li key={day} className="svc-tree__row">
                    <span className="svc-tree__folder">
                      <span>
                        {dayLabel(day)}
                        {today === day ? <small className="svc-tree__meta">Today</small> : null}
                      </span>
                    </span>
                    {isManager ? (
                      <select
                        className="input"
                        aria-label={dayLabel(day)}
                        value={days[day] || ''}
                        disabled={!teamId}
                        onChange={(event) => setDays((current) => ({ ...current, [day]: event.target.value }))}
                      >
                        <option value="">{membersNote}</option>
                        {members.map((member) => (
                          <option key={member.user_id} value={member.user_id}>{known(member.name)}</option>
                        ))}
                      </select>
                    ) : (
                      <small>{known(members.find((member) => String(member.user_id) === days[day])?.name)}</small>
                    )}
                  </li>
                ))}
              </ul>
              {isManager ? (
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save rotation'}</button>
                </div>
              ) : null}
            </form>
          </section>
        )}
      </div>
    </DevOpsLayout>
  );
}
