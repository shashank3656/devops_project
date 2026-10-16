import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { permissionsForService, serviceLabel } from '../../lib/cloudServices';
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

const STEPS = ['Identity', 'Scope', 'Permission', 'Duration', 'Review'];

export default function IamRequestPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [teams, setTeams] = useState<Team[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [projects, setProjects] = useState<CatalogProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [provider, setProvider] = useState('AWS');
  const [teamId, setTeamId] = useState('team-platform');
  const [principalId, setPrincipalId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [service, setService] = useState('');
  const [resourceId, setResourceId] = useState('');
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
      fetch(`${apiUrl}/api/devops/projects`, { headers }).then((res) => (res.ok ? res.json() : { projects: [] })),
    ]).then(([teamBody, principalBody, accountBody, resourceBody, projectBody]) => {
      setTeams(Array.isArray(teamBody?.teams) ? teamBody.teams : []);
      setPrincipals(Array.isArray(principalBody?.principals) ? principalBody.principals : []);
      setAccounts(Array.isArray(accountBody?.accounts) ? accountBody.accounts : []);
      setResources(Array.isArray(resourceBody?.resources) ? resourceBody.resources : []);
      setProjects(Array.isArray(projectBody?.projects) ? projectBody.projects : []);
    }).catch(() => setError('The access catalog could not be loaded.'));
  }, [apiUrl]);

  const visiblePrincipals = principals.filter((item) => item.teamId === teamId);
  const selected = resources.find((item) => item.id === resourceId);
  const selectedProject = projects.find((item) => String(item.id) === projectId);
  const scopeKind = selected?.type === 'subscription' ? 'SUBSCRIPTION' : selected?.type === 'resource_group' ? 'RESOURCE_GROUP' : 'RESOURCE';
  const cloudKey = provider.toLowerCase();
  const environmentOptions = selectedProject?.environments?.length ? selectedProject.environments : ['dev', 'uat', 'prod'];
  const cloudOptions = selectedProject?.clouds?.length ? selectedProject.clouds : ['aws', 'azure', 'gcp'];
  const scopeReady = Boolean(environment && projectId && provider);
  const serviceOptions = !scopeReady
    ? []
    : (selectedProject?.services || [])
      .filter((item) => item.cloud.toLowerCase() === cloudKey)
      .map((item) => ({ id: item.service, label: serviceLabel(cloudKey, item.service) }));
  const permissionOptions = permissionsForService(service);
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

  async function review() {
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
      setStep(4);
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

  return (
    <DevOpsLayout>
      <Head><title>Request access - IAM</title></Head>
      <IamFrame title="Request access" lede="Describe the task. The policy chooses the role, the scope, and who must approve. Submitting does not grant access.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <ol className="access-nav" aria-label="Request steps">
          {STEPS.map((label, index) => (
            <li key={label} className={index === step ? 'is-current' : undefined}>{index + 1}. {label}</li>
          ))}
        </ol>
        <form className="portal-surface access-form" onSubmit={(event) => {
          event.preventDefault();
          if (step === 1 && !service) {
            setError('Choose a service.');
            return;
          }
          if (step === 2 && !action) {
            setError('Choose a permission.');
            return;
          }
          setError('');
          if (step < 3) setStep(step + 1);
          else if (step === 3) void review();
        }}>
          {step === 0 ? (
            <>
              <label className="label" htmlFor="iam-team">Team</label>
              <select id="iam-team" className="input" value={teamId} onChange={(event) => { setTeamId(event.target.value); setPrincipalId(''); }}>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <label className="label" htmlFor="iam-principal">Who needs access</label>
              <select id="iam-principal" className="input" value={principalId} onChange={(event) => setPrincipalId(event.target.value)} required>
                <option value="">Choose a verified person</option>
                {visiblePrincipals.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.verified}>{item.name}{item.verified ? '' : ' · not verified'}</option>
                ))}
              </select>
            </>
          ) : null}
          {step === 1 ? (
            <>
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
              <select id="iam-service" className="input" value={service} onChange={(event) => { setService(event.target.value); setAction(''); }} required disabled={!scopeReady || serviceOptions.length === 0}>
                <option value="">{!scopeReady ? 'Choose environment, project, and cloud first' : serviceOptions.length ? 'Select a service' : 'No services were saved for this cloud on the project'}</option>
                {serviceOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <label className="label" htmlFor="iam-account">Account</label>
              <select id="iam-account" className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">No connected account</option>
                {accounts.filter((item) => item.provider === provider).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <label className="label" htmlFor="iam-action">Permission</label>
              <select id="iam-action" className="input" value={action} onChange={(event) => setAction(event.target.value)} required disabled={!service}>
                <option value="">{service ? 'Choose a permission' : 'Choose a service first'}</option>
                {permissionOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <p className="access-hint">{serviceName ? `${serviceName} permissions are Read, Developer, or Admin.` : 'Select a service to see its permissions.'} Owner and Contributor are not available.</p>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <label className="label" htmlFor="iam-duration">How long</label>
              <select id="iam-duration" className="input" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
                <option value={60}>1 hour</option>
                <option value={240}>4 hours</option>
                <option value={480}>8 hours</option>
                <option value={1440}>24 hours</option>
              </select>
              <label className="label" htmlFor="iam-ticket">Ticket</label>
              <input id="iam-ticket" className="input" value={ticket} onChange={(event) => setTicket(event.target.value)} placeholder="INC-2026-1042" />
              <label className="label" htmlFor="iam-why">Why this is needed</label>
              <textarea id="iam-why" className="input" rows={4} value={justification} onChange={(event) => setJustification(event.target.value)} />
              <p className="access-hint">Do not paste a secret, password, or connection string.</p>
            </>
          ) : null}
          {step === 4 && evaluation ? (
            <>
              <h2 className="access-form__title">{evaluation.decision?.replaceAll('_', ' ')}</h2>
              <p className="access-hint">Service {service || 'Unknown'} · Risk {evaluation.risk || 'Unknown'} · {evaluation.roleName || 'No role'} {evaluation.roleId ? `· ${evaluation.roleId}` : ''}</p>
              <p className="access-hint">{evaluation.normalizedScope}</p>
              <p className="access-hint">Approval: {(evaluation.approvalStages || []).join(' → ') || 'None'} · {evaluation.provisioningMode}</p>
              {evaluation.reason ? <p className="access-hint">{evaluation.reason}</p> : null}
              {(evaluation.warnings || []).map((warning) => <p key={warning} className="access-hint">{warning}</p>)}
              <p className="access-hint">Policy {evaluation.policyVersion}. This review expires quickly. It does not read or display secret values.</p>
            </>
          ) : null}
          <div className="access-create__end">
            {step > 0 ? <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)}>Back</button> : null}
            {step < 3 ? <button type="submit" className="btn btn-primary">Continue</button> : null}
            {step === 3 ? <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Checking…' : 'Review policy'}</button> : null}
            {step === 4 && (evaluation?.decision === 'ALLOW_WITH_APPROVAL' || evaluation?.decision === 'REQUIRE_ELIGIBILITY') ? (
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Opening…' : 'Open incident'}</button>
            ) : null}
          </div>
        </form>
      </IamFrame>
    </DevOpsLayout>
  );
}
