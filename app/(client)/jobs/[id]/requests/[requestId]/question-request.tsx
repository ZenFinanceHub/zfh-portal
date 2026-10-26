"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cardClass, inputClass, primaryButtonClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { answerToInput, buildAnswer, formatAmount, parseAmount, type QuestionType } from "@/lib/validation/answers";

type Props = {
  requestId: string;
  title: string;
  type: QuestionType;
  options: string[];
  /** The person's previous answer, if the request was returned to them. */
  previousValue?: unknown;
};

const draftKey = (requestId: string) => `zfh-draft:${requestId}`;

// Local storage can be blocked or full (private windows, etc.), so every use is wrapped.
function loadDraft(requestId: string): string | null {
  try {
    return window.localStorage.getItem(draftKey(requestId));
  } catch {
    return null;
  }
}
function saveDraft(requestId: string, value: string) {
  try {
    if (value) window.localStorage.setItem(draftKey(requestId), value);
    else window.localStorage.removeItem(draftKey(requestId));
  } catch {
    /* autosave is a convenience only */
  }
}
function clearDraft(requestId: string) {
  try {
    window.localStorage.removeItem(draftKey(requestId));
  } catch {
    /* ignore */
  }
}

export function QuestionRequest({ requestId, title, type, options, previousValue }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(() => answerToInput(type, previousValue));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bring back anything typed earlier on this device (runs once, after the page loads).
  useEffect(() => {
    const draft = loadDraft(requestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage can only happen after mount
    if (draft) setValue(draft);
  }, [requestId]);

  function change(next: string) {
    setValue(next);
    setError(null);
    saveDraft(requestId, next);
    setSaved(!!next);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const built = buildAnswer(type, value, options);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("responses").insert({
      request_id: requestId,
      answer: { value: built.value },
    });
    const { error: submitError } = insertError
      ? { error: insertError }
      : await supabase.rpc("submit_request", { p_request_id: requestId });
    if (insertError || submitError) {
      setBusy(false);
      setError("We couldn't send that just now. Your answer is saved on this device — please try again.");
      return;
    }
    clearDraft(requestId);
    router.refresh();
  }

  const choiceClass = (selected: boolean) =>
    `flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg border px-4 text-base ${
      selected ? "border-gold bg-ink" : "border-line"
    }`;

  return (
    <form onSubmit={send} className={`${cardClass} space-y-4`} noValidate>
      {type === "yes_no" || type === "choice" ? (
        <fieldset className="space-y-2">
          <legend className="sr-only">{title}</legend>
          {(type === "yes_no"
            ? [
                { v: "yes", label: "Yes" },
                { v: "no", label: "No" },
              ]
            : options.map((o) => ({ v: o, label: o }))
          ).map((o) => (
            <label key={o.v} className={choiceClass(value === o.v)}>
              <input
                type="radio"
                name="answer"
                value={o.v}
                checked={value === o.v}
                onChange={() => change(o.v)}
                className="size-5 accent-gold"
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <div>
          <label htmlFor="answer" className="mb-2 block text-base font-medium">
            Your answer
          </label>
          {type === "text" ? (
            <textarea
              id="answer"
              value={value}
              onChange={(e) => change(e.target.value)}
              rows={5}
              className={`${inputClass} py-3`}
            />
          ) : type === "date" ? (
            <input id="answer" type="date" value={value} onChange={(e) => change(e.target.value)} className={inputClass} />
          ) : (
            <input
              id="answer"
              inputMode="decimal"
              autoComplete="off"
              placeholder="£0.00"
              value={value}
              onChange={(e) => change(e.target.value)}
              onBlur={() => {
                const n = parseAmount(value);
                if (n !== null) change(formatAmount(n));
              }}
              className={inputClass}
            />
          )}
        </div>
      )}

      {saved && !error ? <p className="text-sm text-text-muted">Saved on this device as you type.</p> : null}
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Sending…" : "Send to ZenFinanceHub"}
      </button>
    </form>
  );
}
