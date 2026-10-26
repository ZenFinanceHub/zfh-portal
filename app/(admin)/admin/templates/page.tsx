import Link from "next/link";
import { cardClass } from "@/components/ui/styles";
import { AREA_LABELS, isArea } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_LABELS } from "@/lib/validation/request";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data: templates, error } = await supabase
    .from("templates")
    .select("id, name, service, area, description, active, requests")
    .order("name");

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold sm:text-3xl">Templates</h1>
      <p className="mb-6 text-text-muted">The request lists new jobs are built from.</p>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the templates. Please refresh the page.
        </p>
      ) : (
        <ul className="space-y-3">
          {(templates ?? []).map((t) => (
            <li key={t.id}>
              <Link href={`/admin/templates/${t.id}`} className={`${cardClass} block min-h-11 !p-4 hover:border-gold`}>
                <span className="block text-lg font-medium">
                  {t.name}
                  {t.active ? "" : " (inactive)"}
                </span>
                <span className="block text-sm text-text-muted">
                  {isArea(t.area) ? `${AREA_LABELS[t.area]} · ` : ""}{SERVICE_LABELS[t.service]} · {Array.isArray(t.requests) ? t.requests.length : 0} requests
                  {t.description ? ` · ${t.description}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
