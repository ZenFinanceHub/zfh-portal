"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  FINANCE_STAGES,
  STAGES,
  noteSchema,
  parseOptions,
  requestSchema,
  returnSchema,
} from "@/lib/validation/request";

// All writes here run as the signed-in staff member, so RLS applies (staff only).
// Every job and request status change is recorded in audit_log by database triggers.

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; version?: number };

const refresh = (jobId: string) => revalidatePath(`/admin/jobs/${jobId}`);

function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

// ── Job ──────────────────────────────────────────────────────
export async function setStage(jobId: string, formData: FormData) {
  const stage = z.enum(STAGES).safeParse(formData.get("stage"));
  if (!stage.success) return;
  const supabase = await createClient();
  await supabase.from("jobs").update({ stage: stage.data }).eq("id", jobId);
  refresh(jobId);
}

export async function setFinanceStage(jobId: string, formData: FormData) {
  const stage = z.enum(FINANCE_STAGES).safeParse(formData.get("finance_stage"));
  if (!stage.success) return;
  const supabase = await createClient();
  // Only finance applications carry a finance stage.
  await supabase.from("jobs").update({ finance_stage: stage.data }).eq("id", jobId).eq("service", "finance_application");
  refresh(jobId);
}

// ── Requests ─────────────────────────────────────────────────
function requestInput(formData: FormData) {
  return {
    kind: formData.get("kind"),
    title: formData.get("title") ?? "",
    help_text: formData.get("help_text") ?? "",
    question_type: formData.get("question_type") || null,
    options: parseOptions(String(formData.get("options") ?? "")),
    consent_type: formData.get("consent_type") || null,
    due_date: formData.get("due_date") ?? "",
  };
}

export async function addRequest(jobId: string, prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = requestSchema.safeParse(requestInput(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), version: prev.version };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("requests")
    .select("sort_order")
    .eq("job_id", jobId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from("requests")
    .insert({ ...parsed.data, job_id: jobId, sort_order: (last?.sort_order ?? -1) + 1 });
  if (error) return { error: "We couldn't add that request. Please try again.", version: prev.version };

  refresh(jobId);
  return { ok: true, version: (prev.version ?? 0) + 1 };
}

export async function updateRequest(
  jobId: string,
  requestId: string,
  prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = requestSchema.safeParse(requestInput(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), version: prev.version };

  const { kind: _kind, ...changes } = parsed.data; // the kind of an existing request never changes
  void _kind;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .update(changes)
    .eq("id", requestId)
    .eq("job_id", jobId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "We couldn't save that request. Please try again.", version: prev.version };

  refresh(jobId);
  return { ok: true, version: (prev.version ?? 0) + 1 };
}

export async function cancelRequest(jobId: string, requestId: string) {
  const supabase = await createClient();
  await supabase
    .from("requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("job_id", jobId)
    .in("status", ["open", "returned", "submitted"]);
  refresh(jobId);
}

export async function acceptRequest(jobId: string, requestId: string) {
  const supabase = await createClient();
  await supabase
    .from("requests")
    .update({ status: "accepted", return_reason: null })
    .eq("id", requestId)
    .eq("job_id", jobId)
    .eq("status", "submitted");
  refresh(jobId);
}

// Returning reopens the request for the client (they see the reason and can submit again).
export async function returnRequest(
  jobId: string,
  requestId: string,
  prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = returnSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), version: prev.version };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .update({ status: "returned", return_reason: parsed.data.reason })
    .eq("id", requestId)
    .eq("job_id", jobId)
    .eq("status", "submitted")
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "That request is no longer waiting for review.", version: prev.version };

  refresh(jobId);
  return { ok: true, version: (prev.version ?? 0) + 1 };
}

export async function addPendingRequest(jobId: string, index: number, formData: FormData) {
  const due = String(formData.get("due_date") ?? "").trim();
  const supabase = await createClient();
  await supabase.rpc("add_pending_request", {
    p_job_id: jobId,
    p_index: index,
    p_due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : undefined,
  });
  refresh(jobId);
}

// ── Internal notes (staff only: messages.internal = true) ────
export async function addNote(jobId: string, prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = noteSchema.safeParse({ body: formData.get("body") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), version: prev.version };

  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({ job_id: jobId, body: parsed.data.body, internal: true });
  if (error) return { error: "We couldn't save that note. Please try again.", version: prev.version };

  refresh(jobId);
  return { ok: true, version: (prev.version ?? 0) + 1 };
}
