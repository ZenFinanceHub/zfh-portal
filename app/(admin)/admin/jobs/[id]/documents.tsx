"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cardClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { ACCEPT_ATTRIBUTE, checkFile, safeFilename, uploadMimeType } from "@/lib/files";
import { createClient } from "@/lib/supabase/client";
import { sendFile } from "@/lib/upload";

export type AttachTarget = { id: string; label: string };

// ── Add documents ────────────────────────────────────────────
type Item = { key: string; name: string; state: "uploading" | "done" | "failed"; progress: number; message?: string };

export function AddDocument({
  jobId,
  clientId,
  targets,
}: {
  jobId: string;
  clientId: string;
  targets: AttachTarget[];
}) {
  const router = useRouter();
  const pickRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<"client" | "internal">("client");
  const [attachTo, setAttachTo] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<string[]>([]);

  const patch = (key: string, next: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...next } : i)));

  async function uploadOne(file: File) {
    const key = crypto.randomUUID();
    setItems((list) => [...list, { key, name: file.name, state: "uploading", progress: 0 }]);
    const supabase = createClient();

    // Same order as for clients: register the file first, then upload it.
    const fileId = crypto.randomUUID();
    const path = `${clientId}/${jobId}/${fileId}-${safeFilename(file.name)}`;
    const mime = uploadMimeType(file)!;
    const { error: insertError } = await supabase.from("files").insert({
      id: fileId,
      client_id: clientId,
      job_id: jobId,
      request_id: attachTo || null,
      storage_path: path,
      original_name: file.name,
      mime_type: mime,
      size_bytes: file.size,
      visibility,
    });
    if (insertError) {
      patch(key, { state: "failed", message: "We couldn't add this file." });
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("no session");
      await sendFile(path, data.session.access_token, file, mime, (p) => patch(key, { progress: p }));
      patch(key, { state: "done", progress: 1 });
      router.refresh();
    } catch {
      await supabase.rpc("discard_failed_upload", { p_file_id: fileId });
      patch(key, { state: "failed", message: "The upload didn't finish. Please try again." });
    }
  }

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of Array.from(list)) {
      const problem = checkFile(f);
      if (problem) rejected.push(problem);
      else accepted.push(f);
    }
    setProblems(rejected);
    for (const f of accepted) await uploadOne(f);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Add document
      </button>
    );
  }

  return (
    <div className={`${cardClass} !p-4 space-y-4`} data-testid="add-document">
      <h3 className="text-lg font-semibold">Add document</h3>

      <fieldset>
        <legend className="mb-1 block text-base font-medium">Who can see it</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name="doc-visibility"
            checked={visibility === "client"}
            onChange={() => setVisibility("client")}
            className="size-5 accent-gold"
          />
          Share with client
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name="doc-visibility"
            checked={visibility === "internal"}
            onChange={() => setVisibility("internal")}
            className="size-5 accent-gold"
          />
          Internal only
        </label>
      </fieldset>

      {targets.length > 0 && visibility === "client" ? (
        <div>
          <label htmlFor="doc-attach" className="mb-1 block text-base font-medium">
            Attach to a request (optional)
          </label>
          <select id="doc-attach" value={attachTo} onChange={(e) => setAttachTo(e.target.value)} className={inputClass}>
            <option value="">Not attached</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-text-muted">
            The client can&apos;t approve or agree until at least one attached document has been checked.
          </p>
        </div>
      ) : null}

      <input
        ref={pickRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        aria-label="Choose documents"
        data-testid="document-input"
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <button type="button" onClick={() => pickRef.current?.click()} className={`${primaryButtonClass} sm:w-auto`}>
          Choose files
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          Close
        </button>
      </div>
      <p className="text-sm text-text-muted">PDF, photos, CSV, Excel (.xlsx) or Word (.docx), up to 25 MB each.</p>

      {problems.length > 0 ? (
        <ul role="alert" className="space-y-1 text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <ul className="space-y-1 text-sm" aria-live="polite">
        {items.map((i) => (
          <li key={i.key} className="break-all">
            {i.name}{" "}
            <span className={i.state === "failed" ? "text-danger" : "text-text-muted"}>
              {i.state === "uploading"
                ? `— sending ${Math.round(i.progress * 100)}%`
                : i.state === "done"
                  ? "— added, being checked"
                  : `— ${i.message}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Scan again ───────────────────────────────────────────────
export function ScanAgain({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    const { error } = await createClient().functions.invoke("scan-file", { body: { file_id: fileId } });
    setBusy(false);
    if (error) setFailed(true);
    else router.refresh();
  }

  return (
    <>
      <button type="button" onClick={run} disabled={busy} className="inline-flex min-h-11 items-center text-gold underline underline-offset-4">
        {busy ? "Scanning…" : "Scan again"}
      </button>
      {failed ? (
        <span role="alert" className="ml-2 text-danger">
          Couldn&apos;t scan just now.
        </span>
      ) : null}
    </>
  );
}

// ── Zip and lender pack ──────────────────────────────────────
async function friendlyError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (typeof body?.error === "string") return body.error;
    } catch {
      /* fall through */
    }
  }
  return "Something went wrong. Please try again.";
}

export function ZipButtons({
  jobId,
  isFinance,
  lenderConsent,
}: {
  jobId: string;
  isFinance: boolean;
  lenderConsent: boolean;
}) {
  const [busy, setBusy] = useState<"all" | "lender_pack" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function download(kind: "all" | "lender_pack") {
    setBusy(kind);
    setMessage(null);
    const { data, error } = await createClient().functions.invoke("job-zip", { body: { job_id: jobId, kind } });
    setBusy(null);
    if (error || !data?.url) {
      setMessage(await friendlyError(error));
      return;
    }
    // The link is made inside Supabase; use this page's own Supabase address for it (they match when hosted).
    const link = new URL(data.url as string);
    const anchor = document.createElement("a");
    anchor.href = `${process.env.NEXT_PUBLIC_SUPABASE_URL}${link.pathname}${link.search}`;
    anchor.click();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={() => download("all")} disabled={busy !== null} className={`${secondaryButtonClass} sm:w-auto`}>
          {busy === "all" ? "Preparing…" : "Download all documents (zip)"}
        </button>
        {isFinance ? (
          <button
            type="button"
            onClick={() => download("lender_pack")}
            disabled={busy !== null || !lenderConsent}
            className={`${secondaryButtonClass} sm:w-auto`}
          >
            {busy === "lender_pack" ? "Preparing…" : "Lender pack"}
          </button>
        ) : null}
      </div>
      {isFinance && !lenderConsent ? (
        <p className="text-sm text-text-muted">
          The lender pack is available once the client has agreed to share their documents with lenders.
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}
