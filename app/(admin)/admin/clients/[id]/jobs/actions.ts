"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { newJobSchema } from "@/lib/validation/request";

export type NewJobState = { errors?: Partial<Record<string, string>>; message?: string };

// The job and all its requests are created by one database function, in one transaction.
// The function itself checks the caller is staff.
export async function createJob(_prev: NewJobState, formData: FormData): Promise<NewJobState> {
  const parsed = newJobSchema.safeParse({
    client_id: formData.get("client_id"),
    template_id: formData.get("template_id"),
    title: formData.get("title") ?? "",
    service: formData.get("service"),
    period_end: formData.get("period_end") ?? "",
    due_date: formData.get("due_date") ?? "",
    assigned_to: formData.get("assigned_to") ?? "",
    contributors: formData.getAll("contributors").map(String),
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { errors };
  }

  const v = parsed.data;
  const supabase = await createClient();
  const { data: jobId, error } = await supabase.rpc("create_job_from_template", {
    p_client_id: v.client_id,
    p_template_id: v.template_id,
    p_title: v.title,
    p_service: v.service,
    // The SQL function accepts null for these three; the generated types just can't say so.
    p_period_end: v.period_end as string,
    p_due_date: v.due_date as string,
    p_assigned_to: v.assigned_to as string,
    p_contributors: v.contributors,
  });
  if (error || !jobId) return { message: "We couldn't create the job. Please check the details and try again." };

  redirect(`/admin/jobs/${jobId}`);
}
