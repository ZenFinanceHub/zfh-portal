import Link from "next/link";
import { cardClass, inputClass, primaryButtonInlineClass, secondaryButtonClass } from "@/components/ui/styles";
import { CLIENT_STATUS_LABELS, ENTITY_TYPE_LABELS, formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_STATUSES } from "@/lib/validation/client";

type SearchParams = Promise<{ q?: string; status?: string }>;

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q = "", status = "" } = await searchParams;
  const search = q.trim().slice(0, 100);
  const statusFilter = (CLIENT_STATUSES as readonly string[]).includes(status) ? status : "";

  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select("id, name, entity_type, status, year_end")
    .order("name")
    .limit(200);
  if (search) query = query.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  if (statusFilter) query = query.eq("status", statusFilter as (typeof CLIENT_STATUSES)[number]);
  const { data: clients, error } = await query;

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold sm:text-3xl">Clients</h1>
        <Link href="/admin/clients/new" className={`${primaryButtonInlineClass}`}>
          New client
        </Link>
      </div>

      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-[1fr_auto_auto]" role="search">
        <label className="sr-only" htmlFor="q">
          Search by name
        </label>
        <input id="q" name="q" type="search" defaultValue={search} placeholder="Search by name" className={inputClass} />
        <label className="sr-only" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={statusFilter} className={inputClass}>
          <option value="">All statuses</option>
          {CLIENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CLIENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button type="submit" className={secondaryButtonClass}>
          Search
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the clients. Please refresh the page.
        </p>
      ) : clients && clients.length > 0 ? (
        <ul className="space-y-3">
          {clients.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/clients/${c.id}`}
                className={`${cardClass} block min-h-11 !p-4 hover:border-gold`}
              >
                <span className="block text-lg font-medium">{c.name}</span>
                <span className="block text-sm text-text-muted">
                  {ENTITY_TYPE_LABELS[c.entity_type]} · {CLIENT_STATUS_LABELS[c.status]} · Year end{" "}
                  {formatDate(c.year_end)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={cardClass}>
          <p className="text-text-muted">
            {search || statusFilter ? "No clients match that search." : "No clients yet. Create your first one."}
          </p>
        </div>
      )}
    </>
  );
}
