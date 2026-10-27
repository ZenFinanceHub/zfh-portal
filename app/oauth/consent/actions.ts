"use server";

import { isStaff } from "@/lib/auth/routing";
import { isAllowedRedirect, isAuthorizationId } from "@/lib/connector/return-to";
import { createClient } from "@/lib/supabase/server";

export type DecisionState = { redirectUrl?: string; error?: string };

const TRY_AGAIN = "Something went wrong. Please start again from Claude.";

// Approving is the one moment the connector's grant is created, and the database only creates it for a staff member
// whose session has passed their authenticator code (aal2). If either is missing, nothing is approved.
export async function decide(authorizationId: string, approve: boolean): Promise<DecisionState> {
  if (!isAuthorizationId(authorizationId)) return { error: TRY_AGAIN };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims || claims.aal !== "aal2" || !(await isStaff(supabase, claims.sub))) {
    return { error: "Please sign in with your authenticator code first, then try again." };
  }

  if (approve) {
    const { data: appId } = await supabase.rpc("connector_authorization_client", { p_authorization_id: authorizationId });
    if (!appId) return { error: TRY_AGAIN };
    const { error } = await supabase.rpc("connector_record_grant", { p_client_id: appId });
    if (error) return { error: "We couldn't record your approval. Please sign in again with your authenticator code." };
  }

  const result = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  const url = result.data?.redirect_url;
  if (result.error || !url || !isAllowedRedirect(url)) return { error: TRY_AGAIN };
  return { redirectUrl: url };
}
