import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { sessionRole } from '../../components/deskClient';
import { useApiUrl } from '../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

type ProjectOption = { id: number; name: string; code: string; environments: string[] };
type ServiceOption = { id: number; project_id: number; service: string; environment: string };
type TeamOption = { id: number; name: string };
type PersonOption = { user_id: number; name: string };
type ChangeOption = { id: number; change_number: string; project_id: number; title: string };
type IncidentOption = { id: number; incident_number: string; summary: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export default function NewMaintenancePage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const canWrite = sessionRole() !== 'viewer';
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [changes, setChanges] = useState<ChangeOption[]>([]);
  const [incidents, setIncidents] = useState<IncidentOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [owner, setOwner] = useState('');
  const [changeId, setChangeId] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [impact, setImpact] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/services`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/project-options`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/changes`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
      fetch(`${apiUrl}/api/devops/incidents`, { headers }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    ]).then(([projectBody, serviceBody, myTeams, options, changeBody, incidentBody]) => {
      const projectRows = Array.isArray(asRecord(projectBody).projects) ? asRecord(projectBody).projects as unknown[] : [];
      setProjects(projectRows.map((item) => {
        const row = asRecord(item);
        return {
          id: typeof row.id === 'number' ? row.id : 0,
          name: String(row.name || '').trim(),
          code: String(row.code || '').trim(),
          environments: Array.isArray(row.environments) ? row.environments.map((value) => String(value)) : [],
        };
      }).filter((item) => item.id > 0));
      const serviceRows = Array.isArray(asRecord(serviceBody).services) ? asRecord(serviceBody).services as unknown[] : [];
      setServices(serviceRows.map((item) => {
        const row = asRecord(item);
        return {
          id: typeof row.id === 'number' ? row.id : 0,
          project_id: typeof row.project_id === 'number' ? row.project_id : 0,
          service: String(row.service || '').trim(),
          environment: String(row.environment || '').trim(),
        };
      }).filter((item) => item.id > 0 && item.service));
      const byId = new Map<number, TeamOption>();
      [asRecord(myTeams).teams, asRecord(options).owner_teams, asRecord(options).teams].forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((item) => {
          const row = asRecord(item);
          const id = typeof row.id === 'number' ? row.id : 0;
          const name = String(row.name || '').trim();
          if (id > 0 && name) byId.set(id, { id, name });
        });
      });
      setTeams([...byId.values()].sort((left, right) => left.name.localeCompare(right.name)));
      const changeRows = Array.isArray(asRecord(changeBody).changes) ? asRecord(changeBody).changes as unknown[] : [];
      setChanges(changeRows.map((item) => {
        const row = asRecord(item);
        return {
          id: typeof row.id === 'number' ? row.id : 0,
          change_number: String(row.change_number || '').trim(),
          project_id: typeof row.project_id === 'number' ? row.project_id : 0,
          title: String(row.title || '').trim(),
        };
      }).filter((item) => item.id > 0 && item.change_number));
      const incidentRows = Array.isArray(asRecord(incidentBody).incidents) ? asRecord(incidentBody).incidents as unknown[] : [];
      setIncidents(incidentRows.map((item) => {
        const row = asRecord(item);
        return {
          id: typeof row.id === 'number' ? row.id : 0,
          incident_number: String(row.incident_number || '').trim(),
          summary: String(row.summary || '').trim(),
        };
      }).filter((item) => item.id > 0));
    }).catch(() => setLoadError('The service, team, or change lists could not be loaded.'));
  }, [apiUrl]);

  const projectServices = useMemo(
    () => services.filter((item) => !projectId || item.project_id === Number(projectId)),
    [services, projectId],
  );
  const projectChanges = useMemo(
    () => changes.filter((item) => !item.project_id || !projectId || item.project_id === Number(projectId)),
    [changes, projectId],
  );
  const selectedProject = projects.find((item) => String(item.id) === projectId);
  const environments = selectedProject?.environments.length ? selectedProject.environments : [];

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !teamId) {
      setPeople([]);
      return;
    }
    fetch(`${apiUrl}/api/oncall/team-members?team_id=${teamId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : {}))
      .then((body) => {
        const rows = Array.isArray(asRecord(body).members) ? asRecord(body).members as unknown[] : [];
        setPeople(rows.map((item) => {
          const row = asRecord(item);
          return { user_id: typeof row.user_id === 'number' ? row.user_id : 0, name: String(row.name || '').trim() };
        }).filter((item) => item.user_id > 0 && item.name));
      })
      .catch(() => setPeople([]));
  }, [apiUrl, teamId]);

  async function submit() {
    setMessage('');
    const service = projectServices.find((item) => String(item.id) === serviceId);
    const startIso = toIso(start);
    const endIso = toIso(end);
    if (!canWrite || !projectId || !environment || !service || !teamId || !owner.trim() || !impact.trim() || !description.trim() || !changeId || !startIso || !endIso) {
      setMessage('Choose the project, service, team, owner, change, start, end, impact, and description.');
      return;
    }
    if (new Date(endIso) <= new Date(startIso)) {
      setMessage('The end time has to be after the start time.');
      return;
    }
    if (description.trim().length > 200) {
      setMessage('The description has to stay within 200 characters.');
      return;
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/maintenance/windows`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: Number(projectId),
          environment,
          service: service.service,
          team_id: Number(teamId),
          owner_name: owner.trim(),
          change_number: changeId,
          incident_number: incidentId,
          impact: impact.trim(),
          description: description.trim(),
          start: startIso,
          end: endIso,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === 'string' ? data.error : 'Maintenance could not be created.');
        return;
      }
      const id = data.window && typeof data.window.id === 'number' ? data.window.id : 0;
      if (id > 0) void router.push(`/maintenance/${id}`);
    } catch {
      setMessage('Maintenance could not be created.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DevOpsLayout>
      <Head><title>Create maintenance</title></Head>
      <div className="portal-page">
        <header className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Maintenance</span>
            <h1 className="portal-page__title">Create maintenance</h1>
            <p className="portal-page__subtitle">You get a confirmation when this is created. Your manager approves first, then a DevOps manager, then an admin.</p>
          </div>
          <Link href="/maintenance" className="btn btn-secondary">Back</Link>
        </header>
        {loadError ? <div className="alert alert-error">{loadError}</div> : null}
        {message ? <div className="alert alert-error">{message}</div> : null}
        <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="portal-field-grid portal-field-grid--two">
            <label className="label">Project
              <select className="input" value={projectId} onChange={(event) => { setProjectId(event.target.value); setServiceId(''); setChangeId(''); }} required>
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.code ? `${project.name} (${project.code})` : project.name}</option>
                ))}
              </select>
            </label>
            <label className="label">Environment
              <select className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} required>
                <option value="">Select an environment</option>
                {environments.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="label">Service
              <select className="input" value={serviceId} onChange={(event) => {
                const next = event.target.value;
                setServiceId(next);
                const service = projectServices.find((item) => String(item.id) === next);
                if (service?.environment) setEnvironment(service.environment);
              }} required>
                <option value="">{projectId ? 'Select a service' : 'Select a project first'}</option>
                {projectServices.map((item) => (
                  <option key={item.id} value={item.id}>{item.environment ? `${item.service} · ${item.environment}` : item.service}</option>
                ))}
              </select>
            </label>
            <label className="label">Team
              <select className="input" value={teamId} onChange={(event) => { setTeamId(event.target.value); setOwner(''); }} required>
                <option value="">Select a team</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label className="label">Owner
              <select className="input" value={owner} onChange={(event) => setOwner(event.target.value)} required disabled={!teamId}>
                <option value="">{teamId ? 'Select an owner' : 'Select a team first'}</option>
                {people.map((person) => <option key={person.user_id} value={person.name}>{person.name}</option>)}
              </select>
            </label>
            <label className="label">Change request
              <select className="input" value={changeId} onChange={(event) => setChangeId(event.target.value)} required>
                <option value="">Select a change</option>
                {projectChanges.map((change) => (
                  <option key={change.id} value={change.change_number}>{change.title ? `${change.change_number} · ${change.title}` : change.change_number}</option>
                ))}
              </select>
            </label>
            <label className="label">Linked incident
              <select className="input" value={incidentId} onChange={(event) => setIncidentId(event.target.value)}>
                <option value="">None</option>
                {incidents.map((incident) => (
                  <option key={incident.id} value={incident.incident_number || String(incident.id)}>
                    {incident.incident_number || `INC${incident.id}`}{incident.summary ? ` · ${incident.summary}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">Start
              <input className="input" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required />
            </label>
            <label className="label">End
              <input className="input" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required />
            </label>
            <label className="label">Impact
              <input className="input" value={impact} onChange={(event) => setImpact(event.target.value)} required />
            </label>
            <label className="label" style={{ gridColumn: '1 / -1' }}>Description
              <textarea className="input" rows={3} maxLength={200} value={description} onChange={(event) => setDescription(event.target.value)} required />
            </label>
          </div>
          <div className="portal-page__actions">
            <button className="btn btn-primary" type="submit" disabled={!canWrite || saving}>{saving ? 'Creating...' : 'Create'}</button>
          </div>
        </form>
      </div>
    </DevOpsLayout>
  );
}
