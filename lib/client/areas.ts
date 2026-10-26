import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { orderedAreas, type Area } from "@/lib/areas";

/** The areas in which this person has at least one job (row-level security limits it to their own). */
export async function getClientAreas(supabase: SupabaseClient<Database>): Promise<Area[]> {
  const { data } = await supabase.from("jobs").select("area");
  return orderedAreas((data ?? []).map((j) => j.area));
}
