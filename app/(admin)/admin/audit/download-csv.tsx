"use client";

import { useState } from "react";
import { secondaryButtonClass } from "@/components/ui/styles";

// Fetches the CSV in the page so a failed download shows a message instead of a broken file or a blank tab.
export function DownloadCsv({ href }: { href: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(href, { cache: "no-store" });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "audit-log.csv";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setMessage("Sorry, that download didn't work — please try again.");
    }
    setBusy(false);
  }

  return (
    <div>
      <button type="button" onClick={run} disabled={busy} className={secondaryButtonClass} data-testid="audit-export">
        {busy ? "Preparing…" : "Download as CSV"}
      </button>
      {message ? (
        <p role="alert" className="mt-2 text-danger" data-testid="audit-export-error">
          {message}
        </p>
      ) : null}
    </div>
  );
}
