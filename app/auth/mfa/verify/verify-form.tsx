"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { inputClass, primaryButtonClass } from "@/components/ui/styles";
import { totpCodeSchema } from "@/lib/validation/auth";

export function VerifyForm({ factorId }: { factorId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = totpCodeSchema.safeParse(new FormData(e.currentTarget).get("code"));
    if (!parsed.success) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId,
      code: parsed.data,
    });
    if (error) {
      setBusy(false);
      setError("That code isn't right. Check the latest code in your app and try again.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="code" className="mb-2 block text-base font-medium">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          className={inputClass}
        />
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
