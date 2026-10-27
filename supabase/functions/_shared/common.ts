// Small helpers shared by the file-related edge functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Hosted projects have an https API URL; the local stack does not.
export const PORTAL_URL = SUPABASE_URL.startsWith("https://")
  ? "https://portal.zenfinancehub.com"
  : "http://localhost:3000";

export const CORS = {
  "Access-Control-Allow-Origin": PORTAL_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

export function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export const serviceClient = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export type Caller = { id: string; asCaller: SupabaseClient; isAdmin: boolean };

/** A signed-in staff member who has passed MFA, or null. Reads go through the caller's own session (RLS applies). */
export async function authenticateStaff(req: Request): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error } = await asCaller.auth.getUser(token);
  if (error || !userData.user) return null;
  const { data: claims } = await asCaller.auth.getClaims(token);
  if (claims?.claims?.aal !== "aal2") return null;
  const { data: profile } = await asCaller
    .from("profiles")
    .select("is_staff, staff_role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profile?.is_staff !== true) return null;
  return { id: userData.user.id, asCaller, isAdmin: profile.staff_role === "admin" };
}

// Staff alert email. Content is fixed text plus a link: no file names, client names or answers.
export async function sendAlert(subject: string, intro: string, link: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.error("alert email not sent: RESEND_API_KEY is not set");
    return false;
  }
  const html = `<p>${intro}</p><p><a href="${link}">Open the portal</a></p>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "ZenFinanceHub <portal@mail.zenfinancehub.com>",
        reply_to: "craig@zen-finance.co.uk",
        to: ["craig@zen-finance.co.uk"],
        subject,
        html,
        text: `${intro}\n\n${link}`,
      }),
    });
    if (!res.ok) console.error("alert email failed with status", res.status);
    return res.ok;
  } catch {
    console.error("alert email failed to send");
    return false;
  }
}

/** Compares in constant time, so a shared secret cannot be guessed from response timing. Unset means nothing gets in. */
export function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
