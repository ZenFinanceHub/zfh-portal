"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { asLimited } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validation/auth";

export type LoginState = { sent: boolean; invalid?: boolean; limited?: boolean; wait?: number };

// The same result is returned whether or not the email belongs to an account,
// so this form can never be used to find out who has one.
export async function requestSignInLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { sent: false, invalid: true };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");

  const supabase = await createClient();

  // At most 5 links an hour per email address and 20 per IP address. Counted for every address, whether or not it
  // belongs to an account, and answered the same way, so this can't be used to find out who has one.
  // (Vercel sets x-forwarded-for itself; a visitor cannot choose it.)
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const { data: limit, error: limitError } = await supabase.rpc("rate_limit_magic_link", { p_email: parsed.data, p_ip: ip });
  const limited = asLimited(limit);
  if (limitError) console.error("rate_limit_magic_link failed"); // a broken counter should not stop everyone signing in
  if (limited && !limited.allowed) return { sent: false, limited: true, wait: limited.retry_after };

  await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${proto}://${host}/auth/callback` },
  });
  // Errors (unknown email, rate limit) are deliberately ignored.
  return { sent: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}
