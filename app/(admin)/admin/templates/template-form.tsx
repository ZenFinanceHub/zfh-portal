"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import type { TemplateFormState } from "./actions";
import { RequestFields, emptyRequestFields, type RequestFieldValues } from "@/components/admin/request-fields";
import { cardClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { parseOptions } from "@/lib/validation/request";

export type Blueprint = {
  kind: string;
  title: string;
  help_text?: string;
  question_type?: string;
  options?: string[];
  consent_type?: string;
  due_offset_days?: number;
};

type Item = RequestFieldValues & { key: number; due_offset_days: string };

const toItem = (b: Blueprint, key: number): Item => ({
  key,
  kind: b.kind,
  title: b.title ?? "",
  help_text: b.help_text ?? "",
  question_type: b.question_type ?? "text",
  options_text: (b.options ?? []).join("\n"),
  consent_type: b.consent_type ?? "lender_share",
  partner_firm: "",
  due_offset_days: b.due_offset_days === undefined ? "" : String(b.due_offset_days),
});

// Plain objects for the server to validate with zod; blank optional fields are left out there.
const toBlueprint = (i: Item) => ({
  kind: i.kind,
  title: i.title,
  help_text: i.help_text,
  question_type: i.kind === "question" ? i.question_type : undefined,
  options: i.kind === "question" && i.question_type === "choice" ? parseOptions(i.options_text) : undefined,
  consent_type: i.kind === "consent" ? i.consent_type : undefined,
  due_offset_days: i.due_offset_days.trim() === "" ? undefined : Number(i.due_offset_days),
});

type Props = {
  action: (prev: TemplateFormState, formData: FormData) => Promise<TemplateFormState>;
  template: { name: string; description: string; active: boolean; requests: Blueprint[] };
};

export function TemplateForm({ action, template }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const nextKey = useRef(template.requests.length);
  // Controlled, so a failed save keeps what was typed (React resets uncontrolled fields).
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [active, setActive] = useState(template.active);
  const [items, setItems] = useState<Item[]>(() => template.requests.map(toItem));

  const update = (key: number, next: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...next } : i)));
  const move = (index: number, by: -1 | 1) =>
    setItems((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });
  const remove = (key: number) => setItems((list) => list.filter((i) => i.key !== key));
  const add = () =>
    setItems((list) => [...list, { ...emptyRequestFields, key: nextKey.current++, due_offset_days: "" }]);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="requests" value={JSON.stringify(items.map(toBlueprint))} />

      <div className={`${cardClass} space-y-4`}>
        <div>
          <label htmlFor="name" className="mb-2 block text-base font-medium">
            Name
          </label>
          <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          {state.fieldErrors?.name ? <p role="alert" className="mt-1 text-danger">{state.fieldErrors.name}</p> : null}
        </div>
        <div>
          <label htmlFor="description" className="mb-2 block text-base font-medium">
            Description
          </label>
          <textarea id="description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputClass} py-3`} />
          {state.fieldErrors?.description ? <p role="alert" className="mt-1 text-danger">{state.fieldErrors.description}</p> : null}
        </div>
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-gold" />
          Active (can be used for new jobs)
        </label>
      </div>

      <section aria-labelledby="blueprints" className="space-y-4">
        <h2 id="blueprints" className="text-xl font-semibold">
          Requests
        </h2>
        <p className="text-sm text-text-muted">
          Requests with a due offset are created when a job starts, due that many days later. Requests
          without one (for example approvals) are held back and added later with one click.
        </p>

        {items.length === 0 ? <p className="text-text-muted">No requests yet.</p> : null}

        <ol className="space-y-4">
          {items.map((item, index) => (
            <li key={item.key} className={`${cardClass} !p-4 space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">Request {index + 1}</h3>
                <div className="flex gap-2">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move request ${index + 1} up`} className={`${secondaryButtonClass} disabled:opacity-40`}>
                    Up
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Move request ${index + 1} down`} className={`${secondaryButtonClass} disabled:opacity-40`}>
                    Down
                  </button>
                  <button type="button" onClick={() => remove(item.key)} aria-label={`Remove request ${index + 1}`} className={`${secondaryButtonClass} text-danger`}>
                    Remove
                  </button>
                </div>
              </div>
              <RequestFields idPrefix={`bp-${item.key}`} value={item} onChange={(v) => update(item.key, v)} noFirm />
              <div>
                <label htmlFor={`bp-${item.key}-due`} className="mb-1 block text-base font-medium">
                  Due offset (days after the job starts)
                </label>
                <input
                  id={`bp-${item.key}-due`}
                  inputMode="numeric"
                  value={item.due_offset_days}
                  onChange={(e) => update(item.key, { due_offset_days: e.target.value })}
                  className={inputClass}
                />
                <p className="mt-1 text-sm text-text-muted">Leave blank to add this request later.</p>
              </div>
            </li>
          ))}
        </ol>

        <button type="button" onClick={add} className={secondaryButtonClass}>
          Add a request
        </button>
      </section>

      {state.errors?.length ? (
        <ul role="alert" className="space-y-1 rounded-lg border border-danger p-3 text-danger">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
          {pending ? "Saving…" : "Save template"}
        </button>
        <Link href="/admin/templates" className={secondaryButtonClass}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
