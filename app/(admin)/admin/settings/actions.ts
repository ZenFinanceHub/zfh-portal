"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AREAS } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";
import { holidaySchema, notificationSettingsSchema } from "@/lib/validation/notifications";

export type StaffAreasState = { ok?: boolean; error?: string };

// Only the admin can do this: set_staff_areas() checks, and records who changed what in the audit log.
export async function saveStaffAreas(
  profileId: string,
  _prev: StaffAreasState,
  formData: FormData,
): Promise<StaffAreasState> {
  const areas = z.array(z.enum(AREAS)).safeParse(formData.getAll("areas"));
  if (!z.uuid().safeParse(profileId).success || !areas.success) {
    return { error: "Something went wrong. Please refresh and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_staff_areas", { p_profile_id: profileId, p_areas: areas.data });
  if (error) return { error: "We couldn't save that. Only the admin can change access." };

  revalidatePath("/admin/settings");
  return { ok: true };
}

// ── Notifications ────────────────────────────────────────────
export type NotificationState = { ok?: boolean; error?: string };

// Only the admin can write these tables (row-level security); every change is audited by the database.
export async function saveNotificationSettings(_prev: NotificationState, formData: FormData): Promise<NotificationState> {
  const flag = (name: string) => formData.get(name) === "on";
  const parsed = notificationSettingsSchema.safeParse({
    staff_batch_minutes: formData.get("staff_batch_minutes"),
    client_bundle_minutes: formData.get("client_bundle_minutes"),
    quiet_start: formData.get("quiet_start"),
    quiet_end: formData.get("quiet_end"),
    urgent_approvals: flag("urgent_approvals"),
    urgent_lender_consents: flag("urgent_lender_consents"),
    urgent_finance_activity: flag("urgent_finance_activity"),
    digest_enabled: flag("digest_enabled"),
    digest_time: formData.get("digest_time"),
    fallback_email: String(formData.get("fallback_email") ?? "").trim(),
    reminders_enabled: flag("reminders_enabled"),
    reminder_days: String(formData.get("reminder_days") ?? ""),
    bank_holiday_region: formData.get("bank_holiday_region"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the settings and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("notification_settings").update(parsed.data).eq("id", true).select("id");
  if (error || !data?.length) return { error: "We couldn't save that. Only the admin can change these settings." };

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function addBankHoliday(region: string, _prev: NotificationState, formData: FormData): Promise<NotificationState> {
  const parsed = holidaySchema.safeParse({ holiday_date: formData.get("holiday_date"), name: formData.get("name") });
  if (!parsed.success || !["scotland", "england_wales"].includes(region)) {
    return { error: parsed.success ? "Something went wrong. Please refresh and try again." : parsed.error.issues[0].message };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("uk_bank_holidays").insert({ region, ...parsed.data });
  if (error) {
    return { error: error.code === "23505" ? "That day is already on the list." : "We couldn't add that. Only the admin can change the list." };
  }
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function removeBankHoliday(region: string, date: string): Promise<void> {
  if (!["scotland", "england_wales"].includes(region) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const supabase = await createClient();
  await supabase.from("uk_bank_holidays").delete().eq("region", region).eq("holiday_date", date);
  revalidatePath("/admin/settings");
}

// ── Privacy notice link ──────────────────────────────────────
const privacyUrlSchema = z
  .string()
  .trim()
  .max(500, "That address is too long.")
  .refine((v) => v === "" || /^https:\/\/[A-Za-z0-9][^\s<>"']*$/.test(v), "Enter an address that starts with https://");

// Admin only: set_privacy_notice_url() checks, and records that it changed (not the address itself).
export async function savePrivacyNoticeUrl(_prev: NotificationState, formData: FormData): Promise<NotificationState> {
  const parsed = privacyUrlSchema.safeParse(String(formData.get("privacy_notice_url") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter an address that starts with https://" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_privacy_notice_url", { p_url: parsed.data });
  if (error) return { error: "We couldn't save that. Only the admin can change this." };

  revalidatePath("/admin/settings");
  return { ok: true };
}

// ── Connected apps ───────────────────────────────────────────
// Admin only (the database checks). The grant stops working at once; for the admin's own connection the Supabase
// consent and tokens are ended through Supabase's own call too.
export async function revokeConnectorGrant(grantId: string): Promise<void> {
  if (!z.uuid().safeParse(grantId).success) return;
  const supabase = await createClient();
  const { data: grant } = await supabase.from("connector_grants").select("user_id, client_id").eq("id", grantId).maybeSingle();
  const { error } = await supabase.rpc("connector_revoke_grant", { p_grant_id: grantId });
  if (!error && grant) {
    const { data } = await supabase.auth.getUser();
    if (data.user?.id === grant.user_id) await supabase.auth.oauth.revokeGrant({ clientId: grant.client_id });
  }
  revalidatePath("/admin/settings");
}
