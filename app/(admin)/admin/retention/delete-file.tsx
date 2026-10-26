"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { secondaryButtonClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";

// Two steps (Delete, then Yes, delete it) so a stray tap can't remove a file.
export function DeleteFile({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    const { error } = await createClient().functions.invoke("retention-delete", { body: { file_id: fileId } });
    setBusy(false);
    if (error) {
      setFailed(true);
      return;
    }
    router.refresh();
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${secondaryButtonClass} text-danger sm:w-auto`}>
        Delete
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <p>Delete this file for good?</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={run} disabled={busy} className={`${secondaryButtonClass} text-danger sm:w-auto`}>
          {busy ? "Deleting…" : "Yes, delete it"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={`${secondaryButtonClass} sm:w-auto`}>
          Keep it
        </button>
      </div>
      {failed ? (
        <p role="alert" className="text-danger">
          That didn&apos;t work. Please try again.
        </p>
      ) : null}
    </div>
  );
}
