import Link from "next/link";
import { AreaTabs } from "@/components/area-tabs";
import { cardClass, primaryButtonInlineClass } from "@/components/ui/styles";
import { todayLondon } from "@/lib/dates";
import { CLIENT_ACTION_LABELS, formatDate } from "@/lib/labels";
import { resolveArea } from "@/lib/areas";
import { getClientAreas } from "@/lib/client/areas";
import { createClient } from "@/lib/supabase/server";

export default async function ThingsToDoPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area: requestedArea } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user!.id;

  // Which clients this person belongs to, and as what.
  const { data: memberships } = await supabase
    .from("client_contacts")
    .select("client_id, role, client:clients(name)")
    .eq("profile_id", userId);
  const roleByClient = new Map((memberships ?? []).map((m) => [m.client_id, m.role]));
  const nameByClient = new Map((memberships ?? []).map((m) => [m.client_id, m.client?.name ?? ""]));
  const clientIds = [...roleByClient.keys()];

  // Tabs only when the person has jobs in both areas.
  const areas = await getClientAreas(supabase);
  const showTabs = areas.length > 1;
  const area = resolveArea(requestedArea, areas);

  let query = supabase
        .from("requests")
        .select("id, title, help_text, kind, due_date, status, return_reason, created_at, job:jobs!inner(id, client_id, stage)")
        .in("status", ["open", "returned"])
        .in("job.client_id", clientIds)
        .not("job.stage", "in", "(completed,cancelled)")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at");
  if (showTabs) query = query.eq("job.area", area);
  const { data: rows, error } = clientIds.length ? await query : { data: [], error: null };

  // Only account owners can approve or consent, so those never appear as something to do for a contributor.
  const items = (rows ?? []).filter(
    (r) => !(["approval", "consent"].includes(r.kind) && roleByClient.get(r.job.client_id) !== "owner"),
  );

  if (error) {
    return (
      <p role="alert" className="text-danger">
        We couldn&apos;t load your list just now. Please refresh the page.
      </p>
    );
  }

  const today = todayLondon();
  const groupByClient = clientIds.length > 1;
  const groups = groupByClient
    ? clientIds
        .map((id) => ({ id, name: nameByClient.get(id) ?? "", items: items.filter((i) => i.job.client_id === id) }))
        .filter((g) => g.items.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [{ id: "all", name: "", items }];

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Things to do</h1>
      {showTabs ? <AreaTabs areas={areas} current={area} fromAddress={requestedArea !== undefined} /> : null}

      {items.length === 0 ? (
        <div className={cardClass}>
          <p className="text-lg">You&apos;re all up to date — nothing needed from you right now.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.id} aria-label={g.name || "Things to do"}>
              {groupByClient ? <h2 className="mb-3 text-xl font-semibold">{g.name}</h2> : null}
              <ul className="space-y-4">
                {g.items.map((r) => {
                  const overdue = !!r.due_date && r.due_date < today;
                  return (
                    <li key={r.id} className={`${cardClass} !p-4 sm:!p-6 space-y-3`} data-testid="todo">
                      <div>
                        <h3 className="text-lg font-semibold">{r.title}</h3>
                        {r.help_text ? <p className="mt-1 text-text-muted">{r.help_text}</p> : null}
                      </div>

                      {r.status === "returned" && r.return_reason ? (
                        <div className="rounded-lg border-2 border-gold p-3" role="note">
                          <p className="font-semibold text-gold-light">We need a little more from you</p>
                          <p className="mt-1">{r.return_reason}</p>
                        </div>
                      ) : null}

                      {r.due_date ? (
                        <p className={overdue ? "text-gold-light" : "text-text-muted"}>
                          {overdue
                            ? `This was due on ${formatDate(r.due_date)}. No problem — please send it when you can.`
                            : `Due ${formatDate(r.due_date)}`}
                        </p>
                      ) : null}

                      <Link href={`/jobs/${r.job.id}/requests/${r.id}`} className={primaryButtonInlineClass}>
                        {r.status === "returned" ? "Update and resend" : CLIENT_ACTION_LABELS[r.kind]}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
