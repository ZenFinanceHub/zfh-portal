"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { templateSchema } from "@/lib/validation/request";

export type TemplateFormState = { errors?: string[]; fieldErrors?: Record<string, string>; saved?: boolean };

// RLS lets only staff write to templates.
export async function saveTemplate(
  id: string,
  _prev: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  let requests: unknown;
  try {
    requests = JSON.parse(String(formData.get("requests") ?? "[]"));
  } catch {
    return { errors: ["Something went wrong reading the requests. Please refresh and try again."] };
  }

  const parsed = templateSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    active: formData.get("active") === "on",
    requests,
  });

  if (!parsed.success) {
    const errors: string[] = [];
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "requests" && typeof issue.path[1] === "number") {
        errors.push(`Request ${issue.path[1] + 1}: ${issue.message}`);
      } else {
        fieldErrors[String(issue.path[0])] ??= issue.message;
      }
    }
    return { errors, fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { errors: ["We couldn't save that. Please try again."] };

  revalidatePath("/admin/templates");
  redirect("/admin/templates");
}
