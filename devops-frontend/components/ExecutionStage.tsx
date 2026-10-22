import type { ReactNode } from 'react';

const STEPS = ['Approved', 'Queued', 'Running', 'Succeeded'] as const;

export type ExecutionPhase = 'approval' | 'approved' | 'queued' | 'running' | 'succeeded' | 'failed';

export function executionPhase(status?: string): ExecutionPhase {
  switch ((status || '').toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'queued':
    case 'scheduled':
      return 'queued';
    case 'in_progress':
    case 'running':
    case 'implementing':
    case 'monitoring':
      return 'running';
    case 'completed':
    case 'succeeded':
    case 'resolved':
    case 'closed':
      return 'succeeded';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'failed';
    default:
      return 'approval';
  }
}

const COPY: Record<ExecutionPhase, string> = {
  approval: 'Waiting for approval. Approval does not run this work.',
  approved: 'Approved. It is not running until it is queued.',
  queued: 'Queued. Execution has not started.',
  running: 'Running. Approval is already finished.',
  succeeded: 'Succeeded.',
  failed: 'Failed. Approval is finished. Use the recovery action to try again or roll back.',
};

export default function ExecutionStage({
  status,
  recovery,
}: {
  status?: string;
  recovery?: ReactNode;
}) {
  const phase = executionPhase(status);
  const current = phase === 'failed' ? 'Succeeded' : phase === 'approval' ? '' : phase === 'approved' ? 'Approved' : phase === 'queued' ? 'Queued' : phase === 'running' ? 'Running' : 'Succeeded';

  return (
    <section className="execution-stage" aria-label="Approval and execution">
      <p className="execution-stage__copy">{COPY[phase]}</p>
      <ol className="execution-stage__steps">
        {STEPS.map((step) => {
          const reached = current !== '' && STEPS.indexOf(step) <= STEPS.indexOf(current as (typeof STEPS)[number]);
          const failedHere = phase === 'failed' && step === 'Succeeded';
          const isCurrent = step === current;
          const complete = phase === 'succeeded' && isCurrent;
          const done = reached && !isCurrent && !failedHere;
          return (
            <li
              key={step}
              className={`execution-stage__step${done ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}${complete ? ' is-complete' : ''}${failedHere ? ' is-failed' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="execution-stage__mark" aria-hidden="true">{failedHere ? '!' : done || complete ? '✓' : ''}</span>
              <span>{failedHere ? 'Failed' : step}</span>
              {isCurrent && !complete && !failedHere ? <span className="execution-stage__state">Current</span> : null}
              {complete ? <span className="execution-stage__state">Complete</span> : null}
            </li>
          );
        })}
      </ol>
      {phase === 'failed' && recovery ? <div className="execution-stage__recovery">{recovery}</div> : null}
    </section>
  );
}
