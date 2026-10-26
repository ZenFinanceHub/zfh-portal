import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isStaff, LOGIN_PATH, MFA_ENROL_PATH, MFA_VERIFY_PATH } from "./routing";

/**
 * For the MFA pages: staff who are signed in but not yet at aal2.
 * Anyone else is sent where they belong. Returns the verified TOTP factor id, if any.
 */
export async function requireStaffPendingMfa(page: "enrol" | "verify") {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(LOGIN_PATH);
  if (!(await isStaff(supabase, data.user.id))) redirect("/");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect("/admin");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factorId = factors?.totp?.[0]?.id ?? null;
  if (page === "enrol" && factorId) redirect(MFA_VERIFY_PATH);
  if (page === "verify" && !factorId) redirect(MFA_ENROL_PATH);
  return { factorId };
}
