"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cardClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import {
  ACCEPT_ATTRIBUTE,
  SCAN_LABELS_CLIENT,
  checkFile,
  formatBytes,
  safeFilename,
  uploadMimeType,
} from "@/lib/files";
import { createClient } from "@/lib/supabase/client";

type Existing = { id: string; name: string; size: number; scan: string };
type Item = {
  key: string;
  id?: string;
  name: string;
  size: number;
  state: "uploading" | "done" | "failed";
  progress: number;
  message?: string;
};

type Props = { requestId: string; jobId: string; clientId: string; existing: Existing[] };

// Sends the file to Supabase Storage with progress. (supabase-js has no upload progress.)
function sendFile(path: string, token: string, file: File, mime: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/client-files/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}

export function UploadRequest({ requestId, jobId, clientId, existing }: Props) {
  const router = useRouter();
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const patch = (key: string, next: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...next } : i)));

  async function uploadOne(file: File) {
    const key = crypto.randomUUID();
    setItems((list) => [...list, { key, name: file.name, size: file.size, state: "uploading", progress: 0 }]);
    const supabase = createClient();

    // 1. Register the file first (scan status starts as "pending")…
    const fileId = crypto.randomUUID();
    const path = `${clientId}/${jobId}/${fileId}-${safeFilename(file.name)}`;
    const mime = uploadMimeType(file)!;
    const { error: insertError } = await supabase.from("files").insert({
      id: fileId,
      client_id: clientId,
      job_id: jobId,
      request_id: requestId,
      storage_path: path,
      original_name: file.name,
      mime_type: mime,
      size_bytes: file.size,
    });
    if (insertError) {
      patch(key, { state: "failed", message: "We couldn't add this file. Please try again." });
      return;
    }

    // 2. …then upload it.
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("no session");
      await sendFile(path, data.session.access_token, file, mime, (p) => patch(key, { progress: p }));
      patch(key, { state: "done", progress: 1, id: fileId });
      router.refresh();
    } catch {
      // Remove the half-finished record so it can't be counted as a received file.
      await supabase.rpc("discard_failed_upload", { p_file_id: fileId });
      patch(key, { state: "failed", message: "The upload didn't finish. Please check your connection and try again." });
    }
  }

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of files) {
      const problem = checkFile(f);
      if (problem) rejected.push(problem);
      else accepted.push(f);
    }
    setProblems(rejected);
    setSendError(null);
    for (const f of accepted) await uploadOne(f);
  }

  async function send() {
    setSending(true);
    setSendError(null);
    const { error } = await createClient().rpc("submit_request", { p_request_id: requestId });
    if (error) {
      setSending(false);
      setSendError("We couldn't send that just now. Please try again.");
      return;
    }
    router.refresh();
  }

  // What's already on the server, plus uploads from this visit that the server list hasn't caught up with.
  const knownIds = new Set(existing.map((e) => e.id));
  const received = existing.filter((e) => e.scan !== "infected");
  const rejectedByScan = existing.filter((e) => e.scan === "infected");
  const justDone = items.filter((i) => i.state === "done" && i.id && !knownIds.has(i.id));
  const working = items.filter((i) => i.state === "uploading");
  const failed = items.filter((i) => i.state === "failed");
  const canSend = received.length + justDone.length > 0 && working.length === 0 && !sending;

  return (
    <div className={`${cardClass} space-y-5`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => cameraRef.current?.click()} className={primaryButtonClass}>
          Take a photo
        </button>
        <button type="button" onClick={() => pickRef.current?.click()} className={`${secondaryButtonClass} min-h-12 w-full`}>
          Choose files
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take a photo"
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={pickRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        aria-label="Choose files"
        data-testid="file-input"
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="text-sm text-text-muted">
        You can add as many files as you need. PDFs, photos, spreadsheets and Word documents, up to 25 MB each.
      </p>

      {problems.length > 0 ? (
        <ul role="alert" className="space-y-1 text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      {working.map((i) => (
        <div key={i.key} aria-live="polite">
          <p className="break-all">
            {i.name} <span className="text-text-muted">— sending…</span>
          </p>
          <div
            role="progressbar"
            aria-label={`Sending ${i.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(i.progress * 100)}
            className="mt-1 h-3 w-full overflow-hidden rounded-full bg-line"
          >
            <div className="h-full bg-gold transition-all" style={{ width: `${Math.round(i.progress * 100)}%` }} />
          </div>
        </div>
      ))}

      {failed.map((i) => (
        <p key={i.key} role="alert" className="text-danger">
          {i.name}: {i.message}
        </p>
      ))}

      {rejectedByScan.map((f) => (
        <p key={f.id} role="alert" className="text-danger">
          {f.name}: {SCAN_LABELS_CLIENT.infected}
        </p>
      ))}

      {received.length + justDone.length > 0 ? (
        <ul className="space-y-2" data-testid="received-files">
          {received.map((f) => (
            <li key={f.id} className="break-all">
              {f.name} <span className="block text-sm text-text-muted">{SCAN_LABELS_CLIENT[f.scan]} · {formatBytes(f.size)}</span>
            </li>
          ))}
          {justDone.map((i) => (
            <li key={i.key} className="break-all">
              {i.name} <span className="block text-sm text-text-muted">{SCAN_LABELS_CLIENT.pending} · {formatBytes(i.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {sendError ? (
        <p role="alert" className="text-danger">
          {sendError}
        </p>
      ) : null}

      <button type="button" onClick={send} disabled={!canSend} className={primaryButtonClass}>
        {sending ? "Sending…" : "Send to ZenFinanceHub"}
      </button>
      {!canSend && received.length + justDone.length === 0 ? (
        <p className="text-sm text-text-muted">Add at least one file, then send it to us.</p>
      ) : null}
    </div>
  );
}
