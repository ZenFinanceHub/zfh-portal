// Staff-only: zips a job's documents and returns a 60-second download link.
//   kind "all"          every clean file on the job (shared and internal)
//   kind "lender_pack"  finance applications only: the client's own clean uploads on upload requests,
//                       and only once a lender_share consent has been recorded for the job
// The job and files are read as the caller (MFA + area rules apply). The service role is used only to read
// the stored objects and to hold the temporary zip. Nothing personal goes in logs.
import { Zip, ZipPassThrough } from "npm:fflate@0.8.3";
import { z } from "npm:zod@4";
import { authenticateStaff, CORS, json, serviceClient } from "../_shared/common.ts";

const BUCKET = "client-files";
const ZIP_BUCKET = "job-zips";
// Edge functions have limited memory: the zip is built in memory, so cap what goes into one.
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

const bodySchema = z.object({ job_id: z.uuid(), kind: z.enum(["all", "lender_pack"]) });

const DENIED = () => json(403, { error: "Not allowed." });
const FAILED = (step: string) => {
  console.error("job-zip failed at:", step);
  return json(400, { error: "Something went wrong." });
};

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Not allowed." });

  const caller = await authenticateStaff(req);
  if (!caller) return DENIED();

  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await req.json());
  } catch {
    return FAILED("validate");
  }

  const admin = serviceClient();

  // The job, as the caller: not found means no access (area rules).
  const { data: job } = await caller.asCaller
    .from("jobs")
    .select("id, client_id, service")
    .eq("id", input.job_id)
    .maybeSingle();
  if (!job) return DENIED();

  if (input.kind === "lender_pack") {
    if (job.service !== "finance_application") return json(400, { error: "Lender packs are for finance applications." });
    const { data: consent } = await caller.asCaller
      .from("consents")
      .select("id")
      .eq("job_id", job.id)
      .eq("consent_type", "lender_share")
      .limit(1)
      .maybeSingle();
    if (!consent) return json(409, { error: "The client has not given permission to share with lenders yet." });
  }

  // The files, as the caller.
  const { data: rows } = await caller.asCaller
    .from("files")
    .select("id, storage_path, original_name, size_bytes, uploaded_by, request:requests(kind)")
    .eq("job_id", job.id)
    .eq("scan_status", "clean")
    .order("created_at");
  let files = rows ?? [];

  if (input.kind === "lender_pack") {
    // Only what the client sent in answer to upload requests, not staff documents.
    const uploaderIds = [...new Set(files.map((f) => f.uploaded_by))];
    const { data: uploaders } = await admin.from("profiles").select("id, is_staff").in("id", uploaderIds);
    const staffIds = new Set((uploaders ?? []).filter((p) => p.is_staff).map((p) => p.id));
    files = files.filter((f) => {
      const request = Array.isArray(f.request) ? f.request[0] : f.request;
      return request?.kind === "upload" && !staffIds.has(f.uploaded_by);
    });
  }

  if (files.length === 0) return json(404, { error: "There are no files to download yet." });
  const total = files.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0);
  if (total > MAX_TOTAL_BYTES) return json(413, { error: "These files are too large to zip in one go." });

  // Build the zip. Documents are already compressed, so they are stored as they are.
  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err;
    else chunks.push(chunk);
  });
  const used = new Set<string>();
  for (const f of files) {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(f.storage_path);
    if (error || !blob) return FAILED("download");
    const base = f.original_name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 150) || "file";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const dot = base.lastIndexOf(".");
      name = dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
    }
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
  if (uploadError) return FAILED("store");

  const remove = () => admin.storage.from(ZIP_BUCKET).remove([path]);

  // Fail closed: no audit entry, no download. Logged as the caller.
  const { error: logError } = await caller.asCaller.rpc("log_event", {
    p_action: input.kind === "lender_pack" ? "lender_pack_download" : "job_zip_download",
    p_entity: "jobs",
    p_entity_id: job.id,
    p_client_id: job.client_id,
  });
  if (logError) {
    await remove();
    return FAILED("audit");
  }

  const { data: signed, error: signError } = await admin.storage
    .from(ZIP_BUCKET)
    .createSignedUrl(path, 60, { download: input.kind === "lender_pack" ? "lender-pack.zip" : "documents.zip" });
  if (signError || !signed) {
    await remove();
    return FAILED("sign");
  }

  // Tidy up once the link has expired, and sweep anything left over from earlier.
  const cleanup = (async () => {
    await new Promise((r) => setTimeout(r, 90_000));
    await remove();
    const { data: old } = await admin.storage.from(ZIP_BUCKET).list("", { limit: 100 });
    const stale = (old ?? []).filter((o) => Date.now() - new Date(o.created_at ?? Date.now()).getTime() > 60 * 60 * 1000);
    if (stale.length) await admin.storage.from(ZIP_BUCKET).remove(stale.map((o) => o.name));
  })().catch(() => {});
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(cleanup);

  return json(200, { ok: true, url: signed.signedUrl });
});
