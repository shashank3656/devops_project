import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { permissionsForService, serviceLabel, servicesForCloud } from '../../lib/cloudServices';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type Team = { id: string; name: string };
type Principal = { id: string; name: string; teamId: string; verified: boolean };
type Account = { id: string; name: string; provider: string };
type CatalogProject = { id: number; name: string; code?: string; environments?: string[]; clouds?: string[]; services?: { cloud: string; service: string }[] };
type Evaluation = { evaluationId?: string; decision?: string; risk?: string; roleName?: string; reason?: string; warnings?: string[] };

const MAX_MINUTES = 90 * 24 * 60;

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export default function IamRequestPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<CatalogProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [provider, setProvider] = useState('AWS');
  const [teamId, setTeamId] = useState('team-platform');
  const [principalId, setPrincipalId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [ticket, setTicket] = useState('');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(() => `iam-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  useEffect(() => {
    const headers = sessionAuthHeaders();
    Promise.all([
      fetch(`${apiUrl}/api/devops/iam/teams`, { headers }).then((res) => res.json()),
      fetch(`${apiUrl}/api/devops/iam/principals`, { headers }).then((res) => res.json()),
      fetch(`${apiUrl}/api/devops/iam/cloud-accounts`, { headers }).then((res) => res.json()),
      fetch(`${apiUrl}/api/me/projects`, { headers }).then((res) => (res.ok ? res.json() : { projects: [] })),
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => (res.ok ? res.json() : { projects: [] })),
    ]).then(([teamBody, principalBody, accountBody, mineBody, managedBody]) => {
      setTeams(Array.isArray(teamBody?.teams) ? teamBody.teams : []);
      setPrincipals(Array.isArray(principalBody?.principals) ? principalBody.principals : []);
      setAccounts(Array.isArray(accountBody?.accounts) ? accountBody.accounts : []);
      const managed = Array.isArray(managedBody?.projects) ? managedBody.projects : [];
      const mine = Array.isArray(mineBody?.projects) ? mineBody.projects : [];
      setProjects(managed.length ? managed : mine);
    }).catch(() => setError('The access catalog could not be loaded.'));
  }, [apiUrl]);

  const visiblePrincipals = principals.filter((item) => item.teamId === teamId);
  const selectedProject = projects.find((item) => String(item.id) === projectId);
  const environmentOptions = selectedProject?.environments?.length ? selectedProject.environments : ['dev', 'uat', 'prod'];
  const cloudOptions = selectedProject?.clouds?.length ? selectedProject.clouds : ['aws', 'azure', 'gcp'];
  const activeProvider = cloudOptions.some((cloud) => cloud.toUpperCase() === provider)
    ? provider
    : (cloudOptions[0] || 'aws').toUpperCase();
  const cloudKey = activeProvider.toLowerCase();
  const catalog = servicesForCloud(cloudKey);
  const catalogIds = new Set(catalog.map((item) => item.id));
  const projectServices = (selectedProject?.services || [])
    .filter((item) => String(item.cloud || '').toLowerCase() === cloudKey && catalogIds.has(item.service))
    .map((item) => ({ id: item.service, label: serviceLabel(cloudKey, item.service) }));
  const serviceOptions = projectServices.length ? projectServices : catalog;
  const permissionOptions = useMemo(() => {
    const rows = services.length
      ? services.flatMap((id) => permissionsForService(cloudKey, id))
      : permissionsForService(cloudKey, '');
    const seen = new Set<string>();
    return rows.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [cloudKey, services]);

  useEffect(() => {
    if (provider !== activeProvider) setProvider(activeProvider);
    setServices((current) => current.filter((id) => catalogIds.has(id)));
    setPermissions((current) => current.filter((id) => permissionOptions.some((item) => item.id === id)));
  }, [activeProvider, cloudKey]);

  function windowError(): string {
    if (!startsAt || !endsAt) return 'Choose a start time and an end time.';
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Choose a start time and an end time.';
    if (end <= start) return 'End time must be after the start time.';
    if ((end.getTime() - start.getTime()) / 60000 > MAX_MINUTES) return 'Access cannot be longer than 90 days.';
    return '';
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const timing = windowError();
    if (!principalId || !environment || !projectId || services.length === 0 || permissions.length === 0 || timing) {
      setError(timing || 'Choose the person, project, at least one service, and at least one permission.');
      return;
    }
    setSaving(true);
    setError('');
    const serviceNames = services.map((id) => serviceLabel(cloudKey, id));
    const minutes = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
    const payload = {
      provider: activeProvider,
      teamId,
      principalId,
      cloudAccountId: accountId,
      environment,
      scopeKind: 'RESOURCE',
      service: serviceNames.join(', '),
      services: serviceNames,
      projectId,
      action: permissions.join(', '),
      permissions,
      startsAt,
      endsAt,
      durationMinutes: minutes,
      ticketRef: ticket.trim(),
      justification: justification.trim(),
    };
    try {
      const reviewed = await fetch(`${apiUrl}/api/devops/iam/access-requests/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const evaluation = await reviewed.json().catch(() => ({})) as Evaluation;
      if (!reviewed.ok || !evaluation.evaluationId) {
        setError(evaluation.reason || 'The request could not be checked.');
        return;
      }
      if (evaluation.decision !== 'ALLOW_WITH_APPROVAL' && evaluation.decision !== 'REQUIRE_ELIGIBILITY') {
        setError(evaluation.reason || 'This access was not accepted.');
        return;
      }
      const created = await fetch(`${apiUrl}/api/devops/iam/access-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...sessionAuthHeaders() },
        body: JSON.stringify({ evaluationId: evaluation.evaluationId }),
      });
      const body = await created.json().catch(() => ({}));
      if (!created.ok) {
        setError(body?.error || 'The access request was not raised.');
        return;
      }
      await router.push('/service-desk');
    } catch {
      setError('The access request was not raised.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DevOpsLayout>
      <Head><title>Request access - IAM</title></Head>
      <IamFrame title="Request access" lede="Select one or more services and permissions. Access starts and ends at the times you set, and cannot run longer than 90 days.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <form className="portal-surface iam-sheet" onSubmit={submit}>
          <div className="iam-grid">
            <section>
              <h2>Who</h2>
              <label className="label" htmlFor="iam-team">Team</label>
              <select id="iam-team" className="input" value={teamId} onChange={(event) => { setTeamId(event.target.value); setPrincipalId(''); }}>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <label className="label" htmlFor="iam-principal">Person</label>
              <select id="iam-principal" className="input" value={principalId} onChange={(event) => setPrincipalId(event.target.value)} required>
                <option value="">Choose a verified person</option>
                {visiblePrincipals.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.verified}>{item.name}{item.verified ? '' : ' · not verified'}</option>
                ))}
              </select>
            </section>
            <section>
              <h2>Where</h2>
              <label className="label" htmlFor="iam-env">Environment</label>
              <select id="iam-env" className="input" value={environment} onChange={(event) => { setEnvironment(event.target.value); setServices([]); setPermissions([]); }}>
                <option value="">Choose an environment</option>
                {environmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <label className="label" htmlFor="iam-project">Project</label>
              <select id="iam-project" className="input" value={projectId} onChange={(event) => { setProjectId(event.target.value); setServices([]); setPermissions([]); }}>
                <option value="">Choose a project</option>
                {projects.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.name} (${item.code})` : item.name}</option>)}
              </select>
              <label className="label" htmlFor="iam-provider">Cloud</label>
              <select id="iam-provider" className="input" value={activeProvider} onChange={(event) => { setProvider(event.target.value); setServices([]); setPermissions([]); }}>
                {cloudOptions.map((cloud) => <option key={cloud} value={cloud.toUpperCase()}>{cloud.toUpperCase()}</option>)}
              </select>
              <label className="label" htmlFor="iam-account">Account</label>
              <select id="iam-account" className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">No connected account</option>
                {accounts.filter((item) => item.provider.toUpperCase() === activeProvider).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </section>
          </div>
          <div className="iam-grid">
            <section>
              <h2>Services</h2>
              <p className="access-hint">Select every service this access covers.</p>
              <div className="iam-choices" role="group" aria-label={`${activeProvider} services`} key={cloudKey}>
                {serviceOptions.map((item) => (
                  <label key={item.id} className={services.includes(item.id) ? 'is-current' : undefined}>
                    <input type="checkbox" checked={services.includes(item.id)} onChange={() => setServices((current) => toggle(current, item.id))} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </section>
            <section>
              <h2>Permissions</h2>
              <p className="access-hint">{services.length ? 'Select every role these services need.' : 'Choose a service to see its roles.'}</p>
              <div className="iam-choices" role="group" aria-label="Permissions">
                {permissionOptions.map((item) => (
                  <label key={item.id} className={permissions.includes(item.id) ? 'is-current' : undefined}>
                    <input type="checkbox" checked={permissions.includes(item.id)} onChange={() => setPermissions((current) => toggle(current, item.id))} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </section>
          </div>
          <section>
            <h2>When</h2>
            <div className="iam-split">
              <div>
                <label className="label" htmlFor="iam-start">Start time</label>
                <input id="iam-start" className="input" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
              </div>
              <div>
                <label className="label" htmlFor="iam-end">End time</label>
                <input id="iam-end" className="input" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
              </div>
            </div>
            <p className="access-hint">These are two separate times. The gap cannot be more than 90 days.</p>
          </section>
          <section>
            <label className="label" htmlFor="iam-ticket">Ticket</label>
            <input id="iam-ticket" className="input" value={ticket} onChange={(event) => setTicket(event.target.value)} placeholder="INC-2026-1042" />
            <label className="label" htmlFor="iam-why">Why this is needed</label>
            <textarea id="iam-why" className="input" rows={3} value={justification} onChange={(event) => setJustification(event.target.value)} />
            <p className="access-hint">Do not paste a secret, password, or connection string. Submitting raises an access request on the Service Desk.</p>
          </section>
          <div className="access-create__end">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Raising…' : 'Raise access request'}</button>
          </div>
        </form>
      </IamFrame>
    </DevOpsLayout>
  );
}
