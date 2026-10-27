"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { useState } from "react";
import { cardClass, secondaryButtonClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";

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

// Admin only: everything held on this client, as one or more zips, for a subject access request. Recorded in the audit log.
export function ExportClient({ clientId }: { clientId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    const { data, error } = await createClient().functions.invoke("client-export", { body: { client_id: clientId } });
    setBusy(false);
    const urls = data?.urls as string[] | undefined;
    if (error || !urls?.length) {
      setMessage(await friendlyError(error));
      return;
    }
    // Each link lasts 60 seconds, so they are all started straight away.
    for (const url of urls) {
      const link = new URL(url);
      const anchor = document.createElement("a");
      anchor.href = `${process.env.NEXT_PUBLIC_SUPABASE_URL}${link.pathname}${link.search}`;
      anchor.click();
    }
    setMessage(urls.length > 1 ? `Your export is in ${urls.length} zips. Allow multiple downloads if your browser asks.` : "Your export is downloading.");
  }

  return (
    <section className={`${cardClass} space-y-3`} aria-labelledby="export" data-testid="export-client">
      <h2 id="export" className="text-xl font-semibold">
        Subject access request
      </h2>
      <p className="text-text-muted">
        A zip of everything held on this client: their record, contacts, jobs, requests, answers, consents, messages and notes,
        the audit trail and every stored file that passed its virus check. Staff notes may need checking before you share them.
      </p>
      <button type="button" onClick={run} disabled={busy} className={secondaryButtonClass}>
        {busy ? "Preparing…" : "Export everything we hold"}
      </button>
      {message ? (
        <p role="status" className="text-text-muted">
          {message}
        </p>
      ) : null}
    </section>
  );
}
