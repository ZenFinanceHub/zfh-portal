"use client";

import { useActionState } from "react";
import { requestSignInLink, type LoginState } from "@/app/auth/actions";
import { inputClass, primaryButtonClass } from "@/components/ui/styles";

const initial: LoginState = { sent: false };

export function LoginForm() {
  const [state, action, pending] = useActionState(requestSignInLink, initial);

  if (state.sent) {
    return (
      <p role="status" className="text-text">
        If you have an account, we&apos;ve emailed you a sign-in link.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="mb-2 block text-base font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className={inputClass}
          aria-invalid={state.invalid || undefined}
          aria-describedby={state.invalid ? "email-error" : undefined}
        />
        {state.invalid ? (
          <p id="email-error" role="alert" className="mt-2 text-danger">
            Please enter a valid email address.
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
