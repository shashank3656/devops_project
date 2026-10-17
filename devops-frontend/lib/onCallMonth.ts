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
