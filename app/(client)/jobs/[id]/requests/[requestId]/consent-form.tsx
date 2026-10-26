"use client";

import { useActionState, useState } from "react";
import { giveConsent, type ConsentState } from "./actions";
import { cardClass, primaryButtonClass } from "@/components/ui/styles";

export function ConsentForm({ requestId, agreeLabel }: { requestId: string; agreeLabel: string }) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(giveConsent.bind(null, requestId), {});
  const [ticked, setTicked] = useState(false);

  return (
    <form action={action} className={`${cardClass} space-y-4`}>
      <label className="flex items-start gap-3 text-base">
        <input
          type="checkbox"
          name="agree"
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
          className="mt-1 size-6 shrink-0 accent-gold"
        />
        <span>{agreeLabel}</span>
      </label>
      {state.error ? (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={!ticked || pending} className={primaryButtonClass}>
        {pending ? "Sending…" : "I agree"}
      </button>
    </form>
  );
}
