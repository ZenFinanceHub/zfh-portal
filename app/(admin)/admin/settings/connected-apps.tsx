import { revokeConnectorGrant } from "./actions";
import { cardClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/server";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

const ACTION_LABELS: Record<string, string> = {
  connector_approved: "Approved Claude",
  connector_revoked: "Switched Claude off",
  connector_job_created: "Created a job",
  connector_requests_added: "Added requests",
  connector_message_sent: "Sent a client message",
  connector_note_added: "Added an internal note",
};

// Keep in step with private.connector_grant_days() in the database.
const GRANT_DAYS = 7;
const isExpired = (approvedAt: string) => new Date(approvedAt).getTime() < Date.now() - GRANT_DAYS * 86_400_000;

export async function ConnectedApps() {
  const supabase = await createClient();
  const [{ data: grants }, { data: activity }] = await Promise.all([
    supabase
      .from("connector_grants")
      .select("id, approved_at, revoked_at, profiles!connector_grants_user_id_fkey(full_name, email)")
      .order("approved_at", { ascending: false }),
    supabase
      .from("audit_log")
      .select("id, actor_id, action, created_at, meta")
      .like("action", "connector_%")
      .order("id", { ascending: false })
      .limit(15),
  ]);

  const actorIds = [...new Set((activity ?? []).map((a) => a.actor_id).filter((x): x is string => !!x))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const nameOf = new Map((actors ?? []).map((p) => [p.id, p.full_name || p.email]));

  return (
    <div className="space-y-4" data-testid="connected-apps">
      <section className={`${cardClass} !p-4 space-y-3`}>
        <h2 className="text-lg font-semibold">Claude</h2>
        <p className="text-sm text-text-muted">
          Team members who have connected Claude to the portal. Each approval lasts {GRANT_DAYS} days and needs an
          authenticator code. Switching one off stops it straight away.
        </p>
        {!grants?.length ? (
          <p className="text-text-muted">Nobody has connected Claude.</p>
        ) : (
          <ul className="divide-y divide-line">
            {grants.map((g) => {
              const person = Array.isArray(g.profiles) ? g.profiles[0] : g.profiles;
              const expired = isExpired(g.approved_at);
              const status = g.revoked_at ? "Switched off" : expired ? "Expired" : "Active";
              return (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="connector-grant">
                  <div>
                    <p className="font-medium">{person?.full_name || person?.email}</p>
                    <p className="text-sm text-text-muted">
                      {status} · approved {when(g.approved_at)}
                    </p>
                  </div>
                  {status === "Active" ? (
                    <form action={revokeConnectorGrant.bind(null, g.id)}>
                      <button
                        type="submit"
                        className="inline-flex min-h-11 items-center rounded-lg border border-danger px-4 text-danger hover:bg-danger/10"
                      >
                        Switch off
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={`${cardClass} !p-4 space-y-3`}>
        <h2 className="text-lg font-semibold">What Claude has done</h2>
        {!activity?.length ? (
          <p className="text-text-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="connector-activity">
            {activity.map((a) => {
              const count = (a.meta as { count?: number } | null)?.count;
              return (
                <li key={a.id} className="py-2 text-sm">
                  <span className="text-text-muted">{when(a.created_at)}</span> · {nameOf.get(a.actor_id ?? "") ?? "Someone"} ·{" "}
                  {ACTION_LABELS[a.action] ?? "Used Claude"}
                  {typeof count === "number" ? ` (${count})` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
