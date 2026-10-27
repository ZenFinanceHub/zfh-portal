"use client";

import { useActionState } from "react";
import { saveReminders, type RemindersState } from "./actions";
import { primaryButtonClass } from "@/components/ui/styles";

export function RemindersForm({ initial }: { initial: boolean }) {
  const [state, action, pending] = useActionState<RemindersState, FormData>(saveReminders, {});

  return (
    <form action={action} className="space-y-4">
      <label className="flex min-h-11 items-center gap-3 text-lg">
        <input type="checkbox" name="email_reminders" defaultChecked={initial} className="size-6 accent-gold" />
        Email me reminders
      </label>
      <p className="text-text-muted">
        A short email on working days when something is coming up or overdue. We&apos;ll always email you when
        something new needs doing and when you have a new message. Those can&apos;t be switched off.
      </p>
      {state.error ? (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-gold-light">
          Saved.
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
