import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * How many things this person can still act on, across all their clients and areas.
 * Approvals and consents only count for account owners, matching the Things to do list.
 */
export async function countOpenItems(supabase: SupabaseClient<Database>, userId: string): Promise<number> {
  const { data: memberships } = await supabase.from("client_contacts").select("client_id, role").eq("profile_id", userId);
  const roleByClient = new Map((memberships ?? []).map((m) => [m.client_id, m.role]));
  const clientIds = [...roleByClient.keys()];
  if (clientIds.length === 0) return 0;

  const { data } = await supabase
    .from("requests")
    .select("kind, job:jobs!inner(client_id, stage)")
    .in("status", ["open", "returned"])
    .in("job.client_id", clientIds)
    .not("job.stage", "in", "(completed,cancelled)");

  return (data ?? []).filter(
    (r) => !(["approval", "consent"].includes(r.kind) && roleByClient.get(r.job.client_id) !== "owner"),
  ).length;
}
