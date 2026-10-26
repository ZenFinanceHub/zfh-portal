import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { cardClass, secondaryButtonClass } from "@/components/ui/styles";
import {
  CLIENT_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  ROLE_LABELS,
  STAGE_LABELS,
  formatDate,
} from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { InviteContact } from "./invite-contact";

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-base">{value || "—"}</dd>
    </div>
  );
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("*, assignee:profiles!clients_assigned_to_fkey(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (!client) notFound();

  const [{ data: contacts }, { data: jobs }] = await Promise.all([
    supabase
      .from("client_contacts")
      .select("role, created_at, profile:profiles(id, full_name, email)")
      .eq("client_id", id)
      .order("created_at"),
    supabase
      .from("jobs")
      .select("id, title, stage, due_date")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/clients" className="text-sm text-gold underline underline-offset-4">
            ← All clients
          </Link>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{client.name}</h1>
        </div>
        <Link href={`/admin/clients/${id}/edit`} className={secondaryButtonClass}>
          Edit client
        </Link>
      </div>

      <section className={cardClass} aria-labelledby="details">
        <h2 id="details" className="sr-only">
          Client details
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="Type" value={ENTITY_TYPE_LABELS[client.entity_type]} />
          <Detail label="Status" value={CLIENT_STATUS_LABELS[client.status]} />
          <Detail label="Company number" value={client.company_number} />
          <Detail label="UTR" value={client.utr} />
          <Detail label="Xero contact ID" value={client.xero_contact_id} />
          <Detail label="Year end" value={client.year_end ? formatDate(client.year_end) : null} />
          <Detail label="Assigned to" value={client.assignee?.full_name || client.assignee?.email} />
        </dl>
      </section>

      <section aria-labelledby="contacts">
        <h2 id="contacts" className="mb-3 text-xl font-semibold">
          Contacts
        </h2>
        {contacts && contacts.length > 0 ? (
          <ul className="mb-4 space-y-3">
            {contacts.map((c) => (
              <li key={c.profile?.id} className={`${cardClass} !p-4`}>
                <span className="block text-base font-medium">{c.profile?.full_name || c.profile?.email}</span>
                <span className="block text-sm text-text-muted">
                  {c.profile?.full_name ? `${c.profile.email} · ` : ""}
                  {ROLE_LABELS[c.role]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-text-muted">No contacts yet. Invite the first one below.</p>
        )}
        <InviteContact clientId={id} />
      </section>

      <section aria-labelledby="jobs">
        <h2 id="jobs" className="mb-3 text-xl font-semibold">
          Jobs
        </h2>
        {jobs && jobs.length > 0 ? (
          <ul className="space-y-3">
            {jobs.map((j) => (
              <li key={j.id} className={`${cardClass} !p-4`}>
                <span className="block text-base font-medium">{j.title}</span>
                <span className="block text-sm text-text-muted">
                  {STAGE_LABELS[j.stage]} · Due {formatDate(j.due_date)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-muted">No jobs yet.</p>
        )}
      </section>
    </div>
  );
}
