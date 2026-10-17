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
          return (
            <li key={step} className={`execution-stage__step${reached ? ' is-reached' : ''}${step === current ? ' is-current' : ''}${failedHere ? ' is-failed' : ''}`}>
              {failedHere ? 'Failed' : step}
            </li>
          );
        })}
      </ol>
      {phase === 'failed' && recovery ? <div className="execution-stage__recovery">{recovery}</div> : null}
    </section>
  );
}
