import { cardClass } from "@/components/ui/styles";
import { formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export default async function DocumentsPage() {
  const supabase = await createClient();

  // Only files that have passed the virus check. Row-level security limits this to the person's own clients.
  const { data: files, error } = await supabase
    .from("files")
    .select("id, original_name, created_at, job:jobs(title)")
    .eq("visibility", "client")
    .eq("scan_status", "clean")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">Documents</h1>
      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load your documents. Please refresh the page.
        </p>
      ) : (files ?? []).length === 0 ? (
        <div className={cardClass}>
          <p className="text-lg">No documents to show yet.</p>
          <p className="mt-1 text-text-muted">Files appear here once we&apos;ve checked them.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {(files ?? []).map((f) => (
            <li key={f.id}>
              <a href={`/download/${f.id}`} className={`${cardClass} block min-h-11 !p-4 hover:border-gold`}>
                <span className="block break-all text-base font-medium text-gold">{f.original_name}</span>
                <span className="block text-sm text-text-muted">
                  {f.job?.title ? `${f.job.title} · ` : ""}
                  {formatDate(f.created_at)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
