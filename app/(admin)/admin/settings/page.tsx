import { StaffRow } from "./staff-row";
import { cardClass } from "@/components/ui/styles";
import { getMyAreas } from "@/lib/admin/areas";
import { orderedAreas } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";

// Settings has one tab for now (Staff). Notification rules join it in a later step.
export default async function SettingsPage() {
  const { isAdmin } = await getMyAreas();

  if (!isAdmin) {
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Settings</h1>
        <p className={cardClass} role="status">
          Only the admin can change settings.
        </p>
      </>
    );
  }

  const supabase = await createClient();
  const { data: staff, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, staff_role, staff_areas")
    .eq("is_staff", true)
    .order("email");

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Settings</h1>
      <nav aria-label="Settings" className="mb-6 border-b border-line">
        <span className="inline-flex min-h-11 items-center border-b-2 border-gold px-2 text-base font-semibold" aria-current="page">
          Staff
        </span>
      </nav>

      <p className="mb-4 text-text-muted">
        Choose which areas each team member can work in. They only see the clients, jobs and files in those areas.
        New team members start with no access.
      </p>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the team. Please refresh the page.
        </p>
      ) : (
        <ul className="space-y-3">
          {(staff ?? []).map((s) => (
            <StaffRow
              key={s.id}
              id={s.id}
              name={s.full_name || s.email}
              email={s.email}
              isAdmin={s.staff_role === "admin"}
              areas={orderedAreas(s.staff_areas)}
            />
          ))}
        </ul>
      )}
    </>
  );
}
