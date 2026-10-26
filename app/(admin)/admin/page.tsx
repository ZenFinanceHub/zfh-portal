import Link from "next/link";
import { cardClass } from "@/components/ui/styles";
import { addDays, todayLondon } from "@/lib/dates";
import { formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { KIND_LABELS } from "@/lib/validation/request";

const COLUMNS =
  "id, title, kind, due_date, submitted_at, job:jobs!inner(id, title, stage, client:clients(name))";
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

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const today = todayLondon();

  // Requests on jobs that are still live. "Open" includes ones returned to the client.
  const [submitted, overdue, dueSoon] = await Promise.all([
    supabase
      .from("requests")
      .select(COLUMNS)
      .eq("status", "submitted")
      .not("job.stage", "in", FINISHED)
      .order("submitted_at")
      .limit(50),
    supabase
      .from("requests")
      .select(COLUMNS)
      .in("status", ["open", "returned"])
      .lt("due_date", today)
      .not("job.stage", "in", FINISHED)
      .order("due_date")
      .limit(50),
    supabase
      .from("requests")
      .select(COLUMNS)
      .in("status", ["open", "returned"])
      .gte("due_date", today)
      .lte("due_date", addDays(today, 7))
      .not("job.stage", "in", FINISHED)
      .order("due_date")
      .limit(50),
  ]);

  if (submitted.error || overdue.error || dueSoon.error) {
    return (
      <p role="alert" className="text-danger">
        We couldn&apos;t load the dashboard. Please refresh the page.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold sm:text-3xl">Admin dashboard</h1>
      <Section id="submitted" title="Newly submitted" empty="Nothing waiting for review." rows={submitted.data as unknown as Row[]} showDue={false} />
      <Section id="overdue" title="Overdue" empty="Nothing overdue." rows={overdue.data as unknown as Row[]} showDue />
      <Section id="due-soon" title="Due this week" empty="Nothing due in the next 7 days." rows={dueSoon.data as unknown as Row[]} showDue />
    </div>
  );
}
