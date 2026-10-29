import Link from "next/link";
import { ConnectedApps } from "./connected-apps";
import { NotificationSettings } from "./notifications";
import { PrivacyNotice } from "./privacy-notice";
import { StaffRow } from "./staff-row";
import { cardClass } from "@/components/ui/styles";
import { getMyAreas } from "@/lib/admin/areas";
import { orderedAreas } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";

const TABS = [
  { id: "staff", label: "Staff" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy notice" },
  { id: "connected", label: "Connected apps" },
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
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

  const { tab: requested } = await searchParams;
  const tab = requested === "notifications" || requested === "connected" || requested === "privacy" ? requested : "staff";

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Settings</h1>
      <nav aria-label="Settings" className="mb-6 flex gap-2 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "staff" ? "/admin/settings" : `/admin/settings?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={`inline-flex min-h-11 items-center border-b-2 px-2 text-base ${
              t.id === tab ? "border-gold font-semibold" : "border-transparent text-text-muted hover:text-gold-light"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "notifications" ? (
        <NotificationSettings />
      ) : tab === "privacy" ? (
        <PrivacyNotice />
      ) : tab === "connected" ? (
        <ConnectedApps />
      ) : (
        <StaffTab />
      )}
    </>
  );
}

async function StaffTab() {
  const supabase = await createClient();
  const { data: staff, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, staff_role, staff_areas")
    .eq("is_staff", true)
    .order("email");

  return (
    <>
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
