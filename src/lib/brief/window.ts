export type BriefWindow = { isoWeek: string; start: Date; end: Date; label: string };

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function isoWeekOf(date: Date): string {
  const d = startOfUtcDay(date);
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function shortDay(d: Date): string {
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function dayMonth(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// The latest complete Mon-Fri announcement week: `end` is the most recent Saturday 00:00 UTC at or
// before `now`, `start` the Monday 00:00 UTC before it.
export function briefWindow(now: Date): BriefWindow {
  const today = startOfUtcDay(now);
  const sinceSaturday = (today.getUTCDay() + 1) % 7;
  const end = new Date(today.getTime() - sinceSaturday * DAY_MS);
  const start = new Date(end.getTime() - 5 * DAY_MS);
  const friday = new Date(end.getTime() - DAY_MS);
  return { isoWeek: isoWeekOf(start), start, end, label: `${shortDay(start)} – ${shortDay(friday)}` };
}

// The window for an ISO week id such as 2026-W41.
export function windowForIsoWeek(isoWeek: string): BriefWindow | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!match) return null;
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS + (Number(match[2]) - 1) * 7 * DAY_MS);
  const window = briefWindow(new Date(monday.getTime() + 5 * DAY_MS));
  return window.isoWeek === isoWeek ? window : null;
}
