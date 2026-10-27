import { adminClient } from "../../scripts/local-supabase.mjs";

// Every run creates its own throwaway staff accounts. Left alone they pile up in Settings → Staff
// until the page is too long for the tests to use, so retire the ones from earlier runs first.
// (Local Supabase only: adminClient() refuses anything that isn't 127.0.0.1.)
export default async function globalSetup() {
  const admin = adminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_staff: false, staff_role: null, staff_areas: [] })
    .like("email", "e2e.%@example.com")
    .eq("is_staff", true);
  if (error) throw new Error(`Could not tidy earlier test staff: ${error.message}`);
}
