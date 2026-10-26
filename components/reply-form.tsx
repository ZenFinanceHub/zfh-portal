"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { inputClass, primaryButtonClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { messageSchema } from "@/lib/validation/answers";

export function ReplyForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const parsed = messageSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please write a message.");
      return;
    }
    setBusy(true);
    setError(null);
    // Never an internal note: clients can only write messages the whole team and their colleagues can read.
    const { error: insertError } = await createClient()
      .from("messages")
      .insert({ job_id: jobId, body: parsed.data.body, internal: false });
    setBusy(false);
    if (insertError) {
      setError("We couldn't send that just now. Please try again.");
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <form onSubmit={send} className="space-y-3" noValidate>
      <label htmlFor={id} className="block text-base font-medium">
        Write a message
      </label>
      <textarea
        id={id}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className={`${inputClass} py-3`}
      />
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
