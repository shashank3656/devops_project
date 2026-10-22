const BUSY = 'The first attempt is still being saved. Your entries are unchanged. Retry in a moment. A second record will not be created.';
const UNKNOWN = 'No response confirmed the save. Your entries are unchanged. Retry uses the same attempt, so a second record is not created if the first one landed.';
const REJECTED = 'This was not accepted. Nothing was created, and your entries are still here.';

export function rememberAttempt(storageKey: string, payload: string): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '') as { key?: string; payload?: string };
    if (saved.payload === payload && saved.key) return saved.key;
  } catch {
    // A broken attempt record starts a new submission.
  }
  const key = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `attempt-${Date.now()}`;
  sessionStorage.setItem(storageKey, JSON.stringify({ key, payload }));
  return key;
}

export function forgetAttempt(storageKey: string) {
  sessionStorage.removeItem(storageKey);
}

export function outcomeForFailedSubmit(status: number, serverMessage: string): { keepAttempt: boolean; message: string } {
  const detail = serverMessage.trim();
  if (status === 409) {
    return { keepAttempt: true, message: detail || BUSY };
  }
  if (status === 0 || status >= 500) {
    return { keepAttempt: true, message: UNKNOWN };
  }
  return { keepAttempt: false, message: detail || REJECTED };
}
