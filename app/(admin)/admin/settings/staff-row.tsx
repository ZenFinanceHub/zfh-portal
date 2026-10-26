"use client";

import { useActionState } from "react";
import { saveStaffAreas, type StaffAreasState } from "./actions";
import { cardClass, secondaryButtonClass } from "@/components/ui/styles";
import { AREAS, AREA_LABELS, type Area } from "@/lib/areas";

type Props = { id: string; name: string; email: string; isAdmin: boolean; areas: Area[] };

export function StaffRow({ id, name, email, isAdmin, areas }: Props) {
  const [state, action, pending] = useActionState<StaffAreasState, FormData>(saveStaffAreas.bind(null, id), {});

  return (
    <li className={`${cardClass} !p-4`} data-testid="staff-row">
      <p className="text-base font-medium">{name}</p>
      <p className="text-sm text-text-muted">{email}</p>

      {isAdmin ? (
        <p className="mt-2 text-text-muted">Admin — always has access to both areas.</p>
      ) : (
        <form action={action} className="mt-3 space-y-1">
          <fieldset>
            <legend className="sr-only">Areas for {name}</legend>
            {AREAS.map((area) => (
              <label key={area} className="flex min-h-11 items-center gap-3 text-base">
                <input type="checkbox" name="areas" value={area} defaultChecked={areas.includes(area)} className="size-5 accent-gold" />
                {AREA_LABELS[area]}
              </label>
            ))}
          </fieldset>
          {areas.length === 0 ? <p className="text-sm text-text-muted">No access yet — they can&apos;t see any clients or jobs.</p> : null}
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
          <button type="submit" disabled={pending} className={secondaryButtonClass}>
            {pending ? "Saving…" : "Save access"}
          </button>
        </form>
      )}
    </li>
  );
}
