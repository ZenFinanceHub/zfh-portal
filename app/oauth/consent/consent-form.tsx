"use client";

import { useState, useTransition } from "react";
import { decide } from "./actions";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";

export function ConsentForm({ authorizationId }: { authorizationId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(approve: boolean) {
    setError(null);
    start(async () => {
      const result = await decide(authorizationId, approve);
      if (result.redirectUrl) window.location.assign(result.redirectUrl);
      else setError(result.error ?? "Something went wrong. Please start again from Claude.");
    });
  }

  return (
    <div className="mt-6 space-y-3">
      {error ? (
        <p role="alert" className="rounded-lg border border-danger p-3 text-danger">
          {error}
        </p>
      ) : null}
      <button type="button" disabled={pending} onClick={() => choose(true)} className={primaryButtonClass}>
        {pending ? "One moment…" : "Allow Claude to help me"}
      </button>
      <button type="button" disabled={pending} onClick={() => choose(false)} className={`${secondaryButtonClass} w-full`}>
        Don&apos;t allow
      </button>
    </div>
  );
}
