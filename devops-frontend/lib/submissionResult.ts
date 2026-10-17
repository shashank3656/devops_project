const KEY = 'opstrellis-submission-result';

export interface SubmissionResult {
  kind: string;
  id: string;
  status: string;
  next: string;
}

export function saveSubmissionResult(result: SubmissionResult) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(KEY, JSON.stringify(result));
}

export function readSubmissionResult(): SubmissionResult | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SubmissionResult;
    if (!data || typeof data.id !== 'string' || typeof data.kind !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}
