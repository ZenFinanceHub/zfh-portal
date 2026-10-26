import { DeleteFile } from "./delete-file";
import { cardClass } from "@/components/ui/styles";
import { getMyAreas } from "@/lib/admin/areas";
import { todayLondon } from "@/lib/dates";
import { formatBytes } from "@/lib/files";
import { formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

// Files past their retention date, for the admin to review. Nothing is ever deleted automatically.
export default async function RetentionPage() {
  const { isAdmin } = await getMyAreas();

  if (!isAdmin) {
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Retention</h1>
        <p className={cardClass} role="status">
          Only the admin can review retention.
        </p>
      </>
    );
  }

  const supabase = await createClient();
  const { data: files, error } = await supabase
    .from("files")
    .select("id, original_name, size_bytes, retain_until, created_at, client:clients(name), job:jobs(title)")
    .lt("retain_until", todayLondon())
    .order("retain_until")
    .limit(200);

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold sm:text-3xl">Retention</h1>
      <p className="mb-6 text-text-muted">
        These files are past the date we agreed to keep them. Check each one before deleting. Deleting removes the file
        for good; a record that it existed, and who deleted it, stays in the audit trail. Nothing is deleted automatically.
      </p>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load this list. Please refresh the page.
        </p>
      ) : (files ?? []).length === 0 ? (
        <p className={cardClass} role="status">
          Nothing is past its retention date.
        </p>
      ) : (
        <ul className="space-y-3">
          {(files ?? []).map((f) => (
            <li key={f.id} className={`${cardClass} !p-4 space-y-2`} data-testid="retention-file">
              <p className="break-all font-medium">{f.original_name}</p>
              <p className="text-sm text-text-muted">
                {f.client?.name ?? "No client"}
                {f.job?.title ? ` · ${f.job.title}` : ""} · {formatBytes(f.size_bytes ?? 0)} · Added {formatDate(f.created_at)} ·
                Keep until {formatDate(f.retain_until)}
              </p>
              <DeleteFile fileId={f.id} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
