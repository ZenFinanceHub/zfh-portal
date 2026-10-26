"use client";

import { useActionState, useState } from "react";
import type { FormState } from "../actions";
import { RequestFields, emptyRequestFields, type RequestFieldValues } from "@/components/admin/request-fields";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function Feedback({ state }: { state: FormState }) {
  return state.error ? (
    <p role="alert" className="text-danger">
      {state.error}
    </p>
  ) : null;
}

function DueDate({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-base font-medium">
        Due date
      </label>
      <input id={id} name="due_date" type="date" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      {error ? (
        <p role="alert" className="mt-1 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── Add a request ────────────────────────────────────────────
function AddRequestInner({ action, onClose }: { action: Action; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [fields, setFields] = useState<RequestFieldValues>(emptyRequestFields);
  const [due, setDue] = useState("");

  // After a successful add, the parent remounts this component (key = version) to clear the form.
  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-line bg-surface p-4" noValidate>
      <h3 className="text-lg font-semibold">Add a request</h3>
      <RequestFields idPrefix="add" value={fields} onChange={setFields} named errors={state.fieldErrors} />
      <DueDate id="add-due" value={due} onChange={setDue} error={state.fieldErrors?.due_date} />
      <Feedback state={state} />
      {state.ok ? (
        <p role="status" className="text-gold-light">
          Request added.
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
          {pending ? "Adding…" : "Add request"}
        </button>
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          Close
        </button>
      </div>
    </form>
  );
}

export function AddRequest({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Add a request
      </button>
    );
  }
  // Wrap the action so each successful add clears the fields by remounting the form.
  const wrapped: Action = async (prev, fd) => {
    const next = await action(prev, fd);
    if (next.ok) setRound((r) => r + 1);
    return next;
  };
  return <AddRequestInner key={round} action={wrapped} onClose={() => setOpen(false)} />;
}

// ── Edit a request ───────────────────────────────────────────
export function EditRequest({
  requestId,
  action,
  initial,
  dueDate,
}: {
  requestId: string;
  action: Action;
  initial: RequestFieldValues;
  dueDate: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [fields, setFields] = useState<RequestFieldValues>(initial);
  const [due, setDue] = useState(dueDate);

  return (
    <details className="rounded-lg border border-line">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base text-gold">Edit request</summary>
      <form action={formAction} className="space-y-4 border-t border-line p-4" noValidate>
        <RequestFields idPrefix={`edit-${requestId}`} value={fields} onChange={setFields} named lockKind errors={state.fieldErrors} />
        <DueDate id={`edit-due-${requestId}`} value={due} onChange={setDue} error={state.fieldErrors?.due_date} />
        <Feedback state={state} />
        {state.ok ? (
          <p role="status" className="text-gold-light">
            Saved.
          </p>
        ) : null}
        <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
    </details>
  );
}

// ── Return a submitted request with a reason ─────────────────
export function ReturnForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [reason, setReason] = useState("");
  return (
    <details className="rounded-lg border border-line">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base text-gold">Return with reason</summary>
      <form action={formAction} className="space-y-3 border-t border-line p-4" noValidate>
        <label htmlFor="reason" className="block text-base font-medium">
          What does the client need to change?
        </label>
        <textarea id="reason" name="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} py-3`} />
        {state.fieldErrors?.reason ? (
          <p role="alert" className="text-danger">
            {state.fieldErrors.reason}
          </p>
        ) : null}
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
          {pending ? "Returning…" : "Return to client"}
        </button>
      </form>
    </details>
  );
}

// ── Internal note ────────────────────────────────────────────
export function NoteForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [body, setBody] = useState("");
  const [lastVersion, setLastVersion] = useState(state.version ?? 0);
  // Clear the box after a note is saved (the version changes), but keep it after an error.
  if ((state.version ?? 0) !== lastVersion) {
    setLastVersion(state.version ?? 0);
    setBody("");
  }
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <label htmlFor="note" className="block text-base font-medium">
        Add an internal note
      </label>
      <textarea id="note" name="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} className={`${inputClass} py-3`} />
      {state.fieldErrors?.body ? (
        <p role="alert" className="text-danger">
          {state.fieldErrors.body}
        </p>
      ) : null}
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
        {pending ? "Saving…" : "Save note"}
      </button>
    </form>
  );
}
