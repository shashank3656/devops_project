export type RecordPrefix = 'REQ' | 'CHG' | 'INC' | 'PRB';

export function recordReference(prefix: RecordPrefix, id: number): string {
  const safe = Number.isFinite(id) && id > 0 ? Math.trunc(id) : 0;
  return `${prefix}${String(safe).padStart(7, '0')}`;
}

/** Accepts REQ0000013, req13, or 13 and returns the numeric id the queue API expects. */
export function requestIdFromQuery(value: string): string {
  const text = value.trim();
  const match = /^(?:req|acc|chg|inc|prb)?0*(\d+)$/i.exec(text);
  if (!match) return text;
  const id = Number(match[1]);
  return Number.isFinite(id) ? String(id) : text;
}
