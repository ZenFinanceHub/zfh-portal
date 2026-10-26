// Staff-only: invite a client contact (or link an existing user) and add them to a client.
// Uses the service role, which exists only inside Edge Functions. Errors are generic on purpose.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Hosted projects have an https API URL; the local stack does not.
const PORTAL_URL = SUPABASE_URL.startsWith("https://")
  ? "https://portal.zenfinancehub.com"
  : "http://localhost:3000";
const REDIRECT_TO = `${PORTAL_URL}/auth/callback`;

const CORS = {
  "Access-Control-Allow-Origin": PORTAL_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const bodySchema = z.object({
  client_id: z.uuid(),
  full_name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(["owner", "contributor"]),
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const DENIED = () => json(403, { error: "Not allowed." });
const FAILED = (step: string) => {
  // Log the step only, never names, emails or other personal data.
  console.error("invite-contact failed at:", step);
  return json(400, { error: "Something went wrong." });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Not allowed." });

  // 1. The caller must be a signed-in staff member who has passed MFA.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return DENIED();

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser(token);
  if (userError || !userData.user) return DENIED();
  const caller = userData.user;

  const { data: claimsData } = await asCaller.auth.getClaims(token);
  if (claimsData?.claims?.aal !== "aal2") return DENIED();

  // Read through the caller's own session so RLS applies.
  const { data: callerProfile } = await asCaller
    .from("profiles")
    .select("is_staff")
    .eq("id", caller.id)
    .maybeSingle();
  if (callerProfile?.is_staff !== true) return DENIED();

  // 2. Validate input.
  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await req.json());
  } catch {
    return FAILED("validate");
  }

  // 3. From here on, the service role.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: client } = await admin.from("clients").select("id").eq("id", input.client_id).maybeSingle();
  if (!client) return FAILED("client");

  const { data: existing } = await admin
    .from("profiles")
    .select("id, is_staff, full_name")
    .eq("email", input.email)
    .maybeSingle();

  let userId: string;
  let invited = false;
  if (existing) {
    // Staff accounts are never attached to a client as contacts.
    if (existing.is_staff) return FAILED("existing-staff");
    userId = existing.id;
    if (!existing.full_name) {
      await admin.from("profiles").update({ full_name: input.full_name }).eq("id", userId);
    }
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: REDIRECT_TO,
      data: { full_name: input.full_name },
    });
    if (error || !data.user) return FAILED("invite");
    userId = data.user.id;
    invited = true;
  }

  const { error: linkError } = await admin
    .from("client_contacts")
    .upsert({ client_id: input.client_id, profile_id: userId, role: input.role });
  if (linkError) return FAILED("link");

  // No email address or name in the audit entry.
  const { error: auditError } = await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "invite_contact",
    entity: "client_contacts",
    entity_id: userId,
    client_id: input.client_id,
    meta: { role: input.role, invited },
  });
  if (auditError) console.error("invite-contact failed at: audit");

  return json(200, { ok: true, invited });
});
