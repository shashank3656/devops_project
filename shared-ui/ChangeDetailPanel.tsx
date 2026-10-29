import { formatOperationalTime } from './time';

export interface ChangeDetailModel {
  id: number;
  change_number: string;
  project_id?: number;
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
  if (status === 'scheduled') return 2;
  if (cab === 'approved') return 2;
  if (cab === 'pending') return 1;
  if (status === 'new') return 0;
  return 0;
}

function formatWhen(value?: string): string {
  return formatOperationalTime(value);
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || '—'}</strong>
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

export function changeScopeIncomplete(item: ChangeDetailModel): boolean {
  const env = (item.environment || '').trim().toLowerCase();
  const envMissing = !env || env === 'unspecified' || env === 'unknown' || env === '—' || env === '-';
  const projectMissing = !(item.project_name || '').trim() && !(item.project_code || '').trim() && !(item.project_id && item.project_id > 0);
  return envMissing || projectMissing;
}

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
  const hasManualActions = Boolean(
    actions &&
      (actions.canApprove ||
        actions.canSchedule ||
        actions.canImplement ||
        actions.canResolve ||
        actions.canClose ||
        actions.canFail ||
        actions.canCancel ||
        actions.canReopen ||
        actions.canRollout),
  );

  const scopeIncomplete = changeScopeIncomplete(item);

  return (
    <div className="chg-detail">
      <section className="work-board">
        {scopeIncomplete ? (
          <div className="alert alert-warning" role="status">
            Scope incomplete. The recorded project, environment, or both are missing. The title and description are not treated as the scope. Schedule and implement stay unavailable until both are recorded.
          </div>
        ) : null}
        {item.summary?.trim() ? <p className="chg-detail__prose" style={{ marginTop: 0 }}>{item.summary}</p> : null}
        <div className="request-facts">
          <DetailField label="Service" value={item.service || '—'} />
          <DetailField label="Environment" value={scopeIncomplete && (!(item.environment || '').trim() || item.environment === 'unspecified' || item.environment === 'unknown') ? 'Scope incomplete' : item.environment || '—'} />
          <DetailField label="Type" value={item.change_type || '—'} />
          <DetailField label="Priority" value={item.priority || 'medium'} />
          <DetailField label="Risk" value={item.risk_level || 'medium'} />
          <DetailField label="Assigned to" value={item.assignee_username || '—'} />
          <DetailField label="Author" value={item.author || '—'} />
          <DetailField label="CAB" value={item.cab_status || 'not required'} />
          <DetailField
            label="Project"
            value={item.project_name ? `${item.project_name}${item.project_code ? ` (${item.project_code})` : ''}` : scopeIncomplete ? 'Scope incomplete' : '—'}
          />
          <DetailField label="Planned start" value={formatWhen(item.cab_window_start)} />
          <DetailField label="Planned end" value={formatWhen(item.cab_window_end)} />
          <DetailField label="Repo" value={item.repo || '—'} />
          <DetailField label="SHA" value={item.sha ? item.sha.slice(0, 12) : '—'} />
          <DetailField label="Pull request" value={item.pr_number ? `#${item.pr_number}` : 'None'} />
          <DetailField
            label="Watch window"
            value={`${item.watch_minutes} min${item.watch_until ? ` · until ${formatWhen(item.watch_until)}` : ''}`}
          />
          <DetailField label="Linked incidents" value={String(item.linked_incidents || 0)} />
          <DetailField label="Created" value={formatWhen(item.created_at)} />
        </div>
        {item.impact ? <p className="chg-detail__prose"><strong>Impact. </strong>{item.impact}</p> : null}
        {item.backout_plan ? <p className="chg-detail__prose"><strong>Backout. </strong>{item.backout_plan}</p> : null}
        {(item.pr_url || item.pipeline_url) ? (
          <p className="chg-detail__links">
            {item.pr_url ? (
              <a href={item.pr_url} target="_blank" rel="noreferrer">Pull request</a>
            ) : null}
            {item.pr_url && item.pipeline_url ? ' · ' : null}
            {item.pipeline_url ? (
              <a href={item.pipeline_url} target="_blank" rel="noreferrer">Pipeline</a>
            ) : null}
          </p>
        ) : null}
      </section>

      <section className="work-board chg-detail__lifecycle">
        <div className="chg-detail__lifecycle-head">
          <div>
            <h2 className="chg-detail__section-title">Lifecycle</h2>
            <p className="chg-detail__hint">Manual path: Approve → Schedule → Implement → Close. CI can also advance status after deploy.</p>
          </div>
        </div>
        <ol className="chg-lifecycle" aria-label="Change lifecycle">
          {LIFECYCLE_STEPS.map((step, index) => {
            const done = stepIdx >= 0 && index < stepIdx;
            const current = stepIdx === index;
            const authorizedDone = step.key === 'authorized' && (item.cab_status === 'approved' || stepIdx > 1);
            const isDone = step.key === 'authorized' ? authorizedDone : done;
            const isCurrent =
              step.key === 'authorized'
                ? item.cab_status === 'pending' ||
                  ((item.cab_status || '') !== 'approved' && normalizeStatus(item.status) === 'new')
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

      {hasManualActions ? (
        <section className="work-board chg-detail__actions">
          <h2 className="chg-detail__section-title">Manual actions</h2>
          <p className="chg-detail__hint">Approval records the decision. It does not deploy or execute the change. A material edit after approval invalidates that approval.</p>
          <div className="chg-detail__action-row">
            {actions?.canApprove ? (
              <button type="button" className="btn btn-primary" disabled={!!acting} onClick={actions.onApprove}>
                {acting === 'approve' ? 'Approving…' : 'Approve request'}
              </button>
            ) : null}
            {actions?.canSchedule ? (
              <button type="button" className="btn btn-primary" disabled={!!acting} onClick={actions.onSchedule}>
                {acting === 'schedule' ? 'Scheduling…' : 'Schedule'}
              </button>
            ) : null}
            {actions?.canImplement ? (
              <button type="button" className="btn btn-primary" disabled={!!acting} onClick={actions.onImplement}>
                {acting === 'implement' ? 'Starting…' : 'Implement'}
              </button>
            ) : null}
            {actions?.canResolve && !finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onResolve}>
                {acting === 'resolve' ? 'Resolving…' : 'Resolve'}
              </button>
            ) : null}
            {actions?.canClose && !finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onClose}>
                {acting === 'close' ? 'Closing…' : 'Close'}
              </button>
            ) : null}
            {actions?.canCancel && !finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onCancel}>
                {acting === 'cancel' ? 'Cancelling…' : 'Cancel'}
              </button>
            ) : null}
            {actions?.canFail && !finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onFail}>
                {acting === 'fail' ? 'Updating…' : 'Mark failed'}
              </button>
            ) : null}
            {actions?.canReopen && finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={actions.onReopen}>
                {acting === 'reopen' ? 'Reopening…' : 'Reopen'}
              </button>
            ) : null}
          </div>
          {actions?.canRollout && !finished ? (
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

    </div>
  );
}

export function buildChangeDetailActions(
  item: ChangeDetailModel,
  opts: {
    portal: 'devops' | 'admin' | 'user';
    isManager?: boolean;
    canAuthorize?: boolean;
    finished: boolean;
  },
): ChangeDetailActions {
  const status = normalizeStatus(item.status);
  const cab = (item.cab_status || '').toLowerCase();
  const canAuthorize =
    opts.canAuthorize ?? (opts.portal === 'admin' || opts.portal === 'devops' || Boolean(opts.isManager));
  const canOperate =
    opts.portal === 'admin' ||
    (opts.portal === 'devops' && Boolean(opts.isManager)) ||
    (opts.portal === 'user' && Boolean(opts.isManager || opts.canAuthorize));
  const open = !opts.finished;
  const scoped = !changeScopeIncomplete(item);
  return {
    canApprove: canAuthorize && open && status === 'new' && cab !== 'approved',
    canSchedule: canOperate && open && scoped && status === 'new' && cab !== 'pending',
    canImplement: canOperate && open && scoped && status === 'scheduled',
    canResolve: canOperate && open && status !== 'resolved',
    canClose: canOperate && open,
    canFail: canOperate && open,
    canCancel: canOperate && open,
    canReopen: canOperate && opts.finished,
    canRollout: opts.portal === 'devops' && canOperate && open,
  };
}
