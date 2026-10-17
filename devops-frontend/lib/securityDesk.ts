export function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

export function coverageStatement(state: string, recorded: number): string {
  const key = (state || 'unknown').trim().toLowerCase();
  if (key === 'partial' || key === 'error' || key === 'unknown' || key === 'failed') {
    return 'Partial, failed, or unknown coverage is not zero risk.';
  }
  if (key === 'queued' || key === 'running') {
    return `Tracked job is ${key}. Coverage stays unknown until it finishes.`;
  }
  if (key === 'completed' && recorded <= 0) {
    return 'The job finished with no recorded checks. That is not zero risk.';
  }
  if (key === 'empty') {
    return 'Empty report. No findings were recorded for this revision.';
  }
  if (key === 'completed') {
    return `${recorded} checks recorded. A completed scan is still not a claim of zero risk outside this scope.`;
  }
  return 'Coverage is unknown. Missing coverage is not zero risk.';
}

export function reportResultLabel(status: number, findingCount: number): string {
  if (status === 0) return 'No report is loaded. This is not an empty report.';
  if (status !== 200) return 'The report failed to load. A failed report is not an empty report.';
  if (findingCount === 0) return 'Empty report. No branch findings were recorded for this revision.';
  return `${findingCount} branch findings. These are not deployed artifact exposure.`;
}

export function canCloseFinding(coverage: string, rescanState: string, latestResult: string): { allowed: boolean; reason: string } {
  const coverageKey = (coverage || 'unknown').toLowerCase();
  const rescan = (rescanState || 'unknown').toLowerCase();
  const latest = (latestResult || 'unknown').toLowerCase();
  if (coverageKey === 'failed' || coverageKey === 'partial' || coverageKey === 'unknown' || latest === 'error' || rescan === 'unknown') {
    return { allowed: false, reason: 'A failed or unknown rescan cannot close this finding.' };
  }
  if (rescan !== 'verified' || latest !== 'pass' || coverageKey !== 'collected') {
    return { allowed: false, reason: 'Close waits for a verified rescan. Fix, deploy, and verification stay separate.' };
  }
  return { allowed: true, reason: 'A verified rescan can close this finding. Closing does not grant cloud access.' };
}

export function nextFindingAction(state: string, coverage: string, rescanState: string, latestResult: string): string {
  if ((state || '').toLowerCase() === 'closed') {
    return 'Closed. A later observation can reopen it. Closure is not cloud access.';
  }
  const gate = canCloseFinding(coverage, rescanState, latestResult);
  if (!gate.allowed) return gate.reason;
  return 'Verified. Close records the decision and does not grant cloud access.';
}
