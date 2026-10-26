"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { inputClass, primaryButtonClass } from "@/components/ui/styles";
import { totpCodeSchema } from "@/lib/validation/auth";

type Enrolment = { factorId: string; qrCode: string; secret: string };

export function EnrolForm() {
  const router = useRouter();
  const started = useRef(false);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const supabase = createClient();
      // Clear any half-finished set-up so the QR code is always fresh.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString()}`,
      });
      if (error || !data) {
        setError("We couldn't start the set-up. Please refresh the page and try again.");
        return;
      }
      setEnrolment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enrolment) return;
    const parsed = totpCodeSchema.safeParse(new FormData(e.currentTarget).get("code"));
    if (!parsed.success) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId: enrolment.factorId,
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
    <div className="space-y-6">
      {enrolment ? (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI from Supabase */}
          <img
            src={enrolment.qrCode}
            alt="QR code to scan with your authenticator app"
            width={200}
            height={200}
            className="mx-auto rounded-lg bg-white p-2"
          />
          <p className="text-sm text-text-muted">
            Can&apos;t scan? Enter this key in your app instead:{" "}
            <code className="break-all text-text">{enrolment.secret}</code>
          </p>
        </div>
      ) : (
        <p className="text-text-muted" role="status">
          Preparing your code…
        </p>
      )}

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
            className={inputClass}
          />
        </div>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={!enrolment || busy} className={primaryButtonClass}>
          {busy ? "Checking…" : "Confirm and continue"}
        </button>
      </form>
    </div>
  );
}
