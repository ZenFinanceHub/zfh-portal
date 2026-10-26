import Link from "next/link";
import { cardClass } from "@/components/ui/styles";
import { getMyAreas } from "@/lib/admin/areas";
import { AREAS, AREA_LABELS, isArea } from "@/lib/areas";
import { addDays, todayLondon } from "@/lib/dates";
import { formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { FINANCE_STAGE_LABELS, KIND_LABELS } from "@/lib/validation/request";

const COLUMNS =
  "id, title, kind, due_date, submitted_at, job:jobs!inner(id, title, stage, area, client:clients(name))";
const FINISHED = "(completed,cancelled)";

type Row = {
  id: string;
  title: string;
  kind: string;
  due_date: string | null;
  submitted_at: string | null;
  job: { id: string; title: string; client: { name: string } | null };
};

function Section({ id, title, empty, rows, showDue }: { id: string; title: string; empty: string; rows: Row[]; showDue: boolean }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-xl font-semibold">
        {title} <span className="text-base font-normal text-text-muted">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-text-muted">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/jobs/${r.job.id}`} className={`${cardClass} block min-h-11 !p-4 hover:border-gold`}>
                <span className="block text-base font-medium">{r.title}</span>
                <span className="block text-sm text-text-muted">
                  {r.job.client?.name} · {r.job.title} · {KIND_LABELS[r.kind]}
                  {showDue
                    ? ` · Due ${formatDate(r.due_date)}`
                    : r.submitted_at
                      ? ` · Submitted ${formatDate(r.submitted_at)}`
                      : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area: requested } = await searchParams;
  const mine = await getMyAreas();

  // Staff who haven't been given an area yet can see nothing; say so rather than showing empty lists.
  if (mine.areas.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold sm:text-3xl">Admin dashboard</h1>
        <p className={`${cardClass}`} role="status">
          You don&apos;t have access to any area yet. Ask Craig to give you Accounting or Business Finance access.
        </p>
      </div>
    );
  }

  // Default to the staff member's own areas: one area -> that area, both -> everything.
  const filter: "all" | (typeof AREAS)[number] =
    isArea(requested) && mine.areas.includes(requested) ? requested : mine.areas.length === 1 ? mine.areas[0] : "all";
  const canFilter = mine.areas.length > 1;

  const supabase = await createClient();
  const today = todayLondon();
  const byArea = <T extends { eq: (col: string, v: string) => T }>(q: T) => (filter === "all" ? q : q.eq("job.area", filter));

  // Requests on jobs that are still live. "Open" includes ones returned to the client.
  const [submitted, overdue, dueSoon] = await Promise.all([
    byArea(supabase.from("requests").select(COLUMNS).eq("status", "submitted").not("job.stage", "in", FINISHED).order("submitted_at").limit(50)),
    byArea(
      supabase.from("requests").select(COLUMNS).in("status", ["open", "returned"]).lt("due_date", today).not("job.stage", "in", FINISHED).order("due_date").limit(50),
    ),
    byArea(
      supabase
        .from("requests")
        .select(COLUMNS)
        .in("status", ["open", "returned"])
        .gte("due_date", today)
        .lte("due_date", addDays(today, 7))
        .not("job.stage", "in", FINISHED)
        .order("due_date")
        .limit(50),
    ),
  ]);

  if (submitted.error || overdue.error || dueSoon.error) {
    return (
      <p role="alert" className="text-danger">
        We couldn&apos;t load the dashboard. Please refresh the page.
      </p>
    );
  }

  // The finance pipeline only makes sense in the Finance view.
  const pipeline =
    filter === "finance"
      ? (
          await supabase
            .from("jobs")
            .select("id, title, finance_stage, client:clients(name)")
            .eq("service", "finance_application")
            .not("stage", "in", FINISHED)
            .order("created_at")
        ).data ?? []
      : null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold sm:text-3xl">Admin dashboard</h1>

      {canFilter ? (
        <nav aria-label="Area filter">
          <ul className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-line bg-surface p-1">
            {(["all", ...mine.areas] as const).map((a) => (
              <li key={a}>
                <Link
                  href={a === "all" ? "/admin?area=all" : `/admin?area=${a}`}
                  aria-current={a === filter ? "page" : undefined}
                  className={`flex min-h-11 items-center justify-center rounded-lg px-3 text-center text-base font-semibold ${
                    a === filter ? "bg-gold text-ink" : "text-text hover:text-gold-light"
                  }`}
                >
                  {a === "all" ? "Everything" : AREA_LABELS[a]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {pipeline ? (
        <section aria-labelledby="pipeline">
          <h2 id="pipeline" className="mb-3 text-xl font-semibold">
            Finance pipeline
          </h2>
          {pipeline.length === 0 ? (
            <p className="text-text-muted">No finance applications in progress.</p>
          ) : (
            <ul className="space-y-3">
              {(["gathering", "submitted", "credit_decision", "offer"] as const).map((stage) => {
                const jobs = pipeline.filter((j) => (j.finance_stage ?? "gathering") === stage);
                return (
                  <li key={stage} className={`${cardClass} !p-4`}>
                    <p className="font-medium">
                      {FINANCE_STAGE_LABELS[stage]} <span className="text-text-muted">({jobs.length})</span>
                    </p>
                    {jobs.length > 0 ? (
                      <ul className="mt-1">
                        {jobs.map((j) => (
                          <li key={j.id}>
                            <Link href={`/admin/jobs/${j.id}`} className="inline-flex min-h-11 items-center text-gold underline underline-offset-4">
                              {j.client?.name} · {j.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <Section id="submitted" title="Newly submitted" empty="Nothing waiting for review." rows={submitted.data as unknown as Row[]} showDue={false} />
      <Section id="overdue" title="Overdue" empty="Nothing overdue." rows={overdue.data as unknown as Row[]} showDue />
      <Section id="due-soon" title="Due this week" empty="Nothing due in the next 7 days." rows={dueSoon.data as unknown as Row[]} showDue />
    </div>
  );
}
