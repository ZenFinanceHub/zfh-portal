import { expect, test, type Page } from "@playwright/test";
import { adminClient, ensureClientOwner, ensureUser, getLocal } from "../../scripts/local-supabase.mjs";
import {
  currentPeriodStart,
  daysBetween,
  digestDue,
  isQuiet,
  isWorkingDay,
  localToUtc,
  planClientBundles,
  planStaffSends,
  reminderKind,
  remindersDue,
  routeStaff,
  type Settings,
  type StaffEvent,
} from "../../supabase/functions/_shared/notify-rules.ts";
import { signInAs, signInAsStaffWithMfa } from "./helpers";

// Notifications. The rules are tested as plain functions, and end to end by running the real send-notifications
// function locally with a set clock. Locally the function returns the emails instead of sending them, so the tests
// can read exactly what would have gone out. Times below are Europe/London (GMT until 29/03/2027, so UTC = London).
test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const admin = adminClient();
const local = getLocal();
const run = Date.now();
let counter = 0;
const uid = () => `${run}-${++counter}`;

const NOTIFY_URL = `${local.apiUrl}/functions/v1/send-notifications`;
const NOTIFY_SECRET = "local-development-only-notify-secret"; // throwaway; supabase/config.toml

type Mail = { to: string; subject: string; html: string; text: string };

/** Runs the notifier with the clock set to `now` (UTC ISO). Returns the emails it would have sent. */
async function notify(now: string, extra: Record<string, unknown> = {}): Promise<Mail[]> {
  const res = await fetch(NOTIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": NOTIFY_SECRET },
    body: JSON.stringify({ mode: "sweep", now, ...extra }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { emails: Mail[] };
  return body.emails;
}

const at = (date: string, hhmm: string) => `${date}T${hhmm}:00Z`;
const TUE = "2026-11-03"; // an ordinary working Tuesday
const to = (mails: Mail[], address: string) => mails.filter((m) => m.to === address);
/** The emails that belong to one test's people (every address in a test ends with its tag). */
const mine = (w: { tag: string }, mails: Mail[]) => mails.filter((m) => m.to.endsWith(`${w.tag}@example.com`));
const everything = (m: Mail) => `${m.subject}\n${m.html}\n${m.text}`;

const DEFAULTS = {
  staff_batch_minutes: 15,
  client_bundle_minutes: 10,
  quiet_start: "18:00",
  quiet_end: "08:00",
  urgent_approvals: true,
  urgent_lender_consents: true,
  urgent_finance_activity: true,
  digest_enabled: true,
  digest_time: "17:00",
  reminders_enabled: true,
  reminder_days: [7, 3, 1],
  bank_holiday_region: "scotland",
};

/** A clean slate: empty queue and log, the default rules, and a fallback address only this test uses. */
async function resetRules(fallback: string, over: Record<string, unknown> = {}) {
  await admin.from("notifications_queue").delete().neq("id", 0);
  await admin.from("notifications_log").delete().neq("id", 0);
  const { error } = await admin
    .from("notification_settings")
    .update({ ...DEFAULTS, fallback_email: fallback, ...over })
    .eq("id", true);
  expect(error).toBeNull();
}

async function staffUser(tag: string, kind: "admin" | "acc" | "fin") {
  const email = `e2e.notify.${kind}.${tag}@example.com`;
  const id = await ensureUser(admin, {
    email,
    staff: true,
    areas: kind === "admin" ? undefined : [kind === "acc" ? "accounting" : "finance"],
  });
  return { email, id };
}

async function world(o: { assigned?: "admin" | "acc" | "fin"; service?: string; settings?: Record<string, unknown> } = {}) {
  const tag = uid();
  const fallback = `e2e.notify.fallback.${tag}@example.com`;
  // The daily digest is off unless a test is about it, so it cannot add emails to other tests.
  await resetRules(fallback, { digest_enabled: false, ...o.settings });

  const ownerEmail = `e2e.notify.owner.${tag}@example.com`;
  const ownerId = await ensureUser(admin, { email: ownerEmail });
  const clientName = `Alpha ${tag} Ltd`;
  const clientId = await ensureClientOwner(admin, ownerId, clientName);

  const contributorEmail = `e2e.notify.contributor.${tag}@example.com`;
  const contributorId = await ensureUser(admin, { email: contributorEmail });
  const bystanderEmail = `e2e.notify.bystander.${tag}@example.com`;
  const bystanderId = await ensureUser(admin, { email: bystanderEmail });
  await admin.from("client_contacts").upsert([
    { client_id: clientId, profile_id: contributorId, role: "contributor" },
    { client_id: clientId, profile_id: bystanderId, role: "contributor" },
  ]);

  const staff = o.assigned ? await staffUser(tag, o.assigned) : null;
  const jobTitle = `Year-end ${tag}`;
  const { data: job } = await admin
    .from("jobs")
    .insert({ client_id: clientId, title: jobTitle, service: o.service ?? "year_end", assigned_to: staff?.id ?? null })
    .select("id")
    .single();
  // The contributor is on this job; the bystander is a contact of the client but not on the job.
  await admin.from("job_contacts").insert({ job_id: job!.id, profile_id: contributorId });

  return {
    tag, fallback, ownerEmail, ownerId, contributorEmail, contributorId, bystanderEmail,
    clientId, clientName, jobId: job!.id as string, jobTitle, staff,
  };
}
type World = Awaited<ReturnType<typeof world>>;

type Ev = {
  audience?: "staff" | "client";
  event: "request_created" | "item_submitted" | "approval" | "consent" | "client_message" | "staff_message";
  at: string;
  kind?: string;
  urgent?: "approval" | "lender_share" | "finance";
  job?: string;
  client?: string;
  request?: string;
  state?: "pending" | "sent";
};
async function queue(w: World, e: Ev) {
  const { error } = await admin.from("notifications_queue").insert({
    audience: e.audience ?? (e.event === "request_created" || e.event === "staff_message" ? "client" : "staff"),
    event: e.event,
    client_id: e.client ?? w.clientId,
    job_id: e.job ?? w.jobId,
    request_id: e.request ?? null,
    request_kind: e.kind ?? null,
    urgent_reason: e.urgent ?? null,
    occurred_at: e.at,
    state: e.state ?? "pending",
  });
  expect(error).toBeNull();
}

async function addJob(w: World, title: string, service: string, assignedTo: string | null = null, clientId = w.clientId) {
  const { data } = await admin
    .from("jobs")
    .insert({ client_id: clientId, title, service, assigned_to: assignedTo })
    .select("id")
    .single();
  return data!.id as string;
}

/** Adds a request. The database trigger queues a notification for it; tests that queue their own events drop that one. */
async function addRequest(jobId: string, row: Record<string, unknown>, keepQueued = false) {
  const { data, error } = await admin
    .from("requests")
    .insert({ job_id: jobId, kind: "upload", title: "A request", ...row })
    .select("id")
    .single();
  expect(error).toBeNull();
  if (!keepQueued) await admin.from("notifications_queue").delete().eq("request_id", data!.id);
  return data!.id as string;
}

async function states(w: World) {
  const { data } = await admin.from("notifications_queue").select("state").eq("client_id", w.clientId).order("id");
  return (data ?? []).map((r) => r.state as string);
}

// ── The rules, as plain functions ────────────────────────────
const S: Settings = {
  staff_batch_minutes: 15,
  client_bundle_minutes: 10,
  quiet_start: "18:00:00",
  quiet_end: "08:00:00",
  urgent_approvals: true,
  urgent_lender_consents: true,
  urgent_finance_activity: true,
  digest_enabled: true,
  digest_time: "17:00:00",
  fallback_email: "craig@zen-finance.co.uk",
  reminders_enabled: true,
  reminder_days: [7, 3, 1],
  bank_holiday_region: "scotland",
};
const SCOTLAND = new Set(["2026-11-30"]); // St Andrew's Day: a Scottish bank holiday, a normal day in England
const ENGLAND = new Set<string>();
const d = (iso: string) => new Date(iso);

test("quiet hours are 18:00 to 08:00, weekends and bank holidays, in London time", () => {
  // An ordinary Tuesday (GMT)
  expect(isQuiet(d(at(TUE, "07:59")), S, SCOTLAND)).toBe(true);
  expect(isQuiet(d(at(TUE, "08:00")), S, SCOTLAND)).toBe(false);
  expect(isQuiet(d(at(TUE, "17:59")), S, SCOTLAND)).toBe(false);
  expect(isQuiet(d(at(TUE, "18:00")), S, SCOTLAND)).toBe(true);
  // Summer time: London is an hour ahead of UTC, so 18:00 London is 17:00 UTC
  expect(isQuiet(d("2026-06-16T16:59:00Z"), S, SCOTLAND)).toBe(false);
  expect(isQuiet(d("2026-06-16T17:00:00Z"), S, SCOTLAND)).toBe(true);
  expect(isQuiet(d("2026-06-16T06:59:00Z"), S, SCOTLAND)).toBe(true);
  expect(isQuiet(d("2026-06-16T07:00:00Z"), S, SCOTLAND)).toBe(false);
  // Weekends are quiet all day
  expect(isQuiet(d(at("2026-11-07", "12:00")), S, SCOTLAND)).toBe(true);
  expect(isQuiet(d(at("2026-11-08", "12:00")), S, SCOTLAND)).toBe(true);
  // A Scottish bank holiday is quiet all day; the same Monday is a working day with the English list
  expect(isQuiet(d(at("2026-11-30", "12:00")), S, SCOTLAND)).toBe(true);
  expect(isQuiet(d(at("2026-11-30", "12:00")), S, ENGLAND)).toBe(false);
  expect(isWorkingDay("2026-11-30", SCOTLAND)).toBe(false);
  expect(isWorkingDay("2026-12-01", SCOTLAND)).toBe(true);
});

test("the working period starts when quiet hours end, across weekends, bank holidays and the clock change", () => {
  expect(currentPeriodStart(d(at(TUE, "10:00")), S, SCOTLAND)?.toISOString()).toBe(at(TUE, "08:00").replace(":00Z", ":00.000Z"));
  expect(currentPeriodStart(d(at(TUE, "22:00")), S, SCOTLAND)).toBeNull();
  // Monday morning after a weekend
  expect(currentPeriodStart(d(at("2026-11-09", "09:30")), S, SCOTLAND)?.toISOString()).toBe("2026-11-09T08:00:00.000Z");
  // The day after a Scottish bank holiday
  expect(currentPeriodStart(d(at("2026-12-01", "09:00")), S, SCOTLAND)?.toISOString()).toBe("2026-12-01T08:00:00.000Z");
  // Summer time: 08:00 London is 07:00 UTC
  expect(currentPeriodStart(d("2026-06-16T10:00:00Z"), S, SCOTLAND)?.toISOString()).toBe("2026-06-16T07:00:00.000Z");
  // The Monday after the clocks went forward (29/03/2026)
  expect(currentPeriodStart(d("2026-03-30T09:00:00Z"), S, SCOTLAND)?.toISOString()).toBe("2026-03-30T07:00:00.000Z");
  expect(localToUtc("2026-06-16", 480).toISOString()).toBe("2026-06-16T07:00:00.000Z");
  expect(localToUtc("2026-11-03", 480).toISOString()).toBe("2026-11-03T08:00:00.000Z");
});

const ev = (id: number, time: string, over: Partial<StaffEvent> = {}): StaffEvent => ({
  id,
  client_id: "client-a",
  job_id: "job-1",
  occurred_at: at(TUE, time),
  urgent_reason: null,
  recipient: "fallback",
  ...over,
});

test("staff alerts wait for the batch delay, go out one per client, and urgent ones skip quiet hours", () => {
  const events = [ev(1, "10:00"), ev(2, "10:05"), ev(3, "10:10"), ev(4, "10:12", { client_id: "client-b" })];
  // 14 minutes after client A's last activity: not yet
  expect(planStaffSends(events, d(at(TUE, "10:24")), S, SCOTLAND)).toEqual([]);
  // 15 minutes: A goes as one send of three; B (last at 10:12) is not due until 10:27
  expect(planStaffSends(events, d(at(TUE, "10:25")), S, SCOTLAND).map((x) => [x.kind, x.clientId, x.eventIds])).toEqual([
    ["batch", "client-a", [1, 2, 3]],
  ]);
  expect(planStaffSends(events, d(at(TUE, "10:27")), S, SCOTLAND)).toHaveLength(2);

  // Quiet hours: ordinary alerts wait; urgent ones do not
  const night = [ev(1, "22:00"), ev(2, "22:00", { urgent_reason: "approval" }), ev(3, "22:00", { urgent_reason: "finance", client_id: "client-b" })];
  const sends = planStaffSends(night, d(at(TUE, "22:05")), S, SCOTLAND);
  expect(sends.map((x) => [x.kind, x.clientId, x.eventIds])).toEqual([
    ["urgent", "client-a", [2]],
    ["urgent", "client-b", [3]],
  ]);
  // With the urgent rule switched off, the same approval is held like everything else
  expect(planStaffSends(night, d(at(TUE, "22:05")), { ...S, urgent_approvals: false }, SCOTLAND).map((x) => x.eventIds)).toEqual([[3]]);
  expect(planStaffSends(night, d(at(TUE, "22:05")), { ...S, urgent_finance_activity: false, urgent_approvals: false }, SCOTLAND)).toEqual([]);

  // The next morning everything held goes in one email per recipient
  const morning = planStaffSends(night, d(at("2026-11-04", "08:00")), { ...S, urgent_approvals: false, urgent_finance_activity: false }, SCOTLAND);
  expect(morning.map((x) => [x.kind, x.clientId, x.eventIds])).toEqual([["held", null, [1, 2, 3]]]);
});

test("routing: the assigned team member if they work in the job's area, otherwise the fallback address", () => {
  const acc = { id: "u1", email: "acc@example.com", is_staff: true, staff_role: "staff", staff_areas: ["accounting"] };
  const admin1 = { id: "u2", email: "admin@example.com", is_staff: true, staff_role: "admin", staff_areas: [] };
  expect(routeStaff({ area: "accounting" }, acc, S)).toEqual({ key: "u1", email: "acc@example.com" });
  expect(routeStaff({ area: "finance" }, acc, S)).toEqual({ key: "fallback", email: S.fallback_email });
  expect(routeStaff({ area: "finance" }, admin1, S).key).toBe("u2");
  expect(routeStaff({ area: "accounting" }, null, S).key).toBe("fallback");
  expect(routeStaff({ area: "accounting" }, { ...acc, is_staff: false }, S).key).toBe("fallback");
});

test("client bundles, reminders and the digest follow the rules", () => {
  const events = [
    { id: 1, job_id: "j", occurred_at: at(TUE, "10:00") },
    { id: 2, job_id: "j", occurred_at: at(TUE, "10:07") },
  ];
  expect(planClientBundles(events, d(at(TUE, "10:16")), S)).toEqual([]);
  expect(planClientBundles(events, d(at(TUE, "10:17")), S)).toEqual([{ jobId: "j", eventIds: [1, 2] }]);

  expect(daysBetween("2026-11-03", "2026-11-10")).toBe(7);
  const kind = (due: string) => reminderKind(due, TUE, S);
  expect([kind("2026-11-10"), kind("2026-11-06"), kind("2026-11-04")]).toEqual(["upcoming", "upcoming", "upcoming"]);
  expect([kind("2026-11-05"), kind("2026-11-09"), kind("2026-11-03")]).toEqual([null, null, null]);
  expect([kind("2026-11-02"), kind("2026-10-27"), kind("2026-10-26")]).toEqual(["overdue", "overdue", null]);

  expect(remindersDue(d(at(TUE, "07:59")), S, SCOTLAND)).toBe(false);
  expect(remindersDue(d(at(TUE, "08:00")), S, SCOTLAND)).toBe(true);
  expect(remindersDue(d(at("2026-11-07", "09:00")), S, SCOTLAND)).toBe(false);
  expect(remindersDue(d(at("2026-11-30", "09:00")), S, SCOTLAND)).toBe(false);
  expect(remindersDue(d(at(TUE, "09:00")), { ...S, reminders_enabled: false }, SCOTLAND)).toBe(false);

  expect(digestDue(d(at(TUE, "16:59")), S, SCOTLAND)).toBe(false);
  expect(digestDue(d(at(TUE, "17:00")), S, SCOTLAND)).toBe(true);
  expect(digestDue(d(at("2026-11-07", "17:00")), S, SCOTLAND)).toBe(false);
  expect(digestDue(d(at("2026-11-30", "17:00")), S, SCOTLAND)).toBe(false);
  expect(digestDue(d(at(TUE, "17:00")), { ...S, digest_enabled: false }, SCOTLAND)).toBe(false);
});

// ── The function, end to end ─────────────────────────────────
test("staff get one email per client, 15 minutes after that client's last activity, and never twice", async () => {
  const w = await world({ assigned: "acc" });
  const other = await ensureClientOwner(admin, await ensureUser(admin, { email: `e2e.notify.owner2.${w.tag}@example.com` }), `Beta ${w.tag} Ltd`);
  const otherJob = await addJob(w, `Payroll ${w.tag}`, "payroll", w.staff!.id, other);

  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "10:00") });
  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "10:05") });
  await queue(w, { event: "item_submitted", kind: "question", at: at(TUE, "10:08") });
  await queue(w, { event: "client_message", at: at(TUE, "10:10") });
  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "10:20"), client: other, job: otherJob });

  expect(to(await notify(at(TUE, "10:24")), w.staff!.email)).toHaveLength(0);

  const first = to(await notify(at(TUE, "10:25")), w.staff!.email);
  expect(first).toHaveLength(1);
  expect(first[0].subject).toBe(`${w.clientName} sent 3 items and 1 message on the ${w.jobTitle} job`);
  expect(first[0].text).toContain("2 uploads, 1 answer, 1 message");
  expect(first[0].html).toContain("#C9A84C"); // black and gold, like the sign-in emails
  expect(first[0].html).toContain("#0A0A0A");
  expect(first[0].text).toMatch(/\/admin\/jobs\/[0-9a-f-]{36}/);

  // Beta's single upload is not due until 10:35, and goes as its own email
  expect(to(await notify(at(TUE, "10:30")), w.staff!.email)).toHaveLength(0);
  const second = to(await notify(at(TUE, "10:35")), w.staff!.email);
  expect(second).toHaveLength(1);
  expect(second[0].subject).toBe(`Beta ${w.tag} Ltd sent 1 item on the Payroll ${w.tag} job`);

  // Nothing is ever sent twice
  expect(to(await notify(at(TUE, "10:40")), w.staff!.email)).toHaveLength(0);
  expect(to(await notify(at(TUE, "11:40")), w.staff!.email)).toHaveLength(0);
  expect(await states(w)).toEqual(["sent", "sent", "sent", "sent"]);
});

test("urgent items go at once, even in quiet hours; everything else is held until the next working morning", async () => {
  const w = await world({ assigned: "acc" });
  const finJob = await addJob(w, `Bridging loan ${w.tag}`, "finance_application"); // unassigned: goes to the fallback address

  await queue(w, { event: "approval", kind: "approval", urgent: "approval", at: at(TUE, "22:00") });
  await queue(w, { event: "item_submitted", kind: "upload", urgent: "finance", job: finJob, at: at(TUE, "22:00") });
  await queue(w, { event: "consent", kind: "consent", urgent: "lender_share", job: finJob, at: at(TUE, "22:00") });
  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "22:00") }); // ordinary

  const night = await notify(at(TUE, "22:01"));
  const approval = to(night, w.staff!.email);
  expect(approval).toHaveLength(1);
  expect(approval[0].subject).toBe(`Urgent: ${w.clientName} sent 1 item on the ${w.jobTitle} job`);
  expect(approval[0].text).toContain("1 approval");
  const finance = to(night, w.fallback);
  expect(finance).toHaveLength(1);
  expect(finance[0].subject).toBe(`Urgent: ${w.clientName} sent 2 items on the Bridging loan ${w.tag} job`);
  expect(finance[0].text).toContain("1 upload, 1 consent");

  // The ordinary upload is still waiting
  expect(await states(w)).toEqual(["sent", "sent", "sent", "pending"]);
  expect(to(await notify(at(TUE, "23:30")), w.staff!.email)).toHaveLength(0);

  // Next morning at 08:00 the held item goes out
  const morning = to(await notify(at("2026-11-04", "08:00")), w.staff!.email);
  expect(morning).toHaveLength(1);
  expect(morning[0].subject).toContain("Since you were last in: 1 item from 1 client");
  expect(await states(w)).toEqual(["sent", "sent", "sent", "sent"]);
});

test("the urgent rules can be switched off in Settings", async () => {
  const w = await world({ assigned: "acc" });
  await admin.from("notification_settings").update({ urgent_approvals: false }).eq("id", true);
  await queue(w, { event: "approval", kind: "approval", urgent: "approval", at: at(TUE, "22:00") });
  expect(to(await notify(at(TUE, "22:01")), w.staff!.email)).toHaveLength(0);
  expect(to(await notify(at("2026-11-04", "08:00")), w.staff!.email)).toHaveLength(1);
});

test("anything raised over a weekend or bank holiday arrives as one email on the next working morning", async () => {
  const w = await world();
  const beta = await ensureClientOwner(admin, await ensureUser(admin, { email: `e2e.notify.owner3.${w.tag}@example.com` }), `Beta ${w.tag} Ltd`);
  const betaJob = await addJob(w, `Bookkeeping ${w.tag}`, "bookkeeping", null, beta);

  await queue(w, { event: "item_submitted", kind: "upload", at: at("2026-11-27", "17:50") }); // Friday, just before closing
  await queue(w, { event: "item_submitted", kind: "upload", at: at("2026-11-28", "10:00"), client: beta, job: betaJob }); // Saturday
  await queue(w, { event: "client_message", at: at("2026-11-29", "15:00") }); // Sunday

  expect(mine(w, await notify(at("2026-11-27", "18:30")))).toEqual([]);
  expect(mine(w, await notify(at("2026-11-28", "12:00")))).toEqual([]);
  expect(mine(w, await notify(at("2026-11-29", "12:00")))).toEqual([]);
  // Monday 30/11/2026 is St Andrew's Day, a bank holiday in Scotland
  expect(mine(w, await notify(at("2026-11-30", "09:00")))).toEqual([]);

  const mails = to(await notify(at("2026-12-01", "08:00")), w.fallback);
  expect(mails).toHaveLength(1); // one email, not three
  expect(mails[0].subject).toBe("Since you were last in: 2 items and 1 message from 2 clients");
  expect(mails[0].html).toContain(w.clientName);
  expect(mails[0].html).toContain(`Beta ${w.tag} Ltd`);
  expect(to(await notify(at("2026-12-01", "08:05")), w.fallback)).toHaveLength(0);
});

test("the bank holiday list in Settings decides which Mondays are quiet", async () => {
  const w = await world();
  await queue(w, { event: "item_submitted", kind: "upload", at: at("2026-11-28", "10:00") });
  await admin.from("notification_settings").update({ bank_holiday_region: "england_wales" }).eq("id", true);
  // 30/11/2026 is an ordinary working day in England
  expect(to(await notify(at("2026-11-30", "08:00")), w.fallback)).toHaveLength(1);
});

test("alerts go to the assigned team member, or to the fallback address", async () => {
  const w = await world({ assigned: "admin" });
  const acc = await staffUser(`${w.tag}`, "acc");
  const fin = await staffUser(`${w.tag}`, "fin");
  const accFinance = await addJob(w, `Lender ${w.tag}`, "finance_application", acc.id); // accounting-only person on a finance job
  const finFinance = await addJob(w, `Lender two ${w.tag}`, "finance_application", fin.id);
  const unassigned = await addJob(w, `Unassigned ${w.tag}`, "bookkeeping");

  for (const job of [w.jobId, accFinance, finFinance, unassigned]) {
    await queue(w, { event: "item_submitted", kind: "upload", job, at: at(TUE, "10:00") });
  }
  const mails = await notify(at(TUE, "10:15"));
  expect(to(mails, w.staff!.email)).toHaveLength(1);
  expect(to(mails, fin.email)).toHaveLength(1);
  expect(to(mails, acc.email)).toHaveLength(0); // no access to finance jobs, so not theirs
  const fallback = to(mails, w.fallback);
  expect(fallback).toHaveLength(1);
  expect(fallback[0].text).toContain(`Lender ${w.tag}`);
  expect(fallback[0].text).toContain(`Unassigned ${w.tag}`);
  expect(fallback[0].subject).toBe(`${w.clientName} sent 2 items`); // two jobs, so no single job name
});

test("the daily digest groups by area then client, goes once, and is skipped when nothing happened", async () => {
  const w = await world({ settings: { digest_enabled: true } });
  const beta = await ensureClientOwner(admin, await ensureUser(admin, { email: `e2e.notify.owner4.${w.tag}@example.com` }), `Beta ${w.tag} Ltd`);
  const finJob = await addJob(w, `Loan ${w.tag}`, "finance_application", null, beta);

  // Already dealt with during the day (state "sent"): the digest still reports them
  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "09:00"), state: "sent" });
  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "09:30"), state: "sent" });
  await queue(w, { event: "client_message", at: at(TUE, "14:00"), state: "sent" });
  await queue(w, { event: "approval", kind: "approval", urgent: "approval", client: beta, job: finJob, at: at(TUE, "11:00"), state: "sent" });
  await queue(w, { event: "item_submitted", kind: "upload", client: beta, job: finJob, at: at(TUE, "12:00"), state: "sent" });

  expect(mine(w, await notify(at(TUE, "16:59")))).toEqual([]);
  const digest = to(await notify(at(TUE, "17:00")), w.fallback);
  expect(digest).toHaveLength(1);
  expect(digest[0].subject).toBe("Daily digest 03/11/2026: 4 items and 1 message");
  const text = digest[0].text;
  expect(text.indexOf("ACCOUNTING")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("BUSINESS FINANCE")).toBeGreaterThan(text.indexOf("ACCOUNTING"));
  expect(text.indexOf(w.clientName)).toBeLessThan(text.indexOf("BUSINESS FINANCE"));
  expect(text.indexOf(`Beta ${w.tag} Ltd`)).toBeGreaterThan(text.indexOf("BUSINESS FINANCE"));
  expect(text).toContain("2 uploads, 1 message");
  expect(text).toContain("1 upload, 1 approval");

  expect(to(await notify(at(TUE, "17:30")), w.fallback)).toHaveLength(0); // never twice
  // Wednesday: nothing happened, so no digest
  expect(to(await notify(at("2026-11-04", "17:00")), w.fallback)).toHaveLength(0);
  const { data: skipped } = await admin.from("notifications_log").select("status").eq("dedupe_key", "digest:2026-11-04").single();
  expect(skipped?.status).toBe("skipped");

  // Something on Saturday: no weekend digest; Monday's covers it. (30/11 would be a holiday, so use Monday 23/11.)
  await queue(w, { event: "client_message", at: at("2026-11-21", "10:00"), state: "sent" });
  expect(to(await notify(at("2026-11-21", "17:00")), w.fallback)).toHaveLength(0);
  const monday = to(await notify(at("2026-11-23", "17:00")), w.fallback);
  expect(monday).toHaveLength(1);
  expect(monday[0].subject).toBe("Daily digest 23/11/2026: 1 message");
});

test("the daily digest can be switched off and is not sent on a bank holiday", async () => {
  const w = await world({ settings: { digest_enabled: true } });
  await queue(w, { event: "item_submitted", kind: "upload", at: at("2026-11-30", "09:00"), state: "sent" });
  expect(to(await notify(at("2026-11-30", "17:00")), w.fallback)).toHaveLength(0); // St Andrew's Day
  await admin.from("notification_settings").update({ digest_enabled: false }).eq("id", true);
  expect(to(await notify(at("2026-12-01", "17:00")), w.fallback)).toHaveLength(0);
});

test("clients get one 'You have something to do' per job per batch, only people who can act, never twice", async () => {
  const w = await world();
  const r1 = await addRequest(w.jobId, { kind: "upload" });
  const r2 = await addRequest(w.jobId, { kind: "question", question_type: "text" });
  const r3 = await addRequest(w.jobId, { kind: "approval" });
  await queue(w, { event: "request_created", request: r1, kind: "upload", at: at(TUE, "10:00") });
  await queue(w, { event: "request_created", request: r2, kind: "question", at: at(TUE, "10:03") });
  await queue(w, { event: "request_created", request: r3, kind: "approval", at: at(TUE, "10:07") });

  expect(mine(w, await notify(at(TUE, "10:16")))).toEqual([]); // 10 minutes after the last one is 10:17

  const sent = mine(w, await notify(at(TUE, "10:17")));
  expect(to(sent, w.ownerEmail)).toHaveLength(1);
  expect(to(sent, w.contributorEmail)).toHaveLength(1); // on the job, and there is an upload to do
  expect(to(sent, w.bystanderEmail)).toHaveLength(0); // not on this job
  expect(sent).toHaveLength(2);
  for (const m of sent) {
    expect(m.subject).toBe("You have something to do");
    expect(m.html).toContain("Open my portal");
  }
  expect(mine(w, await notify(at(TUE, "10:30")))).toEqual([]);
  expect(mine(w, await notify(at(TUE, "18:30")))).toEqual([]);

  // Approvals are for the account owner only: a contributor is not emailed about one
  const r4 = await addRequest(w.jobId, { kind: "approval" });
  await queue(w, { event: "request_created", request: r4, kind: "approval", at: at(TUE, "11:00") });
  const second = mine(w, await notify(at(TUE, "11:10")));
  expect(second.map((m) => m.to)).toEqual([w.ownerEmail]);

  // A request withdrawn before the email goes is not announced
  const r5 = await addRequest(w.jobId, { kind: "upload" });
  await queue(w, { event: "request_created", request: r5, kind: "upload", at: at(TUE, "12:00") });
  await admin.from("requests").update({ status: "cancelled" }).eq("id", r5);
  expect(mine(w, await notify(at(TUE, "12:10")))).toEqual([]);
});

test("a message from staff sends one 'You have a new message', bundled over 10 minutes, to people on the job", async () => {
  const w = await world();
  await queue(w, { event: "staff_message", at: at(TUE, "10:00") });
  await queue(w, { event: "staff_message", at: at(TUE, "10:05") });
  expect(mine(w, await notify(at(TUE, "10:14")))).toEqual([]);
  const sent = mine(w, await notify(at(TUE, "10:15")));
  expect(sent.map((m) => m.to).sort()).toEqual([w.contributorEmail, w.ownerEmail].sort());
  for (const m of sent) {
    expect(m.subject).toBe("You have a new message");
    expect(m.html).toContain("/messages");
  }
  expect(mine(w, await notify(at(TUE, "10:20")))).toEqual([]);
});

test("reminders: 7, 3 and 1 days before, once when overdue, one count per person, working days only, opt-out respected", async () => {
  const w = await world();
  const day = (offset: number) => new Date(Date.parse(`${TUE}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  await addRequest(w.jobId, { due_date: day(7) });
  await addRequest(w.jobId, { kind: "question", question_type: "text", due_date: day(3) });
  await addRequest(w.jobId, { due_date: day(1) });
  await addRequest(w.jobId, { due_date: day(2) }); // not a reminder day
  await addRequest(w.jobId, { due_date: day(-1) }); // overdue: once
  await addRequest(w.jobId, { kind: "approval", due_date: day(3) }); // the owner only
  await addRequest(w.jobId, { due_date: day(1), status: "submitted" }); // already done
  await addRequest(w.jobId, { due_date: day(-14) }); // long overdue: not chased
  // The queue is empty, so only reminders can produce emails here
  await admin.from("profiles").update({ email_reminders: false }).eq("id", w.contributorId);

  expect(mine(w, await notify(at(TUE, "07:59")))).toEqual([]); // not before the working day starts

  const sent = mine(w, await notify(at(TUE, "08:00")));
  expect(sent.map((m) => m.to)).toEqual([w.ownerEmail]); // the contributor switched reminders off
  expect(sent[0].subject).toBe("You have 5 things to do");
  expect(sent[0].html).toContain("switch them off");

  // Never a second one the same day
  expect(mine(w, await notify(at(TUE, "12:00")))).toEqual([]);

  // Opted back in: the contributor's own count leaves the approval out
  await admin.from("profiles").update({ email_reminders: true }).eq("id", w.contributorId);
  await admin.from("notifications_log").delete().like("dedupe_key", "reminders-run:%");
  await admin.from("notifications_log").delete().like("dedupe_key", `reminder:${w.contributorId}:%`);
  const again = mine(w, await notify(at(TUE, "13:00")));
  expect(again.map((m) => m.to)).toEqual([w.contributorEmail]);
  expect(again[0].subject).toBe("You have 4 things to do");

  // Next day: the overdue one was already mentioned, so it is not counted again. Only the request that is now
  // exactly one day away is (it was two days away yesterday).
  const wednesday = mine(w, await notify(at("2026-11-04", "09:00")));
  expect(wednesday.map((m) => m.to).sort()).toEqual([w.contributorEmail, w.ownerEmail].sort());
  for (const m of wednesday) expect(m.subject).toBe("You have 1 thing to do");
});

test("no reminders at weekends, on bank holidays, or when reminders are switched off", async () => {
  const w = await world();
  const day = (iso: string, offset: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  await addRequest(w.jobId, { due_date: day("2026-11-07", 1) });
  await addRequest(w.jobId, { due_date: day("2026-11-30", 1) });
  expect(mine(w, await notify(at("2026-11-07", "09:00")))).toEqual([]); // Saturday
  expect(mine(w, await notify(at("2026-11-30", "09:00")))).toEqual([]); // St Andrew's Day
  await addRequest(w.jobId, { due_date: day(TUE, 1) });
  await admin.from("notification_settings").update({ reminders_enabled: false }).eq("id", true);
  expect(mine(w, await notify(at(TUE, "09:00")))).toEqual([]);
});

test("a failed send is retried on the next runs, at most three tries, and never double-sent", async () => {
  const w = await world({ assigned: "acc" });
  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "10:00") });

  // First try fails: nothing sent, the event stays pending
  expect(to(await notify(at(TUE, "10:20"), { fail_sends: 1 }), w.staff!.email)).toHaveLength(0);
  let log = (await admin.from("notifications_log").select("status, attempts").like("dedupe_key", "staff-batch:%")).data!;
  expect(log).toEqual([{ status: "failed", attempts: 1 }]);
  expect(await states(w)).toEqual(["pending"]);

  // The next run tries again and succeeds
  expect(to(await notify(at(TUE, "10:25")), w.staff!.email)).toHaveLength(1);
  log = (await admin.from("notifications_log").select("status, attempts").like("dedupe_key", "staff-batch:%")).data!;
  expect(log).toEqual([{ status: "sent", attempts: 2 }]);
  expect(await states(w)).toEqual(["sent"]);
  expect(to(await notify(at(TUE, "10:30")), w.staff!.email)).toHaveLength(0);

  // Three failures in a row: given up (the log says so), and not tried again
  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "11:00") });
  for (const minute of ["11:20", "11:25", "11:30"]) {
    expect(to(await notify(at(TUE, minute), { fail_sends: 1 }), w.staff!.email)).toHaveLength(0);
  }
  const dead = (await admin.from("notifications_log").select("status, attempts").like("dedupe_key", "staff-batch:%").eq("status", "failed")).data!;
  expect(dead).toEqual([{ status: "failed", attempts: 3 }]);
  expect((await states(w)).sort()).toEqual(["failed", "sent"]);
  expect(to(await notify(at(TUE, "11:40")), w.staff!.email)).toHaveLength(0);
});

test("emails never contain titles, file names, answers, amounts or message text, and clients never see names", async () => {
  const w = await world({ assigned: "acc", settings: { digest_enabled: true } });
  const finJob = await addJob(w, `Loan ${w.tag}`, "finance_application");
  const SECRET_TITLE = "Bank statements ACME-SECRET-123";
  const SECRET_FILE = "payroll-SECRET-2025.pdf";
  const SECRET_ANSWER = "£9,876.54";
  const SECRET_MESSAGE = "Please pay £4,321 into account 12345678";

  // Real data, so the database triggers (not the test) create the queue rows
  const due = new Date(Date.parse(`${TUE}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const upload = await addRequest(w.jobId, { title: SECRET_TITLE, help_text: SECRET_ANSWER, due_date: due }, true);
  const question = await addRequest(w.jobId, { kind: "question", question_type: "amount", title: `${SECRET_TITLE} question` }, true);
  const approval = await addRequest(finJob, { kind: "approval", title: `${SECRET_TITLE} approval` }, true);
  const finUpload = await addRequest(finJob, { title: `${SECRET_TITLE} lender` }, true);
  const consent = await addRequest(finJob, { kind: "consent", consent_type: "lender_share", title: `${SECRET_TITLE} consent` }, true);
  await admin.from("files").insert({
    client_id: w.clientId, job_id: w.jobId, request_id: upload, storage_path: `${w.clientId}/${w.jobId}/${crypto.randomUUID()}-${SECRET_FILE}`,
    original_name: SECRET_FILE, uploaded_by: w.ownerId,
  });
  await admin.from("responses").insert({ request_id: question, author_id: w.ownerId, answer: { value: SECRET_ANSWER } });
  for (const id of [upload, question, approval, finUpload]) {
    await admin.from("requests").update({ status: "submitted", submitted_by: w.ownerId }).eq("id", id);
  }
  await admin.from("consents").insert({
    client_id: w.clientId, job_id: finJob, request_id: consent, profile_id: w.ownerId,
    consent_type: "lender_share", wording_version: "v1", wording_text: `${SECRET_MESSAGE} consent wording`,
  });
  await admin.from("messages").insert({ job_id: w.jobId, author_id: w.ownerId, body: SECRET_MESSAGE });
  await admin.from("messages").insert({ job_id: w.jobId, author_id: w.staff!.id, body: `${SECRET_MESSAGE} (reply)` });
  await addRequest(w.jobId, { title: `${SECRET_TITLE} reopened`, due_date: due }, true);

  // Put everything in the queue at 10:00 on the test day
  const { data: queued } = await admin.from("notifications_queue").select("id, audience, event").eq("client_id", w.clientId);
  expect(queued!.filter((q) => q.audience === "staff")).toHaveLength(6); // upload, answer, approval, finance upload, consent, message
  await admin.from("notifications_queue").update({ occurred_at: at(TUE, "10:00") }).eq("client_id", w.clientId);

  const sent = [...(await notify(at(TUE, "10:30"))), ...(await notify(at(TUE, "17:00")))].filter((m) =>
    m.to.endsWith(`${w.tag}@example.com`),
  );
  expect(sent.length).toBeGreaterThanOrEqual(6);

  const staffAddresses = new Set([w.staff!.email, w.fallback]);
  const kinds = new Set(sent.map((m) => (staffAddresses.has(m.to) ? "staff" : "client")));
  expect(kinds).toEqual(new Set(["staff", "client"]));

  for (const m of sent) {
    const body = everything(m);
    for (const secret of [SECRET_TITLE, "ACME-SECRET", SECRET_FILE, "SECRET", SECRET_ANSWER, "9,876", SECRET_MESSAGE, "4,321", "12345678", "wording"]) {
      expect(body, `${m.subject} must not contain ${secret}`).not.toContain(secret);
    }
    expect(body).toContain("ZenFinanceHub");
    if (!staffAddresses.has(m.to)) {
      // Clients are told only that there is something to do: no client name, no job title
      expect(body).not.toContain(w.clientName);
      expect(body).not.toContain(w.jobTitle);
      expect(body).not.toMatch(/admin\/jobs|admin\/clients/);
      expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); // no ids
      expect(m.subject).toMatch(/^You have (something to do|a new message|\d+ things? to do)$/);
    }
  }
  // Clients really were emailed
  expect(sent.some((m) => m.to === w.ownerEmail && m.subject === "You have something to do")).toBe(true);
  expect(sent.some((m) => m.to === w.ownerEmail && m.subject === "You have a new message")).toBe(true);
  expect(sent.some((m) => m.to === w.ownerEmail && /^You have \d+ things? to do$/.test(m.subject))).toBe(true);
});

test("the notifier refuses calls without the shared secret", async () => {
  for (const headers of [{}, { "x-webhook-secret": "wrong" }, { "x-webhook-secret": "" }] as Record<string, string>[]) {
    const res = await fetch(NOTIFY_URL, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ mode: "sweep" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not allowed." });
  }
});

// ── The pages ────────────────────────────────────────────────
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("a client can switch reminder emails off and on from their account", async ({ page }) => {
  const w = await world();
  await signInAs(page, w.ownerEmail);
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();

  const box = page.getByRole("checkbox", { name: "Email me reminders" });
  await expect(box).toBeChecked(); // on by default
  await expect(page.getByText(/can't be switched off/)).toBeVisible();
  await noSideways(page);

  await box.uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  const { data: off } = await admin.from("profiles").select("email_reminders").eq("id", w.ownerId).single();
  expect(off?.email_reminders).toBe(false);

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Email me reminders" })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Email me reminders" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  const { data: on } = await admin.from("profiles").select("email_reminders").eq("id", w.ownerId).single();
  expect(on?.email_reminders).toBe(true);
});

test("the admin edits the notification rules and the bank holidays in Settings", async ({ page }) => {
  test.setTimeout(120_000);
  const w = await world();
  await signInAsStaffWithMfa(page, `e2e.notify.settings.${w.tag}@example.com`);
  await page.goto("/admin/settings");
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(page).toHaveURL(/tab=notifications/);
  await expect(page.getByLabel("Wait this many minutes after a client's last activity")).toHaveValue("15");
  await noSideways(page);

  // Bad values are explained, nothing is saved
  await page.getByLabel("Wait this many minutes after a client's last activity").fill("0");
  const form = page.getByTestId("notification-form");
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(form.getByRole("alert")).toContainText("at least 1 minute");
  await page.getByLabel("Wait this many minutes after a client's last activity").fill("30");
  await page.getByLabel("Quiet hours start (evening)").fill("07:00");
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(form.getByRole("alert")).toContainText("Quiet hours run overnight");

  // A good change
  await page.getByLabel("Quiet hours start (evening)").fill("19:00");
  await page.getByLabel("Digest time").fill("17:30");
  await page.getByLabel("Remind this many days before the due date").fill("10, 5, 2");
  await page.getByLabel("Any upload or submission on a finance application").uncheck();
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved.");
  const { data: s } = await admin.from("notification_settings").select("*").eq("id", true).single();
  expect(s).toMatchObject({
    staff_batch_minutes: 30, quiet_start: "19:00:00", digest_time: "17:30:00", reminder_days: [10, 5, 2], urgent_finance_activity: false,
  });
  const { data: audit } = await admin.from("audit_log").select("meta").eq("action", "notification_settings_changed").order("id", { ascending: false }).limit(1).single();
  expect(audit?.meta.changed).toEqual(expect.arrayContaining(["staff_batch_minutes", "quiet_start", "digest_time", "reminder_days", "urgent_finance_activity"]));

  // Bank holidays: add one, see it, remove it
  const name = `Test holiday ${w.tag}`;
  await page.getByLabel("Date", { exact: true }).fill("2030-12-24");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add bank holiday" }).click();
  await expect(page.getByTestId("holiday-row").filter({ hasText: name })).toContainText("24/12/2030");
  await page.getByRole("button", { name: `Remove ${name} 24/12/2030` }).click();
  await expect(page.getByTestId("holiday-row").filter({ hasText: name })).toHaveCount(0);

  // The list used is the region's: switch to England and Wales
  await page.getByLabel("Bank holidays to use").selectOption("england_wales");
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByRole("heading", { name: /Bank holidays \(England and Wales\)/ })).toBeVisible();

  // Recent emails shows what has been sent (without any content)
  await admin.from("notifications_queue").delete().neq("id", 0);
  await admin.from("notification_settings").update({ ...DEFAULTS, fallback_email: w.fallback }).eq("id", true);
  await queue(w, { event: "item_submitted", kind: "upload", at: at(TUE, "10:00") });
  await notify(at(TUE, "10:15"));
  await page.goto("/admin/settings?tab=notifications");
  await expect(page.getByTestId("recent-sends")).toContainText("Client activity — Sent");
  await expect(page.getByTestId("recent-sends")).not.toContainText(w.clientName);
});
