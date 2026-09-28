import StatusChip from './StatusChip';

export interface ChangeDetailModel {
  id: number;
  change_number: string;
  project_name?: string;
  project_code?: string;
  service: string;
  environment: string;
  repo: string;
  pr_number: number;
  pr_url?: string;
  sha: string;
  previous_sha?: string;
  title: string;
  author?: string;
  summary?: string;
  files?: string[];
  pipeline_url?: string;
  change_type: string;
  status: string;
  watch_minutes: number;
  watch_until?: string;
  watch_remaining_minutes?: number;
  linked_incidents: number;
  baseline?: { p95_ms?: number; error_ratio?: number; saturation?: number };
  latest_metrics?: { p95_ms?: number; error_ratio?: number; saturation?: number };
  rollback_hint?: string;
  cab_status?: string;
  cab_approved_by_username?: string;
  linked_incident_number?: string;
  assignee_username?: string;
  priority?: string;
  risk_level?: string;
  impact?: string;
  backout_plan?: string;
  sbom_url?: string;
  attestation_url?: string;
  image_digest?: string;
  provenance_signed?: boolean;
  rollout_stage?: string;
  rollout_percent?: number;
  rollout_halted?: boolean;
  rollout_note?: string;
  cost_delta_usd?: number;
  cost_monthly_after?: number;
  cost_currency?: string;
  policy_status?: string;
  policy_reasons?: string[];
  cab_window_start?: string;
  cab_window_end?: string;
  created_at: string;
}

const LIFECYCLE_STEPS = [
  { key: 'new', label: 'New' },
  { key: 'authorized', label: 'Approved' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'implementing', label: 'Implement' },
  { key: 'monitoring', label: 'Monitor' },
  { key: 'resolved', label: 'Review' },
  { key: 'closed', label: 'Closed' },
] as const;

function normalizeStatus(raw: string): string {
  const s = (raw || '').toLowerCase().replace(/\s+/g, '_');
  if (s === 'authorized' || s === 'approved') return 'scheduled';
  if (s === 'implemented') return 'monitoring';
  return s;
}

function lifecycleIndex(item: ChangeDetailModel): number {
  const status = normalizeStatus(item.status);
  const cab = (item.cab_status || '').toLowerCase();
  if (status === 'failed' || status === 'cancelled') return -1;
  if (status === 'closed') return 6;
  if (status === 'resolved') return 5;
  if (status === 'monitoring' || status === 'implemented') return 4;
  if (status === 'implementing') return 3;
  if (status === 'scheduled') return cab === 'approved' || cab === '' ? 2 : 2;
  if (cab === 'approved') return 2;
  if (cab === 'pending') return 1;
  if (status === 'new') return 0;
  return 3;
}

function statusTone(status: string): 'info' | 'ok' | 'danger' | undefined {
  const s = normalizeStatus(status);
  if (s === 'failed' || s === 'cancelled') return 'danger';
  if (s === 'resolved' || s === 'closed') return 'ok';
  if (s === 'scheduled' || s === 'new') return 'info';
  return undefined;
}

function formatWhen(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="chg-detail-field">
      <span className="chg-detail-field__label">{label}</span>
      <span className="chg-detail-field__value">{value || '—'}</span>
    </div>
  );
}

export type ChangeDetailActions = {
  canApprove?: boolean;
  canSchedule?: boolean;
  canImplement?: boolean;
  canResolve?: boolean;
  canClose?: boolean;
  canFail?: boolean;
  canCancel?: boolean;
  canReopen?: boolean;
  canRollout?: boolean;
  onApprove?: () => void;
  onSchedule?: () => void;
  onImplement?: () => void;
  onResolve?: () => void;
  onClose?: () => void;
  onFail?: () => void;
  onCancel?: () => void;
  onReopen?: () => void;
  onRollout?: (stage: string) => void;
  acting?: string;
};

export default function ChangeDetailPanel({
  item,
  actions,
}: {
  item: ChangeDetailModel;
  actions?: ChangeDetailActions;
}) {
  const status = (item.status || '').toLowerCase();
  const finished = status === 'resolved' || status === 'closed' || status === 'failed' || status === 'cancelled';
  const stepIdx = lifecycleIndex(item);
  const acting = actions?.acting || '';

  return (
    <div className="chg-detail">
      <section className="chg-detail__lifecycle devops-workflow-card">
        <div className="chg-detail__lifecycle-head">
          <div>
            <h2 className="chg-detail__section-title">Lifecycle</h2>
            <p className="chg-detail__hint">ServiceNow-style path: approve, schedule, then implement.</p>
          </div>
          <StatusChip tone={statusTone(item.status)} label={item.status || 'unknown'} />
        </div>
        <ol className="chg-lifecycle" aria-label="Change lifecycle">
          {LIFECYCLE_STEPS.map((step, index) => {
            const done = stepIdx >= 0 && index < stepIdx;
            const current = stepIdx === index;
            const authorizedDone = step.key === 'authorized' && (item.cab_status === 'approved' || stepIdx > 1);
            const isDone = step.key === 'authorized' ? authorizedDone : done || (current && stepIdx > index);
            const isCurrent =
              step.key === 'authorized'
                ? item.cab_status === 'pending' || (item.cab_status === 'approved' && normalizeStatus(item.status) === 'new')
                : current;
            return (
              <li
                key={step.key}
                className={`chg-lifecycle__step${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
              >
                <span className="chg-lifecycle__dot" aria-hidden />
                <span className="chg-lifecycle__label">{step.label}</span>
              </li>
            );
          })}
        </ol>
        {item.cab_status === 'approved' && item.cab_approved_by_username ? (
          <p className="chg-detail__hint">Approved by {item.cab_approved_by_username}</p>
        ) : null}
      </section>

      {actions ? (
        <section className="chg-detail__actions devops-action-card">
          <h2 className="chg-detail__section-title">Actions</h2>
          <div className="chg-detail__action-row">
            {actions.canApprove ? (
              <button type="button" className="btn btn-primary" disabled={!!acting} onClick={actions.onApprove}>
                {acting === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            ) : null}
            {actions.canSchedule ? (
              <button type="button" className="btn btn-primary" disabled={!!acting} onClick={actions.onSchedule}>
                {acting === 'schedule' ? 'Scheduling…' : 'Schedule'}
              </button>
            ) : null}
            {actions.canImplement ? (
              <button type="button" className="btn btn-primary" disabled={!!acting} onClick={actions.onImplement}>
                {acting === 'implement' ? 'Starting…' : 'Start implementation'}
              </button>
            ) : null}
            {actions.canResolve && !finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onResolve}>
                {acting === 'resolve' ? 'Resolving…' : 'Resolve'}
              </button>
            ) : null}
            {actions.canClose && !finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onClose}>
                {acting === 'close' ? 'Closing…' : 'Close'}
              </button>
            ) : null}
            {actions.canFail && !finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onFail}>
                {acting === 'fail' ? 'Updating…' : 'Mark failed'}
              </button>
            ) : null}
            {actions.canCancel && !finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onCancel}>
                {acting === 'cancel' ? 'Cancelling…' : 'Cancel'}
              </button>
            ) : null}
            {actions.canReopen && finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onReopen}>
                {acting === 'reopen' ? 'Reopening…' : 'Reopen'}
              </button>
            ) : null}
          </div>
          {actions.canRollout && !finished ? (
            <div className="chg-detail__action-row">
              {['canary', '10', '50', '100'].map((stage) => (
                <button
                  key={stage}
                  type="button"
                  className="btn btn-secondary"
                  disabled={!!acting}
                  onClick={() => actions.onRollout?.(stage)}
                >
                  {acting === `rollout-${stage}` ? 'Updating…' : stage === '100' ? '100%' : stage === 'canary' ? 'Canary' : `${stage}%`}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="chg-detail__summary portal-surface">
        <h2 className="chg-detail__section-title">Overview</h2>
        <div className="portal-detail-grid chg-detail__grid">
          <DetailField label="Type" value={item.change_type} />
          <DetailField label="Priority" value={item.priority || 'medium'} />
          <DetailField label="Risk" value={item.risk_level || 'medium'} />
          <DetailField label="Service" value={item.service} />
          <DetailField
            label="Environment"
            value={item.environment === 'unspecified' ? '—' : item.environment}
          />
          <DetailField label="Assigned to" value={item.assignee_username || '—'} />
          <DetailField label="Author" value={item.author || '—'} />
          <DetailField
            label="Project"
            value={item.project_name ? `${item.project_name} (${item.project_code})` : '—'}
          />
          <DetailField label="Planned start" value={formatWhen(item.cab_window_start)} />
          <DetailField label="Planned end" value={formatWhen(item.cab_window_end)} />
          <DetailField label="Repo" value={item.repo} />
          <DetailField label="SHA" value={item.sha} />
          <DetailField label="Pull request" value={item.pr_number ? `#${item.pr_number}` : 'None'} />
          <DetailField
            label="Watch window"
            value={`${item.watch_minutes} min${item.watch_until ? ` · until ${formatWhen(item.watch_until)}` : ''}`}
          />
          <DetailField label="Linked incidents" value={String(item.linked_incidents || 0)} />
          <DetailField label="CAB" value={item.cab_status || '—'} />
        </div>
        {item.summary ? <p className="chg-detail__prose">{item.summary}</p> : null}
        {item.impact ? <p className="chg-detail__prose"><strong>Impact:</strong> {item.impact}</p> : null}
        {item.backout_plan ? <p className="chg-detail__prose"><strong>Backout:</strong> {item.backout_plan}</p> : null}
        {(item.pr_url || item.pipeline_url) ? (
          <p className="chg-detail__links">
            {item.pr_url ? (
              <a href={item.pr_url} target="_blank" rel="noreferrer">
                Pull request
              </a>
            ) : null}
            {item.pr_url && item.pipeline_url ? ' · ' : null}
            {item.pipeline_url ? (
              <a href={item.pipeline_url} target="_blank" rel="noreferrer">
                Pipeline
              </a>
            ) : null}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function buildChangeDetailActions(
  item: ChangeDetailModel,
  opts: {
    portal: 'devops' | 'admin' | 'user';
    isManager?: boolean;
    finished: boolean;
  },
): ChangeDetailActions {
  const status = normalizeStatus(item.status);
  const cab = (item.cab_status || '').toLowerCase();
  const canOps = opts.portal === 'devops' && opts.isManager;
  return {
    canApprove: (opts.portal === 'devops' || opts.portal === 'admin') && cab === 'pending',
    canSchedule:
      opts.portal === 'devops' &&
      opts.isManager &&
      status === 'new' &&
      cab !== 'pending',
    canImplement: opts.portal === 'devops' && opts.isManager && status === 'scheduled',
    canResolve: canOps && !opts.finished && status !== 'resolved',
    canClose: canOps && !opts.finished,
    canFail: canOps && !opts.finished,
    canCancel: canOps && !opts.finished,
    canReopen: canOps && opts.finished,
    canRollout: canOps && !opts.finished,
  };
}
