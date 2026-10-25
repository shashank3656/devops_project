import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

type ProjectOption = { id: number; name: string };
type TeamOption = { id: number; name: string };

export default function NewCertificateAssetPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [assetType, setAssetType] = useState('certificate');
  const [input, setInput] = useState('');
  const [port, setPort] = useState('443');
  const [projectId, setProjectId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [service, setService] = useState('');
  const [environment, setEnvironment] = useState('');
  const [owner, setOwner] = useState('');
  const [runbook, setRunbook] = useState('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => res.json().catch(() => ({}))).then((data) => {
      const rows = Array.isArray(data?.projects) ? data.projects : [];
      setProjects(rows.map((row: { id?: number; name?: string }) => ({ id: Number(row.id) || 0, name: String(row.name || 'Unknown') })).filter((row: ProjectOption) => row.id > 0));
    }).catch(() => undefined);
    fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => res.json().catch(() => ({}))).then((data) => {
      const rows = Array.isArray(data?.teams) ? data.teams : [];
      setTeams(rows.map((row: { id?: number; name?: string }) => ({ id: Number(row.id) || 0, name: String(row.name || 'Unknown') })).filter((row: TeamOption) => row.id > 0));
    }).catch(() => undefined);
  }, [apiUrl]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/expiry/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          asset_type: assetType,
          input,
          port: assetType === 'certificate' ? Number(port) || 443 : 0,
          project_id: Number(projectId) || 0,
          team_id: Number(teamId) || 0,
          service_name: service,
          environment,
          owner_name: owner,
          runbook_url: runbook,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'That endpoint or domain could not be registered.');
        return;
      }
      const id = Number(data.asset?.id);
      if (id > 0) {
        await router.push(`/certificates/${id}`);
        return;
      }
      await router.push('/certificates');
    } catch {
      setError('That endpoint or domain could not be registered.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>Register certificate or domain</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Register asset</h1>
            <p className="portal-page__subtitle">Hosted checks reach approved public targets only. There is no private-key upload. Internal names need a private collector later.</p>
          </div>
          <Link href="/certificates" className="btn btn-secondary">Back</Link>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <form className="portal-surface" onSubmit={submit}>
          {step === 1 ? (
            <>
              <h2 className="portal-surface__title">Scope and asset</h2>
              <label className="label">Asset type
                <select className="input" value={assetType} onChange={(event) => setAssetType(event.target.value)}>
                  <option value="certificate">Certificate endpoint</option>
                  <option value="domain">Registered domain</option>
                </select>
              </label>
              <label className="label">{assetType === 'certificate' ? 'Hostname' : 'Domain'}
                <input className="input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={assetType === 'certificate' ? 'app.example.com' : 'example.com'} required />
              </label>
              {assetType === 'certificate' ? (
                <label className="label">Port
                  <select className="input" value={port} onChange={(event) => setPort(event.target.value)}>
                    <option value="443">443</option>
                    <option value="8443">8443</option>
                  </select>
                </label>
              ) : null}
              <label className="label">Project
                <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">Select a project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="label">Environment
                <input className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="production" />
              </label>
              <label className="label">Service
                <input className="input" value={service} onChange={(event) => setService(event.target.value)} />
              </label>
              <button type="button" className="btn btn-primary" onClick={() => setStep(2)} disabled={!input.trim()}>Continue</button>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <h2 className="portal-surface__title">Ownership and policy</h2>
              <label className="label">Owner
                <input className="input" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Displayed name only" />
              </label>
              <label className="label">Team
                <select className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                  <option value="">No team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label className="label">Renewal runbook URL
                <input className="input" value={runbook} onChange={(event) => setRunbook(event.target.value)} />
              </label>
              <p className="access-hint">Hosted collector: public {assetType === 'certificate' ? `${input || 'hostname'}:${port}` : input || 'domain'}. Private ranges are rejected.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>Back</button>
              {' '}
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Registering…' : 'Register and check'}</button>
            </>
          ) : null}
        </form>
      </div>
    </DevOpsLayout>
  );
}
