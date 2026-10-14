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
  const [role] = useState<'viewer' | 'operator'>(sessionRole());
  const [plans, setPlans] = useState<DriftPlanView[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [review, setReview] = useState<DriftReviewView | null>(null);
  const [message, setMessage] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [kind, setKind] = useState<'configuration' | 'refresh'>('configuration');
  const [accessible, setAccessible] = useState(true);
  const [detail, setDetail] = useState('');
  const [held, setHeld] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const canWrite = deskCanWrite(role);
  const scopeNote = workspaceScopeBlock(scope.projectId, scope.environment);
  const selected = plans.find((plan) => plan.id === selectedId) ?? null;
  const failed = !scopeNote && plans.length === 0 && message.endsWith('request failed');

  async function load() {
    const block = workspaceScopeBlock(scope.projectId, scope.environment);
    if (block) {
      setPlans([]);
      setMessage(block);
      return;
    }
    const result = await deskCall(apiUrl, `/api/drift/plans?project_id=${scope.projectId}&environment=${encodeURIComponent(scope.environment)}`, 'GET');
    if (result.status === 404) {
      setPlans([]);
      setSelectedId(null);
      setMessage('');
      return;
    }
    if (result.status !== 200) {
      setPlans([]);
      setSelectedId(null);
      setMessage(staticError(result.body));
      return;
    }
    const next = parseDriftPlans(result.body);
    setPlans(next);
    setSelectedId((current) => (next.some((plan) => plan.id === current) ? current : null));
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
      <header className="desk-landing">
        <h2>Infrastructure drift</h2>
        <p>A configuration difference is read only. An inaccessible state shows Unknown. A review stays proposed.</p>
      </header>
      <DeskError message={scopeNote ? '' : message} />
      <section className="desk-language__panel desk-language__rail" aria-label="Plan">
        <h2>Plan</h2>
        <form className="desk-language__form" onSubmit={(event) => { event.preventDefault(); void submitPlan(); }}>
          <div className="desk-language__field">
            <label htmlFor="drift-workspace">Workspace</label>
            <input id="drift-workspace" value={workspace} autoComplete="off" onChange={(event) => setWorkspace(event.target.value)} />
          </div>
          <div className="desk-language__choices" role="group" aria-label="Kind">
            <button type="button" className={kind === 'configuration' ? 'is-selected' : ''} onClick={() => setKind('configuration')}>Configuration</button>
            <button type="button" className={kind === 'refresh' ? 'is-selected' : ''} onClick={() => setKind('refresh')}>Refresh</button>
          </div>
          <label htmlFor="drift-accessible">
            <input id="drift-accessible" type="checkbox" checked={accessible} onChange={(event) => setAccessible(event.target.checked)} />
            State is accessible
          </label>
          <div className="desk-language__field">
            <label htmlFor="drift-detail">Evidence</label>
            <input id="drift-detail" value={detail} autoComplete="off" disabled={!accessible} onChange={(event) => setDetail(event.target.value)} />
          </div>
          <div className="desk-language__actions">
            <button type="submit" className="btn btn-primary" disabled={!canWrite}>{canWrite ? 'Record plan' : 'Read only'}</button>
          </div>
        </form>
      </section>
      <section className="desk-language__panel" aria-label="Plans">
        <h2>Plans</h2>
        {scopeNote ? (
          <div className="desk-language__empty">
            <DeskStateChip value="unknown" />
            <p>{scopeNote}</p>
          </div>
        ) : failed ? (
          <div className="desk-language__empty">
            <DeskStateChip value="error" />
          </div>
        ) : plans.length === 0 ? (
          <div className="desk-language__empty">
            <DeskStateChip value="empty" />
            <p>No plans in this project.</p>
          </div>
        ) : (
          <ul className="desk-language__records">
            {plans.map((plan) => (
              <li key={plan.id} aria-current={plan.id === selectedId ? 'true' : undefined}>
                <button type="button" onClick={() => setSelectedId(plan.id)}>
                  <span>
                    <strong>{plan.workspace}</strong>
                    <small>{driftStateLabel(plan.state)} · {plan.kind === 'refresh' ? 'Refresh' : 'Configuration'} · Read only · Can apply off</small>
                  </span>
                  <DeskStateChip value={plan.observed || 'unknown'} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected ? (
          <form className="desk-language__form" onSubmit={(event) => { event.preventDefault(); void submitReview(selected); }}>
            <p className="desk-language__note">{selected.workspace}. Can apply stays off.</p>
            <label htmlFor="drift-held">
              <input id="drift-held" type="checkbox" checked={held} onChange={(event) => setHeld(event.target.checked)} />
              Hold apply
            </label>
            <div className="desk-language__actions">
              <button type="button" className="btn btn-secondary" disabled={!canWrite} onClick={() => void submitLock()}>{canWrite ? 'Save lock' : 'Read only'}</button>
            </div>
            <p className="desk-language__note">While a lock is held, the existing plan stays unchanged.</p>
            {selected.kind === 'configuration' && selected.state === 'drifted' ? (
              <div className="desk-language__field">
                <label htmlFor="drift-reviewer">Reviewer</label>
                <input id="drift-reviewer" value={reviewer} inputMode="numeric" onChange={(event) => setReviewer(event.target.value)} />
              </div>
            ) : null}
            <div className="desk-language__actions">
              <button type="submit" className="btn btn-secondary" disabled={!canWrite || selected.kind === 'refresh' || selected.state !== 'drifted'}>
                {selected.kind === 'refresh' ? 'Refresh cannot open a review' : 'Propose review'}
              </button>
            </div>
            {review ? <p className="desk-language__note">Review {review.state}. Can apply stays off.</p> : null}
          </form>
        ) : plans.length > 0 ? (
          <p className="desk-language__note">Select a plan before holding apply or proposing a review.</p>
        ) : null}
      </section>
    </div>
  );
}
