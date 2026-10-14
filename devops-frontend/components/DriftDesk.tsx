import { useEffect, useState } from 'react';
import {
  DeskError,
  DeskStateChip,
  deskCanWrite,
  deskErrorText,
  driftLockBlock,
  driftPlanBlock,
  driftReviewBlock,
  driftStateLabel,
  parseDriftPlan,
  parseDriftPlans,
  parseDriftReview,
  workspaceScopeBlock,
  type DriftPlanView,
  type DriftReviewView,
} from '@infragate/ui';
import { useApiUrl } from '../context/ApiUrlContext';
import { actorId, deskCall, sessionRole, useDeskScope } from './deskClient';

function staticError(body: unknown): string {
  const message = deskErrorText(body);
  return message === 'request failed' ? 'drift request failed' : message;
}

export default function DriftDesk() {
  const apiUrl = useApiUrl();
  const scope = useDeskScope();
  const [role, setRole] = useState<'viewer' | 'operator'>(sessionRole());
  const lockedViewer = sessionRole() === 'viewer';
  const [plans, setPlans] = useState<DriftPlanView[]>([]);
  const [review, setReview] = useState<DriftReviewView | null>(null);
  const [message, setMessage] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [kind, setKind] = useState<'configuration' | 'refresh'>('configuration');
  const [accessible, setAccessible] = useState(true);
  const [detail, setDetail] = useState('');
  const [held, setHeld] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const canWrite = deskCanWrite(role);

  async function load() {
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setPlans([]);
      setMessage(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/drift/plans?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
    if (result.status !== 200) {
      setPlans([]);
      setMessage(staticError(result.body));
      return;
    }
    setPlans(parseDriftPlans(result.body));
    setMessage('');
  }

  useEffect(() => {
    void load();
  }, [apiUrl, scope.environment, scope.projectId]);

  async function submitPlan() {
    const block = driftPlanBlock({ role, projectId: scope.projectId, environment: scope.environment, workspace, kind, detail: accessible ? detail : '' });
    if (block) {
      setMessage(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/drift/plans', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      workspace: workspace.trim(),
      kind,
      accessible,
      detail: accessible ? detail.trim() : '',
    });
    if (result.status !== 200) {
      setMessage(staticError(result.body));
      return;
    }
    setMessage(parseDriftPlan(result.body) ? '' : 'drift request failed');
    await load();
  }

  async function submitLock() {
    const block = driftLockBlock(role, scope.projectId, scope.environment, workspace);
    if (block) {
      setMessage(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/drift/locks', 'POST', {
      project_id: Number(scope.projectId),
      environment: scope.environment,
      workspace: workspace.trim(),
      held,
    });
    setMessage(result.status === 200 ? '' : staticError(result.body));
    if (result.status === 200) await load();
  }

  async function submitReview(plan: DriftPlanView) {
    const reviewerId = Number(reviewer);
    const block = driftReviewBlock({ role, kind: plan.kind, state: plan.state, reviewerId, actorId: actorId() });
    if (block) {
      setMessage(block);
      return;
    }
    const result = await deskCall(apiUrl, '/api/drift/reviews', 'POST', { plan_id: plan.id, reviewer_id: reviewerId });
    if (result.status !== 200) {
      setMessage(staticError(result.body));
      return;
    }
    const saved = parseDriftReview(result.body);
    setReview(saved);
    setMessage(saved && saved.state === 'proposed' && saved.applied === false ? '' : 'drift request failed');
    await load();
  }

  return (
    <div className="desk-language">
      <header className="sd-hero">
        <div>
          <h1 className="sd-hero__title">Infrastructure drift</h1>
          <p className="sd-hero__subtitle">A configuration difference is read only. An inaccessible state shows Unknown. A review stays proposed.</p>
        </div>
      </header>
      <div className="desk-language__choices" role="group" aria-label="Role">
        <button type="button" className={role === 'operator' ? 'is-selected' : ''} disabled={lockedViewer} onClick={() => setRole('operator')}>Operator</button>
        <button type="button" className={role === 'viewer' ? 'is-selected' : ''} onClick={() => setRole('viewer')}>Viewer</button>
      </div>
      <DeskError message={message} />
      <section className="desk-language__panel" aria-label="Plan">
        <h2>Plan</h2>
        <form className="desk-language__form" onSubmit={(event) => { event.preventDefault(); void submitPlan(); }}>
          <label htmlFor="drift-workspace">Workspace</label>
          <input id="drift-workspace" value={workspace} autoComplete="off" onChange={(event) => setWorkspace(event.target.value)} />
          <div className="desk-language__choices" role="group" aria-label="Kind">
            <button type="button" className={kind === 'configuration' ? 'is-selected' : ''} onClick={() => setKind('configuration')}>Configuration</button>
            <button type="button" className={kind === 'refresh' ? 'is-selected' : ''} onClick={() => setKind('refresh')}>Refresh</button>
          </div>
          <label htmlFor="drift-accessible">
            <input id="drift-accessible" type="checkbox" checked={accessible} onChange={(event) => setAccessible(event.target.checked)} />
            State is accessible
          </label>
          <label htmlFor="drift-detail">Evidence</label>
          <input id="drift-detail" value={detail} autoComplete="off" disabled={!accessible} onChange={(event) => setDetail(event.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Record plan' : 'Read only'}</button>
        </form>
      </section>
      <section className="desk-language__panel" aria-label="Apply lock">
        <h2>Apply lock</h2>
        <form className="desk-language__form" onSubmit={(event) => { event.preventDefault(); void submitLock(); }}>
          <label htmlFor="drift-held">
            <input id="drift-held" type="checkbox" checked={held} onChange={(event) => setHeld(event.target.checked)} />
            Hold apply
          </label>
          <button type="submit" className="btn btn-secondary" disabled={!canWrite}>{canWrite ? 'Save lock' : 'Read only'}</button>
        </form>
        <p className="desk-language__note">While a lock is held, the existing plan stays unchanged.</p>
      </section>
      <section className="desk-language__panel" aria-label="Plans">
        <h2>Plans</h2>
        <label htmlFor="drift-reviewer">Reviewer user id</label>
        <input id="drift-reviewer" value={reviewer} inputMode="numeric" onChange={(event) => setReviewer(event.target.value)} />
        {review ? <p className="desk-language__note">Review {review.state}. Can apply stays off.</p> : null}
        {plans.length === 0 ? (
          <div className="desk-language__empty">
            <DeskStateChip value="empty" />
            <p>No plans in this project.</p>
          </div>
        ) : (
          <ul className="desk-language__records">
            {plans.map((plan) => (
              <li key={plan.id}>
                <span>
                  <strong>{plan.workspace}</strong>
                  <small>{driftStateLabel(plan.state)} · {plan.kind} · Read only · Can apply off</small>
                </span>
                <DeskStateChip value={plan.observed || 'unknown'} />
                <button
                  type="button"
                  disabled={!canWrite || plan.kind === 'refresh' || plan.state !== 'drifted'}
                  onClick={() => void submitReview(plan)}
                >
                  {plan.kind === 'refresh' ? 'Refresh cannot open a review' : 'Propose review'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
