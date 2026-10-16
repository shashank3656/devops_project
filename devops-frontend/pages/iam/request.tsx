import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type Team = { id: string; name: string };
type Principal = { id: string; name: string; teamId: string; verified: boolean };
type Account = { id: string; name: string; provider: string };
type Resource = { id: string; name: string; type: string; environment: string; teamId: string; cloudAccountId: string };
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
  const [provider, setProvider] = useState('AZURE');
  const [teamId, setTeamId] = useState('team-platform');
  const [principalId, setPrincipalId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [action, setAction] = useState('READ_SECRET_VALUE');
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
    ]).then(([teamBody, principalBody, accountBody, resourceBody]) => {
      setTeams(Array.isArray(teamBody?.teams) ? teamBody.teams : []);
      setPrincipals(Array.isArray(principalBody?.principals) ? principalBody.principals : []);
      setAccounts(Array.isArray(accountBody?.accounts) ? accountBody.accounts : []);
      setResources(Array.isArray(resourceBody?.resources) ? resourceBody.resources : []);
    }).catch(() => setError('The access catalog could not be loaded.'));
  }, [apiUrl]);

  const visiblePrincipals = principals.filter((item) => item.teamId === teamId);
  const selected = resources.find((item) => item.id === resourceId);
  const scopeKind = selected?.type === 'subscription' ? 'SUBSCRIPTION' : selected?.type === 'resource_group' ? 'RESOURCE_GROUP' : 'RESOURCE';

  const payload = useMemo(() => ({
    provider,
    teamId,
    principalId,
    cloudAccountId: accountId || selected?.cloudAccountId || '',
    resourceId,
    environment: selected?.environment || '',
    scopeKind,
    action,
    durationMinutes: minutes,
    ticketRef: ticket.trim(),
    justification: justification.trim(),
  }), [accountId, action, justification, minutes, principalId, provider, resourceId, scopeKind, selected, teamId, ticket]);

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
        <form className="portal-surface access-form" onSubmit={(event) => { event.preventDefault(); if (step < 3) setStep(step + 1); else if (step === 3) void review(); }}>
          {step === 0 ? (
            <>
              <label className="label" htmlFor="iam-provider">Cloud</label>
              <select id="iam-provider" className="input" value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="AZURE">Azure</option>
                <option value="AWS">AWS</option>
                <option value="GCP">GCP</option>
              </select>
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
              <label className="label" htmlFor="iam-account">Subscription</label>
              <select id="iam-account" className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">Choose a subscription</option>
                {accounts.filter((item) => item.provider === provider).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <label className="label" htmlFor="iam-resource">Resource</label>
              <select id="iam-resource" className="input" value={resourceId} onChange={(event) => setResourceId(event.target.value)} required>
                <option value="">Choose the smallest resource</option>
                {resources.filter((item) => item.teamId === teamId).map((item) => (
                  <option key={item.id} value={item.id}>{item.name} · {item.environment} · {item.type.replaceAll('_', ' ')}</option>
                ))}
              </select>
              <p className="access-hint">Production secret read is limited to one vault. A subscription or resource group is not an allowed scope.</p>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <label className="label" htmlFor="iam-action">What do you need to do?</label>
              <select id="iam-action" className="input" value={action} onChange={(event) => setAction(event.target.value)}>
                <option value="READ_SECRET_VALUE">Read secret values</option>
                <option value="READ_SECRET_METADATA">View secret names only</option>
                <option value="VIEW_MONITORING">View monitoring</option>
              </select>
              <p className="access-hint">The role is calculated on the server. You cannot pick Owner or Contributor.</p>
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
              <p className="access-hint">Risk {evaluation.risk || 'Unknown'} · {evaluation.roleName || 'No role'} {evaluation.roleId ? `· ${evaluation.roleId}` : ''}</p>
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
