// Admin-only (and only after the authenticator code): a zip of everything held on one client, for a subject access
// request. JSON for the records (client, contacts, jobs, requests, answers, consents with their exact wording, messages
// and notes, the audit trail) plus every stored file that has passed its virus check. Returns 60-second download links
// and records the export in the audit log first: no audit entry, no download.
// The records are read as the signed-in admin (row-level security applies). The service role is used only to read the
// stored files and to hold the temporary zips. Nothing personal goes in logs.
import { Zip, ZipPassThrough, strToU8, ZipDeflate } from "npm:fflate@0.8.3";
import { z } from "npm:zod@4";
import { authenticateStaff, CORS, json, serviceClient } from "../_shared/common.ts";

const BUCKET = "client-files";
const ZIP_BUCKET = "job-zips";
// Edge functions have limited memory: each zip is built in memory, so files are split across parts of this size.
const PART_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 400 * 1024 * 1024;
const MAX_PARTS = 9;

const bodySchema = z.object({ client_id: z.uuid() });

const DENIED = () => json(403, { error: "Not allowed." });
const FAILED = (step: string) => {
  console.error("client-export failed at:", step);
  return json(400, { error: "Something went wrong." });
};

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type Row = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Not allowed." });

  const caller = await authenticateStaff(req); // staff, signed in, authenticator code entered
  if (!caller || !caller.isAdmin) return DENIED();

  let clientId: string;
  try {
    clientId = bodySchema.parse(await req.json()).client_id;
  } catch {
    return FAILED("validate");
  }
  const db = caller.asCaller;
  const admin = serviceClient();

  // Reads one table completely, a page at a time.
  async function all(table: string, build: (q: any) => any, order = "created_at"): Promise<Row[] | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(db.from(table).select("*")).order(order).range(from, from + 999);
      if (error) return null;
      out.push(...(data as Row[]));
      if ((data as Row[]).length < 1000) return out;
    }
  }

  const { data: client } = await db.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (!client) return DENIED();

  const jobs = await all("jobs", (q) => q.eq("client_id", clientId));
  if (!jobs) return FAILED("jobs");
  const jobIds = jobs.map((j) => j.id as string);
  const inJobs = (q: any) => (jobIds.length ? q.in("job_id", jobIds) : q.eq("job_id", "00000000-0000-0000-0000-000000000000")); // eslint-disable-line @typescript-eslint/no-explicit-any

  const [contacts, jobContacts, requests, messages, consents, files] = await Promise.all([
    all("client_contacts", (q) => q.eq("client_id", clientId)),
    all("job_contacts", inJobs, "job_id"),
    all("requests", inJobs),
    all("messages", inJobs),
    all("consents", (q) => q.eq("client_id", clientId)),
    all("files", (q) => q.eq("client_id", clientId)),
  ]);
  if (!contacts || !jobContacts || !requests || !messages || !consents || !files) return FAILED("records");

  const requestIds = requests.map((r) => r.id as string);
  const responses = requestIds.length ? await all("responses", (q) => q.in("request_id", requestIds)) : [];
  if (!responses) return FAILED("responses");

  // People: the client's contacts in full, everyone else (staff who handled the work) by name only.
  const contactIds = contacts.map((c) => c.profile_id as string);
  const authorIds = [...new Set([...messages.map((m) => m.author_id), ...responses.map((r) => r.author_id), ...files.map((f) => f.uploaded_by)] as string[])];
  const { data: profiles } = await db
    .from("profiles")
    .select("id, full_name, email, phone, is_staff, created_at")
    .in("id", [...new Set([...contactIds, ...authorIds])]);
  const people = (profiles ?? []).map((p) =>
    contactIds.includes(p.id as string)
      ? p
      : { id: p.id, full_name: p.full_name, is_staff: p.is_staff }, // staff: name only, no email or phone
  );

  const { data: audit, error: auditError } = await db.rpc("admin_client_audit", { p_client: clientId });
  if (auditError) return FAILED("audit trail");

  // Which stored files can go in: not deleted, and checked clean. The others are listed, with the reason.
  const included: Row[] = [];
  const notIncluded: Row[] = [];
  for (const f of files) {
    if (f.deleted_at) notIncluded.push({ id: f.id, original_name: f.original_name, reason: "deleted under the retention rules" });
    else if (f.scan_status !== "clean") notIncluded.push({ id: f.id, original_name: f.original_name, reason: `not included: virus check status is ${f.scan_status}` });
    else included.push(f);
  }
  const total = included.reduce((n, f) => n + Number(f.size_bytes ?? 0), 0);
  if (total > MAX_TOTAL_BYTES) return json(413, { error: "This client's files are too large to export in one go." });

  // Split the files into parts.
  const parts: Row[][] = [[]];
  let size = 0;
  for (const f of included) {
    const n = Number(f.size_bytes ?? 0);
    if (size + n > PART_BYTES && parts[parts.length - 1].length > 0) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(f);
    size += n;
  }
  if (parts.length > MAX_PARTS) return json(413, { error: "This client's files are too large to export in one go." });

  const json2 = (v: unknown) => strToU8(JSON.stringify(v, null, 2));
  const stamp = new Date().toISOString();
  const readme = [
    "Everything ZenFinanceHub holds on this client, exported for a subject access request.",
    `Exported: ${stamp}`,
    "",
    "data/*.json   the records, one file per kind. Dates are UTC.",
    "files/        the stored documents that passed their virus check (large exports are split across several zips).",
    "data/files.json lists every file, including any that could not be included and why.",
    "data/messages.json includes internal staff notes (marked internal: true). Check these before disclosing anything:",
    "they may contain information about other people, or be exempt from disclosure.",
    "",
  ].join("\n");

  const urls: string[] = [];
  const stored: string[] = [];
  const used = new Set<string>();

  for (let i = 0; i < parts.length; i++) {
    const chunks: Uint8Array[] = [];
    let zipError: Error | null = null;
    const zip = new Zip((err, chunk) => {
      if (err) zipError = err;
      else chunks.push(chunk);
    });
    const addJson = (name: string, value: unknown) => {
      const e = new ZipDeflate(name, { level: 6 });
      zip.add(e);
      e.push(json2(value), true);
    };

    if (i === 0) {
      const readmeEntry = new ZipDeflate("README.txt");
      zip.add(readmeEntry);
      readmeEntry.push(strToU8(readme), true);
      addJson("data/client.json", client);
      addJson("data/contacts.json", contacts);
      addJson("data/people.json", people);
      addJson("data/jobs.json", jobs);
      addJson("data/job_contacts.json", jobContacts);
      addJson("data/requests.json", requests);
      addJson("data/responses.json", responses);
      addJson("data/consents.json", consents);
      addJson("data/messages.json", messages);
      addJson("data/files.json", { stored: files, not_included_in_zip: notIncluded });
      addJson("data/audit_trail.json", audit ?? []);
    }

    for (const f of parts[i]) {
      const { data: blob, error } = await admin.storage.from(BUCKET).download(f.storage_path as string);
      if (error || !blob) return FAILED("download");
      const base = String(f.original_name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 150) || "file";
      let name = `files/${String(f.id).slice(0, 8)}-${base}`;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `files/${String(f.id).slice(0, 8)}-${n}-${base}`;
      used.add(name.toLowerCase());
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(new Uint8Array(await blob.arrayBuffer()), true);
    }
    zip.end();
    if (zipError) return FAILED("zip");

    const path = `${crypto.randomUUID()}.zip`;
    const { error: uploadError } = await admin.storage
      .from(ZIP_BUCKET)
      .upload(path, new Blob(chunks, { type: "application/zip" }), { contentType: "application/zip" });
    if (uploadError) {
      await admin.storage.from(ZIP_BUCKET).remove(stored);
      return FAILED("store");
    }
    stored.push(path);
  }

  const removeAll = () => admin.storage.from(ZIP_BUCKET).remove(stored);

  // Fail closed: no audit entry, no download.
  const { error: logError } = await db.rpc("log_event", {
    p_action: "client_export",
    p_entity: "clients",
    p_entity_id: clientId,
    p_client_id: clientId,
  });
  if (logError) {
    await removeAll();
    return FAILED("log");
  }

  for (let i = 0; i < stored.length; i++) {
    const { data: signed, error } = await admin.storage
      .from(ZIP_BUCKET)
      .createSignedUrl(stored[i], 60, { download: stored.length === 1 ? "client-export.zip" : `client-export-part-${i + 1}-of-${stored.length}.zip` });
    if (error || !signed) {
      await removeAll();
      return FAILED("sign");
    }
    urls.push(signed.signedUrl);
  }

  // Tidy up once the links have expired.
  const cleanup = (async () => {
    await new Promise((r) => setTimeout(r, 90_000));
    await removeAll();
  })().catch(() => {});
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(cleanup);

  return json(200, { ok: true, urls, parts: urls.length });
});
