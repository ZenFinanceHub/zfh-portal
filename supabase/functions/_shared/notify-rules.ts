// The notification rules, as plain functions with no imports and no database access.
// send-notifications (Deno) uses them to decide what is due; the Playwright tests import this same file,
// so the rules in CLAUDE.md are tested as written. Times are Europe/London throughout.

export type Settings = {
  staff_batch_minutes: number;
  client_bundle_minutes: number;
  quiet_start: string; // "18:00:00": quiet hours run overnight, from here ...
  quiet_end: string; //   ... to here the next morning
  urgent_approvals: boolean;
  urgent_lender_consents: boolean;
  urgent_finance_activity: boolean;
  digest_enabled: boolean;
  digest_time: string;
  fallback_email: string;
  reminders_enabled: boolean;
  reminder_days: number[];
  bank_holiday_region: string;
};

/** Bank holidays for the chosen region, as "YYYY-MM-DD". */
export type Holidays = ReadonlySet<string>;

// ── Time ─────────────────────────────────────────────────────
const londonFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The London calendar date ("YYYY-MM-DD") and minutes since midnight at an instant. */
export function londonParts(d: Date): { date: string; minutes: number } {
  const p: Record<string, string> = {};
  for (const part of londonFormat.formatToParts(d)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** "08:00" or "08:00:00" → 480. */
export function toMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

function dateMillis(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, n: number): string {
  return new Date(dateMillis(date) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from one calendar date to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateMillis(to) - dateMillis(from)) / 86_400_000);
}

/** The instant at which the London clock shows `minutes` past midnight on `date` (clock changes handled). */
export function localToUtc(date: string, minutes: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wanted = Date.UTC(y, m - 1, d, 0, minutes);
  let t = wanted;
  for (let i = 0; i < 2; i++) {
    const p = londonParts(new Date(t));
    const [py, pm, pd] = p.date.split("-").map(Number);
    t += wanted - Date.UTC(py, pm - 1, pd, 0, p.minutes);
  }
  return new Date(t);
}

export function isWorkingDay(date: string, holidays: Holidays): boolean {
  const weekday = new Date(dateMillis(date)).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !holidays.has(date);
}

/** Quiet: any time on a weekend or bank holiday, and the overnight window on other days. */
export function isQuiet(d: Date, s: Settings, holidays: Holidays): boolean {
  const { date, minutes } = londonParts(d);
  if (!isWorkingDay(date, holidays)) return true;
  return minutes >= toMinutes(s.quiet_start) || minutes < toMinutes(s.quiet_end);
}

/** When the current working period began (e.g. 08:00 today), or null if it is quiet right now. */
export function currentPeriodStart(now: Date, s: Settings, holidays: Holidays): Date | null {
  if (isQuiet(now, s, holidays)) return null;
  const minute = 60_000;
  const floor = Math.floor(now.getTime() / minute) * minute;
  const limit = floor - 10 * 86_400_000;
  let t = floor;
  while (t > limit && !isQuiet(new Date(t), s, holidays)) t -= 5 * minute; // coarse: find a quiet moment
  if (t <= limit) return new Date(limit);
  while (t < floor && isQuiet(new Date(t), s, holidays)) t += minute; // fine: first quiet-free minute
  return new Date(t);
}

// ── Staff alerts ─────────────────────────────────────────────
export type StaffEvent = {
  id: number;
  client_id: string;
  job_id: string;
  occurred_at: string;
  urgent_reason: string | null;
  /** Who it goes to: a staff member's id, or "fallback". */
  recipient: string;
};

export type StaffSend = {
  kind: "urgent" | "batch" | "held";
  recipient: string;
  /** Set for urgent and batch sends (one client); null for the combined held-alert email. */
  clientId: string | null;
  eventIds: number[];
};

export function isUrgent(reason: string | null, s: Settings): boolean {
  if (reason === "approval") return s.urgent_approvals;
  if (reason === "lender_share") return s.urgent_lender_consents;
  if (reason === "finance") return s.urgent_finance_activity;
  return false;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * What to send to staff right now.
 *  - urgent items go at once, even in quiet hours (one email per client per recipient);
 *  - everything else waits until the client has been quiet for the batch delay (one email per client);
 *  - nothing else goes in quiet hours; anything raised before the current working period began is held and
 *    goes out together, in one email per recipient, as soon as the working period starts.
 */
export function planStaffSends(events: StaffEvent[], now: Date, s: Settings, holidays: Holidays): StaffSend[] {
  const sends: StaffSend[] = [];
  const urgent = events.filter((e) => isUrgent(e.urgent_reason, s));
  const normal = events.filter((e) => !isUrgent(e.urgent_reason, s));

  for (const group of groupBy(urgent, (e) => `${e.recipient}|${e.client_id}`).values()) {
    sends.push({
      kind: "urgent",
      recipient: group[0].recipient,
      clientId: group[0].client_id,
      eventIds: group.map((e) => e.id).sort((a, b) => a - b),
    });
  }

  const start = currentPeriodStart(now, s, holidays);
  if (!start) return sends; // quiet hours: hold the rest

  const held = normal.filter((e) => Date.parse(e.occurred_at) < start.getTime());
  const fresh = normal.filter((e) => Date.parse(e.occurred_at) >= start.getTime());

  for (const group of groupBy(held, (e) => e.recipient).values()) {
    sends.push({
      kind: "held",
      recipient: group[0].recipient,
      clientId: null,
      eventIds: group.map((e) => e.id).sort((a, b) => a - b),
    });
  }

  for (const group of groupBy(fresh, (e) => `${e.recipient}|${e.client_id}`).values()) {
    const last = Math.max(...group.map((e) => Date.parse(e.occurred_at)));
    if (now.getTime() >= last + s.staff_batch_minutes * 60_000) {
      sends.push({
        kind: "batch",
        recipient: group[0].recipient,
        clientId: group[0].client_id,
        eventIds: group.map((e) => e.id).sort((a, b) => a - b),
      });
    }
  }
  return sends;
}

export type StaffProfile = { id: string; email: string; is_staff: boolean; staff_role: string | null; staff_areas: string[] };

/** The job's assigned staff member if they can work in its area, otherwise the fallback address. */
export function routeStaff(
  job: { area: string },
  assignee: StaffProfile | null | undefined,
  s: Settings,
): { key: string; email: string } {
  if (assignee?.is_staff && (assignee.staff_role === "admin" || assignee.staff_areas.includes(job.area))) {
    return { key: assignee.id, email: assignee.email };
  }
  return { key: "fallback", email: s.fallback_email };
}

// ── Client emails ────────────────────────────────────────────
export type ClientEvent = { id: number; job_id: string; occurred_at: string };

/** Events on one job that are ready to go: the last one is at least the bundle delay old. */
export function planClientBundles(events: ClientEvent[], now: Date, s: Settings): { jobId: string; eventIds: number[] }[] {
  const out: { jobId: string; eventIds: number[] }[] = [];
  for (const group of groupBy(events, (e) => e.job_id).values()) {
    const last = Math.max(...group.map((e) => Date.parse(e.occurred_at)));
    if (now.getTime() >= last + s.client_bundle_minutes * 60_000) {
      out.push({ jobId: group[0].job_id, eventIds: group.map((e) => e.id).sort((a, b) => a - b) });
    }
  }
  return out;
}

/** Overdue reminders go once; this is how far back we look so a weekend or bank holiday cannot make us miss one. */
export const OVERDUE_LOOKBACK_DAYS = 7;

/** Is a request with this due date part of today's reminder? "upcoming" = due in N days; "overdue" = just passed. */
export function reminderKind(dueDate: string, today: string, s: Settings): "upcoming" | "overdue" | null {
  const days = daysBetween(today, dueDate);
  if (s.reminder_days.includes(days)) return "upcoming";
  if (days < 0 && days >= -OVERDUE_LOOKBACK_DAYS) return "overdue";
  return null;
}

/** Reminders go out on working days, once the working day has started. */
export function remindersDue(now: Date, s: Settings, holidays: Holidays): boolean {
  if (!s.reminders_enabled) return false;
  const { date, minutes } = londonParts(now);
  return isWorkingDay(date, holidays) && !isQuiet(now, s, holidays) && minutes >= toMinutes(s.quiet_end);
}

/** The digest goes on working days from the digest time. */
export function digestDue(now: Date, s: Settings, holidays: Holidays): boolean {
  if (!s.digest_enabled) return false;
  const { date, minutes } = londonParts(now);
  return isWorkingDay(date, holidays) && minutes >= toMinutes(s.digest_time);
}
