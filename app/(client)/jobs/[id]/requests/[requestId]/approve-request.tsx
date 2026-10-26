"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cardClass, primaryButtonClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";

export function ApproveRequest({ requestId, blocked = false }: { requestId: string; blocked?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("submit_request", { p_request_id: requestId });
    if (error) {
      setBusy(false);
      setError("We couldn't send that just now. Please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className={`${cardClass} space-y-4`}>
      <p>By selecting &ldquo;I approve&rdquo; you confirm you have looked at the above and are happy for us to go ahead.</p>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <button type="button" onClick={approve} disabled={busy || blocked} className={primaryButtonClass}>
        {busy ? "Sending…" : "I approve"}
      </button>
    </div>
  );
}
