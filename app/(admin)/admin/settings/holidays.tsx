"use client";

import { useActionState } from "react";
import { addBankHoliday, removeBankHoliday, type NotificationState } from "./actions";
import { cardClass, inputClass, secondaryButtonClass } from "@/components/ui/styles";
import { formatDate } from "@/lib/labels";

export type Holiday = { date: string; name: string };

export function Holidays({ region, regionLabel, holidays }: { region: string; regionLabel: string; holidays: Holiday[] }) {
  const [state, action, pending] = useActionState<NotificationState, FormData>(addBankHoliday.bind(null, region), {});

  return (
    <section className={`${cardClass} !p-4 space-y-4`} data-testid="bank-holidays">
      <h2 className="text-lg font-semibold">Bank holidays ({regionLabel})</h2>
      <p className="text-sm text-text-muted">
        Upcoming days with no reminders and no non-urgent alerts. Add or remove days if the government announces a change.
      </p>
      {holidays.length === 0 ? (
        <p className="text-text-muted">No upcoming bank holidays on the list. Add the next ones below.</p>
      ) : (
        <ul className="divide-y divide-line">
          {holidays.map((h) => (
            <li key={h.date} className="flex min-h-11 items-center justify-between gap-3 py-1" data-testid="holiday-row">
              <span>
                {formatDate(h.date)} — {h.name}
              </span>
              <form action={removeBankHoliday.bind(null, region, h.date)}>
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center text-gold underline underline-offset-4"
                  aria-label={`Remove ${h.name} ${formatDate(h.date)}`}
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={action} className="space-y-3 border-t border-line pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="holiday_date" className="mb-1 block text-base font-medium">
              Date
            </label>
            <input id="holiday_date" name="holiday_date" type="date" required className={inputClass} />
          </div>
          <div>
            <label htmlFor="holiday_name" className="mb-1 block text-base font-medium">
              Name
            </label>
            <input id="holiday_name" name="name" type="text" required maxLength={80} className={inputClass} />
          </div>
        </div>
        {state.error ? (
          <p role="alert" className="text-danger">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p role="status" className="text-gold-light">
            Added.
          </p>
        ) : null}
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "Adding…" : "Add bank holiday"}
        </button>
      </form>
    </section>
  );
}
