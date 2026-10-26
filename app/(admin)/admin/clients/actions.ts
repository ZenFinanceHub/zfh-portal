"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clientSchema } from "@/lib/validation/client";

export type ClientFormState = {
  errors?: Partial<Record<string, string>>;
  message?: string;
  values?: Record<string, string>;
  version?: number;
};

const FIELDS = [
  "name",
  "entity_type",
  "company_number",
  "utr",
  "xero_contact_id",
  "year_end",
  "assigned_to",
  "status",
] as const;

// `id` is bound by the page: null creates a client, a uuid edits one.
// RLS only lets staff write to clients, so this fails for anyone else.
export async function saveClient(
  id: string | null,
  prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "")]));
  const version = (prev.version ?? 0) + 1;

  const parsed = clientSchema.safeParse(values);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      errors[key] ??= issue.message;
    }
    return { errors, values, version };
  }

  const supabase = await createClient();
  const query = id
    ? supabase.from("clients").update(parsed.data).eq("id", id)
    : supabase.from("clients").insert(parsed.data);
  const { data, error } = await query.select("id").maybeSingle();

  if (error || !data) {
    return { message: "We couldn't save that. Please check the details and try again.", values, version };
  }
  redirect(`/admin/clients/${data.id}`);
}
