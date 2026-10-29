"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { consentText, wordingFor } from "@/lib/consents";
import { createClientForwardingVisitor } from "@/lib/supabase/server";

export type ConsentState = { error?: string };

// The wording is supplied here, by the server, from lib/consents.ts, never taken from the browser,
// so the stored text is exactly what was shown. Only account owners can consent (the database checks).
export async function giveConsent(requestId: string, _prev: ConsentState, formData: FormData): Promise<ConsentState> {
  if (!z.uuid().safeParse(requestId).success || formData.get("agree") !== "on") {
    return { error: "Please tick the box to agree." };
  }

  const supabase = await createClientForwardingVisitor();
  const { data: request } = await supabase
    .from("requests")
    .select("job_id, kind, consent_type, partner_firm, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request || request.kind !== "consent" || !request.consent_type) {
    return { error: "We couldn't find that request." };
  }

  const wording = wordingFor(request.consent_type, request.partner_firm);
  if (!wording) return { error: "We couldn't record that just now. Please try again, or message us." };
  const { error } = await supabase.rpc("record_consent", {
    p_request_id: requestId,
    p_wording_version: wording.version,
    p_wording_text: consentText(wording),
    p_recipient: wording.recipient,
  });
  if (error) return { error: "We couldn't record that just now. Please try again, or message us." };

  revalidatePath(`/jobs/${request.job_id}/requests/${requestId}`);
  revalidatePath("/");
  return {};
}
