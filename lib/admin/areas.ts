import { AREAS, orderedAreas, type Area } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in staff member's role and areas, for choosing what to *show* (filters, menus).
 * The database enforces access itself; this never grants anything.
 */
export async function getMyAreas(): Promise<{ isAdmin: boolean; areas: Area[] }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { isAdmin: false, areas: [] };

  const { data } = await supabase
    .from("profiles")
    .select("staff_role, staff_areas")
    .eq("id", auth.user.id)
    .maybeSingle();

  const isAdmin = data?.staff_role === "admin";
  return { isAdmin, areas: isAdmin ? [...AREAS] : orderedAreas(data?.staff_areas ?? []) };
}
