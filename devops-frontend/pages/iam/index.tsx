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
type Resource = { id: string; name: string; type: string; environment: string; teamId: string; cloudAccountId: string };
type CatalogProject = { id: number; name: string; code?: string; environments?: string[]; clouds?: string[]; services?: { cloud: string; service: string }[] };
type Evaluation = {
  evaluationId?: string;
  decision?: string;
  risk?: string;
  roleName?: string;
  roleId?: string;
  normalizedScope?: string;
  approvalStages?: string[];
  provisioningMode?: string;
  warnings?: string[];
  reason?: string;
  policyVersion?: string;
};
type Summary = { active?: number; pending?: number; expiring?: number; approvals?: number };

export default function IamRequestPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [projects, setProjects] = useState<CatalogProject[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [provider, setProvider] = useState('AWS');
  const [teamId, setTeamId] = useState('team-platform');
  const [principalId, setPrincipalId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [service, setService] = useState('');
  const [resourceId] = useState('');
  const [action, setAction] = useState('');
  const [minutes, setMinutes] = useState(240);
  const [ticket, setTicket] = useState('');
  const [justification, setJustification] = useState('');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(() => `iam-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  useEffect(() => {
    const headers = sessionAuthHeaders();
    Promise.all([
      fetch(`${apiUrl}/api/devops/iam/teams`, { headers }).then((res) => res.json()),
      fetch(`${apiUrl}/api/devops/iam/principals`, { headers }).then((res) => res.json()),
      fetch(`${apiUrl}/api/devops/iam/cloud-accounts`, { headers }).then((res) => res.json()),
      fetch(`${apiUrl}/api/devops/iam/resources`, { headers }).then((res) => res.json()),
      fetch(`${apiUrl}/api/me/projects`, { headers }).then((res) => (res.ok ? res.json() : { projects: [] })),
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => (res.ok ? res.json() : { projects: [] })),
      fetch(`${apiUrl}/api/devops/iam/summary`, { headers }).then((res) => (res.ok ? res.json() : null)),
    ]).then(([teamBody, principalBody, accountBody, resourceBody, mineBody, managedBody, summaryBody]) => {
      setTeams(Array.isArray(teamBody?.teams) ? teamBody.teams : []);
      setPrincipals(Array.isArray(principalBody?.principals) ? principalBody.principals : []);
      setAccounts(Array.isArray(accountBody?.accounts) ? accountBody.accounts : []);
      setResources(Array.isArray(resourceBody?.resources) ? resourceBody.resources : []);
      const managed = Array.isArray(managedBody?.projects) ? managedBody.projects : [];
      const mine = Array.isArray(mineBody?.projects) ? mineBody.projects : [];
      setProjects(managed.length ? managed : mine);
      setSummary(summaryBody);
    }).catch(() => setError('The access catalog could not be loaded.'));
  }, [apiUrl]);

  const visiblePrincipals = principals.filter((item) => item.teamId === teamId);
  const selected = resources.find((item) => item.id === resourceId);
  const selectedProject = projects.find((item) => String(item.id) === projectId);
  const scopeKind = selected?.type === 'subscription' ? 'SUBSCRIPTION' : selected?.type === 'resource_group' ? 'RESOURCE_GROUP' : 'RESOURCE';
  const cloudKey = provider.toLowerCase();
  const environmentOptions = selectedProject?.environments?.length ? selectedProject.environments : ['dev', 'uat', 'prod'];
  const cloudOptions = selectedProject?.clouds?.length ? selectedProject.clouds : ['aws', 'azure', 'gcp'];
  const projectServices = (selectedProject?.services || [])
    .filter((item) => String(item.cloud || '').toLowerCase() === cloudKey && item.service)
    .map((item) => ({ id: item.service, label: serviceLabel(cloudKey, item.service) }));
  const serviceOptions = projectServices.length ? projectServices : servicesForCloud(cloudKey);
  const permissionOptions = permissionsForService(cloudKey, service);
  const serviceName = serviceOptions.find((item) => item.id === service)?.label || serviceLabel(cloudKey, service);

  const payload = useMemo(() => ({
    provider,
    teamId,
    principalId,
    cloudAccountId: accountId || selected?.cloudAccountId || '',
    resourceId,
    environment: environment || selected?.environment || '',
    scopeKind,
    service: serviceName,
    projectId,
    action,
    durationMinutes: minutes,
    ticketRef: ticket.trim(),
    justification: justification.trim(),
  }), [accountId, action, environment, justification, minutes, principalId, projectId, provider, resourceId, scopeKind, selected, serviceName, teamId, ticket]);

  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!principalId || !environment || !projectId || !service || !action) {
      setError('Choose the person, project, cloud, service, and permission.');
      return;
    }
    setSaving(true);
    setError('');
    setEvaluation(null);
    try {
      const response = await fetch(`${apiUrl}/api/devops/iam/access-requests/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error || 'The request could not be evaluated.');
        return;
      }
      setEvaluation(body);
    } catch {
      setError('The request could not be evaluated.');
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!evaluation?.evaluationId) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/iam/access-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...sessionAuthHeaders() },
        body: JSON.stringify({ evaluationId: evaluation.evaluationId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error || 'The request was not accepted.');
        return;
      }
      await router.push('/iam/requests');
    } catch {
      setError('The request was not accepted.');
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = evaluation?.decision === 'ALLOW_WITH_APPROVAL' || evaluation?.decision === 'REQUIRE_ELIGIBILITY';

  return (
    <DevOpsLayout>
      <Head><title>Request access - IAM</title></Head>
      <IamFrame title="Request access" lede="Ask for a role on a project service. DevOps approves it, then the grant is recorded. This does not assign the role in the cloud.">
        <section className="changes-facts" aria-label="Access summary">
          <div><span>Active</span><strong>{summary ? summary.active ?? 0 : '…'}</strong></div>
          <div><span>Pending</span><strong>{summary ? summary.pending ?? 0 : '…'}</strong></div>
          <div><span>Expiring</span><strong>{summary ? summary.expiring ?? 0 : '…'}</strong></div>
          <div><span>Approvals</span><strong>{summary ? summary.approvals ?? 0 : '…'}</strong></div>
        </section>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <form className="portal-surface iam-sheet" onSubmit={review}>
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
              <select id="iam-env" className="input" value={environment} onChange={(event) => { setEnvironment(event.target.value); setService(''); setAction(''); }} required>
                <option value="">Choose an environment</option>
                {environmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <label className="label" htmlFor="iam-project">Project</label>
              <select
                id="iam-project"
                className="input"
                value={projectId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setProjectId(nextId);
                  setService('');
                  setAction('');
                  const next = projects.find((item) => String(item.id) === nextId);
                  const nextCloud = next?.clouds?.[0];
                  if (nextCloud && !next?.clouds?.some((cloud) => cloud.toLowerCase() === provider.toLowerCase())) {
                    setProvider(nextCloud.toUpperCase());
                  }
                }}
                required
              >
                <option value="">Choose a project</option>
                {projects.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.name} (${item.code})` : item.name}</option>)}
              </select>
              <label className="label" htmlFor="iam-provider">Cloud</label>
              <select id="iam-provider" className="input" value={provider} onChange={(event) => { setProvider(event.target.value); setService(''); setAction(''); }} required>
                {cloudOptions.map((cloud) => <option key={cloud} value={cloud.toUpperCase()}>{cloud.toUpperCase()}</option>)}
              </select>
              <label className="label" htmlFor="iam-service">Service</label>
              <select id="iam-service" className="input" value={service} onChange={(event) => { setService(event.target.value); setAction(''); }} required>
                <option value="">Select a service</option>
                {serviceOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <div className="iam-choices" role="listbox" aria-label="Services">
                {serviceOptions.map((item) => (
                  <button key={item.id} type="button" className={service === item.id ? 'is-current' : undefined} onClick={() => { setService(item.id); setAction(''); }}>
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="label" htmlFor="iam-account">Account</label>
              <select id="iam-account" className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">No connected account</option>
                {accounts.filter((item) => item.provider === provider).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </section>
          </div>
          <section className="iam-split">
            <div>
              <h2>Permission</h2>
              <label className="label" htmlFor="iam-action">Role</label>
              <select id="iam-action" className="input" value={action} onChange={(event) => setAction(event.target.value)} required>
                <option value="">Select a permission</option>
                {permissionOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <div className="iam-choices" role="listbox" aria-label="Permissions">
                {permissionOptions.map((item) => (
                  <button key={item.id} type="button" className={action === item.id ? 'is-current' : undefined} onClick={() => setAction(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="access-hint">{service ? `${serviceName} on ${provider}.` : `Common ${provider} roles. Choose a service to see its roles.`}</p>
            </div>
            <div>
              <h2>How long and why</h2>
              <label className="label" htmlFor="iam-duration">Duration</label>
              <select id="iam-duration" className="input" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
                <option value={60}>1 hour</option>
                <option value={240}>4 hours</option>
                <option value={480}>8 hours</option>
                <option value={1440}>24 hours</option>
              </select>
              <label className="label" htmlFor="iam-ticket">Ticket</label>
              <input id="iam-ticket" className="input" value={ticket} onChange={(event) => setTicket(event.target.value)} placeholder="INC-2026-1042" />
              <label className="label" htmlFor="iam-why">Why this is needed</label>
              <textarea id="iam-why" className="input" rows={3} value={justification} onChange={(event) => setJustification(event.target.value)} />
              <p className="access-hint">Do not paste a secret, password, or connection string.</p>
            </div>
          </section>
          {evaluation ? (
            <section className="iam-review" aria-live="polite">
              <h2>{evaluation.decision?.replaceAll('_', ' ')}</h2>
              <p>{evaluation.roleName || 'No role'} · {evaluation.risk || 'Unknown'} risk{evaluation.roleId ? ` · ${evaluation.roleId}` : ''}</p>
              <p>{evaluation.normalizedScope}</p>
              <p>Approval: {(evaluation.approvalStages || []).join(' → ') || 'None'}</p>
              {evaluation.reason ? <p>{evaluation.reason}</p> : null}
              {(evaluation.warnings || []).map((warning) => <p key={warning}>{warning}</p>)}
            </section>
          ) : null}
          <div className="access-create__end">
            <button type="submit" className="btn btn-secondary" disabled={saving}>{saving ? 'Checking…' : 'Check policy'}</button>
            {canSubmit ? (
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Opening…' : 'Open incident'}</button>
            ) : null}
          </div>
        </form>
      </IamFrame>
    </DevOpsLayout>
  );
}
