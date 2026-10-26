import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

export const LOGIN_PATH = "/auth/login";
export const MFA_ENROL_PATH = "/auth/mfa/enrol";
export const MFA_VERIFY_PATH = "/auth/mfa/verify";

/** Where a staff member must go to reach aal2, or null if they already have it. */
export async function staffMfaRedirect(supabase: Client): Promise<string | null> {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") return null;
  // `totp` only lists verified factors.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  return factors?.totp?.length ? MFA_VERIFY_PATH : MFA_ENROL_PATH;
}

export async function isStaff(supabase: Client, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("is_staff").eq("id", userId).maybeSingle();
  return data?.is_staff === true;
}
