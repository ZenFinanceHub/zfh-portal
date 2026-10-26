import { createClient } from "@/lib/supabase/server";

/** Staff members who can be assigned to a client. Staff can read all profiles via RLS. */
export async function listStaff() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("is_staff", true)
    .order("full_name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email }));
}
