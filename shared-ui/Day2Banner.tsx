import type { RequestOperation } from './types';

export default function Day2Banner({ operation }: { operation: RequestOperation | null | undefined }) {
  if (!operation) return null;
  const decommission = operation.operation === 'decommission';
  return (
    <section className={`ig-plan${decommission ? ' ig-plan--blocking' : ''}`} aria-label="Change type">
      <header className="ig-plan__head">
        <span className="ig-eyebrow">{decommission ? 'Decommission' : 'Change to existing infrastructure'}</span>
        <span className={`ig-chip ig-chip--${decommission ? 'danger' : 'info'}`}>Source #{operation.source_request_id}</span>
      </header>
      <p className={decommission ? 'ig-plan__warning' : 'ig-plan__empty'}>
        {decommission
          ? `Approving opens a pull request that deletes the files from request #${operation.source_request_id}. Terraform destroys those resources when it merges.`
          : `Edits the same Terraform files as request #${operation.source_request_id}, so resources are updated in place rather than created again.`}
        {operation.reason ? ` Reason: ${operation.reason}` : ''}
      </p>
    </section>
  );
}
