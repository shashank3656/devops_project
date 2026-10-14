import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { actorId, deskCall, sessionRole } from '../../components/deskClient';
import { useApiUrl } from '../../context/ApiUrlContext';
import { canCloseFinding, nextFindingAction, textField } from '../../lib/securityDesk';
import { asRecord } from '../../lib/payload';
import { deskCanWrite } from '../../shared-ui/deskRules';

interface LoadedFinding {
  id: number;
  projectId: number;
  state: string;
  coverage: string;
  rescanState: string;
  latestResult: string;
  evidence: string;
  checkId: string;
  resourceId: string;
}

function safeStatus(status: number): string {
  if (status === 404) return 'That finding was not found in this project.';
  if (status === 403) return 'This action is not permitted.';
  return 'The request was not accepted.';
}

export default function FindingsPage() {
  const apiUrl = useApiUrl();
  const [canWrite, setCanWrite] = useState(false);
  const [findingId, setFindingId] = useState('');
  const [finding, setFinding] = useState<LoadedFinding | null>(null);
  const [owner, setOwner] = useState('Unknown');
  const [expiry, setExpiry] = useState('Unknown');
  const [serviceId, setServiceId] = useState('');
  const [fixNote, setFixNote] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionEvidence, setExceptionEvidence] = useState('');
  const [exceptionControl, setExceptionControl] = useState('');
  const [exceptionEnvironment, setExceptionEnvironment] = useState('');
  const [exceptionExpiry, setExceptionExpiry] = useState('');
  const [approverId, setApproverId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setCanWrite(deskCanWrite(sessionRole()));
  }, []);

  const gate = finding ? canCloseFinding(finding.coverage, finding.rescanState, finding.latestResult) : { allowed: false, reason: 'Load a finding before choosing a next action.' };
  const action = finding ? nextFindingAction(finding.state, finding.coverage, finding.rescanState, finding.latestResult) : 'Load a finding to see evidence, owner, and the next action.';

  async function loadFinding() {
    setError('');
    setNotice('');
    setFinding(null);
    setOwner('Unknown');
    setExpiry('Unknown');
    if (!findingId) return;
    const result = await deskCall(apiUrl, `/api/findings?finding_id=${encodeURIComponent(findingId)}`, 'GET');
    if (result.status !== 200) {
      setError(safeStatus(result.status));
      return;
    }
    const body = asRecord(result.body);
    const observations = Array.isArray(body.observations) ? body.observations : [];
    const latest = observations.length > 0 ? asRecord(observations[observations.length - 1]) : {};
    setFinding({
      id: Number(body.id) || 0,
      projectId: Number(body.project_id) || 0,
      state: textField(body, 'state') || 'unknown',
      coverage: textField(body, 'coverage') || 'unknown',
      rescanState: textField(body, 'rescan_state') || 'unknown',
      latestResult: textField(body, 'latest_result') || 'unknown',
      evidence: textField(latest, 'evidence') || 'Unknown',
      checkId: textField(body, 'check_id') || 'Unknown',
      resourceId: textField(body, 'resource_id') || 'Unknown',
    });
  }

  async function nameOwner() {
    if (!finding || !canWrite || !serviceId) return;
    const result = await deskCall(apiUrl, '/api/remediation/assignments', 'POST', {
      project_id: finding.projectId,
      service_id: Number(serviceId),
      finding_key: String(finding.id),
      severity: '',
    });
    if (result.status !== 201 && result.status !== 200) {
      setError(safeStatus(result.status));
      return;
    }
    const body = asRecord(result.body);
    setOwner(textField(body, 'owner_team') || 'Unknown');
    const due = textField(body, 'due_at');
    if (due) setExpiry(due);
    setNotice('Owner recorded. Assignment is not acknowledgement and it is not cloud access.');
  }

  async function recordException() {
    if (!finding || !canWrite) return;
    const approver = Number(approverId);
    if (owner === 'Unknown') {
      setError('Name an owner before recording an exception.');
      return;
    }
    if (!exceptionReason.trim() || !exceptionEvidence.trim() || !exceptionControl.trim() || !exceptionEnvironment.trim() || !exceptionExpiry || !approver || approver === actorId()) {
      setError('An exception needs one environment, a reason, a compensating control, evidence, a future expiry, and a different approver.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/remediation/exceptions', 'POST', {
      project_id: finding.projectId,
      finding_key: String(finding.id),
      environment: exceptionEnvironment.trim(),
      reason: exceptionReason.trim(),
      compensating_control: exceptionControl.trim(),
      evidence: exceptionEvidence.trim(),
      approver_user_id: approver,
      expires_at: new Date(exceptionExpiry).toISOString(),
    });
    if (result.status !== 201) {
      setError(safeStatus(result.status));
      return;
    }
    const body = asRecord(result.body);
    setExpiry(textField(body, 'expires_at') || exceptionExpiry);
    setNotice(body.access_granted === true ? 'The exception response was not accepted.' : 'Exception recorded. Cloud access was not granted.');
  }

  async function closeFinding() {
    if (!finding || !canWrite || !gate.allowed) {
      setError(gate.reason);
      return;
    }
    const result = await deskCall(apiUrl, '/api/findings/close', 'POST', {
      finding_id: finding.id,
      reason: 'verified rescan',
    });
    if (result.status !== 200) {
      setError(safeStatus(result.status));
      return;
    }
    setFinding({ ...finding, state: 'closed' });
    setNotice('Finding closed after a verified rescan. Closure does not grant cloud access.');
  }

  return (
    <DevOpsLayout>
      <Head><title>Findings</title></Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <h1 className="portal-page__title">Findings</h1>
            <p className="portal-page__subtitle">Evidence, owner, and the next action stay in view. An exception is not cloud access.</p>
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert">{notice}</div> : null}
        <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); void loadFinding(); }}>
          <label className="label">Finding id
            <input className="input" value={findingId} onChange={(event) => setFindingId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </label>
          <div className="portal-page__actions">
            <button className="btn btn-primary" type="submit" disabled={!findingId}>Load finding</button>
          </div>
        </form>
        {finding ? (
          <section className="portal-surface">
            <dl className="security-facts">
              <div><dt>Evidence</dt><dd>{finding.evidence}</dd></div>
              <div><dt>Owner</dt><dd>{owner}</dd></div>
              <div><dt>Expiry</dt><dd>{expiry}</dd></div>
              <div><dt>Next action</dt><dd>{action}</dd></div>
            </dl>
            <p className="portal-page__subtitle">{finding.checkId} · {finding.resourceId} · {finding.state} · coverage {finding.coverage} · rescan {finding.rescanState}</p>
            <div className="portal-field-grid portal-field-grid--two">
              <label className="label">Service id for the owner
                <input className="input" value={serviceId} onChange={(event) => setServiceId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
              </label>
              <label className="label">Fix note
                <textarea className="input" value={fixNote} onChange={(event) => setFixNote(event.target.value)} />
              </label>
            </div>
            <p className="portal-page__subtitle">A fix note does not deploy. A change request is not execution. Close waits for a verified rescan.</p>
            <div className="portal-page__actions">
              <button className="btn btn-secondary" type="button" disabled={!canWrite || !serviceId} onClick={() => void nameOwner()}>Name owner</button>
              <Link className="btn btn-secondary" href="/changes/new">Open a change request</Link>
              <button className="btn btn-primary" type="button" disabled={!canWrite || !gate.allowed} onClick={() => void closeFinding()}>Close after verified rescan</button>
            </div>
            <p>{gate.reason}</p>
            <h2 className="portal-surface__title">Exception</h2>
            <div className="portal-field-grid portal-field-grid--two">
              <label className="label">Reason
                <input className="input" value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} />
              </label>
              <label className="label">Environment
                <input className="input" value={exceptionEnvironment} onChange={(event) => setExceptionEnvironment(event.target.value)} placeholder="One environment" />
              </label>
              <label className="label">Compensating control
                <input className="input" value={exceptionControl} onChange={(event) => setExceptionControl(event.target.value)} />
              </label>
              <label className="label">Evidence
                <input className="input" value={exceptionEvidence} onChange={(event) => setExceptionEvidence(event.target.value)} />
              </label>
              <label className="label">Expiry
                <input className="input" type="datetime-local" value={exceptionExpiry} onChange={(event) => setExceptionExpiry(event.target.value)} />
              </label>
              <label className="label">Approver user id
                <input className="input" value={approverId} onChange={(event) => setApproverId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
              </label>
            </div>
            <div className="portal-page__actions">
              <button className="btn btn-secondary" type="button" disabled={!canWrite} onClick={() => void recordException()}>Record exception</button>
            </div>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
