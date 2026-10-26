// Scans uploaded files and records the result on the files row.
//
// Called three ways:
//   1. the database, when an object lands in the client-files bucket   { type: "INSERT", record: { name } }
//   2. the database, every 5 minutes, to catch stuck scans and retries { type: "SWEEP" }
//   3. a staff member, "Scan again" on the job page (MFA + area checked) { file_id }
//
// The first two come from the database and must carry the shared secret (SCAN_WEBHOOK_SECRET, sent in the
// x-webhook-secret header); without it the answer is a generic 401. Even with it, they can only scan a file
// whose result is still outstanding. The service role is used here and nowhere else; it never reaches the Next.js app.
import { authenticateStaff, json, PORTAL_URL, sendAlert, serviceClient } from "../_shared/common.ts";
import { getScanner } from "../_shared/scanner.ts";

const BUCKET = "client-files";
const RETRY_AFTER_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 2; // the first scan plus one retry

const admin = serviceClient();

/** Compares in constant time, so the secret cannot be guessed from response timing. */
function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false; // not configured means nothing gets in
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

type FileRow = {
  id: string;
  job_id: string | null;
  storage_path: string;
  original_name: string;
  scan_status: string;
  scan_attempts: number;
};

const COLUMNS = "id, job_id, storage_path, original_name, scan_status, scan_attempts";

async function alertStaff(file: FileRow) {
  const link = file.job_id ? `${PORTAL_URL}/admin/jobs/${file.job_id}` : `${PORTAL_URL}/admin`;
  await sendAlert("A file failed a virus scan — check the portal", "A file failed a virus scan — check the portal.", link);
}

/** Takes the file for scanning. Returns false if someone else has just taken it. */
async function claim(file: FileRow): Promise<boolean> {
  const recently = new Date(Date.now() - 60_000).toISOString();
  const { data } = await admin
    .from("files")
    .update({ scanned_at: new Date().toISOString() })
    .eq("id", file.id)
    .in("scan_status", ["pending", "error"])
    .or(`scanned_at.is.null,scanned_at.lt.${recently}`)
    .select("id");
  return (data?.length ?? 0) === 1;
}

async function scan(file: FileRow): Promise<string> {
  if (!(await claim(file))) return "busy";

  const { data: blob, error } = await admin.storage.from(BUCKET).download(file.storage_path);
  if (error || !blob) return "missing"; // nothing uploaded (yet); the sweep will look again

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const result = await getScanner().scanFile(bytes, { name: file.original_name });
  const attempts = file.scan_attempts + 1;
  const now = new Date().toISOString();

  if (result.status === "clean") {
    await admin
      .from("files")
      .update({ scan_status: "clean", scan_attempts: attempts, scan_retry: false, scanned_at: now })
      .eq("id", file.id);
    return "clean";
  }

  if (result.status === "infected") {
    // Delete the object, keep the row (audited by the files trigger), tell Craig.
    await admin.storage.from(BUCKET).remove([file.storage_path]);
    await admin
      .from("files")
      .update({ scan_status: "infected", scan_attempts: attempts, scan_retry: false, scanned_at: now })
      .eq("id", file.id);
    await alertStaff(file);
    return "infected";
  }

  // Error. Files that simply are not acceptable are not retried; provider problems get one more go.
  const willRetry = result.retry && attempts < MAX_ATTEMPTS;
  await admin
    .from("files")
    .update({ scan_status: "error", scan_attempts: attempts, scan_retry: willRetry, scanned_at: now })
    .eq("id", file.id);
  if (result.retry && !willRetry) await alertStaff(file);
  return "error";
}

async function byPath(path: string): Promise<FileRow | null> {
  const { data } = await admin.from("files").select(COLUMNS).eq("storage_path", path).maybeSingle();
  return data as FileRow | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Not allowed." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Something went wrong." });
  }

  try {
    // 3. Staff: "Scan again".
    if (typeof body.file_id === "string") {
      const caller = await authenticateStaff(req);
      if (!caller) return json(403, { error: "Not allowed." });
      // Read as the caller, so area rules decide whether this file exists for them.
      const { data: visible } = await caller.asCaller
        .from("files")
        .select("id")
        .eq("id", body.file_id)
        .in("scan_status", ["pending", "error"])
        .maybeSingle();
      if (!visible) return json(403, { error: "Not allowed." });

      await admin
        .from("files")
        .update({ scan_attempts: 0, scan_retry: false, scanned_at: null, scan_status: "pending" })
        .eq("id", visible.id);
      const { data: file } = await admin.from("files").select(COLUMNS).eq("id", visible.id).single();
      const outcome = await scan(file as FileRow);
      return json(200, { ok: true, outcome });
    }

    // The calls below come from the database and need the shared secret.
    if (body.type === "INSERT" || body.type === "SWEEP") {
      if (!sameSecret(req.headers.get("x-webhook-secret"), Deno.env.get("SCAN_WEBHOOK_SECRET"))) {
        return json(401, { error: "Not allowed." });
      }
    }

    // 1. A new object in the bucket.
    if (body.type === "INSERT") {
      const record = body.record as { bucket_id?: string; name?: string } | undefined;
      if (record?.bucket_id !== BUCKET || typeof record.name !== "string") return json(200, { ok: true });
      const file = await byPath(record.name);
      if (file && file.scan_status === "pending") await scan(file);
      return json(200, { ok: true });
    }

    // 2. The sweep: pending too long, or an error worth one more try.
    if (body.type === "SWEEP") {
      const cutoff = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
      const [{ data: stuck }, { data: retries }] = await Promise.all([
        admin
          .from("files")
          .select(COLUMNS)
          .eq("scan_status", "pending")
          .is("deleted_at", null)
          .lt("created_at", cutoff)
          .limit(20),
        admin
          .from("files")
          .select(COLUMNS)
          .eq("scan_status", "error")
          .eq("scan_retry", true)
          .is("deleted_at", null)
          .lt("scanned_at", cutoff)
          .limit(20),
      ]);
      for (const file of [...(stuck ?? []), ...(retries ?? [])] as FileRow[]) await scan(file);
      return json(200, { ok: true });
    }

    return json(400, { error: "Something went wrong." });
  } catch {
    // No file details in logs.
    console.error("scan-file failed");
    return json(500, { error: "Something went wrong." });
  }
});
