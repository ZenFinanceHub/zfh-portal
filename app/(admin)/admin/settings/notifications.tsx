import { Holidays } from "./holidays";
import { NotificationForm } from "./notification-form";
import { cardClass } from "@/components/ui/styles";
import { todayLondon } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

const KIND_LABELS: Record<string, string> = {
  staff_urgent: "Urgent alert",
  staff_batch: "Client activity",
  staff_held: "Held alerts",
  staff_digest: "Daily digest",
  client_new_request: "New request (client)",
  client_message: "New message (client)",
  client_reminder: "Reminder (client)",
};

const STATUS_LABELS: Record<string, string> = {
  sent: "Sent",
  failed: "Failed",
  sending: "Sending",
  skipped: "Nothing to send",
};

const REGION_LABELS: Record<string, string> = { scotland: "Scotland", england_wales: "England and Wales" };

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

export async function NotificationSettings() {
  const supabase = await createClient();
  const { data: settings } = await supabase.from("notification_settings").select("*").eq("id", true).maybeSingle();
  if (!settings) {
    return (
      <p role="alert" className="text-danger">
        We couldn&apos;t load the notification settings. Please refresh the page.
      </p>
    );
  }

  const [{ data: holidays }, { data: log }] = await Promise.all([
    supabase
      .from("uk_bank_holidays")
      .select("holiday_date, name")
      .eq("region", settings.bank_holiday_region)
      .gte("holiday_date", todayLondon())
      .order("holiday_date"),
    supabase
      .from("notifications_log")
      .select("id, kind, status, event_count, sent_at, created_at")
      .neq("kind", "marker")
      .order("id", { ascending: false })
      .limit(15),
  ]);

  return (
    <div className="space-y-4">
      <p className="text-text-muted">
        The rules for who gets emailed, and when. Emails never contain file names, answers, amounts or message text.
      </p>
      <NotificationForm values={settings} />
      <Holidays
        region={settings.bank_holiday_region}
        regionLabel={REGION_LABELS[settings.bank_holiday_region] ?? settings.bank_holiday_region}
        holidays={(holidays ?? []).map((h) => ({ date: h.holiday_date, name: h.name }))}
      />
      <section className={`${cardClass} !p-4 space-y-3`} data-testid="recent-sends">
        <h2 className="text-lg font-semibold">Recent emails</h2>
        {(log ?? []).length === 0 ? (
          <p className="text-text-muted">Nothing has been sent yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {(log ?? []).map((l) => (
              <li key={l.id} className="py-2">
                <p>
                  {KIND_LABELS[l.kind] ?? l.kind} — {STATUS_LABELS[l.status] ?? l.status}
                </p>
                <p className="text-sm text-text-muted">
                  {when(l.sent_at ?? l.created_at)}
                  {l.event_count > 0 ? ` · ${l.event_count} ${l.event_count === 1 ? "item" : "items"}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
