import Link from "next/link";
import { cardClass, inputClass, primaryButtonInlineClass, secondaryButtonClass } from "@/components/ui/styles";
import { getMyAreas } from "@/lib/admin/areas";
import { ACTION_FILTERS, AREA_NAMES, describeAudit } from "@/lib/audit-labels";
import { auditArgs, PAGE_SIZE, parseAuditFilters, type AuditFilters } from "@/lib/audit-query";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Audit log" };

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

function query(f: AuditFilters, page?: number) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (k !== "page" && v) q.set(k, String(v));
  if (page && page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { isAdmin } = await getMyAreas();
  if (!isAdmin) {
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Audit log</h1>
        <p className={cardClass} role="status">
          Only the admin can see the audit log.
        </p>
      </>
    );
  }

  const filters = parseAuditFilters(await searchParams);
  const supabase = await createClient();
  const [{ data: rows, error }, { data: clients }, { data: staff }] = await Promise.all([
    supabase.rpc("admin_audit", auditArgs(filters, PAGE_SIZE, (filters.page - 1) * PAGE_SIZE)),
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name, email").eq("is_staff", true).order("email"),
  ]);

  const total = Number(rows?.[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportHref = `/admin/audit/export${query(filters)}`;

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold sm:text-3xl">Audit log</h1>
      <p className="mb-4 text-text-muted">
        Who did what, and when. It records actions and counts, never answers, file names or message text.
      </p>

      <form method="get" className={`${cardClass} !p-4 mb-4 grid gap-3 sm:grid-cols-2`} data-testid="audit-filters">
        <Select name="client" label="Client" value={filters.client} options={(clients ?? []).map((c) => [c.id, c.name])} any="All clients" />
        <Select
          name="actor"
          label="Team member"
          value={filters.actor}
          options={(staff ?? []).map((p) => [p.id, p.full_name || p.email])}
          any="Everyone"
        />
        <Select name="action" label="What happened" value={filters.action} options={ACTION_FILTERS.map((a) => [a.value, a.label])} any="Anything" />
        <Select name="area" label="Area" value={filters.area} options={Object.entries(AREA_NAMES)} any="Both areas" />
        <div>
          <label htmlFor="from" className="mb-1 block text-base font-medium">
            From
          </label>
          <input id="from" name="from" type="date" defaultValue={filters.from} className={inputClass} />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-base font-medium">
            To
          </label>
          <input id="to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
        </div>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" className={primaryButtonInlineClass}>
            Show
          </button>
          <Link href="/admin/audit" className={secondaryButtonClass}>
            Clear
          </Link>
          <a href={exportHref} className={secondaryButtonClass} data-testid="audit-export">
            Download as CSV
          </a>
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the audit log. Please try again.
        </p>
      ) : !rows?.length ? (
        <p className={cardClass} role="status">
          Nothing matches those choices.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-text-muted" data-testid="audit-total">
            {total} {total === 1 ? "entry" : "entries"}
          </p>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="audit-list">
            {rows.map((r) => (
              <li key={r.id} className="p-3" data-testid="audit-row">
                <p className="font-medium">{describeAudit({ action: r.action, entity: r.entity, meta: r.meta as Record<string, unknown> | null })}</p>
                <p className="text-sm text-text-muted">
                  {when(r.created_at)} · {r.actor_name ?? "The system"}
                  {r.client_name ? ` · ${r.client_name}` : ""}
                  {r.area ? ` · ${AREA_NAMES[r.area] ?? r.area}` : ""}
                </p>
              </li>
            ))}
          </ul>
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
            {filters.page > 1 ? (
              <Link href={`/admin/audit${query(filters, filters.page - 1)}`} className={secondaryButtonClass}>
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-text-muted">
              Page {filters.page} of {pages}
            </span>
            {filters.page < pages ? (
              <Link href={`/admin/audit${query(filters, filters.page + 1)}`} className={secondaryButtonClass}>
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </>
  );
}

function Select({
  name,
  label,
  value,
  options,
  any,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: (readonly [string, string])[] | [string, string][];
  any: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-base font-medium">
        {label}
      </label>
      <select id={name} name={name} defaultValue={value ?? ""} className={inputClass}>
        <option value="">{any}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
