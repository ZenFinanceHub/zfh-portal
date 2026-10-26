"use client";

import { inputClass } from "@/components/ui/styles";
import {
  CONSENT_TYPES,
  CONSENT_TYPE_LABELS,
  KIND_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  REQUEST_KINDS,
} from "@/lib/validation/request";

export type RequestFieldValues = {
  kind: string;
  title: string;
  help_text: string;
  question_type: string;
  options_text: string; // one choice per line
  consent_type: string;
};

export const emptyRequestFields: RequestFieldValues = {
  kind: "upload",
  title: "",
  help_text: "",
  question_type: "text",
  options_text: "",
  consent_type: "lender_share",
};

type Props = {
  idPrefix: string;
  value: RequestFieldValues;
  onChange: (next: RequestFieldValues) => void;
  /** Form field names are only set when the fields live in a normal form post. */
  named?: boolean;
  lockKind?: boolean;
  errors?: Partial<Record<string, string>>;
};

function Row({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-base font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-sm text-text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RequestFields({ idPrefix, value, onChange, named, lockKind, errors = {} }: Props) {
  const set = (patch: Partial<RequestFieldValues>) => onChange({ ...value, ...patch });
  const n = (name: string) => (named ? name : undefined);

  return (
    <div className="space-y-4">
      <Row id={`${idPrefix}-kind`} label="Kind" error={errors.kind}>
        {lockKind ? <input type="hidden" name={n("kind")} value={value.kind} /> : null}
        <select
          id={`${idPrefix}-kind`}
          name={lockKind ? undefined : n("kind")}
          value={value.kind}
          disabled={lockKind}
          onChange={(e) => set({ kind: e.target.value })}
          className={inputClass}
        >
          {REQUEST_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Row>

      <Row id={`${idPrefix}-title`} label="Title (what the client sees)" error={errors.title}>
        <input
          id={`${idPrefix}-title`}
          name={n("title")}
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          autoComplete="off"
          className={inputClass}
        />
      </Row>

      <Row id={`${idPrefix}-help`} label="Help text" error={errors.help_text} hint="Optional. A line of plain-English guidance.">
        <textarea
          id={`${idPrefix}-help`}
          name={n("help_text")}
          value={value.help_text}
          onChange={(e) => set({ help_text: e.target.value })}
          rows={2}
          className={`${inputClass} py-3`}
        />
      </Row>

      {value.kind === "question" ? (
        <>
          <Row id={`${idPrefix}-qtype`} label="Question type" error={errors.question_type}>
            <select
              id={`${idPrefix}-qtype`}
              name={n("question_type")}
              value={value.question_type}
              onChange={(e) => set({ question_type: e.target.value })}
              className={inputClass}
            >
              {QUESTION_TYPES.map((q) => (
                <option key={q} value={q}>
                  {QUESTION_TYPE_LABELS[q]}
                </option>
              ))}
            </select>
          </Row>
          {value.question_type === "choice" ? (
            <Row id={`${idPrefix}-options`} label="Choices" error={errors.options} hint="One choice per line.">
              <textarea
                id={`${idPrefix}-options`}
                name={n("options")}
                value={value.options_text}
                onChange={(e) => set({ options_text: e.target.value })}
                rows={4}
                className={`${inputClass} py-3`}
              />
            </Row>
          ) : null}
        </>
      ) : null}

      {value.kind === "consent" ? (
        <Row id={`${idPrefix}-consent`} label="Consent type" error={errors.consent_type}>
          <select
            id={`${idPrefix}-consent`}
            name={n("consent_type")}
            value={value.consent_type}
            onChange={(e) => set({ consent_type: e.target.value })}
            className={inputClass}
          >
            {CONSENT_TYPES.map((c) => (
              <option key={c} value={c}>
                {CONSENT_TYPE_LABELS[c]}
              </option>
            ))}
          </select>
        </Row>
      ) : null}
    </div>
  );
}
