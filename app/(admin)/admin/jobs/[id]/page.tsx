import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  acceptRequest,
  addNote,
  addPendingRequest,
  addRequest,
  cancelRequest,
  returnRequest,
  setFinanceStage,
  setStage,
  updateRequest,
} from "../actions";
import { AddRequest, EditRequest, NoteForm, ReturnForm } from "./request-forms";
import { cardClass, inputClass, secondaryButtonClass } from "@/components/ui/styles";
import { formatAnswer } from "@/lib/answers";
import { todayLondon } from "@/lib/dates";
import { STAGE_LABELS, formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import {
  FINANCE_STAGES,
  FINANCE_STAGE_LABELS,
  KIND_LABELS,
  SERVICE_LABELS,
  STAGES,
} from "@/lib/validation/request";

const STATUS_LABELS: Record<string, string> = {
  open: "Waiting on client",
  submitted: "Submitted — needs review",
  accepted: "Accepted",
  returned: "Returned to client",
  cancelled: "Cancelled",
};

const SCAN_LABELS: Record<string, string> = {
  pending: "scanning",
  clean: "clean",
  infected: "blocked",
  error: "scan failed",
};

type Blueprint = { kind?: string; title?: string; help_text?: string };

export default async function AdminJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("*, client:clients(id, name), assignee:profiles!jobs_assigned_to_fkey(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const [{ data: requests }, { data: contributors }, { data: notes }] = await Promise.all([
    supabase.from("requests").select("*").eq("job_id", id).order("sort_order").order("created_at"),
    supabase.from("job_contacts").select("profile:profiles(id, full_name, email)").eq("job_id", id),
    supabase
      .from("messages")
      .select("id, body, created_at, author:profiles!messages_author_id_fkey(full_name, email)")
      .eq("job_id", id)
      .eq("internal", true)
      .order("created_at", { ascending: false }),
  ]);

  const requestIds = (requests ?? []).map((r) => r.id);
  const [{ data: responses }, { data: files }, { data: consents }] = requestIds.length
    ? await Promise.all([
        supabase.from("responses").select("request_id, answer, created_at").in("request_id", requestIds).order("created_at", { ascending: false }),
        supabase.from("files").select("id, request_id, original_name, scan_status").in("request_id", requestIds).order("created_at"),
        supabase.from("consents").select("request_id, created_at, wording_version").in("request_id", requestIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const today = todayLondon();
  const pending = (Array.isArray(job.pending_blueprints) ? job.pending_blueprints : []) as Blueprint[];

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/admin/clients/${job.client?.id}`} className="text-sm text-gold underline underline-offset-4">
          ← {job.client?.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{job.title}</h1>
        <p className="text-text-muted">
          {SERVICE_LABELS[job.service]} · Period end {formatDate(job.period_end)} · Due {formatDate(job.due_date)} ·
          Assigned to {job.assignee?.full_name || job.assignee?.email || "no one"}
        </p>
        {(contributors ?? []).length > 0 ? (
          <p className="text-sm text-text-muted">
            Contributors: {(contributors ?? []).map((c) => c.profile?.full_name || c.profile?.email).join(", ")}
          </p>
        ) : null}
      </div>

      {/* ── Stage ─────────────────────────────────────────── */}
      <section className={`${cardClass} space-y-4`} aria-labelledby="stage-heading">
        <h2 id="stage-heading" className="text-xl font-semibold">
          What the client sees
        </h2>
        <form action={setStage.bind(null, id)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="stage" className="mb-2 block text-base font-medium">
              Stage
            </label>
            <select id="stage" name="stage" defaultValue={job.stage} className={inputClass}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={secondaryButtonClass}>
            Update stage
          </button>
        </form>

        {job.service === "finance_application" ? (
          <form action={setFinanceStage.bind(null, id)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="finance_stage" className="mb-2 block text-base font-medium">
                Finance stage
              </label>
              <select id="finance_stage" name="finance_stage" defaultValue={job.finance_stage ?? "gathering"} className={inputClass}>
                {FINANCE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {FINANCE_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={secondaryButtonClass}>
              Update finance stage
            </button>
          </form>
        ) : null}
      </section>

      {/* ── Requests ──────────────────────────────────────── */}
      <section aria-labelledby="requests-heading" className="space-y-4">
        <h2 id="requests-heading" className="text-xl font-semibold">
          Requests
        </h2>

        {(requests ?? []).length === 0 ? <p className="text-text-muted">No requests yet.</p> : null}

        <ul className="space-y-4">
          {(requests ?? []).map((r) => {
            const answers = (responses ?? []).filter((x) => x.request_id === r.id);
            const reqFiles = (files ?? []).filter((x) => x.request_id === r.id);
            const consent = (consents ?? []).find((x) => x.request_id === r.id);
            const overdue = !!r.due_date && r.due_date < today && (r.status === "open" || r.status === "returned");
            const closed = r.status === "cancelled" || r.status === "accepted";

            return (
              <li key={r.id} className={`${cardClass} !p-4 space-y-3`} data-testid="request">
                <div>
                  <p className="text-sm text-text-muted">{KIND_LABELS[r.kind]}</p>
                  <h3 className="text-lg font-semibold">{r.title}</h3>
                  {r.help_text ? <p className="text-sm text-text-muted">{r.help_text}</p> : null}
                  <p className="mt-1 text-base">
                    <span data-testid="request-status">{STATUS_LABELS[r.status]}</span>
                    {r.due_date ? ` · Due ${formatDate(r.due_date)}` : ""}
                    {overdue ? <span className="text-danger"> · Overdue</span> : null}
                  </p>
                  {r.status === "returned" && r.return_reason ? (
                    <p className="text-sm text-text-muted">Reason given: {r.return_reason}</p>
                  ) : null}
                </div>

                {r.kind === "question" && answers[0] ? (
                  <p className="rounded-lg bg-ink p-3">
                    <span className="block text-sm text-text-muted">Client&apos;s answer</span>
                    {formatAnswer(answers[0].answer, r.question_type)}
                  </p>
                ) : null}

                {r.kind === "upload" && reqFiles.length > 0 ? (
                  <ul className="rounded-lg bg-ink p-3 text-sm">
                    {reqFiles.map((f) => (
                      <li key={f.id}>
                        {f.original_name} <span className="text-text-muted">({SCAN_LABELS[f.scan_status]})</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {r.kind === "consent" && consent ? (
                  <p className="rounded-lg bg-ink p-3 text-sm">
                    Consent recorded on {formatDate(consent.created_at)}
                  </p>
                ) : null}

                <div className="space-y-2">
                  {r.status === "submitted" ? (
                    <div className="space-y-2">
                      <form action={acceptRequest.bind(null, id, r.id)}>
                        <button type="submit" className={secondaryButtonClass}>
                          Accept
                        </button>
                      </form>
                      <ReturnForm action={returnRequest.bind(null, id, r.id)} />
                    </div>
                  ) : null}

                  {!closed ? (
                    <EditRequest
                      requestId={r.id}
                      action={updateRequest.bind(null, id, r.id)}
                      dueDate={r.due_date ?? ""}
                      initial={{
                        kind: r.kind,
                        title: r.title,
                        help_text: r.help_text ?? "",
                        question_type: r.question_type ?? "text",
                        options_text: Array.isArray(r.options) ? r.options.join("\n") : "",
                        consent_type: r.consent_type ?? "lender_share",
                      }}
                    />
                  ) : null}

                  {r.status !== "cancelled" && r.status !== "accepted" ? (
                    <form action={cancelRequest.bind(null, id, r.id)}>
                      <button type="submit" className={`${secondaryButtonClass} text-danger`}>
                        Cancel request
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {pending.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Add later</h3>
            <p className="text-sm text-text-muted">
              These came with the template but have not been sent to the client yet.
            </p>
            <ul className="space-y-3">
              {pending.map((b, i) => (
                <li key={`${i}-${b.title}`} className={`${cardClass} !p-4`}>
                  <p className="text-sm text-text-muted">{KIND_LABELS[b.kind ?? ""] ?? b.kind}</p>
                  <p className="text-base font-medium">{b.title}</p>
                  {b.help_text ? <p className="text-sm text-text-muted">{b.help_text}</p> : null}
                  <form action={addPendingRequest.bind(null, id, i)} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div>
                      <label htmlFor={`pending-due-${i}`} className="mb-1 block text-sm text-text-muted">
                        Due date (optional)
                      </label>
                      <input id={`pending-due-${i}`} name="due_date" type="date" className={inputClass} />
                    </div>
                    <button type="submit" className={secondaryButtonClass}>
                      Add now
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <AddRequest action={addRequest.bind(null, id)} />
      </section>

      {/* ── Internal notes ────────────────────────────────── */}
      <section aria-labelledby="notes-heading" className="space-y-4">
        <h2 id="notes-heading" className="text-xl font-semibold">
          Internal notes
        </h2>
        <p className="text-sm text-text-muted">Only staff can see these. Clients never do.</p>
        <NoteForm action={addNote.bind(null, id)} />
        <ul className="space-y-3">
          {(notes ?? []).map((n) => (
            <li key={n.id} className={`${cardClass} !p-4`}>
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-sm text-text-muted">
                {n.author?.full_name || n.author?.email} · {formatDate(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
