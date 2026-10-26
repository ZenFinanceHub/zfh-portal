import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MessageThread, type ThreadMessage } from "@/components/message-thread";
import { ReplyForm } from "@/components/reply-form";
import { cardClass } from "@/components/ui/styles";
import { CLIENT_REQUEST_STATUS_LABELS, CLIENT_STAGE_LABELS, formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  // Row-level security: a job that isn't yours isn't found, however the address is changed.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, stage, client:clients(name)")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const [{ data: requests }, { data: files }, { data: messages }] = await Promise.all([
    supabase
      .from("requests")
      .select("id, title, kind, status, due_date")
      .eq("job_id", id)
      .neq("status", "cancelled")
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("files")
      .select("id, original_name, created_at")
      .eq("job_id", id)
      .eq("visibility", "client")
      .eq("scan_status", "clean")
      .order("created_at", { ascending: false }),
    supabase
      .from("messages")
      .select("id, body, created_at, author_id, author:profiles!messages_author_id_fkey(is_staff)")
      .eq("job_id", id)
      .eq("internal", false)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-text-muted">{job.client?.name}</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">{job.title}</h1>
        <p className="mt-2 text-lg">
          <span className="text-text-muted">Where things stand: </span>
          <strong className="text-gold-light" data-testid="stage">
            {CLIENT_STAGE_LABELS[job.stage]}
          </strong>
        </p>
      </div>

      <section aria-labelledby="requests">
        <h2 id="requests" className="mb-3 text-xl font-semibold">
          What we need
        </h2>
        {(requests ?? []).length === 0 ? (
          <p className="text-text-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-3">
            {(requests ?? []).map((r) => {
              const actionable = r.status === "open" || r.status === "returned";
              return (
                <li key={r.id}>
                  <Link
                    href={`/jobs/${id}/requests/${r.id}`}
                    className={`${cardClass} block min-h-11 !p-4 hover:border-gold`}
                  >
                    <span className="block text-base font-medium">{r.title}</span>
                    <span className="block text-sm text-text-muted">
                      {CLIENT_REQUEST_STATUS_LABELS[r.status]}
                      {actionable && r.due_date ? ` · Due ${formatDate(r.due_date)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="documents">
        <h2 id="documents" className="mb-3 text-xl font-semibold">
          Documents
        </h2>
        {(files ?? []).length === 0 ? (
          <p className="text-text-muted">No documents to show yet.</p>
        ) : (
          <ul className="space-y-1">
            {(files ?? []).map((f) => (
              <li key={f.id}>
                <a href={`/download/${f.id}`} className="inline-flex min-h-11 items-center break-all text-gold underline underline-offset-4">
                  {f.original_name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="messages" className="space-y-4">
        <h2 id="messages" className="text-xl font-semibold">
          Messages
        </h2>
        <ReplyForm jobId={id} />
        <MessageThread messages={(messages ?? []) as unknown as ThreadMessage[]} me={auth.user!.id} />
      </section>
    </div>
  );
}
