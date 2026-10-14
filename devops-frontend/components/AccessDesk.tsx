import { useEffect, useState } from 'react';
import {
  ACCESS_DENIED_MESSAGE,
  DeskError,
  DeskStateChip,
  accessActionBlock,
  accessGrantBlock,
  accessStateLabel,
  deskCanWrite,
  deskErrorText,
  parseAccessGrant,
  parseAccessGrants,
  workspaceScopeBlock,
  type AccessGrantView,
} from '@infragate/ui';
import { useApiUrl } from '../context/ApiUrlContext';
import { actorId, deskCall, sessionRole, useDeskScope } from './deskClient';

function staticError(body: unknown): string {
  const message = deskErrorText(body);
  return message === 'request failed' ? 'entitlement request failed' : message;
}

export default function AccessDesk() {
  const apiUrl = useApiUrl();
  const scope = useDeskScope();
  const role = sessionRole();
  const [grants, setGrants] = useState<AccessGrantView[]>([]);
  const [listState, setListState] = useState<'unknown' | 'empty' | 'error'>('unknown');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [executor, setExecutor] = useState('');
  const [decision, setDecision] = useState('approved');
  const [duration, setDuration] = useState('30');
  const [approver, setApprover] = useState('');
  const [reviewer, setReviewer] = useState('');
  const canWrite = deskCanWrite(role);
  const selected = grants.find((grant) => grant.id === selectedId) ?? null;

  async function load() {
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setGrants([]);
      setListState('unknown');
      setMessage(block);
      return;
    }
    try {
      const result = await deskCall(apiUrl, `/api/access-grants?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
      if (result.status === 404) {
        setGrants([]);
        setSelectedId(null);
        setListState('empty');
        setMessage('');
        return;
      }
      if (result.status !== 200) {
        setGrants([]);
        setSelectedId(null);
        setListState('error');
        setMessage(staticError(result.body));
        return;
      }
      const next = parseAccessGrants(result.body);
      setGrants(next);
      setSelectedId((current) => (next.some((grant) => grant.id === current) ? current : null));
      setListState('empty');
      setMessage('');
    } catch {
      setGrants([]);
      setSelectedId(null);
      setListState('error');
      setMessage('entitlement request failed');
    }
  }

  useEffect(() => {
    void load();
  }, [apiUrl, scope.environment, scope.projectId]);

  async function submitGrant() {
    const block = accessGrantBlock({
      role,
      projectId: scope.projectId,
      environment: scope.environment,
      target,
      reason,
      executor,
      decision,
      duration: Number(duration),
      approverId: Number(approver),
      actorId: actorId(),
    });
    if (block) {
      setMessage(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/access-grants', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      target: target.trim(),
      reason: reason.trim(),
      provider: 'sandbox',
      executor: executor.trim(),
      decision: 'approved',
      duration_minutes: Number(duration),
      approver_id: Number(approver),
    });
    if (result.status !== 200) {
      setMessage(staticError(result.body));
      return;
    }
    const saved = parseAccessGrant(result.body);
    setMessage(saved ? '' : 'entitlement request failed');
    await load();
  }

  async function act(grant: AccessGrantView, action: 'expire' | 'revoke' | 'verify') {
    const reviewerId = Number(reviewer);
    const block = accessActionBlock(role, grant.state, action, reviewerId, actorId());
    if (block) {
      setMessage(block);
      return;
    }
    const path = action === 'expire' ? '/api/access-grants/expire' : action === 'revoke' ? '/api/access-grants/revoke' : '/api/access-grants/verify';
    const body = action === 'verify' ? { grant_id: grant.id, reviewer_id: reviewerId } : { grant_id: grant.id };
    const result = await deskCall(apiUrl, path, 'POST', body);
    if (result.status !== 200) {
      setMessage(staticError(result.body));
      return;
    }
    setMessage('');
    await load();
  }

  return (
    <div className="desk-language">
      <header className="desk-landing">
        <h2>Temporary access</h2>
        <p>One target, a reason, 1 to 60 minutes, and a different approver. Provider stays sandbox.</p>
      </header>
      <DeskError message={listState === 'unknown' ? '' : message} />
      <section className="desk-language__panel desk-language__rail" aria-label="Grant">
        <h2>Grant</h2>
        <form className="desk-language__form" onSubmit={(event) => { event.preventDefault(); void submitGrant(); }}>
          <div className="desk-language__field">
            <label htmlFor="access-target">Target</label>
            <input id="access-target" value={target} autoComplete="off" onChange={(event) => setTarget(event.target.value)} />
          </div>
          <div className="desk-language__field">
            <label htmlFor="access-reason">Reason</label>
            <input id="access-reason" value={reason} autoComplete="off" onChange={(event) => setReason(event.target.value)} />
          </div>
          <div className="desk-language__field">
            <label htmlFor="access-executor">Executor</label>
            <input id="access-executor" value={executor} autoComplete="off" onChange={(event) => setExecutor(event.target.value)} />
          </div>
          <div className="desk-language__field">
            <label htmlFor="access-provider">Provider</label>
            <input id="access-provider" value="sandbox" readOnly />
          </div>
          <div className="desk-language__field">
            <label htmlFor="access-duration">Duration</label>
            <input id="access-duration" value={duration} inputMode="numeric" onChange={(event) => setDuration(event.target.value)} />
          </div>
          <div className="desk-language__field">
            <label htmlFor="access-approver">Approver</label>
            <input id="access-approver" value={approver} inputMode="numeric" onChange={(event) => setApprover(event.target.value)} />
          </div>
          <div className="desk-language__choices" role="group" aria-label="Decision">
            <button type="button" className={decision === 'approved' ? 'is-selected' : ''} onClick={() => setDecision('approved')}>Approved</button>
            <button type="button" className={decision === 'denied' ? 'is-selected' : ''} onClick={() => setDecision('denied')}>Denied</button>
          </div>
          <div className="desk-language__actions">
            <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Record grant' : 'Read only'}</button>
          </div>
        </form>
        {decision === 'denied' ? <p className="desk-language__note">{ACCESS_DENIED_MESSAGE}</p> : null}
      </section>
      <section className="desk-language__panel" aria-label="Grants">
        <h2>Grants</h2>
        {listState === 'unknown' ? (
          <div className="desk-language__empty">
            <DeskStateChip value="unknown" />
            <p>{message}</p>
          </div>
        ) : listState === 'error' ? (
          <div className="desk-language__empty">
            <DeskStateChip value="error" />
          </div>
        ) : grants.length === 0 ? (
          <div className="desk-language__empty">
            <DeskStateChip value="empty" />
            <p>No grants in this project.</p>
          </div>
        ) : (
          <ul className="desk-language__records">
            {grants.map((grant) => (
              <li key={grant.id} aria-current={grant.id === selectedId ? 'true' : undefined}>
                <button type="button" onClick={() => setSelectedId(grant.id)}>
                  <span>
                    <strong>{grant.target}</strong>
                    <small>{accessStateLabel(grant.state)} · {grant.entitled ? 'Entitled' : 'Not entitled'} · {grant.residual ? 'Residual session recorded' : 'Residual session not recorded'} · {grant.duration} min · {grant.executor}</small>
                  </span>
                  <DeskStateChip value={grant.observed} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected ? (
          <form className="desk-language__form" onSubmit={(event) => event.preventDefault()}>
            <h3>{selected.target}</h3>
            {selected.state === 'revocation_failed' ? (
              <div className="desk-language__field">
                <label htmlFor="access-reviewer">Reviewer</label>
                <input id="access-reviewer" value={reviewer} inputMode="numeric" onChange={(event) => setReviewer(event.target.value)} />
              </div>
            ) : null}
            <div className="desk-language__actions">
              <button type="button" className="btn btn-secondary" disabled={!canWrite || selected.state !== 'approved'} onClick={() => void act(selected, 'expire')}>Expire</button>
              <button type="button" className="btn btn-secondary" disabled={!canWrite || selected.state !== 'approved'} onClick={() => void act(selected, 'revoke')}>Revocation failed</button>
              <button type="button" className="btn btn-secondary" disabled={!canWrite || selected.state !== 'revocation_failed'} onClick={() => void act(selected, 'verify')}>Verify</button>
            </div>
          </form>
        ) : listState === 'empty' && grants.length > 0 ? (
          <p className="desk-language__note">Select a grant before expiring, recording a failed revocation, or verifying.</p>
        ) : null}
      </section>
    </div>
  );
}
