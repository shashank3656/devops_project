const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(iso?: string, now: number = Date.now()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE);
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Named zone and UTC offset for the browser clock, such as Asia/Kolkata · UTC+05:30. */
export function browserTimeZoneLabel(date: Date = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${zone} · UTC${sign}${hours}:${minutes}`;
}

function parseDisplayDate(value?: string | null): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar day for due dates and expiries: 26 Sept 2026. */
export function formatCalendarDate(value?: string | null, empty = '—'): string {
  const date = parseDisplayDate(value);
  if (!date) return empty;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Operational timestamp with the short zone name: 26 Sept 2026, 10:14 am GMT+5:30 (Asia/Kolkata). */
export function formatOperationalTime(value?: string | null, empty = '—'): string {
  const date = parseDisplayDate(value);
  if (!date) return empty;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  // dateStyle/timeStyle cannot be combined with timeZoneName in this Chromium.
  const exact = date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return zone ? `${exact} (${zone})` : exact;
}

/** Exact local date, time, and timezone for a hover title. */
export function exactTimeTitle(iso?: string): string {
  if (!iso) return '';
  const exact = formatOperationalTime(iso, '');
  return exact;
}

export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function initialsFor(name?: string): string {
  const parts = (name || '').trim().split(/[\s._@-]+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
