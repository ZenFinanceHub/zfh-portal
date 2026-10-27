"use server";

import { asLimited, waitPhrase } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { totpCodeSchema } from "@/lib/validation/auth";

export type CodeResult = { ok: true } | { ok: false; error: string };

// Checks an authenticator code for the signed-in person. Attempts are counted per person (10 in 15 minutes) so a
// stolen sign-in link cannot be used to guess codes through the portal.
export async function verifyAuthenticatorCode(factorId: string, code: string): Promise<CodeResult> {
  const parsed = totpCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Please sign in again." };

  const { data: limit, error: limitError } = await supabase.rpc("rate_limit_mfa");
  const limited = asLimited(limit);
  if (limitError) console.error("rate_limit_mfa failed"); // no one is locked out because the counter had a problem
  if (limited && !limited.allowed) {
    return { ok: false, error: `Too many attempts. Please wait ${waitPhrase(limited.retry_after)} and try again.` };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: parsed.data });
  if (error) return { ok: false, error: "That code isn't right. Check the latest code in your app and try again." };
  return { ok: true };
}
