"use client";

import { useActionState } from "react";
import { savePrivacyNoticeUrl, type NotificationState } from "./actions";
import { inputClass, primaryButtonClass } from "@/components/ui/styles";

export function PrivacyForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState<NotificationState, FormData>(savePrivacyNoticeUrl, {});

  return (
    <form action={action} noValidate className="space-y-3" data-testid="privacy-form">
      <div>
        <label htmlFor="privacy_notice_url" className="mb-1 block text-base font-medium">
          Privacy notice address
        </label>
        <input
          id="privacy_notice_url"
          name="privacy_notice_url"
          type="url"
          inputMode="url"
          defaultValue={current}
          placeholder="https://"
          autoComplete="off"
          className={inputClass}
        />
        <p className="mt-1 text-sm text-text-muted">It must start with https://</p>
      </div>
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
