import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { serviceLabel } from '../../lib/cloudServices';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type TeamChoice = { id: number; name: string; slug: string; default_env?: string };
type ProjectService = { cloud: string; service: string };
type ProjectChoice = { id: number; name: string; code?: string; environments?: string[]; clouds?: string[]; services?: ProjectService[] };

export default function NewRequestPage() {
  const apiUrl = useApiUrl();
  const [teams, setTeams] = useState<TeamChoice[]>([]);
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [team, setTeam] = useState('');
  const [projectId, setProjectId] = useState('');
  const [cloud, setCloud] = useState('');
  const [env, setEnv] = useState('dev');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const headers = sessionAuthHeaders();
    fetch(`${apiUrl}/api/me/teams`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const list = Array.isArray(body?.teams) ? body.teams : [];
        setTeams(list);
        if (list[0]?.slug) {
          setTeam(list[0].slug);
          if (list[0].default_env) setEnv(list[0].default_env);
        }
      })
      .catch(() => setTeams([]));
    fetch(`${apiUrl}/api/me/projects`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setProjects(Array.isArray(body?.projects) ? body.projects : []))
      .catch(() => setProjects([]));
  }, [apiUrl]);

  const router = useRouter();
  const selectedProject = projects.find((item) => String(item.id) === projectId);
  const cloudOptions = selectedProject?.clouds || [];
  const environmentOptions = selectedProject?.environments?.length ? selectedProject.environments : ['dev', 'uat', 'prod'];
  const serviceOptions = (selectedProject?.services || []).filter((item) => item.cloud.toLowerCase() === cloud.toLowerCase());
  const chosenService = serviceOptions.find((item) => item.service === serviceId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!chosenService || !cloud) {
      setError('Choose a cloud and a service from this project.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({
          team,
          env,
          cloud,
          service: chosenService.service,
          project_id: projectId ? Number(projectId) : undefined,
          priority,
          due_date: dueDate || undefined,
          initial_comment: comment.trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'The request was not accepted.');
        return;
      }
      if (body?.id) {
        await router.push(`/requests/${body.id}`);
        return;
      }
      setNotice('Request raised. It is waiting for review and has not been applied.');
      setServiceId('');
      setCloud('');
    } catch {
      setError('The request could not be sent.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Head>
        <title>New request - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Requests</p>
              <h1>New request</h1>
              <p>Choose the project, then the cloud, then a service saved on that project. Priority sends it to L1, L2, L3, or L4. Raising it does not create the cloud resource.</p>
            </div>
            <Link href="/my-requests" className="btn btn-secondary">Back to my requests</Link>
          </header>
          {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          <form className="portal-surface access-form" onSubmit={submit}>
            <label className="label" htmlFor="request-team">Team</label>
            <select
              id="request-team"
              className="input"
              value={team}
              onChange={(event) => {
                const slug = event.target.value;
                setTeam(slug);
                const chosen = teams.find((item) => item.slug === slug);
                if (chosen?.default_env) setEnv(chosen.default_env);
              }}
              required
            >
              <option value="">Choose a team</option>
              {teams.map((item) => (
                <option key={item.id} value={item.slug}>{item.name}</option>
              ))}
            </select>
            <label className="label" htmlFor="request-project">Project</label>
            <select
              id="request-project"
              className="input"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setCloud('');
                setServiceId('');
              }}
              required
            >
              <option value="">Choose a project</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>{item.code ? `${item.name} (${item.code})` : item.name}</option>
              ))}
            </select>
            <label className="label" htmlFor="request-env">Environment</label>
            <select id="request-env" className="input" value={env} onChange={(event) => setEnv(event.target.value)}>
              {environmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <label className="label" htmlFor="request-cloud">Cloud</label>
            <select
              id="request-cloud"
              className="input"
              value={cloud}
              onChange={(event) => { setCloud(event.target.value); setServiceId(''); }}
              required
              disabled={!projectId}
            >
              <option value="">{projectId ? 'Select a cloud' : 'Choose a project first'}</option>
              {cloudOptions.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}
            </select>
            <label className="label" htmlFor="request-service">Service</label>
            <select id="request-service" className="input" value={serviceId} onChange={(event) => setServiceId(event.target.value)} required disabled={!cloud || serviceOptions.length === 0}>
              <option value="">{!cloud ? 'Select a cloud first' : serviceOptions.length ? 'Select a service' : 'No services were saved for this cloud on the project'}</option>
              {serviceOptions.map((item) => (
                <option key={`${item.cloud}-${item.service}`} value={item.service}>{serviceLabel(item.cloud, item.service)}</option>
              ))}
            </select>
            <label className="label" htmlFor="request-due">Needed by</label>
            <input id="request-due" className="input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            <label className="label" htmlFor="request-note">Note for the reviewer</label>
            <input id="request-note" className="input" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What should the reviewer know?" />
            <label className="label" htmlFor="request-priority">Priority</label>
            <select id="request-priority" className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="low">Low — L1</option>
              <option value="medium">Medium — L2</option>
              <option value="high">High — L3</option>
              <option value="critical">Critical — L4</option>
            </select>
            <button type="submit" className="btn btn-primary" disabled={saving || teams.length === 0}>
              {saving ? 'Raising…' : 'Raise request'}
            </button>
            {teams.length === 0 ? <p className="work-empty">You need a team before you can raise a request.</p> : null}
          </form>
        </div>
      </DevOpsLayout>
    </>
  );
}
