export type TrackerState = 'done' | 'current' | 'waiting' | 'failed' | 'cancelled';

export type TrackerStage = {
  id: 'submitted' | 'approvals' | 'pr' | 'pipeline' | 'verification';
  label: string;
  state: TrackerState;
  who: string;
  detail: string;
};

export type TrackerEvidence = { label: string; value: string; href?: string };

export type TrackerModel = {
  stages: TrackerStage[];
  blockerTitle: string;
  blockerWho: string;
  blockerNext: string;
  evidence: TrackerEvidence[];
  verification: ResourceVerification;
  provisioned: boolean;
};

export type TrackerInput = {
  status?: string;
  team?: string;
  owner?: string;
  prUrl?: string;
  pipelineUrl?: string;
  pipelineStatus?: string;
  pipelineLabel?: string;
  ciResult?: string;
  sha?: string;
  imageDigest?: string;
  applicationId?: string;
  promoteState?: string;
  rejectReason?: string;
  resourceId?: string;
  verificationCheck?: string;
  verificationResult?: string;
  verificationAt?: string;
  verificationHref?: string;
};

export type ResourceVerification = {
  recorded: boolean;
  resourceId: string;
  check: string;
  result: string;
  at: string;
  href?: string;
};

const NOT_RECORDED = 'Not recorded';

function resourceVerification(input: TrackerInput): ResourceVerification {
  const resourceId = clean(input.resourceId);
  const check = clean(input.verificationCheck);
  const result = clean(input.verificationResult);
  const at = clean(input.verificationAt);
  const href = clean(input.verificationHref);
  const recorded = Boolean(resourceId && check && result && at);
  return {
    recorded,
    resourceId: resourceId || NOT_RECORDED,
    check: check || NOT_RECORDED,
    result: recorded ? result : NOT_RECORDED,
    at: at || 'Unknown',
    href: recorded && href ? href : undefined,
  };
}

const APPROVAL_WAITING = new Set([
  'pending_user_manager_approval',
  'pending_devops_approval',
  'pending_approval',
]);

function clean(value?: string): string {
  return (value || '').trim();
}

const ACTION_NAMES: Record<string, string> = {
  request_approve: 'Approved the request',
  request_reject: 'Rejected the request',
  request_promote: 'Opened the next-environment request',
  request_ci_update: 'Recorded a pipeline update',
  request_completed_by_pipeline: 'Pipeline marked the request complete',
  request_verification_missing: 'Withheld completion; resource verification is missing',
  request_incident_close: 'Closed the incident',
  request_incident_cancel: 'Cancelled the incident',
  request_incident_update: 'Updated the incident',
  request_incident_upsert: 'Saved the incident',
  deployment_gate_approve: 'Approved the promotion gate',
  deployment_gate_revoke: 'Revoked the promotion gate',
  access_file_requested: 'Requested the access file',
  provisioned: 'Recorded the access grant',
  access_request_closed: 'Closed the access request',
  rejected: 'Rejected the access request',
  evaluated: 'Checked the access request',
};

export function publicDetail(value?: string): string {
  const text = clean(value);
  if (!text) return '';
  if (/password|secret|token|bearer|\beyJ/i.test(text)) return 'Details withheld.';
  return ACTION_NAMES[text] || text.replaceAll('_', ' ');
}

export function dedupeActivity<T extends { id?: number; action: string; details?: string; created_at?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const sticky = item.action === 'request_ci_update' || item.action === 'request_completed_by_pipeline' || item.action === 'request_verification_missing';
    const key = sticky
      ? `${item.action}|${item.details || ''}`
      : `${item.id || ''}|${item.action}|${item.details || ''}|${item.created_at || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildRequestTracker(input: TrackerInput): TrackerModel {
  const status = clean(input.status).toLowerCase();
  const owner = clean(input.owner) || clean(input.team) || 'Unassigned';
  const pipelineStatus = clean(input.pipelineStatus).toLowerCase();
  const cancelled = status === 'cancelled' || /cancel/i.test(clean(input.rejectReason));
  const failed = pipelineStatus === 'failed' || status === 'failed' || (status === 'rejected' && !cancelled);
  const approvalDone = !APPROVAL_WAITING.has(status) && status !== 'draft' && status !== 'rejected' && status !== 'cancelled';
  const hasPR = Boolean(clean(input.prUrl));
  const verification = resourceVerification(input);
  const verified = verification.recorded;
  const provisioned = pipelineStatus === 'success' && verified;

  const stages: TrackerStage[] = [
    {
      id: 'submitted',
      label: 'Submitted',
      state: status === 'draft' ? 'current' : 'done',
      who: owner,
      detail: status === 'draft' ? 'Still a draft.' : 'The request is on record.',
    },
    {
      id: 'approvals',
      label: 'Required approvals',
      state: cancelled ? 'cancelled' : status === 'rejected' ? 'failed' : approvalDone ? 'done' : APPROVAL_WAITING.has(status) || status === 'draft' ? 'current' : 'waiting',
      who: status === 'pending_user_manager_approval' ? 'Manager' : 'DevOps reviewer',
      detail: cancelled ? 'Cancelled before the resource was provisioned.' : approvalDone ? 'Approval is finished. The resource is not provisioned by approval alone.' : 'Waiting for an approval decision.',
    },
    {
      id: 'pr',
      label: 'PR',
      state: cancelled ? 'cancelled' : hasPR ? 'done' : approvalDone ? 'current' : 'waiting',
      who: 'GitHub',
      detail: cancelled ? 'Cancelled.' : hasPR ? 'Pull request is linked.' : 'No pull request is linked yet.',
    },
    {
      id: 'pipeline',
      label: 'Pipeline',
      state: cancelled ? 'cancelled' : failed && pipelineStatus === 'failed' ? 'failed' : pipelineStatus === 'success' ? 'done' : pipelineStatus === 'running' ? 'current' : approvalDone ? 'waiting' : 'waiting',
      who: 'Pipeline',
      detail: cancelled ? 'Cancelled.' : failed && pipelineStatus === 'failed'
        ? `Pipeline failed. ${publicDetail(input.ciResult || input.pipelineLabel) || 'No reason was recorded.'}`
        : clean(input.pipelineLabel) || 'No pipeline result yet.',
    },
    {
      id: 'verification',
      label: 'Resource verification',
      state: cancelled ? 'cancelled' : verified ? 'done' : 'waiting',
      who: 'OpsTrellis',
      detail: cancelled
        ? 'Cancelled.'
        : verified
          ? `${verification.check}: ${verification.result}.`
          : NOT_RECORDED,
    },
  ];

  let blockerTitle = 'Nothing is blocking the recorded stage.';
  let blockerWho = owner;
  let blockerNext = 'Open the evidence below before treating this as provisioned.';
  if (cancelled) {
    blockerTitle = 'This request was cancelled.';
    blockerWho = owner;
    blockerNext = 'Raise a new request if the work should continue. This record stays cancelled.';
  } else if (status === 'rejected') {
    blockerTitle = 'Approval was rejected.';
    blockerWho = 'DevOps reviewer';
    blockerNext = 'Raise again from this request. The retry stays tied to a new draft, and this decision remains in the activity.';
  } else if (APPROVAL_WAITING.has(status)) {
    blockerTitle = 'Approval is waiting. Nothing has been provisioned.';
    blockerWho = status === 'pending_user_manager_approval' ? 'Manager' : 'DevOps reviewer';
    blockerNext = 'The next permitted action is the approval decision.';
  } else if (pipelineStatus === 'failed') {
    blockerTitle = 'The pipeline failed. Approval does not mean the resource exists.';
    blockerWho = 'Pipeline';
    blockerNext = 'Retry the pipeline for this same request. A retry stays on this request.';
  } else if (status === 'completed' && !verified) {
    blockerTitle = NOT_RECORDED;
    blockerWho = 'DevOps reviewer';
    blockerNext = 'A pull request, pipeline result, or application identifier is not a resource check. Record the resource, the check, the result, the time, and the evidence.';
  } else if (!provisioned) {
    blockerTitle = 'Approved work is not provisioned yet.';
    blockerWho = hasPR ? 'Pipeline' : 'GitHub';
    blockerNext = hasPR ? 'Wait for the pipeline result, then verify the resource.' : 'Open or link the pull request.';
  } else {
    blockerTitle = `${verification.check}: ${verification.result}.`;
    blockerWho = 'OpsTrellis';
    blockerNext = clean(input.promoteState) || 'No further action is required on this request.';
  }

  const evidence: TrackerEvidence[] = [
    { label: 'Pull request', value: clean(input.prUrl) || 'Not linked', href: clean(input.prUrl) || undefined },
    { label: 'Pipeline', value: clean(input.pipelineUrl) || clean(input.pipelineLabel) || 'Not linked', href: clean(input.pipelineUrl) || undefined },
    { label: 'Commit', value: clean(input.sha) || 'Not recorded' },
    { label: 'Image digest', value: clean(input.imageDigest) || 'Not recorded' },
    { label: 'Application', value: clean(input.applicationId) || 'Not recorded' },
  ];

  return { stages, blockerTitle, blockerWho, blockerNext, evidence, verification, provisioned };
}
