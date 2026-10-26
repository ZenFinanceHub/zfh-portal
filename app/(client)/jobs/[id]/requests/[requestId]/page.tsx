import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ApproveRequest } from "./approve-request";
import { ConsentForm } from "./consent-form";
import { QuestionRequest } from "./question-request";
import { UploadRequest } from "./upload-request";
import { AutoRefresh } from "@/components/auto-refresh";
import { cardClass, primaryButtonInlineClass } from "@/components/ui/styles";
import { CONSENTS } from "@/lib/consents";
import { countOpenItems } from "@/lib/client/open-items";
import { formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { QuestionType } from "@/lib/validation/answers";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id: jobId, requestId } = await params;
  if (!z.uuid().safeParse(jobId).success || !z.uuid().safeParse(requestId).success) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  // Row-level security means a request on someone else's job simply isn't found.
  const { data: request } = await supabase
    .from("requests")
    .select("*, job:jobs!inner(id, title, client_id)")
    .eq("id", requestId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (!request) notFound();

  const { data: membership } = await supabase
    .from("client_contacts")
    .select("role")
    .eq("client_id", request.job.client_id)
    .eq("profile_id", auth.user!.id)
    .maybeSingle();
  const isOwner = membership?.role === "owner";

  const isOpen = request.status === "open" || request.status === "returned";

  const back = (
    <Link href="/" className="mb-4 inline-flex min-h-11 items-center text-gold underline underline-offset-4">
      ← Things to do
    </Link>
  );

  // ── Already sent, finished, or no longer needed ──────────
  if (!isOpen) {
    if (request.status === "cancelled") {
      return (
        <>
          {back}
          <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">{request.title}</h1>
          <div className={`${cardClass} space-y-4`} role="status">
            <p className="text-lg font-semibold text-gold-light">
              This is no longer needed. You don&apos;t need to do anything.
            </p>
            <Link href="/" className={primaryButtonInlineClass}>
              Back to things to do
            </Link>
          </div>
        </>
      );
    }
    const remaining = await countOpenItems(supabase, auth.user!.id);
    return (
      <>
        {back}
        <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">{request.title}</h1>
        <div className={`${cardClass} space-y-4`} role="status">
          <p className="text-lg font-semibold text-gold-light">
            {remaining > 0 ? "Received — thank you." : "Received — thank you. That's everything for now."}
          </p>
          {remaining > 0 ? (
            <p className="text-text-muted">
              {remaining === 1 ? "You have 1 more thing to do" : `You have ${remaining} more things to do`}
            </p>
          ) : (
            <p className="text-text-muted">We&apos;ll be in touch if we need anything else.</p>
          )}
          <Link href="/" className={primaryButtonInlineClass}>
            {remaining > 0 ? "Back to my list" : "Back to home"}
          </Link>
        </div>
      </>
    );
  }

  // ── Open: show the right action ──────────────────────────
  const { data: files } = await supabase
    .from("files")
    .select("id, original_name, size_bytes, scan_status, uploaded_by")
    .eq("request_id", requestId)
    .eq("visibility", "client")
    .order("created_at");

  const header = (
    <>
      {back}
      <h1 className="text-2xl font-semibold sm:text-3xl">{request.title}</h1>
      {request.help_text ? <p className="mt-2 text-lg text-text-muted">{request.help_text}</p> : null}
      {request.due_date ? <p className="mt-2 text-text-muted">Due {formatDate(request.due_date)}</p> : null}
      {request.status === "returned" && request.return_reason ? (
        <div className="mt-4 rounded-lg border-2 border-gold p-4" role="note">
          <p className="font-semibold text-gold-light">We need a little more from you</p>
          <p className="mt-1 text-lg">{request.return_reason}</p>
        </div>
      ) : null}
    </>
  );

  if (request.kind === "upload") {
    const mine = (files ?? []).filter((f) => f.uploaded_by === auth.user!.id);
    return (
      <>
        {header}
        <div className="mt-6">
          <UploadRequest
            requestId={requestId}
            jobId={jobId}
            clientId={request.job.client_id}
            existing={mine.map((f) => ({ id: f.id, name: f.original_name, size: f.size_bytes ?? 0, scan: f.scan_status }))}
          />
        </div>
      </>
    );
  }

  if (request.kind === "question") {
    const { data: last } = await supabase
      .from("responses")
      .select("answer")
      .eq("request_id", requestId)
      .eq("author_id", auth.user!.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastValue =
      last?.answer && typeof last.answer === "object" && !Array.isArray(last.answer) && "value" in last.answer
        ? last.answer.value
        : undefined;
    return (
      <>
        {header}
        <div className="mt-6">
          <QuestionRequest
            requestId={requestId}
            title={request.title}
            type={(request.question_type ?? "text") as QuestionType}
            options={Array.isArray(request.options) ? request.options.map(String) : []}
            previousValue={lastValue}
          />
        </div>
      </>
    );
  }

  // Approvals and consents: the documents to look at, then the owner's action.
  // The documents staff attached. Until at least one has passed its check, the person can't approve or agree.
  const attached = files ?? [];
  const documents = attached.filter((f) => f.scan_status === "clean");
  const stillChecking = attached.some((f) => f.scan_status === "pending");
  const blocked = attached.length > 0 && documents.length === 0;
  const blockedNote = blocked ? (
    <p className={`${cardClass} !p-4`} role="status">
      {stillChecking
        ? "We're just checking the documents for you. This page will update in a moment, then you can continue."
        : "There was a problem with the documents. We'll sort this out and let you know when they're ready."}
    </p>
  ) : null;
  const documentList = documents.length ? (
    <div className={`${cardClass} !p-4`}>
      <h2 className="mb-2 text-lg font-semibold">Documents to look at</h2>
      <ul className="space-y-1">
        {documents.map((f) => (
          <li key={f.id}>
            <a href={`/download/${f.id}`} className="inline-flex min-h-11 items-center text-gold underline underline-offset-4">
              {f.original_name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  if (request.kind === "approval") {
    return (
      <>
        {header}
        <div className="mt-6 space-y-4">
          <AutoRefresh active={stillChecking} />
          {documentList}
          {blockedNote}
          {isOwner ? (
            <ApproveRequest requestId={requestId} blocked={blocked} />
          ) : (
            <p className={`${cardClass} !p-4`} role="note">
              Your account owner needs to approve this.
            </p>
          )}
        </div>
      </>
    );
  }

  // consent
  const wording = request.consent_type ? CONSENTS[request.consent_type] : null;
  if (!wording) notFound();
  return (
    <>
      {header}
      <div className="mt-6 space-y-4">
        <AutoRefresh active={stillChecking} />
        {documentList}
        {blockedNote}
        <div className={`${cardClass} space-y-3`}>
          <h2 className="text-xl font-semibold">{wording.heading}</h2>
          {wording.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        {isOwner ? (
          <ConsentForm requestId={requestId} agreeLabel={wording.agreeLabel} blocked={blocked} />
        ) : (
          <p className={`${cardClass} !p-4`} role="note">
            Your account owner needs to agree to this.
          </p>
        )}
      </div>
    </>
  );
}
