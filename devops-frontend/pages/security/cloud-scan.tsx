import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { deskCall, sessionRole } from '../../components/deskClient';
import { useApiUrl } from '../../context/ApiUrlContext';
import { coverageStatement, textField } from '../../lib/securityDesk';
import { asRecord } from '../../lib/payload';
import { deskCanWrite } from '../../shared-ui/deskRules';
import { useWorkspaceScope } from '../../shared-ui/useWorkspaceScope';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProjectOption {
  id: number;
  name: string;
  team: string;
  cloud: string;
  environments: string[];
}

interface ConnectionOption {
  id: number;
  name: string;
  provider: string;
  environment: string;
}

interface ScanJob {
  id: number;
  state: string;
  completed: number;
  total: number;
  region: string;
  account_id: string;
}

function safeStatus(status: number): string {
  if (status === 404) return 'That scan record was not found in this project.';
  if (status === 403) return 'This action is not permitted.';
  if (status === 409) return 'The scan could not start. Check the account and region.';
  return 'The request was not accepted.';
}

export default function CloudScanPage() {
  const apiUrl = useApiUrl();
  const { scope } = useWorkspaceScope();
  const [canWrite, setCanWrite] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [profileId, setProfileId] = useState('');
  const [region, setRegion] = useState('');
  const [accountId, setAccountId] = useState('');
  const [checkId, setCheckId] = useState('');
  const [step, setStep] = useState<'scope' | 'review' | 'result'>('scope');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [job, setJob] = useState<ScanJob | null>(null);
  const [sources, setSources] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    setCanWrite(deskCanWrite(sessionRole()));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    void Promise.all([
      deskCall(apiUrl, '/api/devops/projects', 'GET'),
      deskCall(apiUrl, '/api/connections', 'GET'),
    ]).then(([projectResult, connectionResult]) => {
      if (projectResult.status !== 200) {
        setSources('error');
        return;
      }
      const projectBody = asRecord(projectResult.body);
      const projectRows = Array.isArray(projectBody.projects) ? projectBody.projects : Array.isArray(projectResult.body) ? projectResult.body : [];
      setProjects(projectRows.map((row) => {
        const item = asRecord(row);
        const clouds = Array.isArray(item.clouds) ? item.clouds.map((cloud) => String(cloud)) : [];
        const environments = Array.isArray(item.environments) ? item.environments.map((value) => String(value)) : [];
        return {
          id: Number(item.id) || 0,
          name: textField(item, 'name') || 'Unknown',
          team: textField(item, 'owner_team') || textField(item, 'team') || 'Unknown',
          cloud: clouds.join(', ') || textField(item, 'cloud') || 'Unknown',
          environments,
        };
      }).filter((item) => item.id > 0));
      const connectionBody = asRecord(connectionResult.body);
      const connectionRows = Array.isArray(connectionBody.connections) ? connectionBody.connections : Array.isArray(connectionResult.body) ? connectionResult.body : [];
      setConnections(connectionResult.status === 200 ? connectionRows.map((row) => {
        const item = asRecord(row);
        return {
          id: Number(item.id) || 0,
          name: textField(item, 'name') || 'Unknown',
          provider: textField(item, 'provider') || textField(item, 'type') || 'Unknown',
          environment: textField(item, 'environment') || 'Unknown',
        };
      }).filter((item) => item.id > 0) : []);
      setSources('ready');
    }).catch(() => setSources('error'));
  }, [apiUrl]);

  useEffect(() => {
    if (!projectId && scope.projectId) setProjectId(scope.projectId);
    if (!environment && scope.environment) setEnvironment(scope.environment);
  }, [environment, projectId, scope.environment, scope.projectId]);

  const project = projects.find((item) => String(item.id) === projectId);
  const connection = connections.find((item) => String(item.id) === connectionId);
  const ready = Boolean(project && profileId && region.trim() && /^\d{12}$/.test(accountId) && checkId.trim() && environment);
  const coverage = useMemo(() => coverageStatement(job?.state || 'unknown', job?.completed || 0), [job]);

  async function startRescan() {
    if (!canWrite || !ready || !project) return;
    setError('');
    const result = await deskCall(apiUrl, '/api/scans/jobs', 'POST', {
      profile_id: Number(profileId),
      observed_account: accountId,
      region: region.trim(),
      checks: [checkId.trim()],
      prowler_version: '5.15.1',
    });
    if (result.status !== 201) {
      setError(safeStatus(result.status));
      return;
    }
    const body = asRecord(result.body);
    const saved: ScanJob = {
      id: Number(body.id) || 0,
      state: textField(body, 'state') || 'unknown',
      completed: Number(body.completed) || 0,
      total: Number(body.total) || 0,
      region: textField(body, 'region') || region,
      account_id: textField(body, 'account_id') || accountId,
    };
    setJob(saved);
    setNotice(saved.id > 0 ? `Tracked job ${saved.id} started.` : 'The job response did not include an id.');
    setStep('result');
  }

  const facts = [
    ['Project', project?.name || 'Unknown'],
    ['Team', project?.team || 'Unknown'],
    ['Provider', connection?.provider || project?.cloud || 'Unknown'],
    ['Connection', connection?.name || 'Unknown'],
    ['Environment', environment || 'Unknown'],
    ['Profile', profileId || 'Unknown'],
    ['Region', region || 'Unknown'],
  ];

  return (
    <DevOpsLayout>
      <Head><title>Cloud scan</title></Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security / cloud posture</span>
            <h1 className="portal-page__title">Scan with a clear scope.</h1>
            <p className="portal-page__subtitle">Choose a connected account and review exactly what will be scanned. Coverage stays unknown until a scan finishes.</p>
          </div>
        </header>
        {sources === 'error' ? <div className="alert alert-error">Project scope could not be loaded. Coverage stays unknown.</div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert">{notice}</div> : null}
        <dl className="security-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {step === 'scope' ? (
          <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); if (ready) setStep('review'); }}>
            <div className="portal-field-grid portal-field-grid--two">
              <label className="label">Project
                <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">Select one project</option>
                  {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="label">Connection
                <select className="input" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
                  <option value="">Unknown until a connection is chosen</option>
                  {connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="label">Environment
                <input className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="One environment" />
              </label>
              <label className="label">Profile id
                <input className="input" value={profileId} onChange={(event) => setProfileId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
              </label>
              <label className="label">Region
                <input className="input" value={region} onChange={(event) => setRegion(event.target.value)} />
              </label>
              <label className="label">Observed account
                <input className="input" value={accountId} onChange={(event) => setAccountId(event.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" />
              </label>
              <label className="label">Check
                <input className="input" value={checkId} onChange={(event) => setCheckId(event.target.value)} />
              </label>
            </div>
            <div className="portal-page__actions">
              <button className="btn btn-primary" type="submit" disabled={!ready || connections.length === 0} title={connections.length === 0 ? 'Connect a cloud account to continue.' : !ready ? 'Choose a project, environment, profile, region, account, and check to continue.' : 'Review scope'}>Review scope</button>
              {connections.length === 0 ? (
                <span className="blocked-action__reason">
                  Connect a cloud account to continue. <Link href="/cloud-accounts">Connect cloud account</Link>
                </span>
              ) : !ready ? <span className="blocked-action__reason">Choose a project, environment, profile, region, account, and check to continue.</span> : null}
            </div>
          </form>
        ) : null}

        {step === 'review' ? (
          <section className="portal-surface">
            <h2 className="portal-surface__title">Review</h2>
            <p className="portal-page__subtitle">A rescan creates a tracked job. It does not grant write access, and missing coverage is not healthy.</p>
            <div className="portal-page__actions">
              <button className="btn btn-secondary" type="button" onClick={() => setStep('scope')}>Back</button>
              <button className="btn btn-primary" type="button" disabled={!canWrite} onClick={() => void startRescan()}>Start tracked rescan</button>
            </div>
            {!canWrite ? <p className="portal-page__subtitle">A viewer can review this scope. A viewer cannot start a scan.</p> : null}
          </section>
        ) : null}

        {step === 'result' && job ? (
          <section className="portal-surface">
            <h2 className="portal-surface__title">Coverage</h2>
            <p>Job {job.id || 'Unknown'} · {job.state || 'unknown'} · {job.completed} of {job.total} checks</p>
            <p>{coverage}</p>
            <div className="portal-page__actions">
              <button className="btn btn-secondary" type="button" onClick={() => { setJob(null); setStep('scope'); }}>Change scope</button>
            </div>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
