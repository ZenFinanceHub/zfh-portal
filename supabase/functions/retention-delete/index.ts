// Admin-only: permanently deletes one file whose retention date has passed.
// The stored object is removed; the files row stays as a tombstone, and the deletion is audited.
// Nothing is ever deleted automatically: this only runs when the admin clicks "Delete" on /admin/retention.
import { z } from "npm:zod@4";
import { authenticateStaff, CORS, json, serviceClient } from "../_shared/common.ts";

const bodySchema = z.object({ file_id: z.uuid() });

const DENIED = () => json(403, { error: "Not allowed." });
const FAILED = (step: string) => {
  console.error("retention-delete failed at:", step);
  return json(400, { error: "Something went wrong." });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Not allowed." });

  const caller = await authenticateStaff(req);
  if (!caller || !caller.isAdmin) return DENIED();

  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await req.json());
  } catch {
    return FAILED("validate");
  }

  const admin = serviceClient();
  const { data: file } = await admin
    .from("files")
    .select("id, client_id, job_id, storage_path, retain_until, deleted_at")
    .eq("id", input.file_id)
    .maybeSingle();
  if (!file || file.deleted_at) return FAILED("find");

  // London date, because retention dates are calendar dates.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  if (!file.retain_until || file.retain_until >= today) return json(409, { error: "This file is not past its retention date." });

  const { error: removeError } = await admin.storage.from("client-files").remove([file.storage_path]);
  if (removeError) return FAILED("remove");

  const { error: updateError } = await admin
    .from("files")
    .update({ deleted_at: new Date().toISOString(), deleted_by: caller.id })
    .eq("id", file.id);
  if (updateError) return FAILED("tombstone");

  // No file name in the audit entry.
  const { error: auditError } = await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "file_deleted_retention",
    entity: "files",
    entity_id: file.id,
    client_id: file.client_id,
    meta: { job_id: file.job_id, retain_until: file.retain_until },
  });
  if (auditError) console.error("retention-delete failed at: audit");

  return json(200, { ok: true });
});
