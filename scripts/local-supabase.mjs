// Helpers for LOCAL development and tests only.
// Reads the local keys from `npx supabase status` at run time (nothing is written to disk)
// and refuses to continue unless the API is on 127.0.0.1.
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

export function getLocal() {
  const res = spawnSync("npx supabase status -o json", { encoding: "utf8", shell: true });
  const out = res.stdout ?? "";
  const start = out.indexOf("{");
  if (res.status !== 0 || start === -1) {
    throw new Error("Could not read `npx supabase status`. Is local Supabase running (npx supabase start)?");
  }
  const status = JSON.parse(out.slice(start));
  const apiUrl = status.API_URL;
  if (new URL(apiUrl).hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run: API URL is ${apiUrl}, not 127.0.0.1.`);
  }
  return { apiUrl, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY };
}

export function adminClient(local = getLocal()) {
  return createClient(local.apiUrl, local.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Creates (or finds) a user and sets their profile role. Returns the user id.
 * Staff are admins unless `areas` is given, in which case they are ordinary staff limited to those areas.
 */
export async function ensureUser(admin, { email, staff = false, areas }) {
  let id;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) {
    const { data } = await admin.from("profiles").select("id").eq("email", email).single();
    if (!data) throw new Error(`Could not create or find ${email}: ${created.error.message}`);
    id = data.id;
  } else {
    id = created.data.user.id;
  }
  const { error } = await admin
    .from("profiles")
    .update({
      is_staff: staff,
      staff_role: staff ? (areas ? "staff" : "admin") : null,
      staff_areas: staff && areas ? areas : [],
    })
    .eq("id", id);
  if (error) throw new Error(`Could not set role for ${email}: ${error.message}`);
  return id;
}

/** Makes the user the owner of a client with the given name, creating it if needed. */
export async function ensureClientOwner(admin, userId, clientName) {
  let { data: client } = await admin.from("clients").select("id").eq("name", clientName).maybeSingle();
  if (!client) {
    const res = await admin
      .from("clients")
      .insert({ name: clientName, entity_type: "limited_company" })
      .select("id")
      .single();
    if (res.error) throw new Error(res.error.message);
    client = res.data;
  }
  const { error } = await admin
    .from("client_contacts")
    .upsert({ client_id: client.id, profile_id: userId, role: "owner" });
  if (error) throw new Error(error.message);
  return client.id;
}

/** Fresh magic-link token for a user, usable at /auth/callback?token_hash=…&type=magiclink */
export async function magicLinkToken(admin, email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(error.message);
  return data.properties.hashed_token;
}
