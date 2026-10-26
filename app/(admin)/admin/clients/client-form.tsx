"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ClientFormState } from "./actions";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { CLIENT_STATUS_LABELS, ENTITY_TYPE_LABELS } from "@/lib/labels";

type Staff = { id: string; name: string };

type Props = {
  action: (prev: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  defaults: Record<string, string>;
  staff: Staff[];
  cancelHref: string;
  submitLabel: string;
};

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-sm text-text-muted">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ClientForm({ action, defaults, staff, cancelHref, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = { ...defaults, ...state.values };
  const e = state.errors ?? {};
  const aria = (name: string) => ({
    "aria-invalid": e[name] ? true : undefined,
    "aria-describedby": e[name] ? `${name}-error` : undefined,
  });

  // `key` remounts the fields after a failed save so they keep what was typed.
  return (
    <form action={formAction} key={state.version ?? 0} className="space-y-5" noValidate>
      <Field id="name" label="Client name" error={e.name}>
        <input id="name" name="name" defaultValue={v.name} required autoComplete="off" className={inputClass} {...aria("name")} />
      </Field>

      <Field id="entity_type" label="Type" error={e.entity_type}>
        <select id="entity_type" name="entity_type" defaultValue={v.entity_type} className={inputClass} {...aria("entity_type")}>
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="company_number" label="Company number" error={e.company_number}>
        <input id="company_number" name="company_number" defaultValue={v.company_number} autoComplete="off" className={inputClass} {...aria("company_number")} />
      </Field>

      <Field id="utr" label="UTR" error={e.utr} hint="10 digits">
        <input id="utr" name="utr" inputMode="numeric" defaultValue={v.utr} autoComplete="off" className={inputClass} {...aria("utr")} />
      </Field>

      <Field id="xero_contact_id" label="Xero contact ID" error={e.xero_contact_id}>
        <input id="xero_contact_id" name="xero_contact_id" defaultValue={v.xero_contact_id} autoComplete="off" className={inputClass} {...aria("xero_contact_id")} />
      </Field>

      <Field id="year_end" label="Year end" error={e.year_end}>
        <input id="year_end" name="year_end" type="date" defaultValue={v.year_end} className={inputClass} {...aria("year_end")} />
      </Field>

      <Field id="assigned_to" label="Assigned to" error={e.assigned_to}>
        <select id="assigned_to" name="assigned_to" defaultValue={v.assigned_to} className={inputClass} {...aria("assigned_to")}>
          <option value="">Not assigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id="status" label="Status" error={e.status}>
        <select id="status" name="status" defaultValue={v.status} className={inputClass} {...aria("status")}>
          {Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {state.message ? (
        <p role="alert" className="rounded-lg border border-danger p-3 text-danger">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href={cancelHref} className={secondaryButtonClass}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
