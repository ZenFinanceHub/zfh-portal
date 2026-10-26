"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cardClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { ROLE_LABELS } from "@/lib/labels";
import { inviteContactSchema } from "@/lib/validation/client";

export function InviteContact({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = Object.fromEntries(new FormData(form));
    const parsed = inviteContactSchema.safeParse({ ...raw, client_id: clientId });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      setMessage(null);
      return;
    }
    setErrors({});
    setBusy(true);
    const { data, error } = await createClient().functions.invoke("invite-contact", { body: parsed.data });
    setBusy(false);

    if (error || !data?.ok) {
      setMessage({ ok: false, text: "We couldn't send that invite. Check the details and try again." });
      return;
    }
    setMessage({
      ok: true,
      text: data.invited
        ? "Invite sent. They'll get an email with a link to set up their access."
        : "Added. They already have an account, so no email was sent.",
    });
    form.reset();
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Invite contact
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className={`${cardClass} space-y-4`} noValidate>
      <h3 className="text-lg font-semibold">Invite contact</h3>

      <div>
        <label htmlFor="full_name" className="mb-2 block text-base font-medium">
          Name
        </label>
        <input id="full_name" name="full_name" autoComplete="off" className={inputClass} required />
        {errors.full_name ? <p role="alert" className="mt-1 text-danger">{errors.full_name}</p> : null}
      </div>

      <div>
        <label htmlFor="email" className="mb-2 block text-base font-medium">
          Email address
        </label>
        <input id="email" name="email" type="email" inputMode="email" autoComplete="off" className={inputClass} required />
        {errors.email ? <p role="alert" className="mt-1 text-danger">{errors.email}</p> : null}
      </div>

      <div>
        <label htmlFor="role" className="mb-2 block text-base font-medium">
          Role
        </label>
        <select id="role" name="role" defaultValue="owner" className={inputClass}>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-text-muted">
          Owners can approve work and give consents. Contributors can only upload and answer on jobs
          they&apos;re added to.
        </p>
      </div>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-gold-light" : "text-danger"}
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <button type="submit" disabled={busy} className={`${primaryButtonClass} sm:w-auto`}>
          {busy ? "Sending…" : "Send invite"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          Close
        </button>
      </div>
    </form>
  );
}
