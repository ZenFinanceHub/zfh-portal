"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AREAS } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";

export type StaffAreasState = { ok?: boolean; error?: string };

// Only the admin can do this: set_staff_areas() checks, and records who changed what in the audit log.
export async function saveStaffAreas(
  profileId: string,
  _prev: StaffAreasState,
  formData: FormData,
): Promise<StaffAreasState> {
  const areas = z.array(z.enum(AREAS)).safeParse(formData.getAll("areas"));
  if (!z.uuid().safeParse(profileId).success || !areas.success) {
    return { error: "Something went wrong. Please refresh and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_staff_areas", { p_profile_id: profileId, p_areas: areas.data });
  if (error) return { error: "We couldn't save that. Only the admin can change access." };

  revalidatePath("/admin/settings");
  return { ok: true };
}
