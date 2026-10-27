"use client";

import { startTransition, useActionState } from "react";
import { saveNotificationSettings, type NotificationState } from "./actions";
import { cardClass, inputClass, primaryButtonClass } from "@/components/ui/styles";

export type NotificationValues = {
  staff_batch_minutes: number;
  client_bundle_minutes: number;
  quiet_start: string;
  quiet_end: string;
  urgent_approvals: boolean;
  urgent_lender_consents: boolean;
  urgent_finance_activity: boolean;
  digest_enabled: boolean;
  digest_time: string;
  fallback_email: string;
  reminders_enabled: boolean;
  reminder_days: number[];
  bank_holiday_region: string;
};

const hhmm = (t: string) => t.slice(0, 5);

function Check({ name, label, checked, hint }: { name: string; label: string; checked: boolean; hint?: string }) {
  return (
    <div>
      <label className="flex min-h-11 items-center gap-3 text-base">
        <input type="checkbox" name={name} defaultChecked={checked} className="size-5 accent-gold" />
        {label}
      </label>
      {hint ? <p className="ml-8 text-sm text-text-muted">{hint}</p> : null}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-base font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-sm text-text-muted">{hint}</p> : null}
    </div>
  );
}

export function NotificationForm({ values }: { values: NotificationValues }) {
  const [state, action, pending] = useActionState<NotificationState, FormData>(saveNotificationSettings, {});

  return (
    <form
      noValidate
      className="space-y-4"
      data-testid="notification-form"
      // Sent by hand so a message about one field does not wipe what was typed in the others.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <section className={`${cardClass} !p-4 space-y-4`}>
        <h2 className="text-lg font-semibold">Alerts to you and the team</h2>
        <Field
          id="staff_batch_minutes"
          label="Wait this many minutes after a client's last activity"
          hint="You get one email per client, this long after they stop. Never one email per file."
        >
          <input id="staff_batch_minutes" name="staff_batch_minutes" type="number" min={1} max={240} defaultValue={values.staff_batch_minutes} className={inputClass} />
        </Field>
        <Field
          id="fallback_email"
          label="Send to this address when a job has no assigned team member"
          hint="Also where the daily digest goes."
        >
          <input id="fallback_email" name="fallback_email" type="email" defaultValue={values.fallback_email} className={inputClass} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-base font-medium">Send straight away, even in quiet hours</legend>
          <Check name="urgent_approvals" label="Approvals" checked={values.urgent_approvals} />
          <Check name="urgent_lender_consents" label="Agreement to share with lenders" checked={values.urgent_lender_consents} />
          <Check
            name="urgent_finance_activity"
            label="Any upload or submission on a finance application"
            checked={values.urgent_finance_activity}
          />
        </fieldset>
      </section>

      <section className={`${cardClass} !p-4 space-y-4`}>
        <h2 className="text-lg font-semibold">Quiet hours</h2>
        <p className="text-sm text-text-muted">
          Alerts that aren&apos;t urgent are held during quiet hours, at weekends and on the bank holidays below, then sent
          together when the next working day starts.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="quiet_start" label="Quiet hours start (evening)">
            <input id="quiet_start" name="quiet_start" type="time" defaultValue={hhmm(values.quiet_start)} className={inputClass} />
          </Field>
          <Field id="quiet_end" label="Quiet hours end (morning)">
            <input id="quiet_end" name="quiet_end" type="time" defaultValue={hhmm(values.quiet_end)} className={inputClass} />
          </Field>
        </div>
        <Field id="bank_holiday_region" label="Bank holidays to use">
          <select id="bank_holiday_region" name="bank_holiday_region" defaultValue={values.bank_holiday_region} className={inputClass}>
            <option value="scotland">Scotland</option>
            <option value="england_wales">England and Wales</option>
          </select>
        </Field>
      </section>

      <section className={`${cardClass} !p-4 space-y-4`}>
        <h2 className="text-lg font-semibold">Daily digest</h2>
        <Check name="digest_enabled" label="Send a daily digest on working days" checked={values.digest_enabled} hint="Skipped when nothing happened." />
        <Field id="digest_time" label="Digest time">
          <input id="digest_time" name="digest_time" type="time" defaultValue={hhmm(values.digest_time)} className={inputClass} />
        </Field>
      </section>

      <section className={`${cardClass} !p-4 space-y-4`}>
        <h2 className="text-lg font-semibold">Emails to clients</h2>
        <Field
          id="client_bundle_minutes"
          label="Bundle new requests and messages sent within this many minutes"
          hint="Each person gets one email per job, this long after the last one was added."
        >
          <input id="client_bundle_minutes" name="client_bundle_minutes" type="number" min={1} max={240} defaultValue={values.client_bundle_minutes} className={inputClass} />
        </Field>
        <Check name="reminders_enabled" label="Send reminders" checked={values.reminders_enabled} hint="On working days only. Clients can switch them off in their account." />
        <Field
          id="reminder_days"
          label="Remind this many days before the due date"
          hint="Separate with commas. A reminder also goes once when something becomes overdue."
        >
          <input id="reminder_days" name="reminder_days" type="text" defaultValue={values.reminder_days.join(", ")} className={inputClass} />
        </Field>
      </section>

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
        {pending ? "Saving…" : "Save notification settings"}
      </button>
    </form>
  );
}
