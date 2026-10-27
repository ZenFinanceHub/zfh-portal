"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RemindersState = { ok?: boolean; error?: string };

// Only the person's own row can change (row-level security), and only this one column is writable.
export async function saveReminders(_prev: RemindersState, formData: FormData): Promise<RemindersState> {
  const on = formData.get("email_reminders") === "on";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Please sign in again." };

  const { error } = await supabase.from("profiles").update({ email_reminders: on }).eq("id", auth.user.id);
  if (error) return { error: "We couldn't save that. Please try again." };

  revalidatePath("/account");
  return { ok: true };
}
