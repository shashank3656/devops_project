const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ANCHOR = Date.UTC(2024, 0, 1, 12, 0, 0);

export interface OnCallPerson {
  userId: number;
  name: string;
}

export interface OnCallDay {
  date: string;
  label: string;
  weekday: string;
  userId: number;
  name: string;
  today: boolean;
}

export function monthDays(monthValue: string, timeZone: string, people: OnCallPerson[]): OnCallDay[] {
  const [yearText, monthText] = monthValue.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return [];
  const last = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
  const today = zonedParts(new Date(), timeZone);
  const todayKey = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  const days: OnCallDay[] = [];
  for (let day = 1; day <= last; day += 1) {
    const date = zonedDate(year, month, day);
    const parts = zonedParts(date, timeZone);
    const person = people.length ? people[(day - 1) % people.length] : null;
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    days.push({
      date: key,
      label: formatDay(parts),
      weekday: parts.weekday || 'Unknown',
      userId: person?.userId || 0,
      name: person?.name || 'Unknown',
      today: key === todayKey,
    });
  }
  return days;
}

export interface OnCallWeek {
  index: number;
  range: string;
  name: string;
  current: boolean;
}

function zonedDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday || '',
  };
}

function formatDay(parts: { day: number; month: number }): string {
  return `${parts.day} ${MONTHS[parts.month - 1] || 'Unknown'}`;
}

export function addCalendarDays(dateKey: string, days: number): string {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return dateKey;
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function nextDateKeys(fromKey: string, count: number): string[] {
  const length = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Array.from({ length }, (_, index) => addCalendarDays(fromKey, index));
}

export function nextSevenDateKeys(fromKey: string): string[] {
  return nextDateKeys(fromKey, 7);
}

function dateParts(dateKey: string): { year: number; month: number; day: number } | null {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

export function formatCompactDay(dateKey: string): string {
  const parts = dateParts(dateKey);
  if (!parts) return dateKey;
  return `${parts.day} ${MONTHS[parts.month - 1] || 'Unknown'}`;
}

export function formatDateRange(startKey: string, endKey: string): string {
  const start = dateParts(startKey);
  const end = dateParts(endKey);
  if (!start || !end) return `${startKey}–${endKey}`;
  const startMonth = MONTHS[start.month - 1] || 'Unknown';
  const endMonth = MONTHS[end.month - 1] || 'Unknown';
  if (start.year !== end.year) return `${start.day} ${startMonth} ${start.year}–${end.day} ${endMonth} ${end.year}`;
  if (start.month === end.month && start.day === end.day) return `${start.day} ${startMonth}`;
  return `${start.day} ${startMonth}–${end.day} ${endMonth}`;
}

export function formatDateList(dateKeys: string[]): string {
  const unique = Array.from(new Set(dateKeys)).sort();
  if (!unique.length) return '';
  const spans: string[][] = [];
  unique.forEach((key) => {
    const last = spans[spans.length - 1];
    if (last && addCalendarDays(last[last.length - 1], 1) === key) last.push(key);
    else spans.push([key]);
  });
  return spans.map((span) => (span.length === 1 ? formatCompactDay(span[0]) : formatDateRange(span[0], span[span.length - 1]))).join(', ');
}

export function weekdayShort(dateKey: string): string {
  const parts = dateParts(dateKey);
  if (!parts) return '';
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
  return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][weekday] || '';
}

export function weekdayLong(dateKey: string): string {
  const parts = dateParts(dateKey);
  if (!parts) return '';
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][weekday] || '';
}

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatLongDay(dateKey: string): string {
  const parts = dateParts(dateKey);
  if (!parts) return dateKey;
  return `${parts.day} ${LONG_MONTHS[parts.month - 1] || 'Unknown'}`;
}

export function onCallTeamHref(projectId: number, teamId: number, date?: string, timezone?: string): string {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (timezone) params.set('timezone', timezone);
  const query = params.toString();
  return `/on-call/project/${projectId}/team/${teamId}${query ? `?${query}` : ''}`;
}

export function onCallRotationHref(projectId: number, teamId: number, options?: { scheduleId?: number; date?: string; timezone?: string; intent?: 'assign' | 'recurring' }): string {
  const params = new URLSearchParams();
  if (options?.date) params.set('date', options.date);
  if (options?.timezone) params.set('timezone', options.timezone);
  if (options?.intent) params.set('intent', options.intent);
  if (options?.scheduleId && options.scheduleId > 0) {
    const query = params.toString();
    return `/on-call/${options.scheduleId}${query ? `?${query}` : ''}`;
  }
  if (projectId > 0) params.set('project_id', String(projectId));
  if (teamId > 0) params.set('team_id', String(teamId));
  const query = params.toString();
  return `/on-call/new${query ? `?${query}` : ''}`;
}

function timezonePart(timeZone: string, name: 'short' | 'shortOffset' | 'longOffset', at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', timeZoneName: name }).formatToParts(at);
    return parts.find((part) => part.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

const ZONE_ABBREV: Record<string, string> = {
  UTC: 'UTC',
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'Europe/London': 'UK',
  'Europe/Berlin': 'CET',
  'Asia/Kolkata': 'IST',
  'Asia/Singapore': 'SGT',
  'Asia/Tokyo': 'JST',
  'Australia/Sydney': 'AET',
};

export function timezoneAbbrev(timeZone: string, at = new Date()): string {
  if (ZONE_ABBREV[timeZone]) return ZONE_ABBREV[timeZone];
  const value = timezonePart(timeZone, 'short', at);
  if (!value || value.startsWith('GMT') || value.startsWith('UTC')) return timeZone === 'UTC' ? 'UTC' : timezoneUtcOffset(timeZone, at);
  return value;
}

export function timezoneUtcOffset(timeZone: string, at = new Date()): string {
  const raw = (timezonePart(timeZone, 'longOffset', at) || timezonePart(timeZone, 'shortOffset', at)).replace(/^GMT/, 'UTC') || 'UTC';
  const match = raw.match(/^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return raw === 'UTC' ? 'UTC+00:00' : raw;
  return `UTC${match[1]}${match[2].padStart(2, '0')}:${(match[3] || '00').padStart(2, '0')}`;
}

export function timezoneCompactLabel(timeZone: string, at = new Date()): string {
  if (timeZone === 'UTC') return 'UTC';
  const abbrev = timezoneAbbrev(timeZone, at);
  const offset = timezoneUtcOffset(timeZone, at).replace(/^UTC/, '');
  if (!abbrev) return offset || 'Unknown';
  return `${abbrev} ${offset}`;
}

export function currentMonth(timeZone: string): string {
  const parts = zonedParts(new Date(), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

export function shiftMonth(value: string, delta: number): string {
  const [yearText, monthText] = value.split('-');
  const cursor = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1, 12, 0, 0));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthTitle(value: string): string {
  const [yearText, monthText] = value.split('-');
  const month = Number(monthText);
  return `${MONTHS[month - 1] || 'Unknown'} ${yearText || 'Unknown'}`;
}

export function monthWeeks(monthValue: string, timeZone: string, names: string[]): OnCallWeek[] {
  const [yearText, monthText] = monthValue.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return [];
  const first = zonedDate(year, month, 1);
  const firstParts = zonedParts(first, timeZone);
  const monday = addDays(first, -(WEEKDAY_INDEX[firstParts.weekday] ?? 0));
  const today = zonedParts(new Date(), timeZone);
  const todayKey = today.year * 10000 + today.month * 100 + today.day;
  const weeks: OnCallWeek[] = [];
  let cursor = monday;
  for (let guard = 0; guard < 6; guard += 1) {
    const start = zonedParts(cursor, timeZone);
    const end = zonedParts(addDays(cursor, 6), timeZone);
    const startOrder = start.year * 12 + start.month;
    const endOrder = end.year * 12 + end.month;
    const monthOrder = year * 12 + month;
    if (startOrder > monthOrder) break;
    if (startOrder === monthOrder || endOrder === monthOrder || (startOrder < monthOrder && endOrder > monthOrder)) {
      const weekIndex = Math.round((cursor.getTime() - ANCHOR) / 86400000 / 7);
      const name = names.length ? names[((weekIndex % names.length) + names.length) % names.length] : '';
      const startKey = start.year * 10000 + start.month * 100 + start.day;
      const endKey = end.year * 10000 + end.month * 100 + end.day;
      weeks.push({
        index: weeks.length + 1,
        range: `${formatDay(start)} – ${formatDay(end)}`,
        name: name || 'Unknown',
        current: todayKey >= startKey && todayKey <= endKey,
      });
    }
    cursor = addDays(cursor, 7);
  }
  return weeks;
}
