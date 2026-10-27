// Sends the portal's emails. Called only by the database (pg_cron every 5 minutes, at 08:00 and 17:00 London,
// and straight away when something urgent happens), with the shared secret in x-webhook-secret.
//
// It reads the notifications_queue (ids and kinds only), applies the rules in notification_settings and
// uk_bank_holidays (the same functions the tests use: _shared/notify-rules.ts), and sends through Resend.
// Every send is recorded once in notifications_log under a unique key, so nothing is sent twice; a failed send
// is tried again on the next run, up to three tries in all. The log keeps no email bodies and no addresses.
//
// Email content is fixed wording plus, for staff only, the client name, job title, kind and count of items.
// Nothing here ever reads a file name, an answer, an amount or the text of a message.
// The service role is used here and nowhere in the Next.js app.
import { json, PORTAL_URL, sameSecret, serviceClient, SUPABASE_URL } from "../_shared/common.ts";
import {
  addDays,
  digestDue,
  londonParts,
  OVERDUE_LOOKBACK_DAYS,
  planClientBundles,
  planStaffSends,
  reminderKind,
  remindersDue,
  routeStaff,
  type Holidays,
  type Settings,
  type StaffEvent,
  type StaffProfile,
} from "../_shared/notify-rules.ts";
import {
  clientMessage,
  clientNewRequest,
  clientReminder,
  emptyTally,
  staffClientEmail,
  staffDigestEmail,
  staffHeldEmail,
  type ClientSummary,
  type Email,
  type Tally,
} from "../_shared/notify-render.ts";

const FROM = "ZenFinanceHub <portal@mail.zenfinancehub.com>";
const REPLY_TO = "craig@zen-finance.co.uk";
const MAX_ATTEMPTS = 3; // the first try and two more
const STALE_MS = 10 * 60 * 1000; // a send that has been "in progress" this long is assumed to have crashed
const KEEP_QUEUE_DAYS = 60;

const admin = serviceClient();

type Captured = { to: string; subject: string; html: string; text: string };
type Ctx = {
  now: Date;
  /** Local development only: emails are returned instead of sent, and failures can be simulated. */
  capture: boolean;
  failures: number;
  captured: Captured[];
  sent: number;
};

type QueueRow = {
  id: number;
  event: string;
  client_id: string;
  job_id: string;
  request_id: string | null;
  request_kind: string | null;
  urgent_reason: string | null;
  occurred_at: string;
};
type JobInfo = { id: string; title: string; area: string; client_id: string; assigned_to: string | null; stage: string; clientName: string };

const QUEUE_COLUMNS = "id, event, client_id, job_id, request_id, request_kind, urgent_reason, occurred_at";

// ── Small helpers ────────────────────────────────────────────
function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
const unique = <T>(items: T[]) => [...new Set(items)];

async function loadJobs(ids: string[]): Promise<Map<string, JobInfo>> {
  const map = new Map<string, JobInfo>();
  for (const part of chunks(unique(ids))) {
    const { data } = await admin
      .from("jobs")
      .select("id, title, area, client_id, assigned_to, stage, client:clients(name)")
      .in("id", part);
    for (const j of (data ?? []) as unknown as (Omit<JobInfo, "clientName"> & { client: { name: string } | null })[]) {
      map.set(j.id, { ...j, clientName: j.client?.name ?? "A client" });
    }
  }
  return map;
}

async function markEvents(ids: number[], state: "sent" | "skipped" | "failed") {
  for (const part of chunks(ids, 200)) {
    await admin.from("notifications_queue").update({ state, processed_at: new Date().toISOString() }).in("id", part);
  }
}

// ── Sending, exactly once ────────────────────────────────────
async function transmit(ctx: Ctx, to: string, email: Email, key: string): Promise<{ ok: boolean; error?: string }> {
  if (ctx.capture) {
    if (ctx.failures > 0) {
      ctx.failures--;
      return { ok: false, error: "simulated failure" };
    }
    ctx.captured.push({ to, subject: email.subject, html: email.html, text: email.text });
    return { ok: true };
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("email not sent: RESEND_API_KEY is not set");
    return { ok: false, error: "no email key" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // If a send is ever repeated for the same key (say, after a crash), Resend delivers it only once.
        "Idempotency-Key": key,
      },
      body: JSON.stringify({ from: FROM, reply_to: REPLY_TO, to: [to], subject: email.subject, html: email.html, text: email.text }),
    });
    // Resend allows two requests a second; pace ourselves so a burst of reminders is not turned away.
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (!res.ok) {
      console.error("email failed with status", res.status);
      return { ok: false, error: `status ${res.status}` };
    }
    return { ok: true };
  } catch {
    console.error("email failed to send");
    return { ok: false, error: "network" };
  }
}

/** sent: delivered now · already: delivered earlier · retry: try again next run · dead: given up after three tries */
type Outcome = "sent" | "already" | "retry" | "dead";

async function deliver(
  ctx: Ctx,
  a: {
    key: string;
    kind: string;
    to: string;
    email: Email;
    clientId?: string | null;
    jobId?: string | null;
    eventCount: number;
    windowEnd?: Date;
  },
): Promise<Outcome> {
  const stamp = new Date().toISOString();
  let logId: number | undefined;
  let attempts = 1;

  // The unique key is the lock: only one caller can create the row.
  const inserted = await admin
    .from("notifications_log")
    .insert({
      dedupe_key: a.key,
      kind: a.kind,
      status: "sending",
      attempts: 1,
      client_id: a.clientId ?? null,
      job_id: a.jobId ?? null,
      event_count: a.eventCount,
      window_end: a.windowEnd?.toISOString() ?? null,
      updated_at: stamp,
    })
    .select("id")
    .maybeSingle();
  logId = inserted.data?.id;

  if (logId === undefined) {
    const { data: row } = await admin
      .from("notifications_log")
      .select("id, status, attempts, updated_at")
      .eq("dedupe_key", a.key)
      .maybeSingle();
    if (!row) return "retry";
    if (row.status === "sent") return "already";
    const stale = row.status === "sending" && Date.now() - Date.parse(row.updated_at) > STALE_MS;
    if (row.status === "sending" && !stale) return "retry"; // another run is on it
    if (row.attempts >= MAX_ATTEMPTS) return "dead";
    const claim = await admin
      .from("notifications_log")
      .update({ status: "sending", attempts: row.attempts + 1, updated_at: stamp })
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .eq("status", row.status)
      .select("id");
    if (!claim.data?.length) return "retry";
    logId = row.id;
    attempts = row.attempts + 1;
  }

  const result = await transmit(ctx, a.to, a.email, a.key);
  if (result.ok) {
    await admin
      .from("notifications_log")
      .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null })
      .eq("id", logId);
    ctx.sent++;
    return "sent";
  }
  await admin
    .from("notifications_log")
    .update({ status: "failed", updated_at: new Date().toISOString(), last_error: result.error ?? "failed" })
    .eq("id", logId);
  return attempts >= MAX_ATTEMPTS ? "dead" : "retry";
}

/** What to do with the queue rows once their emails have been dealt with. */
async function settle(ids: number[], outcomes: Outcome[]) {
  if (outcomes.includes("retry")) return; // some recipient still to retry: leave pending
  await markEvents(ids, outcomes.includes("dead") ? "failed" : "sent");
}

// ── Staff alerts and the held overnight email ────────────────
function summarise(events: QueueRow[], jobs: Map<string, JobInfo>): ClientSummary[] {
  const clients = new Map<string, ClientSummary>();
  for (const e of events) {
    const job = jobs.get(e.job_id);
    if (!job) continue;
    let c = clients.get(job.client_id);
    if (!c) clients.set(job.client_id, (c = { clientId: job.client_id, clientName: job.clientName, jobs: [] }));
    let j = c.jobs.find((x) => x.jobId === job.id);
    if (!j) c.jobs.push((j = { jobId: job.id, jobTitle: job.title, tally: emptyTally() }));
    const tally: Tally = j.tally;
    if (e.event === "client_message") tally.message++;
    else if (e.event === "approval") tally.approval++;
    else if (e.event === "consent") tally.consent++;
    else if (e.request_kind === "question") tally.question++;
    else tally.upload++;
  }
  const list = [...clients.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
  for (const c of list) c.jobs.sort((a, b) => a.jobTitle.localeCompare(b.jobTitle));
  return list;
}

async function staffPass(ctx: Ctx, s: Settings, holidays: Holidays) {
  const { data } = await admin
    .from("notifications_queue")
    .select(QUEUE_COLUMNS)
    .eq("audience", "staff")
    .eq("state", "pending")
    .order("id")
    .limit(2000);
  const events = (data ?? []) as QueueRow[];
  if (!events.length) return;

  const jobs = await loadJobs(events.map((e) => e.job_id));
  const assigneeIds = unique([...jobs.values()].map((j) => j.assigned_to).filter((x): x is string => !!x));
  const staff = new Map<string, StaffProfile>();
  for (const part of chunks(assigneeIds)) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, is_staff, staff_role, staff_areas")
      .in("id", part);
    for (const p of (profiles ?? []) as StaffProfile[]) staff.set(p.id, p);
  }

  const missing = events.filter((e) => !jobs.has(e.job_id)).map((e) => e.id);
  if (missing.length) await markEvents(missing, "skipped");

  const addressOf = new Map<string, string>();
  const byId = new Map<number, QueueRow>();
  const planEvents: StaffEvent[] = [];
  for (const e of events) {
    const job = jobs.get(e.job_id);
    if (!job) continue;
    const route = routeStaff(job, job.assigned_to ? staff.get(job.assigned_to) : null, s);
    addressOf.set(route.key, route.email);
    byId.set(e.id, e);
    planEvents.push({
      id: e.id,
      client_id: e.client_id,
      job_id: e.job_id,
      occurred_at: e.occurred_at,
      urgent_reason: e.urgent_reason,
      recipient: route.key,
    });
  }

  for (const send of planStaffSends(planEvents, ctx.now, s, holidays)) {
    const rows = send.eventIds.map((id) => byId.get(id)!);
    const summaries = summarise(rows, jobs);
    if (!summaries.length) continue;
    const last = send.eventIds[send.eventIds.length - 1];
    const email =
      send.kind === "held" ? staffHeldEmail(summaries, PORTAL_URL) : staffClientEmail(send.kind, summaries[0], PORTAL_URL);
    const outcome = await deliver(ctx, {
      key: `staff-${send.kind}:${send.recipient}:${send.clientId ?? "all"}:${last}`,
      kind: `staff_${send.kind}`,
      to: addressOf.get(send.recipient)!,
      email,
      clientId: send.clientId,
      eventCount: send.eventIds.length,
    });
    await settle(send.eventIds, [outcome]);
  }
}

// ── Emails to clients about new requests and staff messages ──
async function contactsFor(job: JobInfo, includeContributors: boolean): Promise<string[]> {
  const { data: owners } = await admin
    .from("client_contacts")
    .select("profile_id")
    .eq("client_id", job.client_id)
    .eq("role", "owner");
  const ids = (owners ?? []).map((o) => o.profile_id as string);
  if (includeContributors) {
    const { data: onJob } = await admin.from("job_contacts").select("profile_id").eq("job_id", job.id);
    const jobIds = (onJob ?? []).map((o) => o.profile_id as string);
    if (jobIds.length) {
      const { data: contributors } = await admin
        .from("client_contacts")
        .select("profile_id")
        .eq("client_id", job.client_id)
        .in("profile_id", jobIds);
      ids.push(...(contributors ?? []).map((c) => c.profile_id as string));
    }
  }
  return unique(ids);
}

async function emailsOf(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunks(ids)) {
    const { data } = await admin.from("profiles").select("id, email").in("id", part);
    for (const p of data ?? []) map.set(p.id as string, p.email as string);
  }
  return map;
}

async function clientPass(ctx: Ctx, s: Settings) {
  const { data } = await admin
    .from("notifications_queue")
    .select(QUEUE_COLUMNS)
    .eq("audience", "client")
    .eq("state", "pending")
    .order("id")
    .limit(2000);
  const events = (data ?? []) as QueueRow[];
  if (!events.length) return;
  const jobs = await loadJobs(events.map((e) => e.job_id));

  for (const eventType of ["request_created", "staff_message"] as const) {
    const ofType = events.filter((e) => e.event === eventType);
    for (const bundle of planClientBundles(ofType, ctx.now, s)) {
      const job = jobs.get(bundle.jobId);
      if (!job) {
        await markEvents(bundle.eventIds, "skipped");
        continue;
      }

      let contributorsToo = true;
      if (eventType === "request_created") {
        // Only tell people about things they can still act on.
        const requestIds = ofType.filter((e) => bundle.eventIds.includes(e.id)).map((e) => e.request_id).filter((x): x is string => !!x);
        const { data: open } = requestIds.length
          ? await admin.from("requests").select("kind").in("id", requestIds).in("status", ["open", "returned"])
          : { data: [] };
        if (!open?.length || job.stage === "completed" || job.stage === "cancelled") {
          await markEvents(bundle.eventIds, "skipped");
          continue;
        }
        // Approvals and consents are for the account owner; a contributor only hears about uploads and questions.
        contributorsToo = open.some((r) => r.kind === "upload" || r.kind === "question");
      }

      const recipients = await contactsFor(job, contributorsToo);
      const addresses = await emailsOf(recipients);
      if (!recipients.length) {
        await markEvents(bundle.eventIds, "skipped");
        continue;
      }

      const last = bundle.eventIds[bundle.eventIds.length - 1];
      const outcomes: Outcome[] = [];
      for (const profileId of recipients) {
        const to = addresses.get(profileId);
        if (!to) continue;
        outcomes.push(
          await deliver(ctx, {
            key: `${eventType === "request_created" ? "client-request" : "client-message"}:${profileId}:${job.id}:${last}`,
            kind: eventType === "request_created" ? "client_new_request" : "client_message",
            to,
            email: eventType === "request_created" ? clientNewRequest(PORTAL_URL) : clientMessage(PORTAL_URL),
            clientId: job.client_id,
            jobId: job.id,
            eventCount: bundle.eventIds.length,
          }),
        );
      }
      if (!outcomes.length) await markEvents(bundle.eventIds, "skipped");
      else await settle(bundle.eventIds, outcomes);
    }
  }
}

// ── Reminders ────────────────────────────────────────────────
async function reminderPass(ctx: Ctx, s: Settings, holidays: Holidays) {
  if (!remindersDue(ctx.now, s, holidays)) return;
  const today = londonParts(ctx.now).date;
  const runKey = `reminders-run:${today}`;
  const { data: done } = await admin.from("notifications_log").select("id").eq("dedupe_key", runKey).maybeSingle();
  if (done) return;

  const { data } = await admin
    .from("requests")
    .select("id, kind, due_date, job:jobs!inner(id, client_id, stage)")
    .in("status", ["open", "returned"])
    .gte("due_date", addDays(today, -OVERDUE_LOOKBACK_DAYS))
    .lte("due_date", addDays(today, Math.max(...s.reminder_days)))
    .not("job.stage", "in", "(completed,cancelled)");
  const requests = (data ?? []) as unknown as {
    id: string;
    kind: string;
    due_date: string;
    job: { id: string; client_id: string };
  }[];

  type Item = { requestId: string; overdue: boolean };
  const perPerson = new Map<string, Item[]>();
  const jobCache = new Map<string, JobInfo>();
  const contactCache = new Map<string, string[]>();
  for (const r of requests) {
    const kind = reminderKind(r.due_date, today, s);
    if (!kind) continue;
    const job = jobCache.get(r.job.id) ?? ({ id: r.job.id, client_id: r.job.client_id } as JobInfo);
    jobCache.set(job.id, job);
    // Approvals and consents are for the account owner only, so contributors are left out of those.
    const contributorsToo = r.kind === "upload" || r.kind === "question";
    const cacheKey = `${job.id}:${contributorsToo}`;
    let people = contactCache.get(cacheKey);
    if (!people) contactCache.set(cacheKey, (people = await contactsFor(job, contributorsToo)));
    for (const p of people) {
      const list = perPerson.get(p) ?? [];
      list.push({ requestId: r.id, overdue: kind === "overdue" });
      perPerson.set(p, list);
    }
  }

  // Overdue reminders go once per request per person.
  const markerKey = (item: Item, person: string) => `overdue:${item.requestId}:${person}`;
  const markers = new Set<string>();
  const wanted = [...perPerson].flatMap(([person, items]) => items.filter((i) => i.overdue).map((i) => markerKey(i, person)));
  for (const part of chunks(wanted, 100)) {
    const { data: found } = await admin.from("notifications_log").select("dedupe_key").in("dedupe_key", part);
    for (const f of found ?? []) markers.add(f.dedupe_key as string);
  }

  const people = [...perPerson.keys()];
  const profiles = new Map<string, { email: string; email_reminders: boolean }>();
  for (const part of chunks(people)) {
    const { data: rows } = await admin.from("profiles").select("id, email, email_reminders").in("id", part);
    for (const p of rows ?? []) profiles.set(p.id as string, { email: p.email as string, email_reminders: p.email_reminders as boolean });
  }

  const outcomes: Outcome[] = [];
  for (const [person, items] of perPerson) {
    const profile = profiles.get(person);
    if (!profile || !profile.email_reminders) continue;
    const counted = items.filter((i) => !i.overdue || !markers.has(markerKey(i, person)));
    if (!counted.length) continue;
    const outcome = await deliver(ctx, {
      key: `reminder:${person}:${today}`,
      kind: "client_reminder",
      to: profile.email,
      email: clientReminder(counted.length, PORTAL_URL),
      eventCount: counted.length,
    });
    outcomes.push(outcome);
    if (outcome === "sent" || outcome === "already") {
      const rows = counted
        .filter((i) => i.overdue)
        .map((i) => ({ dedupe_key: markerKey(i, person), kind: "marker", status: "sent", attempts: 0 }));
      if (rows.length) await admin.from("notifications_log").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
    }
  }

  if (!outcomes.includes("retry")) {
    await admin
      .from("notifications_log")
      .upsert([{ dedupe_key: runKey, kind: "marker", status: "sent", attempts: 0 }], { onConflict: "dedupe_key", ignoreDuplicates: true });
  }
}

// ── Daily digest ─────────────────────────────────────────────
const AREA_LABELS: Record<string, string> = { accounting: "Accounting", finance: "Business Finance" };

async function digestPass(ctx: Ctx, s: Settings, holidays: Holidays) {
  if (!digestDue(ctx.now, s, holidays)) return;
  const today = londonParts(ctx.now).date;
  const key = `digest:${today}`;
  const { data: done } = await admin.from("notifications_log").select("id, status").eq("dedupe_key", key).maybeSingle();
  if (done && done.status !== "failed" && done.status !== "sending") return;

  // Everything since the last digest (so a weekend or bank holiday lands in the next working day's).
  const { data: last } = await admin
    .from("notifications_log")
    .select("window_end")
    .eq("kind", "staff_digest")
    .in("status", ["sent", "skipped"])
    .not("window_end", "is", null)
    .order("window_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  const from = last?.window_end ? new Date(last.window_end as string) : new Date(ctx.now.getTime() - 24 * 3_600_000);

  const { data } = await admin
    .from("notifications_queue")
    .select(QUEUE_COLUMNS)
    .eq("audience", "staff")
    .gt("occurred_at", from.toISOString())
    .lte("occurred_at", ctx.now.toISOString())
    .limit(5000);
  const events = (data ?? []) as QueueRow[];
  const jobs = await loadJobs(events.map((e) => e.job_id));
  const usable = events.filter((e) => jobs.has(e.job_id));

  if (!usable.length) {
    // Nothing happened: no email, but note that today's digest has been looked at.
    await admin
      .from("notifications_log")
      .upsert(
        [{ dedupe_key: key, kind: "staff_digest", status: "skipped", attempts: 0, window_end: ctx.now.toISOString() }],
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      );
    return;
  }

  const areas = ["accounting", "finance"]
    .map((area) => ({
      label: AREA_LABELS[area],
      clients: summarise(usable.filter((e) => jobs.get(e.job_id)!.area === area), jobs),
    }))
    .filter((a) => a.clients.length > 0);

  await deliver(ctx, {
    key,
    kind: "staff_digest",
    to: s.fallback_email,
    email: staffDigestEmail(areas, today.split("-").reverse().join("/"), PORTAL_URL),
    eventCount: usable.length,
    windowEnd: ctx.now,
  });
}

// ── Entry point ──────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Not allowed." });
  if (!sameSecret(req.headers.get("x-webhook-secret"), Deno.env.get("NOTIFY_WEBHOOK_SECRET"))) {
    return json(401, { error: "Not allowed." });
  }

  let body: { mode?: string; now?: string; fail_sends?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body means a normal run */
  }

  // Local development only: emails are returned instead of sent, and the clock can be set.
  const hosted = SUPABASE_URL.startsWith("https://");
  const capture = Deno.env.get("NOTIFY_TRANSPORT") === "capture";
  if (capture && hosted) return json(500, { error: "Something went wrong." });
  const now = !hosted && body.now ? new Date(body.now) : new Date();
  if (Number.isNaN(now.getTime())) return json(400, { error: "Something went wrong." });

  const ctx: Ctx = { now, capture, failures: !hosted ? Number(body.fail_sends ?? 0) : 0, captured: [], sent: 0 };

  try {
    const { data: settings } = await admin.from("notification_settings").select("*").eq("id", true).single();
    if (!settings) throw new Error("no settings");
    const s = settings as unknown as Settings;
    const { data: days } = await admin.from("uk_bank_holidays").select("holiday_date").eq("region", s.bank_holiday_region);
    const holidays: Holidays = new Set((days ?? []).map((d) => d.holiday_date as string));

    await staffPass(ctx, s, holidays);
    if (body.mode !== "urgent") {
      await clientPass(ctx, s);
      await reminderPass(ctx, s, holidays);
      await digestPass(ctx, s, holidays);
      // Tidy: queue rows are only needed for a while after they are dealt with.
      const cutoff = new Date(Date.now() - KEEP_QUEUE_DAYS * 86_400_000).toISOString();
      await admin.from("notifications_queue").delete().neq("state", "pending").lt("occurred_at", cutoff);
    }
  } catch {
    // No names, ids or content in logs.
    console.error("send-notifications failed");
    return json(500, { error: "Something went wrong." });
  }

  return json(200, { ok: true, sent: ctx.sent, ...(capture ? { emails: ctx.captured } : {}) });
});
