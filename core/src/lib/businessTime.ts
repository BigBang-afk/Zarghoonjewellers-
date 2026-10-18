/**
 * Business-time helpers. Timestamps are stored in UTC; the business time zone
 * (default Asia/Karachi) is used only to interpret "today", quiet hours and
 * staff-entered local times. A customer's own time zone is never assumed.
 */

export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Karachi";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds. */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** A wall-clock time in `timeZone` → the UTC instant. */
export function zonedTimeToUtc(y: number, m: number, d: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  // Re-check once in case the offset differs at the target instant (DST edges).
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

/** "HH:MM" or "HH:MM:SS" → minutes after midnight. */
export function parseClock(value: string): number {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`Invalid time "${value}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface QuietHours {
  enabled: boolean;
  /** Business-local "HH:MM". The window may wrap past midnight (e.g. 21:00–10:00). */
  start: string;
  end: string;
  timezone: string;
}

export function isInQuietHours(date: Date, q: QuietHours): boolean {
  if (!q.enabled) return false;
  const start = parseClock(q.start);
  const end = parseClock(q.end);
  if (start === end) return false;
  const p = zonedParts(date, q.timezone);
  const minute = p.hour * 60 + p.minute;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** The earliest instant ≥ `date` outside quiet hours (business time zone). */
export function nextAllowedTime(date: Date, q: QuietHours): Date {
  if (!isInQuietHours(date, q)) return date;
  const end = parseClock(q.end);
  const p = zonedParts(date, q.timezone);
  const minute = p.hour * 60 + p.minute;
  // Quiet end is later today, or (window wrapped past midnight and we're before midnight) tomorrow.
  const endToday = zonedTimeToUtc(p.year, p.month, p.day, Math.floor(end / 60), end % 60, q.timezone);
  if (minute < end) return endToday;
  return new Date(endToday.getTime() + 24 * 3_600_000);
}

/** Start of the business day containing `date`, as a UTC instant. */
export function startOfBusinessDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}
